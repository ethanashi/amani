import { dot, orthogonal, regression, residual } from './permutation.ts';
import { studentCDF, studentCritical } from './linear.ts';
import type { PrimaryEntry, PlanClaim } from '../../omb-gauntlet/src/index.ts';

export function hc3Linear(x:readonly number[],y:readonly number[],nuisance:readonly (readonly number[])[]=[]):{estimate:number;se:number;df:number} {
  const q=orthogonal([x.map(()=>1),...nuisance,x]),fit=regression(x,y,nuisance),errors=residual(y,q),xr=residual(x,q.slice(0,-1)),xx=dot(xr,xr);
  const variance=errors.reduce((s,e,i)=>{const h=q.reduce((t,c)=>t+c[i]!**2,0);if(h>=1-1e-10)throw new Error('HC3 unit leverage');return s+(xr[i]!*e/(1-h)/xx)**2;},0);
  return {estimate:fit.estimate,se:Math.sqrt(variance),df:x.length-q.length};
}
function inverse(a:readonly (readonly number[])[]):number[][] {
  const n=a.length,m=a.map((r,i)=>[...r,...Array.from({length:n},(_,j)=>i===j?1:0)]);
  for(let k=0;k<n;k++) {let pivot=k;for(let i=k+1;i<n;i++)if(Math.abs(m[i]![k]!)>Math.abs(m[pivot]![k]!))pivot=i;
    if(Math.abs(m[pivot]![k]!)<1e-12)throw new Error('singular logistic information');[m[k],m[pivot]]=[m[pivot]!,m[k]!];
    const d=m[k]![k]!;m[k]=m[k]!.map(v=>v/d);
    for(let i=0;i<n;i++)if(i!==k){const v=m[i]![k]!;m[i]=m[i]!.map((z,j)=>z-v*m[k]![j]!);}
  }return m.map(r=>r.slice(n));
}
export const expit=(x:number)=>x>=0?1/(1+Math.exp(-x)):Math.exp(x)/(1+Math.exp(x));
/** Fixed iteration cap. Separation/non-convergence is unevaluable, never a finite surrogate. */
export function logisticFit(columns:readonly (readonly number[])[], y:readonly number[], offset:readonly number[]=y.map(()=>0)):{beta:number[];se:number[];mlSE:number[];probabilities:number[];df:number} {
  const n=y.length,k=columns.length;
  if(offset.length!==n||offset.some(v=>!Number.isFinite(v))||n<=k||!y.every(v=>v===0||v===1)||!y.includes(0)||!y.includes(1)||columns.some(c=>c.length!==n||c.some(v=>!Number.isFinite(v))))throw new Error('invalid binary logistic design');
  orthogonal(columns);let beta=columns.map(()=>0),bread:number[][]=[],p:number[]=[];let converged=false;
  for(let step=0;step<80;step++){
    p=y.map((_,i)=>expit(offset[i]!+columns.reduce((s,c,j)=>s+c[i]!*beta[j]!,0)));
    if(p.some(v=>v<1e-10||v>1-1e-10))throw new Error('logistic separation or extreme fitted probabilities');
    bread=inverse(columns.map(a=>columns.map(b=>a.reduce((s,v,i)=>s+v*b[i]!*p[i]!*(1-p[i]!),0))));
    const score=columns.map(c=>c.reduce((s,v,i)=>s+v*(y[i]!-p[i]!),0)),delta=bread.map(r=>dot(r,score));
    beta=beta.map((v,j)=>v+delta[j]!);if(Math.max(...delta.map(Math.abs))<1e-9){converged=true;break;}
  }
  if(!converged)throw new Error('logistic nonconvergence');
  // Recompute the information at the final coefficients.
  p=y.map((_,i)=>expit(offset[i]!+columns.reduce((s,c,j)=>s+c[i]!*beta[j]!,0)));
  bread=inverse(columns.map(a=>columns.map(b=>a.reduce((s,v,i)=>s+v*b[i]!*p[i]!*(1-p[i]!),0))));
  const variances=columns.map(()=>0);
  for(let i=0;i<n;i++) {const v=columns.map(c=>c[i]!),influence=bread.map(r=>dot(r,v)),h=p[i]!*(1-p[i]!)*dot(v,influence);if(h>=1-1e-10)throw new Error('HC3 unit leverage');
    const e=(y[i]!-p[i]!)/(1-h);for(let j=0;j<k;j++)variances[j]=variances[j]!+(influence[j]!*e)**2;
  }return {beta,se:variances.map(Math.sqrt),mlSE:bread.map((r,i)=>Math.sqrt(r[i]!)),probabilities:p,df:n-k};
}
export function logisticEntry(claim:PlanClaim,x:readonly number[],y:readonly number[],nuisance:readonly (readonly number[])[]=[]):PrimaryEntry {
  const fit=logisticFit([x.map(()=>1),...nuisance,x],y),b=fit.beta.at(-1)!,se=fit.se.at(-1)!,or=claim.estimand?.toLowerCase()==='odds ratio';
  const nullValue=or?Math.log(claim.nullValue):claim.nullValue;
  if(!Number.isFinite(nullValue)||!(se>0))throw new Error('invalid logistic null or standard error');
  const cdf=studentCDF((b-nullValue)/se,fit.df),p=claim.direction==='two-sided'?2*Math.min(cdf,1-cdf):claim.direction==='less'?cdf:1-cdf,half=studentCritical(fit.df,claim.alpha)*se;
  return {key:claim.id,estimate:or?Math.exp(b):b,se:or?Math.exp(b)*se:se,p,ci:or?[Math.exp(b-half),Math.exp(b+half)]:[b-half,b+half],nUnits:x.length,raw:{intervalMethod:'HC3-logistic',logSE:String(se)}};
}
