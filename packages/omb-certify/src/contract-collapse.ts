import type { PlanClaim } from '../../omb-gauntlet/src/index.ts';
import { decimalsOf } from '../../omb-procedures/src/index.ts';
import type { ClaimData } from './producers.ts';

/** Largest decimal count at which every value of the given magnitude scales to a safe integer (the
 * same bound the registry applies to an undeclared resolution). */
function safeDecimals(magnitude:number):number {return Math.max(0,Math.floor(Math.log10(Number.MAX_SAFE_INTEGER/Math.max(1,magnitude)))-1);}
/** Extra decimals that hold v/k exactly for every v on a decimal grid, or null when k has a prime
 * factor other than 2 or 5 (the mean of k grid values is then not a finite decimal). */
function exactExtraDecimals(sizes:Iterable<number>):number|null {
  let extra=0;
  for(const k of sizes){let m=k,twos=0,fives=0;while(m%2===0){m/=2;twos++;}while(m%5===0){m/=5;fives++;}if(m!==1)return null;extra=Math.max(extra,twos,fives);}
  return extra;
}
/** The resolution of averaged replicate outcomes (K2b-fix1, k1b-round4 finding 22). The registered
 * procedures compute on integers at the outcome's resolution, and a mean of k values on the declared
 * grid is generally finer than that grid. When every averaged group size is 2^a·5^b the derived grid
 * (declared decimals + max(a, b)) holds each mean exactly; otherwise the host declares the finest grid
 * whose integers stay safe for every column the procedures scale and rounds each mean to it (an error
 * below half that grid, far inside G3's 1e-8 relative agreement). */
function replicateMeanDecimals(data:ClaimData,claim:PlanClaim,averagedSizes:readonly number[],collapsedY:readonly number[]):{decimals:number;exact:boolean} {
  const yi=data.header.indexOf(claim.outcome??'');
  const base=data.decimalResolution?decimalsOf(data.decimalResolution)
    :Math.max(0,...data.rows.map(r=>r[yi]??'').filter(t=>t.trim()&&Number.isFinite(Number(t))).map(t=>{try{return decimalsOf(t);}catch{return 0;}}));
  const magnitude=Math.max(1,...collapsedY.map(Math.abs),...data.x.map(Math.abs),...data.nuisance.flat().map(Math.abs).filter(Number.isFinite));
  const cap=Math.max(base,safeDecimals(magnitude)),extra=exactExtraDecimals(new Set(averagedSizes));
  return extra!==null&&base+extra<=cap?{decimals:base+extra,exact:true}:{decimals:cap,exact:false};
}
const resolutionString=(decimals:number)=>decimals>=0?`1e-${decimals}`:`1e${-decimals}`;

/** Equal-weight floor units for between-unit exposure. Repeated conditions remain
 * intact for the registered paired procedures. No heuristic ID selection occurs. */
export function collapseContractRows(data:ClaimData,claim:PlanClaim):ClaimData{
  const byUnit=new Map<string,number[]>();
  data.units.forEach((u,i)=>{const g=byUnit.get(u)??[];g.push(i);byUnit.set(u,g);});
  if(byUnit.size===data.units.length||claim.kind==='out-of-sample')return data;
  const groups=[...byUnit.values()];
  if(groups.some(g=>g.some(i=>data.x[i]!==data.x[g[0]!])))return data;
  // Averaging varying covariates would silently change a conditional estimand.
  const fixed=[data.strata,...data.nuisance,...Object.values(data.covariates).flat()];
  if(groups.some(g=>fixed.some(col=>g.some(i=>col[i]!==col[g[0]!]))))throw new Error('replicate covariates vary within unit; clustered procedure required');
  if(claim.test==='logistic'&&groups.some(g=>g.some(i=>data.y[i]!==data.y[g[0]!])) )throw new Error('binary replicates disagree; clustered procedure required');
  const first=<T>(col:T[])=>groups.map(g=>col[g[0]!]!);
  const yi=data.header.indexOf(claim.outcome!);
  // A group whose replicates agree keeps its value and source token unchanged.
  const constant=groups.map(g=>g.every(i=>data.y[i]===data.y[g[0]!]));
  const mean=groups.map((g,k)=>constant[k]?data.y[g[0]!]!:g.reduce((sum,i)=>sum+data.y[i]!,0)/g.length);
  const averaged=groups.filter((_,k)=>!constant[k]).map(g=>g.length);
  const resolution=averaged.length?replicateMeanDecimals(data,claim,averaged,mean):null;
  const y=resolution?mean.map((v,k)=>constant[k]?v:Number(v.toFixed(Math.max(0,resolution.decimals)))):mean;
  const token=(k:number)=>constant[k]||!resolution?data.rows[groups[k]![0]!]![yi]!:y[k]!.toFixed(Math.max(0,resolution.decimals));
  return {...data,units:[...byUnit.keys()],x:first(data.x),y,strata:first(data.strata),nuisance:data.nuisance.map(first),
    covariates:Object.fromEntries(Object.entries(data.covariates).map(([k,cols])=>[k,cols.map(first)])),
    rows:groups.map((g,k)=>{const row=[...data.rows[g[0]!]!];if(yi>=0)row[yi]=token(k);return row;}),sourceRowGroups:groups,
    ...(resolution?{decimalResolution:resolutionString(resolution.decimals),replicateMeanResolution:resolution}:{})};
}
