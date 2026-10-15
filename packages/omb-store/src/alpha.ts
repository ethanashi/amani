import { contentHash, fail, hash, text } from './primitives.ts';
import type { AlphaFamily } from './types.ts';
/** Nonincreasing, positive, telescoping gamma sequence summing exactly to one. */
export function gamma(t: number): number { return t > 0 ? 1 / (t * (t + 1)) : 0; }
/** LORD++: first rejection earns alpha-w0; subsequent rejections earn alpha.
 * FDR, not FWER. The caller must establish valid online p-values/independence.
 */
export function lordThreshold(index: number, rejections: readonly number[], alpha = 0.05, w0 = alpha / 2): number {
  if (!Number.isSafeInteger(index) || index < 1 || !(alpha > 0 && alpha < 1) || !(w0 > 0 && w0 <= alpha)) fail('invalid LORD++ parameters');
  if (new Set(rejections).size !== rejections.length || rejections.some((t, i) => !Number.isSafeInteger(t) || t < 1 || t >= index || (i > 0 && t <= rejections[i - 1]!))) fail('invalid rejection history');
  return w0 * gamma(index) + rejections.reduce((sum, t, j) => sum + (j === 0 ? alpha - w0 : alpha) * gamma(index - t), 0);
}
export function familyKey(f: AlphaFamily): string {
  hash(f.outcomeDatasetHash); [f.outcome, f.exposure, f.contractUnit].forEach(text);
  return contentHash([f.outcomeDatasetHash, f.outcome, f.exposure, f.contractUnit]);
}
