import {SURROGACY_WIDTHS,surrogateWidths} from './surrogacy-widths.ts';
import {tQuantileUpper} from './special.ts';
import type {SurrogateTrial,WeightedFit} from './surrogacy.ts';
/** Frozen after pilot selection; widening, not an asymptotic HC3 coverage claim. */
export const SURROGACY_ROBUST_POLICY=Object.freeze({widths:SURROGACY_WIDTHS,method:'HC3 slope and leverage-adjusted correlation sandwich; t(n-2), separate pilot-selected count-band widths, Fisher floor',lawFamily:['normal','t5','t3','contaminated-normal','skewed-lognormal'] as const});
const criticals=new Map<number,number>();
const critical=(df:number)=>{let q=criticals.get(df);if(q===undefined){q=tQuantileUpper(.025,df);criticals.set(df,q);}return q;};
export const squareCorrelationInterval=(r:[number,number]):[number,number]=>[r[0]<=0&&r[1]>=0?0:Math.min(r[0]**2,r[1]**2),Math.max(r[0]**2,r[1]**2)];
export function robustSurrogateRegression(ts:SurrogateTrial[],f:WeightedFit|null,factor?:number){
 if(!f||f.effectiveTrials<=3)return null;
 const n=ts.length,widths=surrogateWidths(n),slopeFactor=factor??widths.slopeFactor,correlationFactor=factor??widths.correlationFactor,w=ts.map(t=>1/t.seOutcome**2),my=ts.reduce((s,t,i)=>s+w[i]!*t.outcome,0)/f.sw;
 const vx=f.sxx/f.sw,vy=ts.reduce((s,t,i)=>s+w[i]!*(t.outcome-my)**2,0)/f.sw;
 let vb=0,vr=0;const residuals:number[]=[];
 for(let i=0;i<n;i++){
  const t=ts[i]!,p=w[i]!/f.sw,dx=t.surrogate-f.meanX,dy=t.outcome-my,e=t.outcome-f.intercept-f.slope*t.surrogate;
  const hx=p*(1+dx*dx/vx),hy=p*(1+dy*dy/vy),hb=Math.max(1e-12,1-hx),hr=Math.max(1e-12,1-Math.max(hx,hy));
  vb+=(w[i]!*dx*e/f.sxx/hb)**2;
  const influence=p*(dx*dy/Math.sqrt(vx*vy)-f.r/2*(dx*dx/vx+dy*dy/vy));
  vr+=(influence/hr)**2;
  residuals.push(Math.sqrt(w[i]!/hb)*e);
 }
 const q=critical(n-2),slopeSE=Math.sqrt(vb),rSE=Math.sqrt(vr),z=Math.atanh(Math.max(-1+1e-15,Math.min(1-1e-15,f.r)));
 const fisherHalf=1.959963984540054/Math.sqrt(f.effectiveTrials-3),half=Math.max(fisherHalf,correlationFactor*q*rSE/Math.max(1e-15,1-f.r*f.r));
 const rCI:[number,number]=[Math.tanh(z-half),Math.tanh(z+half)];
 const bh=slopeFactor*q*slopeSE,slopeCI:[number,number]=[Math.min(f.slopeCI[0],f.slope-bh),Math.max(f.slopeCI[1],f.slope+bh)];
 const mean=residuals.reduce((a,b)=>a+b,0)/n,m2=residuals.reduce((a,b)=>a+(b-mean)**2,0)/n,m4=residuals.reduce((a,b)=>a+(b-mean)**4,0)/n;
 return {method:SURROGACY_ROBUST_POLICY.method,factor:slopeFactor,correlationFactor,slope:f.slope,slopeSE,slopeCI,slopeNullRejected:slopeCI[0]>0||slopeCI[1]<0,r:f.r,r2:f.r2,rSE,rCI,ci:squareCorrelationInterval(rCI),residualExcessKurtosis:m2>0?m4/m2**2-3:null,df:n-2};
}
