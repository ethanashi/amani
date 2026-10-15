import { centered, welchStatistic } from './numeric.ts';
import { createHash } from 'node:crypto';
import { monteCarlo, randomStream, type MonteCarloSettings, type MonteCarloResult } from './monte-carlo.ts';
export type Direction = 'greater' | 'less' | 'two-sided';
export interface PermutationInput {
  x: readonly number[]; y: readonly number[]; units: readonly string[];
  strata?: readonly string[]; nuisance?: readonly (readonly number[])[];
  scheme: 'labels' | 'freedman-lane'; direction: Direction; alpha: number; seed: string;
  nullValue?: number; maxPermutations?: number; exhaustive?: boolean;
  mode?: 'auto' | 'exact' | 'monte-carlo'; monteCarlo?: MonteCarloSettings;
}
export interface PermutationResult {
  status: 'reject' | 'retain' | 'unresolved'; p: number | null;
  pLower: number; pUpper: number; evaluated: number; total: string; extreme: number;
  estimate: number; statistic: number; scheme: PermutationInput['scheme'] | 'sign-flip'; alpha: number;
  guarantee: string;
  stopping: 'exhaustive' | 'decision-fixed' | 'work-limit' | 'model-based' | MonteCarloResult['stopping'];
  modelReference?: string; decisionP?: number; monteCarlo?: MonteCarloResult;
}
export const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);
export function residual(v: readonly number[], basis: readonly (readonly number[])[]): number[] {
  const out = [...v];
  for (const q of basis) { const c = dot(out, q); for (let i = 0; i < out.length; i++) out[i] = out[i]! - c * q[i]!; }
  return out;
}
/** Reorthogonalized modified Gram-Schmidt; rank loss is scientific non-identifiability. */
export function orthogonal(columns: readonly (readonly number[])[]): number[][] {
  const basis: number[][] = [];
  for (const c of columns) {
    const norm = Math.hypot(...c);
    if (!Number.isFinite(norm) || norm === 0) throw new Error('rank-deficient design');
    const r = residual(residual(c.map(v => v / norm), basis), basis), length = Math.hypot(...r);
    if (length < 1e-10) throw new Error('rank-deficient design');
    basis.push(r.map(v => v / length));
  }
  return basis;
}
export function regression(x: readonly number[], y: readonly number[], nuisance: readonly (readonly number[])[] = []): { estimate: number; statistic: number; se: number } {
  const q = orthogonal([x.map(() => 1), ...nuisance]);
  const xr = residual(x, q), yr = residual(centered(y), q), xx = dot(xr, xr);
  if (xx <= 1e-20 * Math.max(1, dot(x, x))) throw new Error('rank-deficient joint design');
  const estimate = dot(xr, yr) / xx;
  const errors = yr.map((v, i) => v - estimate * xr[i]!);
  const df = x.length - q.length - 1;
  if (df <= 0) throw new Error('no residual degrees of freedom');
  const variance = dot(errors, errors) / df / xx;
  // A perfect fit has an infinite mathematical t. Use a finite saturated statistic so
  // serialization and tie comparisons remain well-defined.
  const statistic = variance === 0 ? (estimate === 0 ? 0 : Math.sign(estimate) * 1e100) : estimate / Math.sqrt(variance);
  if (![estimate, statistic].every(Number.isFinite)) throw new Error('nonfinite regression');
  return { estimate, statistic, se: Math.sqrt(variance) };
}
const factorial = (n: number): bigint => { let p = 1n; for (let i = 2; i <= n; i++) p *= BigInt(i); return p; };
function permutations(values: readonly number[]): bigint {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let n = factorial(values.length); for (const count of counts.values()) n /= factorial(count); return n;
}
/** Multiset unranking avoids the n! duplicate permutations for binary exposures. */
function unrank(values: readonly number[], rank: bigint): number[] {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const keys = [...counts.keys()].sort((a,b) => a-b), out: number[] = [];
  let ways = permutations(values);
  for (let left = values.length; left > 0; left--) {
    for (const v of keys) {
      const count = counts.get(v)!; if (!count) continue;
      const block = ways * BigInt(count) / BigInt(left);
      if (rank < block) { out.push(v); counts.set(v, count-1); ways = block; break; }
      rank -= block;
    }
  }
  return out;
}
function gcd(a: bigint, b: bigint): bigint { while (b) [a,b] = [b,a%b]; return a; }
function ratio(a: bigint, b: bigint): number { return Number(a * 10n**16n / b) / 1e16; }
function alphaRatio(alpha: number): [bigint,bigint] {
  const [digits, exp = '0'] = alpha.toExponential(16).split('e');
  const power = 16 - Number(exp);
  return [BigInt(digits!.replace('.','')), 10n ** BigInt(power)];
}
/** No probabilistic CI is treated as certainty. Seeded traversal is without replacement;
 * lower=seen extremes/N, upper=(seen extremes+unseen)/N. Sequential decisions agree with
 * exhaustive enumeration for EVERY seed, even at alpha. Work exhaustion is unresolved.
 * This deliberately abstains on large orbits rather than claiming zero Monte Carlo risk. */
export function permutationTest(input: PermutationInput): PermutationResult {
  const { x,y,units,scheme,direction,alpha,seed } = input, n = x.length;
  const z = input.nuisance ?? [], strata = input.strata ?? x.map(() => '*');
  if (n < 3 || y.length !== n || units.length !== n || new Set(units).size !== n || units.some(u => !u.trim())
    || strata.length !== n || strata.some(s => !s.trim()) || [x,y,...z].some(c => c.length !== n || c.some(v => !Number.isFinite(v)))
    || !(alpha > 0 && alpha <= .05) || !seed || !['labels','freedman-lane'].includes(scheme)
    || !['greater','less','two-sided'].includes(direction)) throw new Error('invalid exchangeability design');
  const nullValue = input.nullValue ?? 0;
  if (!Number.isFinite(nullValue)) throw new Error('invalid null value');
  const centeredY = centered(y.map((v,i) => v - nullValue*x[i]!));
  const outcomeScale=Math.max(...centeredY.map(Math.abs))||1;
  const adjustedY=centeredY.map(v=>v/outcomeScale);
  const binary=scheme==='labels'&&z.length===0&&x.every(v=>v===0||v===1);
  const labelStatistic=(labels:readonly number[])=>binary?welchStatistic(labels,adjustedY):dot(labels,resid);
  const fit = regression(x, adjustedY, z), q = orthogonal([x.map(() => 1), ...z]);
  const resid = residual(adjustedY,q), fitted = adjustedY.map((v,i) => v-resid[i]!);
  const blocks = new Map<string,number[]>();
  strata.forEach((s,i) => { const b=blocks.get(s)??[]; b.push(i); blocks.set(s,b); });
  const groups = [...blocks.values()];
  const source = scheme === 'labels' ? x : resid;
  const values = groups.map(g => g.map(i => source[i]!));
  const sizes = values.map(permutations), total = sizes.reduce((a,b) => a*b,1n);
  if (total < 2n) throw new Error('no exchangeable contrast');
  const stableNuisance = z.every(c => groups.every(g => g.every(i => c[i] === c[g[0]!] )));
  if(scheme==='labels'&&!stableNuisance)throw new Error('labels require stratum-constant nuisance');
  const guarantee = scheme === 'labels' || stableNuisance ? 'exact under exchangeability' : 'model-based: assumptions A1-A4';
  const max = input.maxPermutations ?? 100_000;
  if (!Number.isSafeInteger(max) || max < 1) throw new Error('invalid work limit');
  const mode=input.mode??(input.maxPermutations===undefined?'auto':'exact');
  if (mode === 'monte-carlo' || mode === 'auto' && total > BigInt(Math.min(max, 10_000))) {
    const rng = randomStream(seed + ':permutation');
    const score = (t: number) => direction === 'two-sided' ? Math.abs(t) : direction === 'less' ? -t : t;
    const observed = score(scheme === 'labels' ? labelStatistic(x) : fit.statistic);
    // Precompute residual exposure. Its norm and residual outcome norm order the FL t;
    // residualization still occurs after adding fitted nuisance (not raw label shuffling).
    const xr = residual(x,q), xx = dot(xr,xr), df = n-q.length-1;
    const draw = () => {
      const perm = [...source];
      for (const g of groups) for (let i=g.length-1;i>0;i--) { const j=rng.integer(i+1), a=g[i]!, b=g[j]!; [perm[a],perm[b]]=[perm[b]!,perm[a]!]; }
      if (scheme === 'labels') return score(labelStatistic(perm));
      const yr=residual(perm.map((v,i)=>v+fitted[i]!),q), xy=dot(xr,yr), estimate=xy/xx;
      const variance=Math.max(0,dot(yr,yr)-xy*xy/xx)/df/xx;
      return score(variance===0 ? (estimate===0?0:Math.sign(estimate)*1e100) : estimate/Math.sqrt(variance));
    };
    const mc=monteCarlo(observed,draw,alpha,input.monteCarlo);
    return {status:mc.decisionP<=alpha?'reject':'retain',p:mc.p,decisionP:mc.decisionP,pLower:Math.max(0,mc.p-3*mc.mcSE),pUpper:Math.min(1,mc.p+3*mc.mcSE),
      evaluated:mc.evaluated,total:String(total),extreme:mc.extreme,estimate:fit.estimate*outcomeScale+nullValue,statistic:fit.statistic,scheme,alpha,guarantee,stopping:mc.stopping,monteCarlo:mc};
  }
  const seedInt = BigInt('0x'+createHash('sha256').update(seed).digest('hex'));
  let step = (seedInt / total) % total || 1n; while (gcd(step,total)!==1n) step++;
  let rank = seedInt % total, extreme=0, evaluated=0, status: PermutationResult['status']='unresolved';
  let stopping: PermutationResult['stopping']='work-limit';
  const score = (t: number) => direction === 'two-sided' ? Math.abs(t) : direction === 'less' ? -t : t;
  // Under labels, stratum-constant nuisance makes the residual exposure norm invariant.
  // The partial covariance has exactly the same ordering as the fixed-effects t statistic.
  const observed = score(scheme==='labels'?labelStatistic(x):fit.statistic), [an,ad] = alphaRatio(alpha);
  const canDecide=BigInt(max)*ad>an*total || (total-BigInt(max))*ad<=an*total;
  for (; canDecide && evaluated < max && BigInt(evaluated)<total;) {
    let cursor=rank; const perm=[...source];
    groups.forEach((g,b) => { const v=unrank(values[b]!, cursor%sizes[b]!); cursor/=sizes[b]!; g.forEach((i,j)=>{perm[i]=v[j]!;}); });
    const stat = scheme === 'labels' ? labelStatistic(perm)
      : regression(x, perm.map((v,i)=>v+fitted[i]!),z).statistic;
    if (score(stat) >= observed - 1e-12*Math.abs(observed)) extreme++;
    evaluated++; rank=(rank+step)%total;
    const low=BigInt(extreme), high=low+total-BigInt(evaluated);
    if (high*ad <= an*total) status='reject';
    else if (low*ad > an*total) status='retain';
    if (BigInt(evaluated)===total) { stopping='exhaustive'; break; }
    if (status!=='unresolved' && !input.exhaustive) { stopping='decision-fixed'; break; }
  }
  const pLower=stopping==='exhaustive'?extreme/evaluated:ratio(BigInt(extreme),total), pUpper=stopping==='exhaustive'?pLower:Math.min(status==='reject'?alpha:1,ratio(BigInt(extreme)+total-BigInt(evaluated),total)+1e-16);
  return { status,p:stopping==='exhaustive'?pLower:null,pLower,pUpper,evaluated,total:String(total),extreme,
    estimate:fit.estimate*outcomeScale+nullValue,statistic:fit.statistic,scheme,alpha,guarantee,stopping };
}
