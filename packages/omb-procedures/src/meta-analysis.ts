import { gammaQ, lchoose, normalUpper, tPValue, tQuantileUpper } from './special.ts';
import type { ProcedureAssumption, ProcedureDiagnostic, ProcedureEnvelope } from './types.ts';

export type EffectMeasure = 'OR' | 'RR' | 'RD';
export type MetaModel = 'MH' | 'Peto' | 'exact' | 'DL';
export interface AdverseEventTrial { id:string; eventsTreatment:number; totalTreatment:number; eventsControl:number; totalControl:number; measure?:string }
export interface MetaAnalysisInput { trials:AdverseEventTrial[]; measure:EffectMeasure; model?:MetaModel; continuityCorrection?:number; role?:'primary'|'sensitivity' }
export interface MetaEstimate { measure:EffectMeasure; method:string; estimate:number; ci:[number,number]; se:number; p:number; k:number; intervalMethod:string }
export const META_POLICY = Object.freeze({ rareRisk:.01, petoMaxRisk:.1, petoMaxImbalance:2, petoMinOR:.5, petoMaxOR:2, minSmallStudyTrials:10, exactMaxWidth:1000, exactMaxOperations:2000000 });
const assumption=(id:string,assumption:string,blocks:string[],alternatives:string[]=[]):ProcedureAssumption=>({id,assumption,blocks,mandatory:true,diagnostic:id,valid_alternatives:alternatives,default_rule:{on_fail:alternatives,on_not_evaluable:'not-estimable'}});
export const META_ASSUMPTIONS:readonly ProcedureAssumption[] = [
 assumption('ae.common-measure','All trials estimate the same binary outcome measure',['ae.primary','ae.mh','ae.absolute','ae.heterogeneity','ae.smallStudy','ae.forest','ae.funnel']),
 assumption('ae.uncorrected-primary','Rare-event primaries do not use continuity corrections',['ae.primary'],['ae.mh']),
 assumption('ae.peto-envelope','Peto requires rare events, balanced arms and modest effects',['ae.primary'],['ae.mh']),
 assumption('ae.estimable','The requested model has estimable sampling information',['ae.primary'],['ae.mh']),
 assumption('ae.small-study-support','Small-study tests require at least ten estimable trials',['ae.smallStudy']),
];
export interface MetaAnalysisResult extends ProcedureEnvelope {
 diagnostics:ProcedureDiagnostic[]; primary:MetaEstimate|null; mh:MetaEstimate|null;
 forest:Array<AdverseEventTrial & {estimate:number|null;ci:[number,number]|null;se:number|null;weight:number;included:boolean;reason:string|null}>;
 heterogeneity:{q:number;df:number;p:number;i2:number;i2CI:[number,number];tau2:number;tau2CI:[number,number];method:string;k:number}|null;
 absolute:{riskDifference:MetaEstimate|null;controlRisk:number;per1000:number|null;nnh:number|null;direction:'harm'|'benefit'|'none';nnhIntervals:Array<{direction:'harm'|'benefit';lower:number;upper:number|null}>};
 smallStudy:{method:string;intercept:number;p:number;k:number}|null;
 counts:{inputTrials:number;includedTrials:number;doubleZero:number;excludedDoubleZero:number;excludedNonEstimable:number;includedTotalTreatment:number;includedTotalControl:number;eventsTreatment:number;eventsControl:number;totalTreatment:number;totalControl:number};
 settings:{measure:EffectMeasure;model:MetaModel;continuityCorrection:number;doubleZeroRule:string;role:string};
}
const sum=(xs:number[])=>xs.reduce((a,b)=>a+b,0);
const Z=1.959963984540054;
function cells(t:AdverseEventTrial,cc=0){const add=cc>0&&[t.eventsTreatment,t.eventsControl,t.totalTreatment-t.eventsTreatment,t.totalControl-t.eventsControl].includes(0)?cc:0;const a=t.eventsTreatment+add,b=t.totalTreatment-t.eventsTreatment+add,c=t.eventsControl+add,d=t.totalControl-t.eventsControl+add;return {a,b,c,d,n1:a+b,n0:c+d,n:a+b+c+d};}
function effect(t:AdverseEventTrial,m:EffectMeasure,cc=0):{y:number;v:number}|null {const {a,b,c,d,n1,n0}=cells(t,cc);let y:number,v:number;
 if(m==='OR'){y=Math.log(a*d/(b*c));v=1/a+1/b+1/c+1/d;}else if(m==='RR'){y=Math.log(a/n1/(c/n0));v=1/a-1/n1+1/c-1/n0;}else{y=a/n1-c/n0;v=a*b/n1**3+c*d/n0**3;}
 return Number.isFinite(y)&&Number.isFinite(v)&&v>0?{y,v}:null;
}
function estimate(m:EffectMeasure,method:string,y:number,v:number,k:number,df=Infinity,intervalMethod='normal'):MetaEstimate|null {
 if(!Number.isFinite(y)||!Number.isFinite(v)||v<=0)return null;const se=Math.sqrt(v),q=df===Infinity?Z:tQuantileUpper(.025,df),transform=(x:number)=>m==='RD'?x:Math.exp(x);
 return {measure:m,method,estimate:transform(y),ci:[transform(y-q*se),transform(y+q*se)],se,p:df===Infinity?2*normalUpper(Math.abs(y/se)):tPValue(y/se,df,'two-sided'),k,intervalMethod};
}
export function mantelHaenszel(trials:AdverseEventTrial[],m:EffectMeasure):MetaEstimate|null {
 const ts=trials.filter(t=>m==='RD'||t.eventsTreatment+t.eventsControl>0);const c=ts.map(t=>cells(t));let y:number,v:number;
 if(m==='OR') {const r=sum(c.map(x=>x.a*x.d/x.n)),s=sum(c.map(x=>x.b*x.c/x.n));y=Math.log(r/s);v=sum(c.map(x=>(x.a+x.d)*x.a*x.d/x.n**2))/(2*r*r)+sum(c.map(x=>((x.a+x.d)*x.b*x.c+(x.b+x.c)*x.a*x.d)/x.n**2))/(2*r*s)+sum(c.map(x=>(x.b+x.c)*x.b*x.c/x.n**2))/(2*s*s);}
 else if(m==='RR'){const r=sum(c.map(x=>x.a*x.n0/x.n)),s=sum(c.map(x=>x.c*x.n1/x.n));y=Math.log(r/s);v=sum(c.map(x=>(x.n1*x.n0*(x.a+x.c)-x.a*x.c*x.n)/x.n**2))/(r*s);}
 else {const w=sum(c.map(x=>x.n1*x.n0/x.n));y=sum(c.map(x=>(x.a*x.n0-x.c*x.n1)/x.n))/w;// Sato/Greenland common-risk-difference variance; compatible with sparse strata.
 const imbalance=sum(c.map(x=>x.c*(x.n1/x.n)**2-x.a*(x.n0/x.n)**2+x.n1*x.n0*(x.n0-x.n1)/(2*x.n*x.n)));
 const crossEvents=sum(c.map(x=>(x.a*(x.n0-x.c)+x.c*(x.n1-x.a))/(2*x.n)));
 v=(y*imbalance+crossEvents)/w**2;}
 return estimate(m,'MH',y,v,ts.length);
}
function peto(ts:AdverseEventTrial[]):MetaEstimate|null {let oe=0,v=0,k=0;for(const t of ts){const x=cells(t),e=x.a+x.c;const vi=x.n1*x.n0*e*(x.n-e)/(x.n*x.n*(x.n-1));if(vi>0){oe+=x.a-x.n1*e/x.n;v+=vi;k++;}}return estimate('OR','Peto',oe/v,1/v,k);}
const chiCache=new Map<string,number>();
function chiQuantile(p:number,df:number){const key=`${p}:${df}`;if(chiCache.has(key))return chiCache.get(key)!;let lo=0,hi=df+1;while(1-gammaQ(df/2,hi/2)<p)hi*=2;for(let i=0;i<80;i++){const mid=(lo+hi)/2;if(1-gammaQ(df/2,mid/2)<p)lo=mid;else hi=mid;}const value=(lo+hi)/2;chiCache.set(key,value);return value;}
function heterogeneous(es:{y:number;v:number}[]){if(es.length<2)return null;const k=es.length,w=es.map(e=>1/e.v),sw=sum(w),mean=sum(es.map((e,i)=>w[i]!*e.y))/sw,q=sum(es.map((e,i)=>w[i]!*(e.y-mean)**2)),df=k-1,c=sw-sum(w.map(x=>x*x))/sw,tau2=Math.max(0,(q-df)/c),typical=df/c;
 const qt=(tau:number)=>{const ws=es.map(e=>1/(e.v+tau)),s=sum(ws),mu=sum(es.map((e,i)=>ws[i]!*e.y))/s;return sum(es.map((e,i)=>ws[i]!*(e.y-mu)**2));};
 const root=(target:number)=>{if(q<=target)return 0;let lo=0,hi=Math.max(1,tau2);while(qt(hi)>target)hi*=2;for(let i=0;i<70;i++){const mid=(lo+hi)/2;if(qt(mid)>target)lo=mid;else hi=mid;}return (lo+hi)/2;};
 const tc:[number,number]=[root(chiQuantile(.975,df)),root(chiQuantile(.025,df))];
 return {q,df,p:gammaQ(df/2,q/2),i2:q>0?Math.max(0,(q-df)/q):0,i2CI:tc.map(t=>t/(t+typical)) as [number,number],tau2,tau2CI:tc,method:'inverse-variance Q; DL tau2; Q-profile I2 CI',k};
}
/** Conditional common odds ratio. Conditions on each trial's margins; no pseudo-counts.
 * The sufficient-statistic distribution is convolved once at theta=1 then exponentially tilted. */
export function conditionalOddsRatio(ts:AdverseEventTrial[]):MetaEstimate|null {
 let log=[0],offset=0,observed=0,ops=0,k=0;
 const logAdd=(a:number,b:number)=>a===-Infinity?b:b===-Infinity?a:Math.max(a,b)+Math.log1p(Math.exp(-Math.abs(a-b)));
 for(const t of ts){const {a,c,n1,n0}=cells(t),m=a+c,lo=Math.max(0,m-n0),hi=Math.min(n1,m);if(hi===lo)continue;k++;const width=hi-lo;
 if(log.length+width>META_POLICY.exactMaxWidth||(ops+=log.length*(width+1))>META_POLICY.exactMaxOperations)return null;
 const logs=Array.from({length:width+1},(_,j)=>lchoose(n1,lo+j)+lchoose(n0,m-lo-j));const next=Array(log.length+width).fill(-Infinity) as number[];
 log.forEach((v,i)=>logs.forEach((u,j)=>{next[i+j]=logAdd(next[i+j]!,v+u);}));const mx=Math.max(...next);log=next.map(v=>v-mx);offset+=lo;observed+=a;
 }
 if(!k)return null;const target=observed-offset;
 const dist=(theta:number)=>{const ls=log.map((v,i)=>v+i*theta),max=Math.max(...ls),ps=ls.map(x=>Math.exp(x-max)),total=sum(ps);return ps.map(v=>v/total);};
 const solve=(f:(theta:number)=>number,value:number,increasing=true)=>{let lo=-700,hi=700;for(let i=0;i<100;i++){const mid=(lo+hi)/2;if((f(mid)<value)===increasing)lo=mid;else hi=mid;}return (lo+hi)/2;};
 const max=log.length-1,theta=target===0?-Infinity:target===max?Infinity:solve(t=>sum(dist(t).map((v,i)=>v*i)),target),low=target===0?0:Math.exp(solve(t=>sum(dist(t).slice(target)),.025)),high=target===max?Infinity:Math.exp(solve(t=>sum(dist(t).slice(0,target+1)),.025,false)),d=dist(0);
 return {measure:'OR',method:'exact',estimate:Math.exp(theta),ci:[low,high],se:NaN,p:Math.min(1,2*Math.min(sum(d.slice(0,target+1)),sum(d.slice(target)))),k,intervalMethod:'equal-tailed conditional exact'};
}
export function metaAnalysisAdverseEvents(input:MetaAnalysisInput):MetaAnalysisResult {
 const {trials,measure}=input,model=input.model??'MH',cc=input.continuityCorrection??0,role=input.role??'primary';
 if(!Array.isArray(trials)||trials.length===0||trials.length>1000||!['OR','RR','RD'].includes(measure)||!['MH','Peto','exact','DL'].includes(model)||!Number.isFinite(cc)||cc<0||cc>1||!['primary','sensitivity'].includes(role))throw new Error('invalid meta-analysis configuration');
 if(new Set(trials.map(t=>t.id)).size!==trials.length)throw new Error('independent unique trial IDs required; aggregate shared controls first');
 for(const t of trials)if(!t.id||![t.eventsTreatment,t.eventsControl,t.totalTreatment,t.totalControl].every(Number.isSafeInteger)||t.totalTreatment<1||t.totalControl<1||t.eventsTreatment<0||t.eventsControl<0||t.eventsTreatment>t.totalTreatment||t.eventsControl>t.totalControl)throw new Error('invalid participant event counts');
 const same=trials.every(t=>t.measure===undefined||t.measure===measure),used=trials.filter(t=>measure==='RD'||t.eventsTreatment+t.eventsControl>0),dz=trials.filter(t=>t.eventsTreatment+t.eventsControl===0).length,mh=mantelHaenszel(trials,measure),es=used.map(t=>effect(t,measure,cc)),finite=es.filter((x):x is {y:number;v:number}=>x!==null),het=heterogeneous(finite);
 let primary:MetaEstimate|null=mh;
 if(model==='Peto')primary=measure==='OR'?peto(used):null;
 if(model==='exact')primary=measure==='OR'?conditionalOddsRatio(used):null;
 if(model==='DL'){primary=null;if(finite.length===used.length&&het){const ws=finite.map(e=>1/(e.v+het.tau2)),sw=sum(ws),mu=sum(finite.map((e,i)=>ws[i]!*e.y))/sw,q=sum(finite.map((e,i)=>ws[i]!*(e.y-mu)**2))/(finite.length-1);primary=estimate(measure,'DL-HKSJ',mu,q/sw,finite.length,finite.length-1,'HKSJ t (unmodified)');}}
 // MH, Peto and exact never accept a hidden correction, even as a sensitivity request.
 if(cc>0&&model!=='DL')primary=null;
 const rare=trials.some(t=>t.eventsTreatment/t.totalTreatment<=META_POLICY.rareRisk||t.eventsControl/t.totalControl<=META_POLICY.rareRisk||t.eventsTreatment===t.totalTreatment||t.eventsControl===t.totalControl);
 const or=mantelHaenszel(trials,'OR');const petoOK=measure==='OR'&&trials.every(t=>Math.max(t.totalTreatment/t.totalControl,t.totalControl/t.totalTreatment)<=META_POLICY.petoMaxImbalance&&Math.max(t.eventsTreatment/t.totalTreatment,t.eventsControl/t.totalControl)<=META_POLICY.petoMaxRisk)&&or!==null&&or.estimate>=META_POLICY.petoMinOR&&or.estimate<=META_POLICY.petoMaxOR;
 const statuses:ProcedureDiagnostic['status'][]=[same?'pass':'fail',role==='primary'&&cc>0&&rare?'fail':'pass',model==='Peto'&&!petoOK?'fail':'pass',primary?'pass':'fail',finite.length>=META_POLICY.minSmallStudyTrials?'pass':'not-evaluable'];
 const details=[`declared ${measure}; observed ${[...new Set(trials.map(t=>t.measure??measure))].join(',')}`,`correction=${cc}, rare=${rare}, role=${role}`,`model=${model}; allocation <=2, risks <=.1, OR in [.5,2]; observed OR=${or?.estimate??'unavailable'}`,`model=${model}; estimable ${finite.length}/${used.length}; exact support cap=${META_POLICY.exactMaxWidth}`,`estimable trials ${finite.length}; required ${META_POLICY.minSmallStudyTrials}`];
 const diagnostics=META_ASSUMPTIONS.map((a,i)=>({id:a.id,assumption:a.assumption,mandatory:a.mandatory,blocks:[...a.blocks],valid_alternatives:[...a.valid_alternatives],status:statuses[i]!,detail:details[i]!}));
 let smallStudy:MetaAnalysisResult['smallStudy']=null;
 if(same&&finite.length>=META_POLICY.minSmallStudyTrials){const xs=finite.map(e=>1/Math.sqrt(e.v)),ys=finite.map(e=>e.y/Math.sqrt(e.v)),mx=sum(xs)/xs.length,my=sum(ys)/ys.length,sxx=sum(xs.map(x=>(x-mx)**2));if(sxx>0){const b=sum(xs.map((x,i)=>(x-mx)*(ys[i]!-my)))/sxx,a=my-b*mx,s2=sum(xs.map((x,i)=>(ys[i]!-a-b*x)**2))/(xs.length-2),se=Math.sqrt(s2*(1/xs.length+mx*mx/sxx));if(se>0)smallStudy={method:'Egger (exploratory; binary-effect coupling)',intercept:a,p:tPValue(a/se,xs.length-2,'two-sided'),k:xs.length};}}
 const rd=mantelHaenszel(trials,'RD'),risk=rd?.estimate??0,intervals:MetaAnalysisResult['absolute']['nnhIntervals']=[];
 if(rd){const [lo,hi]=rd.ci;if(hi>0)intervals.push({direction:'harm',lower:1/hi,upper:lo>0?1/lo:null});if(lo<0)intervals.push({direction:'benefit',lower:-1/lo,upper:hi<0?-1/hi:null});}
 const rawWeights=used.map(t=>{const x=cells(t);if(model==='DL'){const e=effect(t,measure,cc);return e&&het?1/(e.v+het.tau2):0;}if(model==='Peto'){const m=x.a+x.c;return x.n1*x.n0*m*(x.n-m)/(x.n*x.n*(x.n-1));}return measure==='OR'?x.b*x.c/x.n:measure==='RR'?x.c*x.n1/x.n:x.n1*x.n0/x.n;}),sw=sum(rawWeights);
 const forest=trials.map(t=>{const i=used.indexOf(t),e=effect(t,measure,cc),r=e?estimate(measure,'individual Wald',e.y,e.v,1):null;return {...t,estimate:r?.estimate??null,ci:r?.ci??null,se:r?.se??null,weight:i<0||sw===0?0:rawWeights[i]!/sw,included:i>=0,reason:i<0?'double-zero excluded from ratio':!r?'individual interval not estimable without correction':null};});
 return {procedure:'meta.adverse-events@1',status:!same?'refused':'ok',diagnostics,primary,mh,forest,heterogeneity:het,absolute:{riskDifference:rd,controlRisk:sum(trials.map(t=>t.eventsControl))/sum(trials.map(t=>t.totalControl)),per1000:rd?risk*1000:null,nnh:risk===0?null:1/Math.abs(risk),direction:risk>0?'harm':risk<0?'benefit':'none',nnhIntervals:intervals},smallStudy,counts:{inputTrials:trials.length,includedTrials:used.length,doubleZero:dz,excludedDoubleZero:measure==='RD'?0:dz,excludedNonEstimable:used.length-finite.length,includedTotalTreatment:sum(used.map(t=>t.totalTreatment)),includedTotalControl:sum(used.map(t=>t.totalControl)),eventsTreatment:sum(trials.map(t=>t.eventsTreatment)),eventsControl:sum(trials.map(t=>t.eventsControl)),totalTreatment:sum(trials.map(t=>t.totalTreatment)),totalControl:sum(trials.map(t=>t.totalControl))},settings:{measure,model,continuityCorrection:cc,doubleZeroRule:measure==='RD'?'include':'exclude',role}};
}
