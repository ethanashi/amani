import { centered, stableSum } from './numeric.ts';
import { logisticFit } from './robust.ts';
import { modelNuisance } from './linear.ts';
import type { PlanClaim, PrimaryEntry } from '../../omb-gauntlet/src/index.ts';
import type { ClaimData } from './producers.ts';
import { fractionalStudentCDF, studentP } from './student-tail.ts';
export { fractionalStudentCDF } from './student-tail.ts';
export function welchEntry(claim:PlanClaim,data:ClaimData):PrimaryEntry {
 if(data.nuisance.length||new Set(data.strata).size>1||new Set(data.units).size!==data.units.length||data.x.some(v=>v!==0&&v!==1))throw new Error('Welch requires two independent unadjusted groups');
 const y=centered(data.y),a=y.filter((_,i)=>data.x[i]===0),b=y.filter((_,i)=>data.x[i]===1);if(Math.min(a.length,b.length)<2)throw new Error('Welch group too small');
 const am=stableSum(a)/a.length,bm=stableSum(b)/b.length,va=stableSum(a.map(v=>(v-am)**2))/(a.length-1)/a.length,vb=stableSum(b.map(v=>(v-bm)**2))/(b.length-1)/b.length,se=Math.sqrt(va+vb),df=(va+vb)**2/(va*va/(a.length-1)+vb*vb/(b.length-1)),estimate=bm-am;
 if(!(se>0))throw new Error('Welch variance unavailable');
 const p=studentP((estimate-claim.nullValue)/se,df,claim.direction);
 let lo=0,hi=1;while(fractionalStudentCDF(hi,df)<1-claim.alpha/2)hi*=2;for(let i=0;i<60;i++){const m=(lo+hi)/2;if(fractionalStudentCDF(m,df)<1-claim.alpha/2)lo=m;else hi=m;}
 return {key:claim.id,estimate,p,se,ci:[estimate-hi*se,estimate+hi*se],nUnits:y.length,raw:{intervalMethod:'welch',df:String(df)}};
}
export function mlLogisticEntry(claim:PlanClaim,data:ClaimData):PrimaryEntry {
 if(!['logistic slope','log odds ratio','odds ratio'].includes(claim.estimand??''))throw new Error('logistic p requires logistic estimand');
 const fit=logisticFit([data.x.map(()=>1),...modelNuisance(data),data.x],data.y),b=fit.beta.at(-1)!,se=fit.mlSE.at(-1)!,ratio=claim.estimand==='odds ratio';
 const nullValue=ratio?Math.log(claim.nullValue):claim.nullValue,t=(b-nullValue)/se;
 // Normal CDF via the regularized Student limit is avoided: integrate smooth
 // normal density with fixed Simpson quadrature on [0,min(|z|,12)].
 const normal=(z:number)=>{const end=Math.min(Math.abs(z),12),h=end/512;let sum=0;for(let i=0;i<=512;i++)sum+=(i===0||i===512?1:i%2?4:2)*Math.exp(-.5*(i*h)**2);return .5+Math.sign(z)*sum*h/(3*Math.sqrt(2*Math.PI));};
 const cdf=normal(t),p=claim.direction==='two-sided'?2*Math.min(cdf,1-cdf):claim.direction==='less'?cdf:1-cdf;
 let lo=0,hi=12;for(let i=0;i<60;i++){const m=(lo+hi)/2;if(normal(m)<1-claim.alpha/2)lo=m;else hi=m;}
 return {key:claim.id,estimate:ratio?Math.exp(b):b,se:ratio?Math.exp(b)*se:se,p:Math.max(0,Math.min(1,p)),ci:ratio?[Math.exp(b-hi*se),Math.exp(b+hi*se)]:[b-hi*se,b+hi*se],nUnits:data.y.length,raw:{intervalMethod:'ML-logistic'}};
}
