import { closeSync, openSync, readSync, fstatSync } from "node:fs";
import { request } from "node:https";
import path from "node:path";
import type { WorkerResult } from "../../omb-adapters/src/index.ts";
import type { Family } from "../../omb-sched/src/index.ts";
import type { Journal } from "./journal.ts";

export const networkEvidence = (text: string): boolean => /connection failed|error sending request|stream (?:disconnected|disconnect)|\b(?:ENOTFOUND|ECONNRESET|EAI_AGAIN|ENETUNREACH|ETIMEDOUT)\b|fetch failed|network (?:is )?unreachable/i.test(text);

/** Read only bounded host-captured diagnostics, never worker files or resumed history. */
export function adapterNetworkFailure(result: WorkerResult): boolean {
  if (["ok", "violation", "containment_failure", "refused-prework", "refused-midtask", "rate_limited"].includes(result.status)) return false;
  if (!result.eventsPath) return false;
  for (const file of [result.eventsPath, path.join(path.dirname(result.eventsPath), "stderr.log")]) {
    let fd: number | undefined;
    try {
      fd = openSync(file, "r"); const size = fstatSync(fd).size;
      const bytes = Buffer.alloc(Math.min(size, 256_000));
      readSync(fd, bytes, 0, bytes.length, Math.max(0, size - bytes.length));
      const captured=bytes.toString();
      if(file!==result.eventsPath){if(networkEvidence(captured))return true;}
      else for(const line of captured.split('\n'))try{const event=JSON.parse(line);if(['error','turn.failed'].includes(event.type)&&networkEvidence(JSON.stringify(event.error??event)))return true;}catch{}
    } catch { /* Missing evidence is not positive evidence of connectivity. The host probe decides. */ }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  return false;
}

export class NetworkDown extends Error { constructor() { super("network-down: outage cap reached"); } }
export interface ConnectivityOptions {
  now: () => number;
  waitUntil: (epochMs: number) => Promise<void>;
  probe: (family: Family) => Promise<boolean>;
  journal: Journal;
  intervalMs?: number;
  capMs?: number;
}

/** Network retries stay inside a single scheduler dispatch, so no attempt/resume/refusal is spent.
 * The journal retains the first outage boundary across a restart and across flapping probes.
 */
export class Connectivity {
  readonly #o: ConnectivityOptions;
  readonly #down = new Map<Family, number>();
  readonly #probes = new Map<Family, Promise<boolean>>();
  constructor(o: ConnectivityOptions) {
    this.#o = o;
    for (const n of [o.intervalMs ?? 60_000, o.capMs ?? 6 * 3_600_000]) if (!Number.isFinite(n) || n <= 0) throw new Error("invalid network interval/cap");
  }
  get blocked(): boolean { return this.#down.size > 0; }
  async reachable(family: Family): Promise<boolean> {
    try { return await this.#o.probe(family) === true; } catch { return false; }
  }
  async park(jobId: string, family: Family): Promise<void> {
    const events = this.#o.journal.read("network");
    const first = events.find(e => e.type === "network-park" && (e.payload as { jobId: string }).jobId === jobId);
    const since = first?.at ?? this.#o.now(), deadline = since + (this.#o.capMs ?? 6 * 3_600_000);
    this.#down.set(family, (this.#down.get(family) ?? 0) + 1);
    this.#o.journal.append("network", "network-park", { jobId, family, since, deadline });
    try {
      for (;;) {
        if (this.#o.now() >= deadline) throw new NetworkDown();
        let probe = this.#probes.get(family);
        if (!probe) {
          probe = (async () => {
            await this.#o.waitUntil(Math.min(deadline, this.#o.now() + (this.#o.intervalMs ?? 60_000)));
            return this.reachable(family);
          })().finally(() => this.#probes.delete(family));
          this.#probes.set(family, probe);
        }
        const up = await probe;
        if (this.#o.now() >= deadline) throw new NetworkDown();
        if (up) {
          this.#o.journal.append("network", "network-unpark", { jobId, family, since });
          return;
        }
      }
    } catch (e) {
      this.#o.journal.append("network", "network-cap", { jobId, family, since });
      throw e;
    } finally { const left = (this.#down.get(family) ?? 1) - 1; if (left) this.#down.set(family, left); else this.#down.delete(family); }
  }
}

/** Any HTTPS response proves transport reachability; authentication is a separate preflight.
 * A hard timer bounds DNS as well as TCP/TLS. The clock and timer are injectable for tests.
 */
export interface ProbeConnection { start(): void; stop(): void; onError(fn: () => void): void }
export function httpsProbe(o: { now: () => number; timeoutMs?: number;
  schedule?: (fn: () => void, ms: number) => () => void;
  connect?: (host: string, response: () => void) => ProbeConnection }) {
  return (family: Family): Promise<boolean> => new Promise(resolve => {
    const start = o.now(), timeout = o.timeoutMs ?? 5_000;
    let done = false, cancel = () => {};
    const finish = (ok: boolean) => { if (done) return; done = true; cancel(); connection.stop(); resolve(ok && o.now() - start <= timeout); };
    const connect = o.connect ?? ((host: string, response: () => void): ProbeConnection => {
      const req = request({ hostname: host, method: "HEAD", path: "/" }, res => { res.resume(); response(); });
      return { start: () => req.end(), stop: () => req.destroy(), onError: fn => { req.once("error", fn); } };
    });
    const connection = connect(family === "codex" ? "api.openai.com" : "api.anthropic.com", () => finish(true));
    const schedule = o.schedule ?? ((fn: () => void, ms: number) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
    connection.onError(() => finish(false));
    cancel = schedule(() => finish(false), timeout);
    if (!done) connection.start();
  });
}
