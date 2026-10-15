import type { TestSpec } from '../src/types.ts';
import { DIAG_LEVELS } from '../src/diagnostics.ts';

/** Tests evaluated on every simulated dataset. Release tests are 0 (two-sided .05, alpha_max 6.25%) and 1, 2
 * (one-sided .025 in each direction; false-direction rate certified at 5%). 3, 4 (one-sided .05) are recorded
 * for the power cost of one-sided .025. */
export const TESTS: readonly TestSpec[] = [
  { direction: 'two-sided', alpha: 0.05 },
  { direction: 'greater', alpha: 0.025 },
  { direction: 'less', alpha: 0.025 },
  { direction: 'greater', alpha: 0.05 },
  { direction: 'less', alpha: 0.05 },
];
export const TEST_NAMES = ['two05', 'g025', 'l025', 'g05', 'l05'] as const;
export const RELEASE_TESTS = [0, 1, 2] as const;
/** Release limits: two-sided alpha_max = 1.25 * .05; directional false-direction rate <= 5% (owner, round 2). */
export const ALPHA_MAX = [0.0625, 0.05, 0.05] as const;
/** Index of the default diagnostic level (alpha_d = 0.01) in DIAG_LEVELS. */
export const PRIMARY_LEVEL = 1;
export { DIAG_LEVELS };

export interface Counts {
  reps: number;
  levels: readonly number[];
  /** End-to-end Confirmed (procedure rejects and the diagnostics at that level do not refuse): [level][test]. */
  rej: number[][];
  /** Refusals (diagnostics at that level, or the procedure's own refusal): [level]. */
  refused: number[];
  procRefused: number;
  /** Parametric branch alone, diagnostics off (diagnostic only). */
  tRej: number[];
  /** Oracle (correctly specified parametric test), diagnostics off, for power cells. */
  oracleRej?: number[];
  /** Two-sided Confirmed with the estimate below the null (false refute at effect = null): [level]. */
  refLow: number[];
  /** Mixture laws: datasets in which no outlier component was drawn, and their Confirmed counts [level][test]. */
  clean?: { reps: number; rej: number[][] };
  observed?: Record<string, number>;
}

export function emptyCounts(withOracle = false, mixture = false): Counts {
  const c: Counts = { reps: 0, levels: DIAG_LEVELS, rej: DIAG_LEVELS.map(() => TESTS.map(() => 0)), refused: DIAG_LEVELS.map(() => 0), procRefused: 0,
    tRej: TESTS.map(() => 0), refLow: DIAG_LEVELS.map(() => 0) };
  if (withOracle) c.oracleRej = TESTS.map(() => 0);
  if (mixture) c.clean = { reps: 0, rej: DIAG_LEVELS.map(() => TESTS.map(() => 0)) };
  return c;
}

export interface Decision { reject: boolean[]; tReject: boolean[]; refused: boolean }

/** Record one dataset: the procedure decision, the diagnostic refusal at each level, the estimate's sign. */
export function add(c: Counts, d: Decision, diagRefused: readonly boolean[], tSign: number, oracle?: boolean[], clean?: boolean): void {
  c.reps++;
  if (d.refused) c.procRefused++;
  d.tReject.forEach((v, i) => { if (v) c.tRej[i]!++; });
  if (oracle && c.oracleRej) oracle.forEach((v, i) => { if (v) c.oracleRej![i]!++; });
  if (clean !== undefined && c.clean && clean) c.clean.reps++;
  DIAG_LEVELS.forEach((_, l) => {
    const off = d.refused || diagRefused[l]!;
    if (off) { c.refused[l]!++; return; }
    d.reject.forEach((v, i) => { if (v) { c.rej[l]![i]!++; if (clean && c.clean) c.clean.rej[l]![i]!++; } });
    if (d.reject[0] && tSign < 0) c.refLow[l]!++;
  });
}

export function summarize(values: number[]): { min: number; p05: number; median: number } {
  const s = [...values].sort((a, b) => a - b), q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return { min: s[0]!, p05: q(0.05), median: q(0.5) };
}
