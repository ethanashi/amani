import { centered, stableSum } from './numeric.ts';
import { hc3Linear, logisticEntry } from './robust.ts';
import { regression, orthogonal } from './permutation.ts';
import type { PrimaryEntry, PlanClaim } from '../../omb-gauntlet/src/index.ts';
import type { ClaimData } from './producers.ts';

import { fractionalStudentCDF, studentP } from './student-tail.ts';
/** Integer-df compatibility API; tail tests use studentP directly. */
export function studentCDF(t:number,df:number):number {
  if(!Number.isSafeInteger(df)||df<1)throw new Error('invalid Student distribution');
  return fractionalStudentCDF(t,df);
}
const criticalCache=new Map<string,number>();
export function studentCritical(df:number,alpha=.05):number {
  if(!Number.isSafeInteger(df)||df<1)throw new Error('invalid Student distribution');
  const key=`${df}:${alpha}`,cached=criticalCache.get(key);if(cached!==undefined)return cached;
  if(!(alpha>0&&alpha<=.05))throw new Error('invalid interval alpha');
  let lo=0,hi=1;while(studentP(hi,df,'greater')>alpha/2&&hi<1e15)hi*=2;
  for(let i=0;i<64;i++){const mid=(lo+hi)/2;if(studentP(mid,df,'greater')>alpha/2)lo=mid;else hi=mid;}
  criticalCache.set(key,hi);return hi;
}
/** Strata fixed effects and declared adjustments share one full-rank span in every kernel.
 * Redundant nuisance columns are harmless; a collinear exposure is still refused by regression. */
export function modelNuisance(data:ClaimData):number[][] {
  if(data.strata.length!==data.x.length||data.strata.some(s=>!s.trim())||data.nuisance.some(c=>c.length!==data.x.length||c.some(v=>!Number.isFinite(v))))throw new Error('invalid nuisance design');
  const levels=[...new Set(data.strata)].sort(), columns:number[][]=[];
  for(const c of [...levels.slice(1).map(s=>data.strata.map(v=>v===s?1:0)),...data.nuisance]){
    try{orthogonal([data.x.map(()=>1),...columns,c]);columns.push(c);}catch{/* redundant nuisance */}
  }
  return columns;
}
/** Trusted linear-model interval; Gaussian independent homoskedastic errors are an explicit
 * additional assumption, not a permutation/exchangeability coverage guarantee. */
export function linearEntry(claim:PlanClaim,data:ClaimData):PrimaryEntry {
  if(new Set(data.units).size<data.units.length) {
    const visits=[...new Set(data.x)].sort((a,b)=>a-b),control=typeof claim.knobs.controlLevel==='number'?claim.knobs.controlLevel:visits[0],treated=typeof claim.knobs.treatedLevel==='number'?claim.knobs.treatedLevel:visits.at(-1);
    const contrasts=pairedContrasts(data,control,treated),n=contrasts.length,estimate=contrasts.reduce((s,v)=>s+v,0)/n,se=Math.sqrt(contrasts.reduce((s,v)=>s+(v-estimate)**2,0)/(n-1)/n),half=studentCritical(n-1,claim.alpha)*se;
    const p=se>0?studentP((estimate-claim.nullValue)/se,n-1,claim.direction):estimate===claim.nullValue?(claim.direction==='two-sided'?1:.5):claim.direction==='two-sided'?0:claim.direction==='greater'?Number(estimate<claim.nullValue):Number(estimate>claim.nullValue);
    return {key:claim.id,estimate,p,se,ci:[estimate-half,estimate+half],nUnits:n,raw:{intervalMethod:'student-wald',df:String(n-1)}};
  }
  const nuisance=modelNuisance(data);
  if(['logistic slope','log odds ratio','odds ratio'].includes(claim.estimand?.toLowerCase()??''))return logisticEntry(claim,data.x,data.y,nuisance);
  const fit=regression(data.x,data.y,nuisance),nullFit=regression(data.x,data.y.map((y,i)=>y-claim.nullValue*data.x[i]!),nuisance);
  const df=data.x.length-nuisance.length-2,se=data.y.every(y=>y===0||y===1)||claim.knobs.interval==='HC3'?hc3Linear(data.x,data.y,nuisance).se:fit.se,half=studentCritical(df,claim.alpha)*se;
  const p=studentP(nullFit.statistic,df,claim.direction);
  return {key:claim.id,estimate:fit.estimate,p,ci:[fit.estimate-half,fit.estimate+half],se,nUnits:data.units.length,raw:{df:String(df),intervalMethod:data.y.every(y=>y===0||y===1)||claim.knobs.interval==='HC3'?'HC3-linear':'student-wald'}};
}

/** Repeated two-condition rows become one equal-weight contrast per declared unit. */
export function pairedContrasts(data:ClaimData,controlLevel?:number,treatedLevel?:number):number[] {
  const groups=new Map<string,number[]>();data.units.forEach((u,i)=>{const g=groups.get(u)??[];g.push(i);groups.set(u,g);});
  const levels=[...new Set(data.x)].sort((a,b)=>a-b),control=controlLevel??levels[0],treated=treatedLevel??levels.at(-1);
  if(groups.size<3||control===undefined||treated===undefined||control===treated||!levels.includes(control)||!levels.includes(treated))throw new Error('paired kernel requires a locked within-unit contrast and at least three units');
  return [...groups.values()].map(g=>{
    const selected=g.filter(i=>data.x[i]===control||data.x[i]===treated);if(selected.some(i=>data.strata[i]!==data.strata[selected[0]!]))throw new Error('paired unit crosses declared strata');
    if(data.nuisance.some(c=>selected.some(i=>c[i]!==c[selected[0]!])) )throw new Error('within-unit varying nuisance requires a reviewed repeated-measures model');
    const a=selected.filter(i=>data.x[i]===control),b=selected.filter(i=>data.x[i]===treated);if(!a.length||!b.length)throw new Error('incomplete paired unit');
    const mean=(indices:number[])=>indices.reduce((s,i)=>s+data.y[i]!,0)/indices.length;return mean(b)-mean(a);
  });
}
