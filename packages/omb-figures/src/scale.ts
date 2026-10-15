/** Deterministic axis rules: nice linear ticks (1, 2, 2.5, 5 x 10^k) and log ticks. */
export interface Scale {
  readonly type: "linear" | "log";
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  readonly ticks: readonly number[];
  map(value: number): number;
}

const clean = (v: number): number => Number(v.toPrecision(12));

export function makeScale(type: "linear" | "log", domain: readonly [number, number], range: readonly [number, number], ticks: readonly number[]): Scale {
  const [d0, d1] = type === "log" ? [Math.log10(domain[0]), Math.log10(domain[1])] : domain;
  const [r0, r1] = range;
  return {
    type, domain, range, ticks,
    map(value: number): number {
      const v = type === "log" ? Math.log10(value) : value;
      return r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
    },
  };
}

function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * power >= raw - 1e-12 * power) return clean(m * power);
  return clean(10 * power);
}

/** Nice linear domain covering [lo, hi]. */
export function niceLinear(lo: number, hi: number, target = 5): { domain: [number, number]; ticks: number[] } {
  if (!(Number.isFinite(lo) && Number.isFinite(hi))) throw new Error("non-finite axis range");
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo) { const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1; lo -= pad; hi += pad; }
  const step = niceStep((hi - lo) / target);
  const start = clean(Math.floor(lo / step + 1e-9) * step);
  const end = clean(Math.ceil(hi / step - 1e-9) * step);
  const ticks: number[] = [];
  for (let k = 0; ; k++) { const t = clean(start + k * step); if (t > end + step * 1e-9) break; ticks.push(t); }
  return { domain: [start, end], ticks };
}

/** Next nice step beyond a linear domain end (used to keep un-truncated values strictly inside). */
export function extendLinear(axis: { domain: [number, number]; ticks: number[] }, side: "lo" | "hi"): { domain: [number, number]; ticks: number[] } {
  const step = axis.ticks.length > 1 ? axis.ticks[1]! - axis.ticks[0]! : 1;
  return side === "lo"
    ? { domain: [clean(axis.domain[0] - step), axis.domain[1]], ticks: [clean(axis.domain[0] - step), ...axis.ticks] }
    : { domain: [axis.domain[0], clean(axis.domain[1] + step)], ticks: [...axis.ticks, clean(axis.domain[1] + step)] };
}

function logCandidates(lo: number, hi: number, mantissas: readonly number[]): number[] {
  const out: number[] = [];
  for (let k = Math.floor(Math.log10(lo)) - 1; k <= Math.ceil(Math.log10(hi)) + 1; k++) {
    for (const m of mantissas) out.push(clean(m * 10 ** k));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Nice log domain covering [lo, hi] (both positive); ticks always include 1 when it is inside. */
export function niceLog(lo: number, hi: number, padSides: readonly ("lo" | "hi")[] = []): { domain: [number, number]; ticks: number[] } {
  if (!(lo > 0 && hi > 0)) throw new Error("log axis needs positive values");
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo) { lo /= 1.5; hi *= 1.5; }
  const span = Math.log10(hi / lo);
  const mantissas = span <= 0.6 ? [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8] : span <= 1.5 ? [1, 2, 5] : [1];
  const candidates = logCandidates(lo, hi, mantissas);
  let iLo = candidates.findLastIndex((c) => c <= lo * (1 + 1e-12));
  let iHi = candidates.findIndex((c) => c >= hi * (1 - 1e-12));
  if (padSides.includes("lo")) iLo -= 1;
  if (padSides.includes("hi")) iHi += 1;
  let ticks = candidates.slice(Math.max(0, iLo), iHi + 1);
  const domain: [number, number] = [ticks[0]!, ticks.at(-1)!];
  if (ticks.length > 8) {
    const anchor = Math.max(0, ticks.findIndex((t) => t === 1));
    ticks = ticks.filter((_, i) => (i - anchor) % 2 === 0);
  }
  return { domain, ticks };
}

export const UNIT_AXIS = { domain: [0, 1] as [number, number], ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] };
