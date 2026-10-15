// Synthetic re-stagings for the offline null calibration (E8) and the planted checks (E9).
//
// Each re-staging takes the task's own staged observations.tsv, keeps cohort 1 (one stratum, so
// the reference analysis fits no cohort term), samples n rows without replacement and assigns a
// balanced binary exposure by a seeded shuffle, independent of every other column: the null holds
// by construction. Planted variants add a fixed shift to the outcome of exposed rows. Sizes are the
// largest at which the exact permutation kernel can decide (orbit <= work limit): C(12,6) = 924
// label permutations for the unadjusted tasks, 7! = 5040 Freedman-Lane residual permutations for
// p12, whose reference adjusts for the continuous quality score.

import { createHash } from "node:crypto";
import { gateResult } from "../../omb-gauntlet/src/index.ts";
import type { GateAuthority } from "../../omb-certify/src/index.ts";

export type Variant = "null" | "mei" | "large";

export interface NullTask { readonly task: string; readonly n: number; readonly outcome: string; }

export const NULL_DESIGN = {
  tasks: [
    { task: "p1-esr1", n: 12, outcome: "expression" },
    { task: "p2-erbb2", n: 12, outcome: "expression" },
    { task: "p12-quality", n: 7, outcome: "expression" },
  ] as readonly NullTask[],
  counts: { null: 200, mei: 40, large: 20 } as Readonly<Record<Variant, number>>,
  /** Software MEI cap for additive estimands (omb-gauntlet meiCap): one outcome unit. */
  meiShift: 1,
  /** Liveness shift in outcome standard deviations of the sampled rows. */
  largeShiftSd: 4,
  /** First k null re-stagings per task are re-run with the real sandboxed simulation program. */
  sandboxValidation: 3,
  alpha: 0.05,
  describe(): string[] {
    return [
      `- Tasks and sizes: ${this.tasks.map((t) => `${t.task} (n = ${t.n})`).join(", ")}. Source rows: the task's staged`,
      "  `observations.tsv`, cohort 1 only. Exposure: a seeded balanced shuffle independent of the outcome.",
      `- Counts per task: ${this.counts.null} null, ${this.counts.mei} planted at the MEI (+${this.meiShift} outcome unit, the`,
      `  software cap), ${this.counts.large} liveness (+${this.largeShiftSd} SD of the sampled outcome). Seeds: sha256 of`,
      "  `v3-restage:<task>:<variant>:<k>`.",
      "- Analysis: the task's reference (workdir rule), locked mode, simulations on. G7 and G8 are host-signed",
      "  stand-ins that always pass (two families, zero difference, tolerance MEI/2; route P first look), so the",
      "  measured rate is that of every locally produced gate plus the kernel decision: the worst case for E8.",
      "- G5b and the data-dependence probe use the trusted `simulationFactory` seam with an in-process transcription of",
      "  the reference (`linearEntry`: OLS with the plan's adjustment, classical t). G5b is not on the effect-exists",
      `  confirm path. The first ${this.sandboxValidation} null re-stagings per task are repeated with the real sandboxed program and`,
      "  must give identical outcome fingerprints.",
      "- A re-staging counts as a false confirmation when the claim's software status is confirmed or replicated.",
      `- Pass rule (E8): the exact one-sided binomial p-value of H0 rate <= ${this.alpha} is > ${this.alpha}, per task and pooled.`,
    ];
  },
};

/** Amendment A2 (V2b): the same rules at the smallest sizes where V2b decides by Monte Carlo
 * (orbit above its 10,000 enumeration limit: C(16,8) = 12,870 label permutations; 8! = 40,320
 * Freedman-Lane residual permutations), with the V2b worker contract (the wrapper omits p, so G3/G4
 * compare estimates and data-derived numbers only). Same seeds, counts, shifts and pass rules. */
export const NULL_DESIGN_A2 = {
  ...NULL_DESIGN,
  tasks: [
    { task: "p1-esr1", n: 16, outcome: "expression" },
    { task: "p2-erbb2", n: 16, outcome: "expression" },
    { task: "p12-quality", n: 8, outcome: "expression" },
  ] as readonly NullTask[],
  omitP: true,
};

/** Counter-mode sha256 uniform stream. */
export function uniformStream(seed: string): () => number {
  let counter = 0;
  let buffer: Buffer = Buffer.alloc(0);
  let offset = 0;
  return () => {
    if (offset + 6 > buffer.length) { buffer = createHash("sha256").update(`${seed}:${counter++}`).digest(); offset = 0; }
    const v = buffer.readUIntBE(offset, 6) / 2 ** 48;
    offset += 6;
    return v;
  };
}

function shuffle<T>(items: T[], rnd: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [items[i], items[j]] = [items[j]!, items[i]!]; }
  return items;
}

/** One re-staged observations.tsv (text) from the task's staged table text. */
export function restage(sourceTsv: string, t: NullTask, variant: Variant, k: number): string {
  const lines = sourceTsv.replace(/\r?\n$/, "").split(/\r?\n/);
  const header = lines[0]!.split("\t");
  const ci = header.indexOf("cohort"), xi = header.indexOf("exposure"), yi = header.indexOf(t.outcome);
  if (ci < 0 || xi < 0 || yi < 0) throw new Error(`${t.task}: re-staging needs cohort, exposure and ${t.outcome} columns`);
  const pool = lines.slice(1).map((l) => l.split("\t")).filter((r) => r[ci] === "1");
  if (pool.length < t.n) throw new Error(`${t.task}: not enough cohort-1 rows`);
  const rnd = uniformStream(`v3-restage:${t.task}:${variant}:${k}`);
  const picked = shuffle(pool.map((r) => [...r]), rnd).slice(0, t.n);
  const exposure = shuffle(Array.from({ length: t.n }, (_, i) => (i < Math.floor(t.n / 2) ? 1 : 0)), rnd);
  const y = picked.map((r) => Number(r[yi]));
  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  const sd = Math.sqrt(y.reduce((s, v) => s + (v - mean) ** 2, 0) / (y.length - 1));
  const shift = variant === "null" ? 0 : variant === "mei" ? NULL_DESIGN.meiShift : NULL_DESIGN.largeShiftSd * sd;
  picked.forEach((r, i) => {
    r[xi] = String(exposure[i]);
    r[yi] = (y[i]! + shift * exposure[i]!).toFixed(4);
  });
  return [header, ...picked].map((r) => r.join("\t")).join("\n") + "\n";
}

/** Host-signed G7/G8 stand-ins that always pass (calibration only; never used for task labels). */
export function standInGates(claimIds: readonly string[], partition: string) {
  return (binding: { planHash: string; inputManifestHash: string; frozenCodeHash: string; executionId: string }, authority: GateAuthority): unknown[] =>
    claimIds.flatMap((claimId) => [
      authority.seal(binding, gateResult("G7", "passed", "calibration stand-in: replicator always agrees", { claimId,
        evidence: { families: ["claude", "codex"], seLead: 1, seReplicator: 1, tolerance: 0.5, deltaEstimate: 0, sameDecision: true, withinTolerance: true, replicatorVerified: true, standIn: true } })),
      authority.seal(binding, gateResult("G8", "passed", "calibration stand-in: first recorded route-P look", { claimId,
        evidence: { route: "P", partitionId: partition, lookNumber: 1, recordedBeforeExecution: true, llmPresent: false, standIn: true } })),
    ]);
}
