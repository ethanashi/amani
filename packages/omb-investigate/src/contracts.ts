// ContractPort over the bio-tasks contract layout (K1a/K1b author contracts):
//   <contractsRoot>/index.json            host pins: [{ task, publicHash, status, ... }]
//   <contractsRoot>/<task>/public.json    the public layer envelope { content, hash }
//   <contractsRoot>/<task>/public.json.enc  (w0) the same, sealed with the host's seal-v2 key
//   <contractsRoot>/<task>/assets/*       public source assets (alias registries), some sealed
// The expected contract hash is the HOST INDEX pin, never a value read from the contract file or a
// worker file; the layer must hash to it or the pin is refused. The public layer and the assets are
// copied into a host-only cache; nothing here is ever mounted into a worker. A private envelope is
// never opened here (the host-only private layer stays sealed).
//
// Authentication: certifyDirectory computes units only on an authenticated contract (a
// ContractAuthority receipt). The receipt is issued at certification by the host authority, and only
// for a contract this port recorded as approved: by an explicit approval policy whose actor is
// journaled (the plan ApprovalPort pattern). Without an approval the contract is pinned and verified
// but unauthenticated, so G1/G1a cannot pass (fail closed).

import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { canonicalSha256 } from "../../bio-core/src/index.ts";
import { snapshotContractFiles, verifyContractBytes } from "../../omb-certify/src/index.ts";
import { openSealV2 } from "../../omb-store/src/seal-v2.ts";
import type { ContractPin, ContractPort } from "./ports.ts";
import type { Json } from "./types.ts";

export class ContractPinRefused extends Error {
  constructor(message: string) { super(`contract pin refused: ${message}`); this.name = "ContractPinRefused"; }
}

/** Decides whether a pinned contract may be authenticated by the host authority. The returned actor
 * is journaled with the pin; never claims an owner review that did not happen. */
export interface ContractApprovalPolicy {
  approve(request: { datasetId: string; publicHash: string; status: string }): { actor: "owner" | "policy"; reason: string } | null;
}

/** Approves the committed K1b author drafts as a recorded host policy (actor "policy"), not as an owner review. */
export function authorDraftPolicy(): ContractApprovalPolicy {
  return {
    approve: ({ status }) => status === "author-draft"
      ? { actor: "policy", reason: "author-draft contract approved by host policy for authentication (not an owner review); its bytes are verified against the staged data at stage and again at certification" }
      : null,
  };
}

export interface TaskContractPortOptions {
  /** packages/bio-tasks/contracts (or a test copy with the same layout). */
  contractsRoot: string;
  /** Host-only cache for the opened public layer and the assets. */
  cacheRoot: string;
  approval?: ContractApprovalPolicy;
  /** Host seal-v2 key for sealed public layers / assets (w0); absent = sealed material refused. */
  sealingKey?: () => Uint8Array | null;
}

const HEX = /^[a-f0-9]{64}$/;
const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Structural facts of the public layer that the plan check and the stager need (no values). */
export function contractDesign(structure: unknown): Json {
  const s = (structure && typeof structure === "object" ? structure : {}) as { unit_hierarchy?: { id: string; coarser_level: string | null; minimum_independent: boolean }[]; tables?: { file: { path: string }; orientation: { unit_axis: string }; columns?: { name: string }[];unit_derivation?:{level:string} }[] };
  const levels = Array.isArray(s.unit_hierarchy) ? s.unit_hierarchy : [];
  const floor = levels.find((l) => l.minimum_independent === true)?.id ?? null;
  const unitLevels: string[] = [];
  for (let at = floor, guard = 0; at !== null && guard < 64; guard++) {
    if (unitLevels.includes(at)) break;
    unitLevels.push(at);
    at = levels.find((l) => l.id === at)?.coarser_level ?? null;
  }
  const tables = (Array.isArray(s.tables) ? s.tables : []).filter((t) => t?.orientation?.unit_axis === "rows").map((t) => t.file.path).sort();
  // Blinding stays row-level: the contract's unit identity lives in host-only alias registries, not
  // in a worker-visible column (trustedBlinding unit null = row-level derangement).
  const tableColumns = Object.fromEntries((s.tables ?? []).filter((t) => t.orientation.unit_axis === "rows").map((t) => [t.file.path, (t.columns ?? []).map((c) => c.name)]));
  const tableUnits=Object.fromEntries((s.tables??[]).filter(t=>t.orientation.unit_axis==="rows"&&t.unit_derivation?.level).map(t=>[t.file.path,t.unit_derivation!.level]));
  return { floor, unitLevels, tables, tableColumns,tableUnits, unit: null, blindingStrata: [] };
}

export class TaskContractPort implements ContractPort {
  constructor(private readonly o: TaskContractPortOptions) {}

  #open(file: string): Buffer {
    const enc = readFileSync(file);
    const sidecar = `${file}.sha256`;
    if (existsSync(sidecar)) {
      const want = readFileSync(sidecar, "utf8").trim().split(/\s+/)[0] ?? "";
      if (!HEX.test(want) || want !== sha256(enc)) throw new ContractPinRefused(`${path.basename(file)} differs from its digest sidecar`);
    }
    const key = this.o.sealingKey?.() ?? null;
    if (!key) throw new ContractPinRefused(`${path.basename(file)} is sealed and no host sealing key is available`);
    try { return openSealV2(enc, key); } catch (e) { throw new ContractPinRefused(`${path.basename(file)} could not be authenticated (${(e as Error).message})`); }
  }

  async pin(request: { datasetId: string; dataRoot: string }): Promise<ContractPin | null> {
    const indexFile = path.join(this.o.contractsRoot, "index.json");
    if (!existsSync(indexFile)) return null;
    const index = JSON.parse(readFileSync(indexFile, "utf8")) as { task?: unknown; publicHash?: unknown; status?: unknown }[];
    const entries = (Array.isArray(index) ? index : []).filter((e) => e?.task === request.datasetId);
    if (entries.length === 0) return null;
    if (entries.length > 1) throw new ContractPinRefused(`the host index pins ${request.datasetId} more than once`);
    const pinned = entries[0]!.publicHash, status = typeof entries[0]!.status === "string" ? entries[0]!.status : "unknown";
    if (typeof pinned !== "string" || !HEX.test(pinned)) throw new ContractPinRefused(`the host index has no valid public hash for ${request.datasetId}`);
    const dir = path.join(this.o.contractsRoot, request.datasetId);
    const plainFile = path.join(dir, "public.json"), sealedFile = `${plainFile}.enc`;
    const bytes = existsSync(plainFile) ? readFileSync(plainFile) : existsSync(sealedFile) ? this.#open(sealedFile) : null;
    if (bytes === null) throw new ContractPinRefused(`no public layer for ${request.datasetId}`);
    let envelope: { content?: unknown; hash?: unknown };
    try { envelope = JSON.parse(bytes.toString("utf8")) as typeof envelope; } catch { throw new ContractPinRefused("the public layer is not JSON"); }
    if (!envelope || typeof envelope !== "object" || Object.keys(envelope).sort().join(",") !== "content,hash") throw new ContractPinRefused("the public layer is not a { content, hash } envelope");
    if (envelope.hash !== pinned || canonicalSha256(envelope.content) !== pinned) throw new ContractPinRefused(`the public layer of ${request.datasetId} does not hash to the host index pin`);

    // Host-only cache, content addressed by the pin. Written atomically, read-only.
    const cache = path.join(this.o.cacheRoot, `${request.datasetId.replace(/[^A-Za-z0-9._-]/g, "_")}-${pinned.slice(0, 16)}`);
    const publicPath = path.join(cache, "public.json"), assetsDir = path.join(cache, "assets");
    if (!existsSync(publicPath) || canonicalSha256(JSON.parse(readFileSync(publicPath, "utf8")).content) !== pinned) {
      rmSync(cache, { recursive: true, force: true });
      const tmp = `${cache}.tmp-${process.pid}`;
      rmSync(tmp, { recursive: true, force: true });
      mkdirSync(path.join(tmp, "assets"), { recursive: true, mode: 0o700 });
      writeFileSync(path.join(tmp, "public.json"), bytes, { mode: 0o400 });
      const assets = path.join(dir, "assets");
      if (existsSync(assets)) {
        for (const name of readdirSync(assets).sort()) {
          const file = path.join(assets, name);
          if (name.endsWith(".sha256") || !lstatSync(file).isFile()) continue;
          if (name.endsWith(".enc")) writeFileSync(path.join(tmp, "assets", name.slice(0, -4)), this.#open(file), { mode: 0o400 });
          else copyFileSync(file, path.join(tmp, "assets", name));
        }
      }
      mkdirSync(path.dirname(cache), { recursive: true, mode: 0o700 });
      renameSync(tmp, cache);
    }
    const approved = this.o.approval?.approve({ datasetId: request.datasetId, publicHash: pinned, status }) ?? null;
    return {
      publicHash: pinned, expectedContractHash: pinned, design: contractDesign((envelope.content as { structure?: unknown }).structure),
      publicPath, assetsDir, approval: approved ? { actor: approved.actor, status, reason: approved.reason } : null,
    };
  }
}

/** Load the pinned public layer (host-only file) as a DataContract-shaped value. */
export function loadPinnedContract(pin: ContractPin): { public: { content: unknown; hash: string } } | null {
  if (!pin.publicPath) return null;
  try {
    const envelope = JSON.parse(readFileSync(pin.publicPath, "utf8")) as { content: unknown; hash: string };
    return envelope && typeof envelope.hash === "string" ? { public: envelope } : null;
  } catch { return null; }
}

/** K1b byte verification of the pinned public layer against a host input directory. */
export function verifyPinnedContract(pin: ContractPin, inputDir: string, context:Omit<import("../../omb-certify/src/contract-verifier.ts").ContractVerificationOptions,"expectedContractHash">={}): { ok: boolean; code: string | null; tables: number } {
  const contract = loadPinnedContract(pin);
  if (!contract) return { ok: false, code: "contract-unreadable", tables: 0 };
  try {
    const r = verifyContractBytes(contract as Parameters<typeof verifyContractBytes>[0], snapshotContractFiles(inputDir), { ...context, expectedContractHash: pin.expectedContractHash });
    return r.ok ? { ok: true, code: null, tables: r.value.tables.size } : { ok: false, code: r.code, tables: 0 };
  } catch (e) { return { ok: false, code: `verification-error: ${String((e as Error).message ?? e).slice(0, 200)}`, tables: 0 }; }
}
