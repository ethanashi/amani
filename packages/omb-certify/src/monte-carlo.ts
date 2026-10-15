import { createHash } from 'node:crypto';

/** Software stream, domain-separated by the signed gate binding. No worker seed is read. */
export function randomStream(seed: string): { uniform: () => number; integer: (n: number) => number } {
  if (!seed) throw new Error('missing software seed');
  const bytes=createHash('sha256').update(seed).digest();
  let a=bytes.readUInt32LE(0),b=bytes.readUInt32LE(4),c=bytes.readUInt32LE(8),d=bytes.readUInt32LE(12);
  if((a|b|c|d)===0)d=1;
  const rot=(x:number,k:number)=>(x<<k)|(x>>>(32-k));
  // xoshiro128**; uniform integer draws use rejection, avoiding modulo bias.
  const word=()=>{const result=Math.imul(rot(Math.imul(b,5),7),9)>>>0,t=b<<9;c^=a;d^=b;b^=c;a^=d;c^=t;d=rot(d,11);return result;};
  return { uniform: () => word() / 4294967296, integer: n => {
    if (!Number.isSafeInteger(n) || n < 1 || n > 4294967296) throw new Error('invalid random range');
    const limit = Math.floor(4294967296 / n) * n; let v; do { v = word(); } while (v >= limit); return v % n;
  } };
}
export interface MonteCarloSettings { draws?: number; maxDraws?: number; extensionFactor?: number; bandSE?: number; }
export interface MonteCarloResult {
  p: number; decisionP: number; initialP: number; extreme: number; evaluated: number;
  stages: { draws: number; extreme: number; p: number }[]; mcSE: number;
  stopping: 'monte-carlo-fixed' | 'monte-carlo-extended';
}
/** Each stage is a predeclared fixed-size randomization test, p=(1+b)/(1+B).
 * Extend only near alpha, at most once. The deciding p is max(initialP, finalP),
 * never below the initial valid p. Thus EVERY rejection is contained in the initial
 * fixed-B rejection event, including after multiplicity adjustment. No optional-stopping
 * confidence interval is mistaken for certainty. Bounds/MC SE are precision diagnostics.
 * See Phipson & Smyth (2010), https://pubmed.ncbi.nlm.nih.gov/21044043/ . */
export function monteCarlo(observed: number, draw: () => number, alpha: number, settings: MonteCarloSettings = {}): MonteCarloResult {
  const B = settings.draws ?? 9999, max = settings.maxDraws ?? B * 4, factor = settings.extensionFactor ?? 4, band = settings.bandSE ?? 3;
  if (![B,max,factor].every(Number.isSafeInteger) || B < 19 || max < B || max > 1_000_000 || factor < 1 || factor > 16 || !Number.isFinite(band) || band < 1 || band > 6 || !(alpha > 0 && alpha <= .05) || !Number.isFinite(observed)) throw new Error('invalid locked Monte Carlo settings');
  const stages: MonteCarloResult['stages'] = [];
  const stage = (draws: number) => {
    let extreme = 0;
    for (let i = 0; i < draws; i++) { const s = draw(); if (!Number.isFinite(s)) throw new Error('nonfinite permutation statistic'); if (s >= observed - 1e-12 * Math.abs(observed)) extreme++; }
    const p = (1 + extreme) / (1 + draws); const result = { draws, extreme, p }; stages.push(result); return result;
  };
  const first = stage(B), se = Math.sqrt(first.p * (1 - first.p) / (B + 1));
  const next = Math.min(max, B * factor);
  const last = Math.abs(first.p - alpha) <= band * se && next > B ? stage(next) : first;
  return { p: last.p, decisionP: Math.max(first.p,last.p), initialP: first.p, extreme: last.extreme,
    evaluated: stages.reduce((n,s) => n+s.draws,0), stages, mcSE: Math.sqrt(last.p*(1-last.p)/(last.draws+1)),
    stopping: stages.length === 1 ? 'monte-carlo-fixed' : 'monte-carlo-extended' };
}
