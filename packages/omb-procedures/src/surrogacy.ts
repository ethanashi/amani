import {robustSurrogateRegression,SURROGACY_ROBUST_POLICY} from './surrogacy-robust.ts';
import {surrogateTailThreshold,surrogatePrecision} from './surrogacy-envelope.ts';
import { createHash } from 'node:crypto';
import { Rng } from './rng.ts';
import { tPValue,tQuantileUpper } from './special.ts';
import type { ProcedureAssumption,ProcedureDiagnostic,ProcedureEnvelope } from './types.ts';
export interface SurrogateTrial { id:string; surrogate:number; outcome:number; seSurrogate:number; seOutcome:number; correlation?:number; surrogateScale:string; outcomeScale:string }
export interface SurrogacyInput { trials:SurrogateTrial[]; ciMethod?:'fisher'|'bootstrap'; bootstrapReplicates?:number; surrogateBenefitDirection?:'greater'|'less'; outcomeBenefitDirection?:'greater'|'less'; predictAt?:number[] }
export const SURROGACY_POLICY=Object.freeze({robust:SURROGACY_ROBUST_POLICY,minimumTrials:10,maxLooR2Change:.2,maxEivR2Change:.2,strongR:.85,weakR:.7,bootstrapMinimum:1000,bootstrapDefault:2000,unknownCorrelations:[-1,0,1] as readonly number[]});
const assumption=(id:string,assumption:string,blocks:string[],alternatives:string[]=[]):ProcedureAssumption=>({id,assumption,mandatory:true,diagnostic:id,blocks,valid_alternatives:alternatives,default_rule:{on_fail:alternatives,on_not_evaluable:'not-estimable'}});
export const SURROGACY_ASSUMPTIONS:readonly ProcedureAssumption[]=[
 assumption('surrogacy.common-scales','Surrogate and final effects each have a single common declared scale',['surrogacy.regression','surrogacy.r2','surrogacy.eiv','surrogacy.ste','surrogacy.loto','surrogacy.predictions','surrogacy.scatter','surrogacy.classification','surrogacy.validated','surrogacy.robustRegression','surrogacy.robustR2','surrogacy.inference']),
 assumption('surrogacy.trial-support','Validation requires at least ten independent trials',['surrogacy.validated'],['surrogacy.classification']),
 assumption('surrogacy.influence','No individual trial changes R2 by more than .2',['surrogacy.validated'],['surrogacy.classification']),
 assumption('surrogacy.measurement-error','Known errors permit positive latent variances and a stable EIV sensitivity',['surrogacy.validated'],['surrogacy.classification']),
 assumption('surrogacy.interpolation','Predictions remain in the observed surrogate-effect range',['surrogacy.predictions']),
 assumption('surrogacy.estimable','Weighted regression and interval have sufficient information',['surrogacy.regression','surrogacy.r2','surrogacy.ste','surrogacy.classification','surrogacy.validated']),
 assumption('surrogacy.residual-tail','Studentized WLS residual kurtosis does not exceed its independently trained normal threshold',['surrogacy.regression','surrogacy.r2'],['surrogacy.robustRegression','surrogacy.robustR2']),
 assumption('surrogacy.precision-path','Unequal precision uses the calibrated sandwich path',['surrogacy.regression','surrogacy.r2'],['surrogacy.robustRegression','surrogacy.robustR2']),
 assumption('surrogacy.robust-estimable','A computed robust partner is mandatory for every inferential or validation claim',['surrogacy.regression','surrogacy.r2','surrogacy.robustRegression','surrogacy.robustR2','surrogacy.validated','surrogacy.inference'],['surrogacy.classification']),
 assumption('surrogacy.robust-agreement','Classical and robust threshold classifications agree; validation requires both lower bounds',['surrogacy.validated','surrogacy.inference'],['surrogacy.robustRegression','surrogacy.robustR2','surrogacy.classification']),
];
const quantiles=new Map<number,number>();
const critical=(df:number)=>{let q=quantiles.get(df);if(q===undefined){q=tQuantileUpper(.025,df);quantiles.set(df,q);}return q;};
const sum=(xs:number[])=>xs.reduce((a,b)=>a+b,0);
const quantile=(xs:number[],p:number)=>{const s=[...xs].sort((a,b)=>a-b),i=(s.length-1)*p,j=Math.floor(i);return s[j]!+(s[Math.min(j+1,s.length-1)]!-s[j]!)*(i-j);};
export interface WeightedFit {intercept:number;slope:number;slopeCI:[number,number];slopeP:number;r:number;r2:number;residualScale:number;df:number;effectiveTrials:number;sw:number;meanX:number;sxx:number;typicalOutcomeSE:number}
/** WLS estimates effects on their supplied scales. Residual scale is weighted SSE/(k-2). */
export function weightedSurrogateRegression(ts:SurrogateTrial[]):WeightedFit|null {
 if(ts.length<3)return null;const w=ts.map(t=>1/t.seOutcome**2),sw=sum(w),mx=sum(ts.map((t,i)=>w[i]!*t.surrogate))/sw,my=sum(ts.map((t,i)=>w[i]!*t.outcome))/sw,sxx=sum(ts.map((t,i)=>w[i]!*(t.surrogate-mx)**2)),syy=sum(ts.map((t,i)=>w[i]!*(t.outcome-my)**2)),sxy=sum(ts.map((t,i)=>w[i]!*(t.surrogate-mx)*(t.outcome-my)));
 if(!(sxx>0&&syy>0))return null;const b=sxy/sxx,a=my-b*mx,df=ts.length-2,scale=sum(ts.map((t,i)=>w[i]!*(t.outcome-a-b*t.surrogate)**2))/df,se=Math.sqrt(scale/sxx),q=critical(df),r=Math.max(-1,Math.min(1,sxy/Math.sqrt(sxx*syy)));
 return {intercept:a,slope:b,slopeCI:[b-q*se,b+q*se],slopeP:se>0?tPValue(b/se,df,'two-sided'):b===0?1:0,r,r2:r*r,residualScale:scale,df,effectiveTrials:sw*sw/sum(w.map(x=>x*x)),sw,meanX:mx,sxx,typicalOutcomeSE:quantile(ts.map(t=>t.seOutcome),.5)};
}
export interface SurrogatePrediction {surrogate:number;predicted:number;lower:number;upper:number;extrapolated:boolean;outcomeSE:number}
export function surrogatePrediction(f:WeightedFit,x:number,se:number,range:[number,number]):SurrogatePrediction {const predicted=f.intercept+f.slope*x,half=critical(f.df)*Math.sqrt(f.residualScale*(se*se+1/f.sw+(x-f.meanX)**2/f.sxx));return {surrogate:x,predicted,lower:predicted-half,upper:predicted+half,extrapolated:x<range[0]||x>range[1],outcomeSE:se};}
function eiv(ts:SurrogateTrial[],rho:number){const w=ts.map(t=>1/t.seOutcome**2),sw=sum(w),den=sw-sum(w.map(x=>x*x))/sw,mx=sum(ts.map((t,i)=>w[i]!*t.surrogate))/sw,my=sum(ts.map((t,i)=>w[i]!*t.outcome))/sw;
 const vx=sum(ts.map((t,i)=>w[i]!*((t.surrogate-mx)**2-(1-w[i]!/sw)*t.seSurrogate**2)))/den,vy=sum(ts.map((t,i)=>w[i]!*((t.outcome-my)**2-(1-w[i]!/sw)*t.seOutcome**2)))/den,cov=sum(ts.map((t,i)=>w[i]!*((t.surrogate-mx)*(t.outcome-my)-(1-w[i]!/sw)*(t.correlation??rho)*t.seSurrogate*t.seOutcome)))/den;
 if(!(vx>0&&vy>0&&cov*cov<=vx*vy))return {assumedMissingCorrelation:rho,estimable:false as const,slope:null,r2:null,latentSurrogateVariance:vx,latentOutcomeVariance:vy};
 return {assumedMissingCorrelation:rho,estimable:true as const,slope:cov/vx,r2:cov*cov/(vx*vy),latentSurrogateVariance:vx,latentOutcomeVariance:vy};
}
export interface SurrogacyResult extends ProcedureEnvelope {
 diagnostics:ProcedureDiagnostic[]; regression:WeightedFit|null;
 robust:ReturnType<typeof robustSurrogateRegression>; robustRegression:WeightedFit|null; robustR2:SurrogacyResult['r2'];
 r2:{estimate:number;ci:[number,number];rCI:[number,number];method:string;bootstrapSuccessful:number|null}|null;
 eiv:ReturnType<typeof eiv>[];
 ste:{value:number|null;status:'within-range'|'not-attained';range:[number,number];outcomeSE:number;method:string}|null;
 loto:Array<{id:string;observed:number;prediction:SurrogatePrediction|null;r2Without:number|null;r2Change:number|null}>;
 predictions:SurrogatePrediction[];scatter:SurrogateTrial[];
 classification:'strong'|'weak'|'unclear'|'not-estimable';validated:boolean;
 reporting:{guideline:string;independentTrials:number;scales:{surrogate:string[];outcome:string[]};ciMethod:string;weighting:string;correlationHandling:string;validationScope:string;rule:string;range:[number,number];maxLooR2Change:number|null;limitations:string[]};
}
export function trialLevelSurrogacy(input:SurrogacyInput):SurrogacyResult {
 const ts=input.trials,ciMethod=input.ciMethod??'fisher',B=input.bootstrapReplicates??SURROGACY_POLICY.bootstrapDefault,sd=input.surrogateBenefitDirection??'greater',od=input.outcomeBenefitDirection??'greater';
 if(!Array.isArray(ts)||ts.length<3||ts.length>1000||!['fisher','bootstrap'].includes(ciMethod)||!Number.isSafeInteger(B)||B<SURROGACY_POLICY.bootstrapMinimum||B>10000||![sd,od].every(d=>['greater','less'].includes(d)))throw new Error('invalid surrogacy configuration; at least three independent trials required');
 if(new Set(ts.map(t=>t.id)).size!==ts.length)throw new Error('independent unique trial IDs required');
 for(const t of ts)if(!t.id||![t.surrogate,t.outcome,t.seSurrogate,t.seOutcome].every(Number.isFinite)||t.seSurrogate<=0||t.seOutcome<=0||!t.surrogateScale||!t.outcomeScale||t.correlation!==undefined&&(!Number.isFinite(t.correlation)||Math.abs(t.correlation)>=1))throw new Error('finite effects, positive SEs, valid correlation and scales required');
 if(input.predictAt?.some(x=>!Number.isFinite(x)))throw new Error('invalid prediction values');
 const same=new Set(ts.map(t=>t.surrogateScale)).size===1&&new Set(ts.map(t=>t.outcomeScale)).size===1,fit=weightedSurrogateRegression(ts),range:[number,number]=[Math.min(...ts.map(t=>t.surrogate)),Math.max(...ts.map(t=>t.surrogate))],sign=(sd===od?1:-1);
 let r2:SurrogacyResult['r2']=null;
 if(fit&&fit.effectiveTrials>3){let rCI:[number,number];let successful:number|null=null;
 if(ciMethod==='fisher'){const z=Math.atanh(Math.max(-1+1e-15,Math.min(1-1e-15,fit.r))),half=1.959963984540054/Math.sqrt(fit.effectiveTrials-3);rCI=[Math.tanh(z-half),Math.tanh(z+half)];}
 else {const seed=createHash('sha256').update(JSON.stringify({ts,ciMethod,B})).digest('hex'),rng=new Rng(seed),rs:number[]=[];for(let b=0;b<B;b++){const f=weightedSurrogateRegression(ts.map(()=>ts[rng.int(ts.length)]!));if(f)rs.push(f.r);}successful=rs.length;rCI=rs.length>=.95*B?[quantile(rs,.025),quantile(rs,.975)]:[-1,1];}
 const squareCI:[number,number]=[rCI[0]<=0&&rCI[1]>=0?0:Math.min(rCI[0]**2,rCI[1]**2),Math.max(rCI[0]**2,rCI[1]**2)];r2={estimate:fit.r2,ci:squareCI,rCI,method:ciMethod==='fisher'?'Fisher z with Kish effective trial count (approximate)':'trial-pairs percentile bootstrap (signed r, then squared)',bootstrapSuccessful:successful};}
 const robust=robustSurrogateRegression(ts,fit),tailThreshold=surrogateTailThreshold(ts),precision=surrogatePrecision(ts);
 const robustRegression=fit&&robust?{...fit,slopeCI:robust.slopeCI,slopeP:Math.max(fit.slopeP,robust.slopeSE>0?tPValue(fit.slope/(robust.factor*robust.slopeSE),robust.df,'two-sided'):fit.slope===0?1:0)}:null;
 const robustR2:SurrogacyResult['r2']=robust?{estimate:robust.r2,ci:robust.ci,rCI:robust.rCI,method:robust.method,bootstrapSuccessful:null}:null;
 const checks=(ts.every(t=>t.correlation!==undefined)?[0]:SURROGACY_POLICY.unknownCorrelations).map(r=>eiv(ts,r));
 const loto=ts.map((t,i)=>{const train=ts.filter((_,j)=>j!==i),f=weightedSurrogateRegression(train),r:[number,number]=[Math.min(...train.map(t=>t.surrogate)),Math.max(...train.map(t=>t.surrogate))];return {id:t.id,observed:t.outcome,prediction:f?surrogatePrediction(f,t.surrogate,t.seOutcome,r):null,r2Without:f?.r2??null,r2Change:f&&fit?Math.abs(f.r2-fit.r2):null};});
 const maxChange=loto.every(t=>t.r2Change!==null)?Math.max(...loto.map(t=>t.r2Change!)):null,predictions=fit?(input.predictAt??[]).map(x=>surrogatePrediction(fit,x,fit.typicalOutcomeSE,range)):[];
 // Solve intersections of a + b*x +/- t*sqrt(prediction variance) with zero.
 // A threshold is reported only on the observed, benefit-oriented domain.
 let ste:SurrogacyResult['ste']=null;
 if(fit){const t2=critical(fit.df)**2*fit.residualScale,A=fit.slope**2-t2/fit.sxx,C=fit.intercept**2-t2*(fit.typicalOutcomeSE**2+1/fit.sw+fit.meanX**2/fit.sxx),D=2*fit.intercept*fit.slope+2*t2*fit.meanX/fit.sxx,disc=D*D-4*A*C,roots=Math.abs(A)<1e-14?(D!==0?[-C/D]:[]):disc>=0?[(-D-Math.sqrt(disc))/(2*A),(-D+Math.sqrt(disc))/(2*A)]:[],direction=sd==='greater'?1:-1,start=direction===1?Math.max(0,range[0]):Math.min(0,range[1]),end=direction===1?range[1]:range[0];
 const supports=(x:number)=>{const p=surrogatePrediction(fit,x,fit.typicalOutcomeSE,range);return od==='greater'?p.lower>=-1e-10:p.upper<=1e-10;};
 const candidates=[start,...roots].filter(x=>Number.isFinite(x)&&x>=range[0]&&x<=range[1]&&x*direction>=start*direction&&x*direction<=end*direction&&supports(x)).sort((a,b)=>direction*(a-b));
 ste={value:candidates[0]??null,status:candidates.length?'within-range':'not-attained',range,outcomeSE:fit.typicalOutcomeSE,method:'95% two-sided WLS prediction band for a new observed trial effect at median SE'};}
 const rCI=r2?(sign===1?r2.rCI:[-r2.rCI[1],-r2.rCI[0]]):null,classification:SurrogacyResult['classification']=!rCI?'not-estimable':rCI[0]!>=SURROGACY_POLICY.strongR?'strong':rCI[1]!<=SURROGACY_POLICY.weakR?'weak':'unclear';
 const robustOriented=robust?(sign===1?robust.rCI:[-robust.rCI[1],-robust.rCI[0]]):null,robustClassification=!robustOriented?'not-estimable':robustOriented[0]!>=SURROGACY_POLICY.strongR?'strong':robustOriented[1]!<=SURROGACY_POLICY.weakR?'weak':'unclear';
 const errorOK=fit&&checks.every(e=>e.estimable&&Math.abs(e.r2!-fit.r2)<=SURROGACY_POLICY.maxEivR2Change&&Math.sign(e.slope!)===Math.sign(fit.slope));
 const statuses:ProcedureDiagnostic['status'][]=[same?'pass':'fail',ts.length>=SURROGACY_POLICY.minimumTrials?'pass':'fail',maxChange===null?'not-evaluable':maxChange<=SURROGACY_POLICY.maxLooR2Change?'pass':'fail',errorOK?'pass':'not-evaluable',predictions.some(p=>p.extrapolated)?'fail':'pass',fit&&r2&&(r2.bootstrapSuccessful===null||r2.bootstrapSuccessful>=.95*B)?'pass':'not-evaluable'];
 const details=[`surrogate scales=${[...new Set(ts.map(t=>t.surrogateScale))]}; outcome scales=${[...new Set(ts.map(t=>t.outcomeScale))]}`,`independent trials=${ts.length}; minimum=${SURROGACY_POLICY.minimumTrials}`,`max absolute LOTO R2 change=${maxChange}; maximum=${SURROGACY_POLICY.maxLooR2Change}`,`corrected-moment EIV; known correlations used; missing correlations varied over [-1,0,1]; stable=${!!errorOK}`,`observed range=[${range}]; extrapolated=${predictions.filter(p=>p.extrapolated).length}`,`effective trials=${fit?.effectiveTrials??0}; CI=${ciMethod}`];
 statuses.push(tailThreshold===null||robust?.residualExcessKurtosis===null||!robust?'not-evaluable':robust.residualExcessKurtosis<=tailThreshold?'pass':'fail',Math.max(precision.outcome,precision.surrogate)<=1+1e-10?'pass':'fail',robust&&robustRegression&&robustR2?'pass':'not-evaluable',robust&&ciMethod==='fisher'&&classification===robustClassification?'pass':'fail');
 details.push(`studentized residual excess kurtosis=${robust?.residualExcessKurtosis}; normal training threshold=${tailThreshold}; a pass does not establish normality`,`SE max/min outcome=${precision.outcome}, surrogate=${precision.surrogate}; unequal precision selects sandwich`, `mandatory robust partner=${!!robust}; slope factor=${robust?.factor}; correlation factor=${robust?.correlationFactor}`,`classical=${classification}; robust=${robustClassification}; both benefit-oriented lower bounds must exceed .85`);
 const diagnostics=SURROGACY_ASSUMPTIONS.map((a,i)=>({id:a.id,assumption:a.assumption,mandatory:a.mandatory,blocks:[...a.blocks],valid_alternatives:[...a.valid_alternatives],status:statuses[i]!,detail:details[i]!}));
 return {procedure:'surrogacy.trial-level@1',status:same&&fit?'ok':'refused',diagnostics,regression:fit,r2,robust,robustRegression,robustR2,eiv:checks,ste,loto,predictions,scatter:ts.map(t=>({...t})),classification,validated:classification==='strong'&&robustClassification==='strong'&&statuses.slice(0,6).every(s=>s==='pass')&&statuses[8]==='pass'&&statuses[9]==='pass',reporting:{guideline:'ReSEEM reporting checklist; IQWiG-style threshold classification',independentTrials:ts.length,scales:{surrogate:[...new Set(ts.map(t=>t.surrogateScale))],outcome:[...new Set(ts.map(t=>t.outcomeScale))]},ciMethod,weighting:'inverse outcome-effect variance; intercept fitted',correlationHandling:ts.every(t=>t.correlation!==undefined)?'supplied within-trial correlations':'missing within-trial correlations: sensitivity at -1, 0, 1',validationScope:'Trial-level association only; no individual-level, causal or regulatory surrogate validation',rule:'benefit-oriented r lower 95% CI >= .85: strong; upper <= .7: weak; otherwise unclear; validated also requires the robust lower bound and all validation guards; residual-tail or unequal precision selects the robust alternative',range,maxLooR2Change:maxChange,limitations:['Independent trials and harmonized endpoint/time definitions required; shared-control contrasts must be aggregated.','Weighted observed-effect R2 is not latent trial-level R2; EIV is a corrected-moment sensitivity.','Fisher/Kish and pairs-bootstrap intervals are approximate; no normality or exchangeability guarantee inferred from sample diagnostics.']}};
}
