import { normalUpper } from './special.ts';
import type { BetaSE } from './coloc-abf.ts';
export const twoSidedP = (z: number) => 2*normalUpper(Math.abs(z));

/** Small dense Cholesky solve; rejects indefinite matrices, does not silently repair LD. */
export function cholesky(a: readonly (readonly number[])[], tolerance=1e-10): number[][] {
  const n=a.length, l=Array.from({length:n},()=>Array<number>(n).fill(0));
  for(let i=0;i<n;i++) for(let j=0;j<=i;j++) {
    let v=a[i]![j]!;
    for(let k=0;k<j;k++) v-=l[i]![k]!*l[j]![k]!;
    if(i===j) { if(v < -tolerance) throw new Error('LD must be positive semidefinite'); l[i]![j]=Math.sqrt(Math.max(v,0)); }
    else if(l[j]![j]!>tolerance) l[i]![j]=v/l[j]![j]!;
    else if(Math.abs(v)>tolerance) throw new Error('LD must be positive semidefinite');
  }
  return l;
}
export function solve(l: number[][], b: number[]): number[] {
  const n=l.length, y=Array<number>(n).fill(0), x=[...y];
  for(let i=0;i<n;i++) { if(l[i]![i]!<1e-8) throw new Error('singular conditioning leads'); let v=b[i]!;for(let j=0;j<i;j++)v-=l[i]![j]!*y[j]!;y[i]=v/l[i]![i]!; }
  for(let i=n-1;i>=0;i--) {let v=y[i]!;for(let j=i+1;j<n;j++)v-=l[j]![i]!*x[j]!;x[i]=v/l[i]![i]!;}
  return x;
}
export function validateLD(r: readonly (readonly number[])[], n: number): void {
  if(r.length!==n || r.some(row=>row.length!==n)) throw new Error('LD dimensions differ from variants');
  for(let i=0;i<n;i++) for(let j=0;j<n;j++) {
    const v=r[i]![j]!;
    if(!Number.isFinite(v)||Math.abs(v)>1+1e-8||Math.abs(v-r[j]![i]!)>1e-8||i===j&&Math.abs(v-1)>1e-8) throw new Error('LD must be a finite symmetric correlation matrix');
  }
  cholesky(r,1e-7);
}
/** Variant-major dosages, already oriented to the summary effect allele. Complete reference rows. */
export function dosageLD(dosages: readonly (readonly number[])[]): number[][] {
  const n=dosages[0]?.length ?? 0;
  if(n<3||dosages.some(v=>v.length!==n||v.some(x=>!Number.isFinite(x)||x<0||x>2))) throw new Error('complete aligned dosages in [0,2] with >=3 samples required');
  const centered=dosages.map(v=>{const m=v.reduce((s,x)=>s+x,0)/n,c=v.map(x=>x-m),ss=Math.sqrt(c.reduce((s,x)=>s+x*x,0));if(ss===0)throw new Error('monomorphic reference variant');return c.map(x=>x/ss);});
  return centered.map((a,i)=>centered.map((b,j)=>i===j?1:a.reduce((s,v,k)=>s+v*b[k]!,0)));
}
/** Approximate summary-statistic conditioning on standardized scores. Each original SE is retained
 * in beta_cond = SE*(z-R_iS R_SS^-1 z_S)/q and SE_cond = SE/sqrt(q), q=1-R_iS R_SS^-1 R_Si.
 * This is a summary-score approximation, not binary-trait N-based linearisation or full GCTA COJO.
 */
/** Nested-sample score correlation. Explicit per-variant N takes precedence; otherwise
 * infer relative information from each SE and allele variance (no scalar-N rebuilding). */
export function scoreLD(stats:readonly BetaSE[],r:readonly (readonly number[])[]):number[][] {
  const n=stats.map(v=>{const x=v as BetaSE & {n?:number;maf?:number};return x.n ?? (x.maf ? 1/(2*x.maf*(1-x.maf)*x.se*x.se) : 1);});
  if(n.some(v=>!Number.isFinite(v)||v<=0))throw new Error('positive per-variant N required');
  return r.map((row,i)=>row.map((v,j)=>v*Math.sqrt(Math.min(n[i]!,n[j]!)/Math.max(n[i]!,n[j]!))));
}
export function condition(stats: readonly BetaSE[], r: readonly (readonly number[])[], leads: readonly number[], maxR2=.9): (BetaSE|null)[] {
  if(!leads.length)return stats.map(v=>({...v}));
  r=scoreLD(stats,r);
  const l=cholesky(leads.map(i=>leads.map(j=>r[i]![j]!))), z=solve(l,leads.map(i=>stats[i]!.beta/stats[i]!.se));
  return stats.map((v,i)=>{
    if(leads.includes(i))return null;
    const ri=leads.map(j=>r[i]![j]!), coefficients=solve(l,ri);
    const q=1-ri.reduce((s,x,k)=>s+x*coefficients[k]!,0);
    if(q<=1-maxR2)return null;
    const residual=v.beta/v.se-ri.reduce((s,x,k)=>s+x*z[k]!,0);
    return {beta:v.se*residual/q,se:v.se/Math.sqrt(q)};
  });
}
export interface SignalSelection { leads:number[]; exhausted:boolean; suppressed_null_candidates:number[]; excluded_collinear:number[] }
export function countSignals(stats: readonly BetaSE[], r: readonly (readonly number[])[], threshold: number, maxSignals: number, maxR2=.9): SignalSelection {
  const excluded=new Set<number>();
  const leads:number[]=[], suppressed=new Set<number>(), collinear=new Set<number>();
  for(let step=0;step<=maxSignals;step++) {
    const adjusted=condition(stats,r,leads,1-1e-6);
    const leadFactor=leads.length?cholesky(leads.map(i=>leads.map(j=>r[i]![j]!))):null;
    let best=-1, bestP=threshold;
    adjusted.forEach((v,i)=>{if(!v || excluded.has(i))return;
      if(leadFactor) {
        const ri=leads.map(j=>r[i]![j]!), weights=solve(leadFactor,ri);
        if(ri.reduce((sum,x,k)=>sum+x*weights[k]!,0)>=maxR2){collinear.add(i);return;}
      }
      const p=twoSidedP(v.beta/v.se);
      if(p<=threshold && twoSidedP(stats[i]!.beta/stats[i]!.se)>threshold){suppressed.add(i);return;}
      if(p<bestP || p===bestP&&best<0){best=i;bestP=p;}
    });
    if(best<0)return {leads,exhausted:false,suppressed_null_candidates:[...suppressed],excluded_collinear:[...collinear]};
    if(step===maxSignals)return {leads,exhausted:true,suppressed_null_candidates:[...suppressed],excluded_collinear:[...collinear]};
    leads.push(best);
    // Joint backward elimination removes tags of multiple causal variants.
    for(;;) {
      let remove=-1,worst=threshold;
      for(const lead of leads){const v=condition(stats,r,leads.filter(i=>i!==lead),1-1e-6)[lead];const p=v?twoSidedP(v.beta/v.se):1;if(p>worst){worst=p;remove=lead;}}
      if(remove<0)break;
      leads.splice(leads.indexOf(remove),1);excluded.add(remove);
    }
  }
  throw new Error('unreachable signal selection');
}
/** Maximum attainable squared correlation of two biallelic variants at these MAFs. */
export function maxAllelicR2(p: number, q: number): number {
  const positive=Math.min(p*(1-q),q*(1-p)),negative=Math.min(p*q,(1-p)*(1-q));
  return Math.max(positive*positive,negative*negative)/(p*(1-p)*q*(1-q));
}
/** DENTIST-style pairwise residual screen on high-LD proxies. A screen, not a formal LD-match test:
 * unexplained z contrasts are standardized by 1-r² with a declared noise floor for finite panels.
 * Family-wise Bonferroni over tested oriented pairs and both traits. */
export function ldConsistency(a: readonly BetaSE[], b: readonly BetaSE[], r: readonly (readonly number[])[], minR2: number, noiseFloor: number, alpha: number) {
  let tests=0,maxResidual=0; const failures:{trait:number;variant:number;proxy:number;residual:number}[]=[];
  const residuals:{trait:number;variant:number;proxy:number;residual:number}[]=[];
  for(const [trait,stats] of [a,b].entries()) {
    const candidates=countSignals(stats,r,5e-8,10).leads.sort((i,j)=>Math.abs(stats[j]!.beta/stats[j]!.se)-Math.abs(stats[i]!.beta/stats[i]!.se));
    const leads:number[]=[];for(const i of candidates)if(leads.every(j=>r[i]![j]!**2<minR2))leads.push(i);
    const covariance=scoreLD(stats,r);
    for(const lead of leads) {
      const others=leads.filter(i=>i!==lead), adjusted=condition(stats,r,others,1-1e-6);
      const leadStat=adjusted[lead];if(!leadStat)continue;
      for(let i=0;i<stats.length;i++) {
        if(i===lead||leads.includes(i)||r[i]![lead]!**2<minR2||!adjusted[i])continue;
        const correlation=covariance[i]![lead]!;
        const residual=Math.abs(adjusted[i]!.beta/adjusted[i]!.se-correlation*leadStat.beta/leadStat.se)/Math.sqrt(Math.max(noiseFloor,1-correlation**2));
        residuals.push({trait,variant:i,proxy:lead,residual});
      }
    }
  }
  tests=residuals.length;
  for(const row of residuals){maxResidual=Math.max(maxResidual,row.residual);if(twoSidedP(row.residual)<alpha/Math.max(1,tests))failures.push(row);}
  return {tests,max_residual:maxResidual,failures};
}
