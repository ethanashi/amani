// Load invariance (design section 4 invariant; pre-registered E7): bounded busy CPU workers and an
// outcome-fingerprint comparison. Only timings may differ between the quiet and loaded runs.

import { spawn, type ChildProcess } from "node:child_process";
import { outcomeFingerprint, type CertRecord } from "./run.ts";

export interface BusyWorkers { readonly count: number; stop(): void }

/** Start `count` equal-priority busy loops. They are killed by stop(), on process exit, and in any
 * case after `maxMs` (a hard bound so a crashed harness cannot leave load behind). */
export function startBusyWorkers(count: number, maxMs: number): BusyWorkers {
  const children: ChildProcess[] = [];
  for (let i = 0; i < count; i++) {
    children.push(spawn(process.execPath, ["-e", "for(;;){}"], { stdio: "ignore" }));
  }
  const stop = () => { for (const c of children) { try { c.kill("SIGKILL"); } catch { /* already gone */ } } };
  const timer = setTimeout(stop, maxMs);
  timer.unref();
  process.once("exit", stop);
  return { count, stop: () => { clearTimeout(timer); stop(); } };
}

export interface InvarianceDiff { readonly key: string; readonly quiet: string | null; readonly loaded: string | null }

/** Compare two record sets by (task, analysis, mode) outcome fingerprints. */
export function compareOutcomes(quiet: readonly CertRecord[], loaded: readonly CertRecord[]): InvarianceDiff[] {
  const key = (r: CertRecord) => `${r.task} ${r.analysis} ${r.mode}`;
  const q = new Map(quiet.map((r) => [key(r), outcomeFingerprint(r)]));
  const l = new Map(loaded.map((r) => [key(r), outcomeFingerprint(r)]));
  const diffs: InvarianceDiff[] = [];
  for (const k of [...new Set([...q.keys(), ...l.keys()])].sort()) {
    const a = q.get(k) ?? null, b = l.get(k) ?? null;
    if (a !== b) diffs.push({ key: k, quiet: a, loaded: b });
  }
  return diffs;
}
