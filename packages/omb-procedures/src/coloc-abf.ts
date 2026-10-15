/** Wakefield beta/SE route, uniform variant priors, matching coloc::coloc.abf.
 * Prior SDs are in the supplied beta units (quantitative SD already incorporated).
 * Reference: chr1swallace/coloc R/claudia.R, approx.bf.estimates / combine.abf.
 */
export interface ColocPriors { p1: number; p2: number; p12: number; sd1: number; sd2: number }
export interface BetaSE { beta: number; se: number }
export type ColocVerdict = 'shared-variant' | 'distinct-variants' | 'inconclusive' | 'method-sensitive';
export interface ColocPosterior {
  pp_h0: number; pp_h1: number; pp_h2: number; pp_h3: number; pp_h4: number;
  verdict: Exclude<ColocVerdict, 'method-sensitive'>;
  n_variants: number;
  effective_priors: ColocPriors;
}
export function logAdd(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const m = Math.max(a,b); return m + Math.log1p(Math.exp(Math.min(a,b)-m));
}
export function logABF({beta,se}: BetaSE, sd: number): number {
  if (!Number.isFinite(beta) || !Number.isFinite(se) || se <= 0 || !Number.isFinite(sd) || sd <= 0)
    throw new Error('finite beta, positive per-variant SE and prior SD required');
  const ratio = (sd/se)**2, z=beta/se;
  const value = .5*(-Math.log1p(ratio) + ratio/(1+ratio)*z*z);
  if (!Number.isFinite(value)) throw new Error('ABF numerical range exceeded');
  return value;
}
export function colocABF(a: readonly BetaSE[], b: readonly BetaSE[], priors: ColocPriors): ColocPosterior {
  if (!a.length || a.length !== b.length) throw new Error('nonempty aligned beta/SE arrays required');
  for (const p of [priors.p1,priors.p2,priors.p12]) if (!Number.isFinite(p) || p <= 0 || p >= 1) throw new Error('priors must be in (0,1)');
  // coloc::adjust_prior applies separately to p1, p2 and p12 on the input SNP set.
  const adjust = (p: number) => a.length*p >= 1 ? 1/(a.length+1) : p;
  const effective_priors = {...priors,p1:adjust(priors.p1),p2:adjust(priors.p2),p12:adjust(priors.p12)};
  const x=a.map(v=>logABF(v,priors.sd1)), y=b.map(v=>logABF(v,priors.sd2));
  const sum=(v: number[])=>v.reduce(logAdd,-Infinity);
  // Prefix/suffix sums exclude i exactly, avoiding catastrophic cancellation in H3.
  const prefix=[-Infinity], suffix=Array<number>(y.length+1).fill(-Infinity);
  for(let i=0;i<y.length;i++) prefix.push(logAdd(prefix[i]!,y[i]!));
  for(let i=y.length-1;i>=0;i--) suffix[i]=logAdd(suffix[i+1]!,y[i]!);
  const distinct=sum(x.map((v,i)=>v+logAdd(prefix[i]!,suffix[i+1]!)));
  const {p1,p2,p12}=effective_priors;
  const logs=[0,Math.log(p1)+sum(x),Math.log(p2)+sum(y),Math.log(p1)+Math.log(p2)+distinct,Math.log(p12)+sum(x.map((v,i)=>v+y[i]!))];
  const denom=sum(logs), pp=logs.map(v=>Math.exp(v-denom));
  return {pp_h0:pp[0]!,pp_h1:pp[1]!,pp_h2:pp[2]!,pp_h3:pp[3]!,pp_h4:pp[4]!,
    verdict:pp[4]!>=.8?'shared-variant':pp[3]!>=.8?'distinct-variants':'inconclusive',n_variants:a.length,effective_priors};
}

/** coloc 5.2.3 split.R coloc.process: per-trait -1.1 masks and zero lbf3
 * for any masked trait pair. O(n), algebraically equal to the R n*(n-1) table. */
export function colocMaskedABF(a:readonly BetaSE[],b:readonly BetaSE[],priors:ColocPriors,dropA:readonly boolean[],dropB:readonly boolean[]):ColocPosterior|null {
  if(a.filter((_,i)=>!dropA[i]&&!dropB[i]).length<=1)return null;
  const base=colocABF(a,b,priors),x=a.map(v=>logABF(v,priors.sd1)),y=b.map(v=>logABF(v,priors.sd2));
  const sum=(v:number[])=>v.reduce(logAdd,-Infinity),n=a.length;
  const activeY=y.map((v,i)=>dropB[i]?-Infinity:v),prefix=[-Infinity],suffix=Array<number>(n+1).fill(-Infinity);
  for(let i=0;i<n;i++)prefix.push(logAdd(prefix[i]!,activeY[i]!));
  for(let i=n-1;i>=0;i--)suffix[i]=logAdd(suffix[i+1]!,activeY[i]!);
  const distinct=sum(x.map((v,i)=>dropA[i]?-Infinity:v+logAdd(prefix[i]!,suffix[i+1]!)));
  const na=dropA.filter(v=>!v).length,nb=dropB.filter(v=>!v).length,both=a.filter((_,i)=>!dropA[i]&&!dropB[i]).length;
  const maskedPairs=n*(n-1)-(na*nb-both);
  const {p1,p2,p12}=base.effective_priors;
  const logs=[0,Math.log(p1)+sum(x.map((v,i)=>dropA[i]?-1.1:v)),Math.log(p2)+sum(y.map((v,i)=>dropB[i]?-1.1:v)),
    Math.log(p1)+Math.log(p2)+logAdd(distinct,Math.log(maskedPairs)),Math.log(p12)+sum(x.map((v,i)=>dropA[i]||dropB[i]?-1.1:v+y[i]!))];
  const den=sum(logs),pp=logs.map(v=>Math.exp(v-den));
  return {...base,pp_h0:pp[0]!,pp_h1:pp[1]!,pp_h2:pp[2]!,pp_h3:pp[3]!,pp_h4:pp[4]!,verdict:pp[4]!>=.8?'shared-variant':pp[3]!>=.8?'distinct-variants':'inconclusive'};
}
