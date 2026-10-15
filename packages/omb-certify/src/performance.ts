import { normalizeId } from './identity.ts';
import { gateResult, POLICY, type GateResult, type PlanClaim, type PrimaryEntry } from '../../omb-gauntlet/src/index.ts';
import { G5B_COVERAGE_METHOD, coverageMeetsNominal } from '../../omb-gauntlet/src/calibration.ts';
import { monteCarlo, randomStream, type MonteCarloSettings } from './monte-carlo.ts';
import { logisticFit } from './robust.ts';
export type PerformanceMetric='auc'|'brier'|'accuracy'|'net-benefit'|'ece';
export interface PredictionData { units:string[]; outcome:number[]; probability:number[]; simpleRule:number[]; trainingUnits:string[]; trainingPrevalence:number; trustedHeldOut?:boolean;
  /** Why trusted apply output is not heldOut:true (sequestration or amendment-11 evidence missing). */
  heldOutProvenance?:string; }
export interface PerformanceSettings { metric:PerformanceMetric; thresholds:number[]; bins:number; bootstrapDraws:number; threshold?:number; monteCarlo?:MonteCarloSettings; }
export function auc(y:readonly number[],p:readonly number[]):number {
  const order=p.map((v,i)=>({v,y:y[i]!})).sort((a,b)=>a.v-b.v),positives=y.reduce((s,v)=>s+v,0),negatives=y.length-positives;
  if(!positives||!negatives)throw new Error('AUC needs both outcome classes');let rankSum=0;
  for(let i=0;i<order.length;){let j=i+1;while(j<order.length&&order[j]!.v===order[i]!.v)j++;const rank=(i+1+j)/2;for(let k=i;k<j;k++)rankSum+=order[k]!.y*rank;i=j;}
  return (rankSum-positives*(positives+1)/2)/(positives*negatives);
}
const mean=(a:readonly number[])=>a.reduce((s,v)=>s+v,0)/a.length;
export function predictionMetrics(y:readonly number[],p:readonly number[],thresholds:readonly number[],bins=10):Record<string,number|null> {
  if(!y.length||p.length!==y.length||!y.every(v=>v===0||v===1)||p.some(v=>!Number.isFinite(v)||v<0||v>1)||!Number.isInteger(bins)||bins<2||bins>100||thresholds.some(t=>!Number.isFinite(t)||t<=0||t>=1))throw new Error('invalid predictions or performance settings');
  let ece=0;for(let b=0;b<bins;b++){const indices=p.flatMap((v,i)=>Math.min(bins-1,Math.floor(v*bins))===b?[i]:[]);if(indices.length)ece+=indices.length/y.length*Math.abs(mean(indices.map(i=>y[i]!))-mean(indices.map(i=>p[i]!)));}
  let intercept:number|null=null,slope:number|null=null,inTheLarge:number|null=null;
  // Boundary probabilities give infinite logits; no clipping invents calibration evidence.
  if(p.every(v=>v>0&&v<1)){try{const fit=logisticFit([p.map(()=>1),p.map(v=>Math.log(v/(1-v)))],y);intercept=fit.beta[0]!;slope=fit.beta[1]!;}catch{/* unavailable calibration remains null */}}
  if(p.every(v=>v>0&&v<1)&&y.includes(0)&&y.includes(1)) {
    let offset=0;
    for(let i=0;i<80;i++){const fitted=p.map(v=>1/(1+Math.exp(-(Math.log(v/(1-v))+offset)))),score=y.reduce<number>((s,v,j)=>s+v-fitted[j]!,0),info=fitted.reduce((s,v)=>s+v*(1-v),0);if(info<1e-12)break;const delta=score/info;offset+=delta;if(Math.abs(delta)<1e-9){inTheLarge=offset;break;}}
  }
  const result:Record<string,number|null>={auc:auc(y,p),brier:mean(y.map((v,i)=>(v-p[i]!)**2)),accuracy:mean(y.map((v,i)=>v===(p[i]!>=.5?1:0)?1:0)),ece,calibrationIntercept:intercept,calibrationSlope:slope,calibrationInTheLarge:inTheLarge};
  for(const threshold of thresholds)result[`netBenefit:${threshold}`]=mean(y.map((v,i)=>p[i]!>=threshold?v-(1-v)*threshold/(1-threshold):0));
  return result;
}
function score(metric:PerformanceMetric,y:number[],p:number[],threshold:number,bins:number):number {
  if(metric==='auc')return auc(y,p);
  if(metric==='brier')return -mean(y.map((v,i)=>(v-p[i]!)**2));
  if(metric==='accuracy')return mean(y.map((v,i)=>v===(p[i]!>=.5?1:0)?1:0));
  if(metric==='net-benefit')return mean(y.map((v,i)=>p[i]!>=threshold?v-(1-v)*threshold/(1-threshold):0));
  return -predictionMetrics(y,p,[],bins).ece!;
}
/** Trusted frozen held-out prediction kernel. This does not attest a worker's CV/training
 * pipeline; only disjoint held-out prediction tables are admitted by this producer. */
export function performanceKernel(claim:PlanClaim,data:PredictionData,settings:PerformanceSettings,seed:string):{entry:PrimaryEntry;gate:GateResult;metrics:Record<string,unknown>} {
  if(claim.strata.length||claim.adjustment.length)throw new Error('performance strata and adjustment are not implemented');
  const {units,outcome:y,probability:p,simpleRule}=data,n=y.length,trustedHeldOut=data.trustedHeldOut===true;
  if(n<6||units.length!==n||!units.every(u=>u.trim())||!data.trainingUnits.length||data.trainingUnits.some(u=>units.map(normalizeId).includes(normalizeId(u)))||!Number.isFinite(data.trainingPrevalence)||data.trainingPrevalence<=0||data.trainingPrevalence>=1||simpleRule.length!==n||simpleRule.some(v=>!Number.isFinite(v)||v<0||v>1))throw new Error('held-out predictions require disjoint training identities and declared baseline probabilities');
  if(!['auc','brier','accuracy','net-benefit','ece'].includes(settings.metric)||!Number.isInteger(settings.bootstrapDraws)||settings.bootstrapDraws<199||settings.bootstrapDraws>10000||!settings.thresholds.length||settings.metric==='net-benefit'&&!settings.thresholds.includes(settings.threshold!))throw new Error('invalid locked performance resampling settings');
  if(claim.direction!=='greater'||claim.nullValue!==0)throw new Error('performance claims estimate improvement over declared baselines: greater, nullValue=0 required');
  const pack=predictionMetrics(y,p,settings.thresholds,settings.bins),threshold=settings.threshold??.5;
  const baselines:Record<string,number[]>={'no-information':p.map(()=>data.trainingPrevalence),'majority-class':p.map(()=>data.trainingPrevalence>=.5?1:0),'simple-rule':simpleRule,'held-out-prevalence':p.map(()=>mean(y)),'held-out-majority':p.map(()=>mean(y)>=.5?1:0)};
  if(settings.metric==='net-benefit'){baselines['treat-all']=p.map(()=>1);baselines['treat-none']=p.map(()=>0);}
  const groups=new Map<string,number[]>();units.forEach((u,i)=>{const g=groups.get(u)??[];g.push(i);groups.set(u,g);});const clusters=[...groups.values()];
  if(clusters.length<6)throw new Error('performance needs at least six independent units');
  const own=score(settings.metric,y,p,threshold,settings.bins), comparisons:Record<string,unknown>={};let estimate=Infinity,lower=Infinity,upper=Infinity,decidingP=0,se=0;
  const supports=Object.entries(baselines).map(([name,baseline])=>{
    const distances=p.map((v,i)=>settings.metric==='net-benefit'||settings.metric==='accuracy'?Number((v>=threshold)!==(baseline[i]!>=threshold)):Math.abs(v-baseline[i]!)),largest=Math.max(...distances),discordant=clusters.filter(g=>g.some(i=>distances[i]!>0&&distances[i]!>=largest*.1));
    return {name,events:discordant.filter(g=>g.some(i=>y[i]===1)).length,nonEvents:discordant.filter(g=>g.some(i=>y[i]===0)).length};
  });
  if(clusters.filter(g=>g.some(i=>y[i]===1)).length<10||clusters.filter(g=>g.some(i=>y[i]===0)).length<10||settings.metric!=='auc'&&supports.some(s=>s.events<10||s.nonEvents<10)){
    const nullBrier=mean(y)*(1-mean(y));pack.scaledBrier=nullBrier>0?1-pack.brier!/nullBrier:null;
    const estimate=Math.min(...Object.values(baselines).map(b=>own-score(settings.metric,y,b,threshold,settings.bins)));
    return {entry:{key:claim.id,estimate,p:1,ci:null,se:null,nUnits:clusters.length,raw:{intervalMethod:'unavailable: event support'}},gate:gateResult('G9','failed','insufficient independent events among held-out or discordant units',{claimId:claim.id,evidence:{heldOut:trustedHeldOut,eventSupport:false,supports,skill:null,skillStatus:'not-run',provenance:data.heldOutProvenance??(trustedHeldOut?'trusted omb-store runConfirm application':'declared held-out, unverified provenance')}}),metrics:{...pack,supports,eventSupport:false}};
  }

  // Shuffle whole prediction units, not model/baseline labels. Equal-size blocks
  // are required; guessing how to align unequal clusters would invent a null.
  if(clusters.some(g=>g.length!==clusters[0]!.length))throw new Error('skill permutation needs equal-sized held-out units');
  const skillRng=randomStream(seed+':skill');
  const skill=monteCarlo(own,()=>{const order=clusters.map((_,i)=>i);for(let i=order.length-1;i>0;i--){const j=skillRng.integer(i+1);[order[i],order[j]]=[order[j]!,order[i]!];}const shuffled=[...p];clusters.forEach((g,k)=>g.forEach((i,j)=>{shuffled[i]=p[clusters[order[k]!]![j]!]!;}));return score(settings.metric,y,shuffled,threshold,settings.bins);},claim.alpha,settings.monteCarlo);
  const events=clusters.filter(g=>g.some(i=>y[i]===1)).length,nonEvents=clusters.filter(g=>g.some(i=>y[i]===0)).length;
  let eventSupport=events>=10&&nonEvents>=10;
  decidingP=skill.decisionP;
  for(const [name,baseline] of Object.entries(baselines)){
    const distances=p.map((v,i)=>settings.metric==='net-benefit'||settings.metric==='accuracy'?Number((v>=threshold)!==(baseline[i]!>=threshold)):Math.abs(v-baseline[i]!)),largest=Math.max(...distances);
    const discordant=clusters.filter(g=>g.some(i=>distances[i]!>0&&distances[i]!>=largest*.1));
    const discordantEvents=discordant.filter(g=>g.some(i=>y[i]===1)).length,discordantNonEvents=discordant.filter(g=>g.some(i=>y[i]===0)).length;
    // AUC constant baselines have no decision discordance; all units inform ranking.
    if(settings.metric!=='auc'&&(discordantEvents<10||discordantNonEvents<10))eventSupport=false;
    const contribution=(outcome:number,probability:number)=>settings.metric==='brier'?-((outcome-probability)**2):settings.metric==='accuracy'?Number(outcome===(probability>=.5?1:0)):probability>=threshold?outcome-(1-outcome)*threshold/(1-threshold):0;
    const additive=['brier','accuracy','net-benefit'].includes(settings.metric);
    const sums=clusters.map(g=>({delta:g.reduce((s,i)=>s+contribution(y[i]!,p[i]!)-contribution(y[i]!,baseline[i]!),0),own:g.reduce((s,i)=>s+contribution(y[i]!,p[i]!),0),events:g.reduce((s,i)=>s+y[i]!,0),n:g.length}));
    const delta=additive?sums.reduce((s,g)=>s+g.delta,0)/n:own-score(settings.metric,y,baseline,threshold,settings.bins),rng=randomStream(seed+':swap:'+name);
    const mc=monteCarlo(delta,()=>{if(additive)return sums.reduce((s,g)=>s+(rng.integer(2)?g.delta:-g.delta),0)/n;const a=[...p],b=[...baseline];for(const g of clusters)if(rng.integer(2))for(const i of g)[a[i],b[i]]=[b[i]!,a[i]!];return score(settings.metric,y,a,threshold,settings.bins)-score(settings.metric,y,b,threshold,settings.bins);},claim.alpha,settings.monteCarlo);
    const boot=randomStream(seed+':bootstrap:'+name),draws:number[]=[];
    for(let draw=0;draw<settings.bootstrapDraws;draw++){
      if(additive){let deltaSum=0,ownSum=0,events=0,count=0;for(let i=0;i<clusters.length;i++){const s=sums[boot.integer(sums.length)]!;deltaSum+=s.delta;ownSum+=s.own;events+=s.events;count+=s.n;}const prevalence=events/count;
        if(name==='held-out-prevalence')draws.push(settings.metric==='brier'?ownSum/count+prevalence*(1-prevalence):ownSum/count-(settings.metric==='accuracy'?(prevalence>=.5?prevalence:1-prevalence):contribution(prevalence,prevalence)));
        else if(name==='held-out-majority')draws.push(settings.metric==='brier'?ownSum/count+Math.min(prevalence,1-prevalence):ownSum/count-(settings.metric==='accuracy'?Math.max(prevalence,1-prevalence):contribution(prevalence,prevalence>=.5?1:0)));
        else draws.push(deltaSum/count);continue;}
      const indices=clusters.flatMap(()=>clusters[boot.integer(clusters.length)]!),yy=indices.map(i=>y[i]!),aa=indices.map(i=>p[i]!),bb=name==='held-out-prevalence'?indices.map(()=>mean(yy)):name==='held-out-majority'?indices.map(()=>mean(yy)>=.5?1:0):indices.map(i=>baseline[i]!);
      // Missing-class resamples have no AUC; fail closed instead of silently dropping draws.
      try{draws.push(score(settings.metric,yy,aa,threshold,settings.bins)-score(settings.metric,yy,bb,threshold,settings.bins));}catch{throw new Error('bootstrap has unevaluable class support; use more independent events');}
    }
    draws.sort((a,b)=>a-b);const lo=draws[Math.floor(claim.alpha/(2*Object.keys(baselines).length)*draws.length)]!,hi=draws[Math.min(draws.length-1,Math.ceil((1-claim.alpha/(2*Object.keys(baselines).length))*draws.length)-1)]!,avg=mean(draws),sd=Math.sqrt(draws.reduce((s,v)=>s+(v-avg)**2,0)/(draws.length-1));
    comparisons[name]={discordantEvents,discordantNonEvents,estimate:delta,ci:[lo,hi],se:sd,permutation:mc,metrics:predictionMetrics(y,baseline,settings.thresholds,settings.bins)};
    estimate=Math.min(estimate,delta);lower=Math.min(lower,lo);upper=Math.min(upper,hi);decidingP=Math.max(decidingP,mc.decisionP);se=Math.max(se,sd);
  }
  const nullBrier=mean(y)*(1-mean(y));pack.scaledBrier=nullBrier>0?1-pack.brier!/nullBrier:null;
  const decisionCurve=settings.thresholds.map(t=>({threshold:t,model:pack[`netBenefit:${t}`],treatAll:mean(y)-(1-mean(y))*t/(1-t),treatNone:0}));
  const beatsBaselines=Object.values(comparisons).every(c=>(c as {ci:number[]}).ci[0]!>0),calibrationAvailable=pack.calibrationSlope!==null&&pack.calibrationIntercept!==null;
  const gate=gateResult('G9',trustedHeldOut&&beatsBaselines&&calibrationAvailable&&eventSupport&&skill.decisionP<=claim.alpha?'passed':'failed','held-out performance and declared baseline comparisons',{claimId:claim.id,evidence:{heldOut:trustedHeldOut,identityDisjoint:!data.trainingUnits.some(u=>units.map(normalizeId).includes(normalizeId(u))),skill,eventSupport,events,nonEvents,trainingUnits:new Set(data.trainingUnits).size,provenance:data.heldOutProvenance??(trustedHeldOut?'trusted omb-store runConfirm application':'declared held-out, unverified provenance'),units:clusters.length,metrics:pack,decisionCurve,comparisons,beatsBaselines,calibrationAvailable,intervalSource:'declared-unit percentile bootstrap',bootstrapDraws:settings.bootstrapDraws}});
  return {entry:{key:claim.id,estimate,p:eventSupport?decidingP:1,ci:[lower,upper],se,nUnits:clusters.length,raw:{intervalMethod:'declared-unit percentile bootstrap'}},gate,metrics:{...pack,decisionCurve,comparisons,skill,eventSupport}};
}

/** Population score in a finite, software-owned Bernoulli plasmode. AUC uses the
 * product distribution of independently sampled case/control units, including ties. */
function populationScore(metric:PerformanceMetric,truth:number[],p:number[],threshold:number,bins:number):number {
  if(metric==='auc'){
    const order=p.map((v,i)=>({v,t:truth[i]!})).sort((a,b)=>a.v-b.v);let numerator=0,below=0;
    for(let i=0;i<order.length;){let j=i+1;while(j<order.length&&order[j]!.v===order[i]!.v)j++;let cases=0,controls=0;for(let k=i;k<j;k++){cases+=order[k]!.t;controls+=1-order[k]!.t;}numerator+=cases*(below+controls/2);below+=controls;i=j;}
    return numerator/(truth.reduce((s,v)=>s+v,0)*truth.reduce((s,v)=>s+1-v,0));
  }
  if(metric==='brier')return -mean(truth.map((t,i)=>t*(1-p[i]!)**2+(1-t)*p[i]!**2));
  if(metric==='accuracy')return mean(truth.map((t,i)=>p[i]!>=.5?t:1-t));
  if(metric==='net-benefit')return mean(truth.map((t,i)=>p[i]!>=threshold?t-(1-t)*threshold/(1-threshold):0));
  let ece=0;for(let b=0;b<bins;b++){const ids=p.flatMap((v,i)=>Math.min(bins-1,Math.floor(v*bins))===b?[i]:[]);if(ids.length)ece+=ids.length/p.length*Math.abs(mean(ids.map(i=>truth[i]!-p[i]!)));}return -ece;
}
/** Conditional recovery of a FROZEN predictor, never a claim that training/CV was
 * recovered. A finite population is planted at the MEI; units are sampled as blocks,
 * with a shared Bernoulli uniform within each block. Failed draws remain in all
 * denominators and make recovery fail. This is a diagnostic under this declared DGP. */
export function performanceRecovery(claim:PlanClaim,data:PredictionData,settings:PerformanceSettings,seed:string):GateResult[] {
  const fail=(reason:string)=>['G5b-power','G5b-recovery'].map(g=>gateResult(g as 'G5b-power'|'G5b-recovery','failed',reason,{claimId:claim.id}));
  if(!claim.mei||claim.mei<=0)return fail('performance MEI unavailable');
  const p=data.probability,prior=data.trainingPrevalence,center=mean(p),threshold=settings.threshold??.5;
  const baselines=[p.map(()=>prior),p.map(()=>prior>=.5?1:0),data.simpleRule];
  if(settings.metric==='net-benefit')baselines.push(p.map(()=>1),p.map(()=>0));
  const probabilities=(slope:number)=>p.map(v=>1/(1+Math.exp(-(Math.log(prior/(1-prior))+slope*(v-center)))));
  const delta=(truth:number[])=>{
    const prevalence=mean(truth),all=[...baselines,p.map(()=>prevalence),p.map(()=>prevalence>=.5?1:0)];
    return Math.min(...all.map(b=>populationScore(settings.metric,truth,p,threshold,settings.bins)-populationScore(settings.metric,truth,b,threshold,settings.bins)));
  };
  let lo=0,hi=0;
  for(let s=.25;s<=32;s+=.25){if(delta(probabilities(s))>=claim.mei){lo=s-.25;hi=s;break;}}
  if(!hi||delta(probabilities(lo))>claim.mei)return fail('MEI cannot be planted in the frozen prediction design');
  for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(delta(probabilities(mid))<claim.mei)lo=mid;else hi=mid;}
  const latent=probabilities((lo+hi)/2),truth=delta(latent),groups=new Map<string,number[]>();data.units.forEach((u,i)=>{const g=groups.get(u)??[];g.push(i);groups.set(u,g);});const clusters=[...groups.values()];
  let rejected=0,covered=0,failed=0;const errors:number[]=[];
  for(let i=0;i<100;i++){
    const rng=randomStream(`${seed}:recovery:${i}`),indices:number[]=[],outcome:number[]=[],units:string[]=[];
    for(let c=0;c<clusters.length;c++){const g=clusters[rng.integer(clusters.length)]!,u=rng.uniform();for(const j of g){indices.push(j);outcome.push(u<latent[j]!?1:0);units.push(`planted-${c}`);}}
    try{const twin:PredictionData={...data,outcome,units,probability:indices.map(j=>p[j]!),simpleRule:indices.map(j=>data.simpleRule[j]!)};
      const result=performanceKernel(claim,twin,settings,`${seed}:kernel:${i}`).entry;
      if(result.p!<=claim.alpha)rejected++;if(result.ci![0]<=truth&&result.ci![1]>=truth)covered++;errors.push(result.estimate!-truth);
    }catch{failed++;}
  }
  const bias=errors.length?mean(errors):0,seMean=errors.length>1?Math.sqrt(errors.reduce((s,v)=>s+(v-bias)**2,0)/(errors.length-1)/errors.length):0,coverage=covered/100,z=1.959963984540054,den=1+z*z/100,mid=(coverage+z*z/200)/den,half=z*Math.sqrt(coverage*(1-coverage)/100+z*z/40000)/den,coverageCI:[number,number]=[Math.max(0,mid-half),Math.min(1,mid+half)],ciLevel=1-claim.alpha,coverageTolerance=POLICY.g5bCoverageTolerance,coverageCalibrated=coverageMeetsNominal(coverage,ciLevel,coverageTolerance);
  const evidence={calibrationMethod:G5B_COVERAGE_METHOD,coverageCalibrated,coverageTolerance,seeds:100,alpha:claim.alpha,power:rejected/100,coverage,coverageCI,ciLevel,bias,seMean,failed,truth,plantedSlope:(lo+hi)/2,plantedPrevalence:mean(latent),effect:claim.mei,intervalSource:'declared-unit percentile bootstrap',scope:'conditional frozen predictor; shared-uniform Bernoulli unit plasmode'};
  return [gateResult('G5b-power',rejected>=80?'passed':'failed','power at the planted performance MEI',{claimId:claim.id,evidence}),gateResult('G5b-recovery',failed===0&&coverageCalibrated?'passed':'failed','design-matched held-out interval coverage calibration',{claimId:claim.id,evidence})];
}
