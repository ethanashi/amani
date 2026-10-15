import { fail, probability } from "./records.ts";

/** Binary Brier loss, range [0, 1]. */
export function brierScore(p: number, outcome: boolean): number {
  probability(p);
  if (typeof outcome !== "boolean") fail("known binary outcome required");
  return (p - Number(outcome)) ** 2;
}
/** Negative natural log likelihood (nats), lower is better; impossible outcomes cost Infinity. */
export function logScore(p: number, outcome: boolean): number {
  probability(p);
  if (typeof outcome !== "boolean") fail("known binary outcome required");
  const loss = outcome ? -Math.log(p) : -Math.log1p(-p);
  return loss === 0 ? 0 : loss;
}
export interface CalibrationBin {
  readonly lower: number;
  readonly upper: number;
  readonly upperInclusive: boolean;
  readonly count: number;
  readonly meanProbability: number | null;
  readonly observedFrequency: number | null;
}
/** Bins are [lower, upper), except the last includes p=1. Empty bins are explicitly null. */
export function calibrationTable(rows: readonly { readonly probability: number; readonly outcome: boolean }[], bins = 10): readonly CalibrationBin[] {
  if (!Number.isSafeInteger(bins) || bins < 1 || bins > 1000) fail("invalid calibration bin count");
  const counts = Array.from({ length: bins }, () => ({ count: 0, total: 0, positives: 0 }));
  for (const row of rows) {
    probability(row.probability);
    if (typeof row.outcome !== "boolean") fail("known binary outcome required");
    let i = Math.min(bins - 1, Math.floor(row.probability * bins));
    // Multiplication can round across a boundary; honor the bounds reported below.
    if (i < bins - 1 && row.probability >= (i + 1) / bins) i++;
    else if (row.probability < i / bins) i--;
    const bin = counts[i]!;
    bin.count++; bin.total += row.probability; bin.positives += Number(row.outcome);
  }
  return counts.map((bin, i) => ({ lower: i / bins, upper: (i + 1) / bins, upperInclusive: i === bins - 1,
    count: bin.count, meanProbability: bin.count ? bin.total / bin.count : null,
    observedFrequency: bin.count ? bin.positives / bin.count : null }));
}
