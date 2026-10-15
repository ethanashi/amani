export interface Pair { b: number; c: number }
export interface BootstrapSettings { seed: number; resamples: number; confidence: number }
export interface Interval { estimate: number; lower: number; upper: number; n: number }

function pairsValid(pairs: readonly Pair[], binary = false): void {
  if (!Array.isArray(pairs) || pairs.length === 0) throw new Error("paired observations required");
  for (const pair of pairs) {
    if (!pair || ![pair.b, pair.c].every(v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 && (!binary || v === 0 || v === 1))) {
      throw new Error(binary ? "binary paired observations required" : "paired rates must be finite and in [0, 1]");
    }
  }
}

/** Two-sided exact conditional binomial test; concordant pairs stay in n. */
export function exactMcNemar(pairs: readonly Pair[]): { n: number; bOnly: number; cOnly: number; pValue: number } {
  pairsValid(pairs, true);
  const bOnly = pairs.filter(p => p.b === 1 && p.c === 0).length;
  const cOnly = pairs.filter(p => p.b === 0 && p.c === 1).length;
  const discordant = bOnly + cOnly;
  const k = Math.min(bOnly, cOnly);
  // Sum the binomial tail in log space: starting at 2^-n underflows for large n.
  let logTerm = -discordant * Math.LN2;
  let logSum = logTerm;
  for (let i = 1; i <= k; i++) {
    logTerm += Math.log(discordant - i + 1) - Math.log(i);
    const max = Math.max(logSum, logTerm);
    logSum = max + Math.log(Math.exp(logSum - max) + Math.exp(logTerm - max));
  }
  return { n: pairs.length, bOnly, cOnly, pValue: Math.min(1, 2 * Math.exp(logSum)) };
}

export function validateBootstrap(settings: BootstrapSettings): void {
  if (!settings || !Number.isSafeInteger(settings.seed) || settings.seed < 0 || settings.seed > 0xffffffff ||
      !Number.isSafeInteger(settings.resamples) || settings.resamples < 2 || settings.resamples > 1_000_000 ||
      !Number.isFinite(settings.confidence) || settings.confidence <= 0 || settings.confidence >= 1) {
    throw new Error("invalid bootstrap settings");
  }
}

/** Mulberry32, pinned here so seeds have stable meaning across versions. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile interval, linear interpolation at (N-1)*p; difference is B minus C.
 * Resamples whole pairs, never arms separately. Caller supplies independent units.
 */
export function pairedBootstrap(pairs: readonly Pair[], settings: BootstrapSettings): Interval {
  pairsValid(pairs);
  validateBootstrap(settings);
  const differences = pairs.map(p => p.b - p.c);
  const random = seededRandom(settings.seed);
  const samples: number[] = [];
  for (let r = 0; r < settings.resamples; r++) {
    let total = 0;
    for (let i = 0; i < pairs.length; i++) total += differences[Math.floor(random() * pairs.length)]!;
    samples.push(total / pairs.length);
  }
  samples.sort((a, b) => a - b);
  const quantile = (p: number): number => {
    const position = (samples.length - 1) * p;
    const low = Math.floor(position);
    return samples[low]! + (samples[Math.ceil(position)]! - samples[low]!) * (position - low);
  };
  const tail = (1 - settings.confidence) / 2;
  return { n: pairs.length, estimate: differences.reduce((a, b) => a + b, 0) / pairs.length,
    lower: quantile(tail), upper: quantile(1 - tail) };
}

/** Equivalence requires the entire interval strictly inside the registered margin.
 * The difference is B minus C; intervals beyond a margin identify its favored arm.
 * Degenerate intervals and boundary-straddling evidence remain insufficient.
 * Failure to reject McNemar's null is deliberately not an equivalence test.
 */
export function checkEquivalence(interval: Interval | null, margin: number, minPairedTasks: number): {
  equivalent: boolean; decision: "ship-tool-pack" | "b-superior" | "retain-omerta-bio" | "insufficient";
} {
  if (!Number.isFinite(margin) || margin <= 0 || margin > 1) throw new Error("margin must be in (0, 1]");
  if (!Number.isSafeInteger(minPairedTasks) || minPairedTasks < 2) throw new Error("minimum paired tasks must be an integer >= 2");
  if (!interval || !Number.isSafeInteger(interval.n) || interval.n < minPairedTasks ||
      ![interval.estimate, interval.lower, interval.upper].every(v => Number.isFinite(v) && v >= -1 && v <= 1) ||
      interval.lower >= interval.upper) return { equivalent: false, decision: "insufficient" };
  const equivalent = interval.lower > -margin && interval.upper < margin;
  return { equivalent, decision: equivalent ? "ship-tool-pack" :
    interval.lower > margin ? "b-superior" : interval.upper < -margin ? "retain-omerta-bio" : "insufficient" };
}

/** Bootstrap a ratio of pooled counts, resampling whole paired task clusters.
 * Unlike a mean of task rates this preserves the primary confirmed-claim denominator.
 * Conditions on defined resamples; reports the excluded fraction explicitly.
 */
export function pairedRatioBootstrap(pairs: readonly {
  b: { numerator: number; denominator: number }; c: { numerator: number; denominator: number };
}[], settings: BootstrapSettings): (Interval & { definedResamples: number; droppedShare: number }) | null {
  validateBootstrap(settings);
  if (!pairs.length) return null;
  for (const pair of pairs) for (const counts of [pair.b, pair.c]) {
    if (!Number.isSafeInteger(counts.numerator) || !Number.isSafeInteger(counts.denominator) ||
        counts.numerator < 0 || counts.numerator > counts.denominator) throw new Error("invalid paired counts");
  }
  const difference = (indices: readonly number[]): number | null => {
    let bn = 0, bd = 0, cn = 0, cd = 0;
    for (const i of indices) {
      const p = pairs[i]!;
      bn += p.b.numerator; bd += p.b.denominator; cn += p.c.numerator; cd += p.c.denominator;
    }
    return bd && cd ? bn / bd - cn / cd : null;
  };
  const estimate = difference(pairs.map((_, i) => i));
  if (estimate === null) return null;
  const random = seededRandom(settings.seed), samples: number[] = [];
  for (let r = 0; r < settings.resamples; r++) {
    const value = difference(pairs.map(() => Math.floor(random() * pairs.length)));
    if (value !== null) samples.push(value);
  }
  if (samples.length < 2) return null;
  samples.sort((a, b) => a - b);
  const quantile = (p: number) => {
    const position = (samples.length - 1) * p, low = Math.floor(position);
    return samples[low]! + (samples[Math.ceil(position)]! - samples[low]!) * (position - low);
  };
  const tail = (1 - settings.confidence) / 2;
  return { n: pairs.length, estimate, lower: quantile(tail), upper: quantile(1 - tail),
    definedResamples: samples.length, droppedShare: 1 - samples.length / settings.resamples };
}
