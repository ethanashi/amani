// OS attestation port (V7-wire item 5). The narrow launcher (packages/omb-launcher, branch
// build/os-launcher) installs `cert-launch` at /usr/local/libexec/omb/bin, run as _ombcert via a
// sudoers rule. Its `attest` subcommand checks, as _ombcert, that _ombcert/_ombrun exist with the
// release uids, that the authority store and seal key are owned by _ombcert with 0700/0600 modes,
// and returns that attestation plus its release hash. V7 reaches it ONLY through the launcher
// client request (identical to omb-launcher's createClient: sudo -n -u _ombcert <install>/bin/
// cert-launch attest, JSON on stdin, bounded output) and then re-checks the reply against the real
// OS user database (module-level probe). No callback can supply or override the verdict; a missing
// install, a refusal, a malformed reply or a mismatch is never attested.
//
// Attestation alone does not make an investigation separated: the host's execution path must also
// run worker code as _ombrun with the store and key under _ombcert (HostCapabilities). The live
// route P path (KernelExecutor + the V5 compatibility ledger) runs in the owner account, so it stays
// degraded until the launcher backend and the native store carry route P (see BUILD-NOTES).

import { spawn } from "node:child_process";
import { createClient } from "../../omb-launcher/src/client.ts";
import { existsSync } from "node:fs";
import { systemUid } from "./os-probe.ts";
import type { OSAttestation, OSAttestationPort, OSAttestationResult } from "./ports.ts";

/** Release constants of the launcher (omb-launcher src/constants.ts), never environment overrides. */
export const LAUNCHER_INSTALL = "/usr/local/libexec/omb";
const LAUNCHER_REQUEST_CAP = 1024 * 1024, LAUNCHER_RESPONSE_CAP = 8 * 1024 * 1024, LAUNCHER_WALL_MS = 30_000;

export interface LauncherProcessRequest { command: string; args: string[]; input: Buffer; outputCap: number; timeoutMs: number }
export type LauncherExecute = (request: LauncherProcessRequest) => Promise<Buffer>;
export interface LauncherReply { ok: true; command: string; result: unknown }
export type LauncherClient = (command: "attest", request: Record<string, never>) => Promise<LauncherReply>;

/** Bounded child process: no shell, minimal environment; kills only the exact child it started. */
export const spawnExecute: LauncherExecute = (r) => new Promise((resolve, reject) => {
  let child;
  try { child = spawn(r.command, r.args, { cwd: "/", env: { PATH: "/usr/bin:/bin", HOME: "/var/empty", LANG: "C" }, stdio: ["pipe", "pipe", "pipe"] }); }
  catch { reject(new Error("launcher unavailable")); return; }
  const chunks: Buffer[] = [];
  let bytes = 0, settled = false;
  const finish = (error: Error | null, out?: Buffer): void => {
    if (settled) return;
    settled = true; clearTimeout(timer);
    if (error) { try { child.kill("SIGKILL"); } catch { /* the exact child only; never escalates */ } reject(error); } else resolve(out!);
  };
  const timer = setTimeout(() => finish(new Error("launcher timed out")), r.timeoutMs);
  child.stdout.on("data", (d: Buffer) => { bytes += d.length; if (bytes > r.outputCap) finish(new Error("launcher response exceeds cap")); else chunks.push(d); });
  child.stderr.resume(); // never returned: launcher diagnostics may be private
  child.on("error", () => finish(new Error("launcher unavailable")));
  child.on("close", (code) => (code === 0 ? finish(null, Buffer.concat(chunks)) : finish(new Error(`launcher exited with status ${code}`))));
  child.stdin.on("error", () => finish(new Error("launcher request transport failed")));
  child.stdin.end(r.input);
});

/** The launcher client request (omb-launcher createClient), restricted to `attest`. */
export function launcherClient(execute: LauncherExecute = spawnExecute): LauncherClient {
  const client=createClient(r=>execute({...r,input:Buffer.from(r.input)}));
  return async (command, request) => {
    if(command!=="attest")throw new Error("only cert-launch attest is used by V7");
    return client(command,request);
  };
}

const uid = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** Checks a cert-launch attest result against the real OS user database. Null when verified. */
export function attestationFault(result: unknown): string | null {
  const a = result as Partial<OSAttestation> | null;
  if (!a || typeof a !== "object") return "attestation missing";
  if (a.certUser !== "_ombcert" || a.runUser !== "_ombrun") return "attested users are not _ombcert/_ombrun";
  if (!uid(a.certUid) || !uid(a.runUid) || a.certUid === a.runUid) return "attested uids are not distinct unprivileged users";
  if (a.effectiveUid !== a.certUid) return "the launcher did not run as _ombcert";
  if (a.storeOwnerUid !== a.certUid || a.keyOwnerUid !== a.certUid) return "store or seal key not owned by _ombcert";
  if (a.storeMode !== 0o700 || a.keyMode !== 0o600) return "store or seal key permissions are not 0700/0600";
  if (typeof a.releaseHash !== "string" || !/^[a-f0-9]{64}$/.test(a.releaseHash)) return "launcher release hash missing";
  const cert = systemUid("_ombcert"), run = systemUid("_ombrun");
  if (cert === null || run === null) return "system accounts _ombcert/_ombrun are not resolvable on this host";
  if (cert !== a.certUid || run !== a.runUid) return "attested uids differ from the operating system";
  return null;
}

export interface LauncherAttestationOptions {
  /** The launcher client (production: launcherClient() over the bounded sudo process). */
  client?: LauncherClient;
  /** Whether cert-launch is installed (production: the release path exists). */
  installed?: () => boolean;
}

/** The production OSAttestationPort: real `cert-launch attest`, re-checked against the OS. */
export class LauncherAttestation implements OSAttestationPort {
  readonly #client: LauncherClient;
  readonly #installed: () => boolean;
  constructor(o: LauncherAttestationOptions = {}) {
    this.#client = o.client ?? launcherClient();
    this.#installed = o.installed ?? (() => existsSync(`${LAUNCHER_INSTALL}/bin/cert-launch`) && existsSync("/etc/sudoers.d/omb-launcher") && systemUid("_ombcert") !== null);
  }
  async attest(): Promise<OSAttestationResult> {
    if (!this.#installed()) return { attested: false, reason: "narrow launcher not installed or incomplete (account, cert-launch or sudoers missing). Use Install or repair launcher in Settings; installation is an owner action." };
    let reply: LauncherReply;
    try { reply = await this.#client("attest", {}); }
    catch (e) { return { attested: false, reason: `cert-launch attest failed: ${String((e as Error)?.message ?? e).slice(0, 200)}` }; }
    const fault = attestationFault(reply.result);
    if (fault) return { attested: false, reason: `cert-launch attestation refused: ${fault}` };
    const a = reply.result as OSAttestation;
    return { attested: true, attestation: { certUser: a.certUser, runUser: a.runUser, certUid: a.certUid, runUid: a.runUid, effectiveUid: a.effectiveUid, storeOwnerUid: a.storeOwnerUid, storeMode: a.storeMode, keyOwnerUid: a.keyOwnerUid, keyMode: a.keyMode, releaseHash: a.releaseHash, ...(typeof a.signingPublicKey === "string" ? {signingPublicKey:a.signingPublicKey} : {}), ...(typeof a.authorityProtocol === "string" ? {authorityProtocol:a.authorityProtocol} : {}) } };
  }
}
