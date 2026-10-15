// Shared helpers for the repeated-measures randomization probes. Every decision goes
// through the real kernelDecision (packages/omb-certify/src/producers.ts), and G5a goes
// through the real nullCalibration with the same closure certify.ts builds.
import { parsePlan, type PlanClaim } from '../../omb-gauntlet/src/index.ts';
import { kernelDecision, linearEntry, nullCalibration, randomStream, type ClaimData } from '../src/index.ts';

export const claimOf = (extra: Record<string, unknown> = {}): PlanClaim =>
  parsePlan({ claims: [{ id: 'c', kind: 'effect-exists', table: 't.tsv', estimand: 'mean difference', test: 'permutation test',
    unit: 'unit_id', permutationLevel: 'unit', exposure: 'x', outcome: 'y', direction: 'greater', nullValue: 0, mei: 1, ...extra }] }).plan!.claims[0]!;

export const dataOf = (x: number[], y: number[], units: string[]): ClaimData =>
  ({ file: 't.tsv', x, y, units, strata: x.map(() => '*'), nuisance: [], covariates: {}, header: [], rows: [] });

export type Rng = ReturnType<typeof randomStream>;
export const normal = (rng: Rng) => Math.sqrt(-2 * Math.log(Math.max(1e-300, rng.uniform()))) * Math.cos(2 * Math.PI * rng.uniform());

export const wilson = (k: number, n: number) => {
  const p = k / n, z = 1.959963984540054, den = 1 + z * z / n, c = (p + z * z / (2 * n)) / den,
    h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  return [+(c - h).toFixed(5), +(c + h).toFixed(5)];
};

/** Simulate `n` null datasets and count kernel rejections at the claim's alpha. */
export function typeI(label: string, claim: PlanClaim, n: number, make: (rng: Rng, i: number) => ClaimData, seed: string) {
  const rng = randomStream(seed); let rejected = 0; const guarantees = new Set<string>(), schemes = new Set<string>(), stops = new Set<string>();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const d = make(rng, i), r = kernelDecision(claim, d, `${seed}:kernel:${i}`);
    guarantees.add(r.guarantee); schemes.add(r.scheme); stops.add(r.stopping);
    if (r.status === 'reject') rejected++;
  }
  const out = { confirmationCappedByGuarantee: [...guarantees].every(g=>g.startsWith('model-based')), experiment: label, nulls: n, rejected, rate: rejected / n, wilson95: wilson(rejected, n), alpha: claim.alpha,
    direction: claim.direction, guarantee: [...guarantees], scheme: [...schemes], stopping: [...stops], seconds: (performance.now() - t0) / 1000 };
  console.log(JSON.stringify(out));
  return out;
}

/** G5a exactly as certify.ts runs it for a non-waived claim. */
export async function g5a(claim: PlanClaim, data: ClaimData, executionId = 'probe') {
  return nullCalibration(claim, data, executionId + ':' + claim.id, async sample => {
    const twin = { ...data, x: sample.x, y: sample.y }, r = kernelDecision(claim, twin, sample.seed);
    return r.status === 'unresolved' ? null : { ...linearEntry(claim, twin), p: r.decisionP ?? r.p ?? r.pUpper };
  });
}
