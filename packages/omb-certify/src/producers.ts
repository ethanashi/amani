import { collapseContractRows } from './contract-collapse.ts';
import { parseContractTable } from './contract-verifier.ts';
import { logisticFit, expit } from './robust.ts';
import { claimContractUnits, contractGates } from './contract-stage.ts';
import { declaredTable } from './declared-stage.ts';
import { signFlipTest, withinUnitTest } from './paired.ts';
import { randomStream, type MonteCarloSettings } from './monte-carlo.ts';
import { numericAgreement } from './numeric.ts';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { parseStageTable } from './stage-parser.ts';
import { POLICY } from '../../omb-gauntlet/src/policy.ts';
import { G5B_COVERAGE_METHOD, coverageMeetsNominal } from '../../omb-gauntlet/src/calibration.ts';
import { decideCalibration, g1cFromConfoundDocument, gateResult, evaluateG4, evaluateG1a, evaluateG1b, evaluateG2,
  snapshotOutputs, evaluateG3, evaluateG6, reportedNumbers, entryNumbers, parsePrimary, findEntry,
  planLockHash, type ClaimedNumber, type GateResult, type Plan, type PlanClaim, type PrimaryEntry, type PrimaryOutputs, type PlanLock, type ReportedParseResult } from '../../omb-gauntlet/src/index.ts';
import { orthogonal, residual, dot, permutationTest, type PermutationInput, type PermutationResult } from './permutation.ts';
import { linearEntry, modelNuisance, pairedContrasts } from './linear.ts';
import { columnFormatter, roundedSample } from './run-inputs.ts';
import { type Binding, GateAuthority, type SignedGate } from './auth.ts';
import { type Execution, OfflineExecutor, type FrozenCode } from './execution.ts';
import { type StagedInputs } from './stage.ts';
import type { RegisteredProcedure } from './procedure-registry.ts';
import { binaryRatesAt, decisionAlpha, memoRegisteredProcedure, registeredDesign, runRegisteredProcedure } from './procedure-registry.ts';

export interface ClaimData {
  /** True only when the claim unit is the verified contract floor (or the declared unit_id of a
   * non-contract table). Registered envelopes treat anything else as outside (fail closed). */
  unitAtFloor?:boolean;
  sourceRowGroups?:number[][]; publicTwinData?:Omit<ClaimData,'sourceRowGroups'|'publicTwinData'>; decimalResolution?:string|null;
  /** Set by collapseContractRows when replicate outcomes were averaged: the grid the unit means sit on
   * (decimalResolution then names it), exact when every averaged group size is 2^a·5^b. */
  replicateMeanResolution?:{decimals:number;exact:boolean}; file:string; units:string[]; x:number[]; y:number[]; strata:string[]; nuisance:number[][]; covariates:Record<string,number[][]>; header:string[]; rows:string[][]; }
/** Numeric additive models only. A broader estimand must register another trusted kernel,
 * not silently reinterpret a Cox/AUC/ratio test as a linear contrast. */
export function claimData(staged:StagedInputs,claim:PlanClaim):ClaimData{
  if(Object.keys(claim.knobs).some(k=>!['table','monteCarlo','permutationMode','material','interval','performance','producer','design','procedureDesign','weights','sequenceColumn','periodColumn','controlLevel','treatedLevel'].includes(k)))throw new Error('unsupported locked analysis knob; kernel cannot reinterpret it');
  if(claim.knobs.material!==undefined&&typeof claim.knobs.material!=='boolean')throw new Error('material must be boolean');
  if(claim.knobs.interval!==undefined&&claim.knobs.interval!=='HC3')throw new Error('unsupported locked interval method');
  const file=claim.knobs.table;
  if(typeof file!=='string'||path.basename(file)!==file)throw new Error('locked row table required');
  if(!claim.exposure||!claim.outcome||(!staged.contractMode&&claim.unit!=='unit_id'))throw new Error('unit, exposure and outcome required');
  if(staged.contractMode&&(!staged.verifiedContract||!staged.contractAuthenticated))throw new Error('authenticated verified contract required for unit-based computation');
  const ct=staged.verifiedContract&&[...staged.verifiedContract.tables.values()].find(t=>t.definition.file.path===file);
  if(staged.contractMode&&(!ct||!staged.verifiedContract!.contract.public.content.structure.tables.some(t=>t.file.path===file)))throw new Error('claim table absent from contract');
  const declaration=staged.declarations?.[file],bytes=readFileSync(path.join(staged.directory,'RAW',file));
  const t=ct?{axis:ct.definition.orientation.unit_axis,header:ct.header,rows:ct.rows}:declaration?declaredTable(file,bytes,declaration,[claim.exposure,claim.outcome,...claim.adjustment,...claim.strata]):parseStageTable(file,bytes,[claim.exposure,claim.outcome,...claim.adjustment,...claim.strata]);
  if(t.axis!=='rows')throw new Error('kernel requires a row-axis analysis table');
  const col=(name:string)=>{const i=t.header.indexOf(name);if(i<0)throw new Error('locked column missing');return t.rows.map(r=>r[i]!);};
  const number=(name:string)=>col(name).map(v=>{if(!v.trim()||!Number.isFinite(Number(v)))throw new Error('numeric model column required');return Number(v);});
  const encode=(name:string):number[][]=>{
    const values=col(name), levels=[...new Set(values)].sort();
    if(values.some(v=>!v.trim()||/^(na|nan|null)$/i.test(v)))throw new Error('missing covariate');
    if(levels.length===1)return [];
    return values.every(v=>Number.isFinite(Number(v)))?[values.map(Number)]:levels.slice(1).map(l=>values.map(v=>v===l?1:0));
  };
  const covariates:Record<string,number[][]>={};
  const covariateNames=ct?[...new Set([...claim.adjustment,...staged.verifiedContract!.structure.batch.filter(b=>b.table===ct.definition.id).map(b=>b.column),...staged.verifiedContract!.structure.time.filter(b=>b.column.table===ct.definition.id).map(b=>b.column.column)])]:t.header.filter(name=>![claim.exposure,claim.outcome,'unit_id',declaration?.idColumn,declaration?.unitColumn].includes(name)&&! /^(?:id|(?:sample|patient|donor|cell_?line|line|participant|cell|variant|record|library)(?:_?id)?|subject|person)$/i.test(name));
  for(const name of covariateNames)covariates[name]=encode(name);
  const data:ClaimData={file,units:ct?claimContractUnits(staged.verifiedContract!,claim,staged.contractUnitKey!):col('unit_id'),x:number(claim.exposure),y:number(claim.outcome),strata:t.rows.map((_,i)=>JSON.stringify(claim.strata.map(s=>col(s)[i]))),
    nuisance:claim.adjustment.flatMap(encode),covariates,header:t.header,rows:t.rows,
    decimalResolution:ct?.definition.columns.find(c=>c.name===claim.outcome)?.decimal_resolution??null,
    // claimContractUnits refuses units finer than the floor; a coarser contract level is not the floor.
    unitAtFloor:ct?claim.unit==='unit_id'||claim.unit===staged.verifiedContract!.resolver.hierarchy.floor:claim.unit==='unit_id'};
  // Keep the public-row view for diagnostics whose seeds or effect sizes must not
  // depend on private replicate collapse. It contains no contract-derived unit IDs.
  const publicUnitTokens=ct&&ct.definition.unit_derivation.kind==='column-tuple'
    ?t.rows.map(row=>JSON.stringify(ct.definition.unit_derivation.kind==='column-tuple'?ct.definition.unit_derivation.columns.map(name=>row[t.header.indexOf(name)]):[]))
    :t.rows.map((_,i)=>`public-row-${i}`);
  data.publicTwinData={...data,units:publicUnitTokens};
  return ct?collapseContractRows(data,claim):data;
}
export function confounding(claim:PlanClaim,data:ClaimData):GateResult{
  try{
    const n=data.x.length, intercept=data.x.map(()=>1), center=residual(data.x,orthogonal([intercept])), total=dot(center,center);
    if(total<1e-20)throw new Error('no exposure contrast');
    const independent:number[][]=[intercept];
    for(const column of Object.values(data.covariates).flat()){try{orthogonal([...independent,column]);independent.push(column);}catch{/* redundant nuisance adds no span */}}
    let joint='estimable';try{orthogonal([...independent,data.x]);}catch{joint='aligned';}
    const columns=Object.entries(data.covariates).map(([column,cs])=>{
      if(!cs.length)return {column,status:'constant'};
      let r:number;try{const rest=residual(data.x,orthogonal([intercept,...cs]));r=Math.sqrt(Math.max(0,1-dot(rest,rest)/total));}catch{return {column,status:'insufficient'};}
      return {column,status:r>=1-1e-10?'aligned':r>=.5?'strong':'weak',association:r};
    });
    return g1cFromConfoundDocument(claim,{status:'checked',exposure:claim.exposure,columns,jointDesign:{status:joint},strongThreshold:.5});
  }catch{return gateResult('G1c','not-run','confounding unavailable',{claimId:claim.id});}
}
export function assertKernelClaim(claim:PlanClaim):void{
  const logistic=['logistic slope','log odds ratio','odds ratio'].includes(claim.estimand?.trim().toLowerCase()??'');
  if(logistic!== (claim.test==='logistic'))throw new Error('logistic estimands and the HC3 model-based logistic test must be declared together');
  if(!['effect-exists','effect-size','null','reproduction'].includes(claim.kind)||!['linear difference','linear slope','mean difference','additive difference','additive slope','logistic slope','log odds ratio','odds ratio'].includes(claim.estimand?.trim().toLowerCase()??''))throw new Error('unsupported kernel kind or estimand');
  if(!['logistic','sign-flip','permutation','permutation test','unit-level permutation test','randomization test','randomisation test','permutation-test','randomization','randomization-test','freedman-lane','linear'].includes(claim.test??''))throw new Error('unsupported kernel estimand');
  if(claim.adjustment.length>0&&!['freedman-lane','logistic','sign-flip'].includes(claim.test??''))throw new Error('adjusted claims must declare Freedman-Lane');
}
export function kernelDecision(claim:PlanClaim,data:ClaimData,seed:string,maxPermutations?:number):PermutationResult{
  assertKernelClaim(claim);
  const settings=claim.knobs.monteCarlo as MonteCarloSettings|undefined;
  if(settings!==undefined && (!settings||typeof settings!=='object'||Array.isArray(settings)||Object.keys(settings).some(k=>!['draws','maxDraws','extensionFactor','bandSE'].includes(k))||Object.values(settings).some(v=>typeof v!=='number'||!Number.isFinite(v))))throw new Error('invalid locked Monte Carlo configuration');
  if(new Set(data.units).size<data.units.length) {
    if(['logistic slope','log odds ratio','odds ratio'].includes(claim.estimand?.toLowerCase()??''))throw new Error('repeated logistic estimand requires a reviewed clustered model');
    if(claim.permutationLevel!=='unit')throw new Error('repeated measures must declare unit-level exchangeability');
    const contrasts=pairedContrasts(data);
    if(claim.nullValue===0&&data.units.length!==2*new Set(data.units).size)return {...withinUnitTest(data.x,data.y,data.units,claim.direction,claim.alpha,seed,settings),guarantee:'model-based: studentized mean null; finite-sample exchangeability and independent units unverified'};
    const differences=contrasts.map(d=>d-claim.nullValue),r=signFlipTest(differences,[...new Set(data.units)],claim.direction,claim.alpha,seed,settings);
    return {...r,estimate:r.estimate+claim.nullValue,guarantee:claim.nullValue===0?'model-based: studentized mean null; finite-sample exchangeability and independent units unverified':'model-based: independent contrasts symmetric about the locked null'};
  }
  if(claim.test==='sign-flip')throw new Error('sign-flip requires a declared repeated two-condition table');
  if(['logistic slope','log odds ratio','odds ratio'].includes(claim.estimand?.toLowerCase()??'')) {
    if(claim.test!=='logistic')throw new Error('logistic estimands require the declared HC3 model-based logistic test');
    const fit=linearEntry(claim,data),p=fit.p!;return {status:p<=claim.alpha?'reject':'retain',p,pLower:p,pUpper:p,evaluated:1,total:'1',extreme:0,estimate:fit.estimate!,statistic:claim.estimand?.toLowerCase()==='odds ratio'?(Math.log(fit.estimate!)-Math.log(claim.nullValue))/Number(fit.raw.logSE):(fit.estimate!-claim.nullValue)/fit.se!,scheme:'freedman-lane',alpha:claim.alpha,guarantee:'model-based: assumptions A1-A4',stopping:'model-based'};
  }
  const mode=claim.knobs.permutationMode??(maxPermutations!==undefined&&maxPermutations<19?'exact':'auto');
  if(typeof mode !== 'string' || !['auto','exact','monte-carlo'].includes(mode))throw new Error('unknown permutation decision mode');
  const result=permutationTest({x:data.x,y:data.y,units:data.units,strata:data.strata,nuisance:modelNuisance(data),scheme:claim.adjustment.length?'freedman-lane':'labels',direction:claim.direction,
    alpha:claim.alpha,seed,nullValue:claim.nullValue,...(maxPermutations===undefined?{}:{maxPermutations}),exhaustive:true,mode:mode as 'auto'|'exact'|'monte-carlo',...(settings?{monteCarlo:settings}:{})});
  // FL reprojects I-H residuals, which are not exchangeable at finite n. Under
  // the declared Gaussian linear model, the Student test is exact; its envelope
  // prevents the approximate FL ordering from making a more liberal decision.
  if(result.guarantee.startsWith('model-based')&&result.status!=='unresolved'&&!data.y.every(v=>v===0||v===1)){
    const reference=linearEntry(claim,data).p;
    if(reference===null)throw new Error('Gaussian calibration reference unavailable');
    const p=Math.max(result.decisionP??result.p??result.pUpper,reference);
    return {...result,modelReference:'Gaussian homoskedastic linear errors; max(Freedman-Lane p, Student p)',p,decisionP:p,status:p<=claim.alpha?'reject':'retain',pLower:Math.max(result.pLower,reference),pUpper:Math.max(result.pUpper,reference)};
  }
  return result;
}
export function generator(seed:string):()=>number{
  let s=createHash('sha256').update(seed).digest().readUInt32LE(0)||1;
  return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};
}
export function nullData(data:ClaimData,scheme:PermutationInput['scheme'],seed:string):{x:number[];y:number[]}{
  if(scheme==='freedman-lane'&&data.y.includes(0)&&data.y.includes(1)&&data.y.every(v=>v===0||v===1)) {
    const fit=logisticFit([data.x.map(()=>1),...modelNuisance(data)],data.y),rng=randomStream(seed+':binary-null');
    return {x:[...data.x],y:fit.probabilities.map(p=>rng.uniform()<p?1:0)};
  }
  const rng=generator(seed), groups=new Map<string,number[]>();(new Set(data.units).size<data.units.length?data.units:data.strata).forEach((s,i)=>{const g=groups.get(s)??[];g.push(i);groups.set(s,g);});
  const q=orthogonal([data.x.map(()=>1),...modelNuisance(data)]);
  const resid=residual(data.y,q), source=scheme==='labels'?data.x:resid, shuffled=[...source];
  for(const g of groups.values()) {const indices=[...g];for(let i=indices.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[indices[i],indices[j]]=[indices[j]!,indices[i]!];}g.forEach((i,k)=>{shuffled[i]=source[indices[k]!]!;});}
  return scheme==='labels'?{x:shuffled,y:[...data.y]}:{x:[...data.x],y:shuffled.map((v,i)=>v+data.y[i]!-resid[i]!)};
}
/** Location shift d with P(R + d > R') + P(R + d = R')/2 = target for R, R' drawn independently from
 * the centered residual pool (the population relative effect a Brunner–Munzel plant targets). */
function relativeEffectShift(residuals:readonly number[],target:number):number {
  const r=[...residuals].sort((a,b)=>a-b),n=r.length;if(n<2)throw new Error('relative-effect plant needs residual variation');
  const spread=r[n-1]!-r[0]!;if(!(spread>0))throw new Error('relative-effect plant needs residual variation');
  const p=(d:number)=>{let s=0;for(const a of r)for(const b of r){const v=a+d-b;s+=v>0?1:v===0?.5:0;}return s/(n*n);};
  let lo=-2*spread,hi=2*spread;if(!(p(lo)<target&&p(hi)>target))throw new Error('relative effect cannot be planted in this design');
  for(let i=0;i<60;i++){const m=(lo+hi)/2;if(p(m)<target)lo=m;else hi=m;}
  return (lo+hi)/2;
}
/** Two-arm null that keeps each arm's own size, spread and shape, shifted to the locked null on the
 * procedure's scale: additive for two-group, log scale for the geometric-mean ratio. Unlike a
 * relabeling of the observed outcomes, the arms are not exchangeable, so a permutation branch is not
 * exact by construction and the Behrens–Fisher behaviour of the registered procedure at the observed
 * design is actually exercised.
 * K2b-fix2 (k2b-fix1-verify new defect, "arm-resampled twins create ties"): a plain with-replacement
 * resample of 5 residuals repeats values so often that the registered ties rule refused about half of
 * the 5 v 5 twins. Each arm is now a smoothed bootstrap: a resampled centered residual plus Gaussian
 * kernel noise (Silverman bandwidth 0.9·s·n^(−1/5)), rescaled so the arm variance equals the observed
 * arm variance s² (the plain bootstrap's (n−1)/n shrinkage is undone too). Twins are later rounded to
 * the data's own resolution, so ties arise only as often as the grid makes them. */
function armResampledNull(claim:PlanClaim,data:ClaimData,design:'two-group'|'ratio',seed:string):{x:number[];y:number[]} {
  const levels=[...new Set(data.x)].sort((a,b)=>a-b);if(levels.length!==2)throw new Error('two-arm null requires exactly two exposure levels');
  if(design==='ratio'&&(data.y.some(v=>!(v>0))||!(claim.nullValue>0)))throw new Error('ratio null twins require positive outcomes and a positive null ratio');
  const scale=(v:number)=>design==='ratio'?Math.log(v):v,unscale=(v:number)=>design==='ratio'?Math.exp(v):v,shift=design==='ratio'?Math.log(claim.nullValue):claim.nullValue;
  const t=data.y.map(scale),arms=levels.map(level=>t.filter((_,i)=>data.x[i]===level)),mean=(v:number[])=>v.reduce((s,n)=>s+n,0)/v.length;
  const centre=mean(arms[0]!),residuals=arms.map(a=>{const m=mean(a);return a.map(v=>v-m);});
  const kernel=residuals.map(r=>{const n=r.length,s2=n>1?r.reduce((u,v)=>u+v*v,0)/(n-1):0,h=.9*Math.sqrt(s2)*n**-.2,denominator=(n-1)/n*s2+h*h;
    return {h,k:denominator>0?Math.sqrt(s2/denominator):0};});
  const rng=randomStream(seed+':arm-smoothed-bootstrap'),normal=()=>Math.sqrt(-2*Math.log(Math.max(Number.MIN_VALUE,rng.uniform())))*Math.cos(2*Math.PI*rng.uniform());
  return {x:[...data.x],y:data.x.map(x=>{const arm=x===levels[0]?0:1,r=residuals[arm]!,{h,k}=kernel[arm]!;return unscale(centre+(arm?shift:0)+k*(r[rng.integer(r.length)]!+h*normal()));})};
}
/** Values quantised to the outcome's declared decimal resolution (when one is declared), the grid the
 * registered procedures accept: smoothed twins are continuous, and the serialized tokens alone may
 * not name the grid. */
function onDeclaredGrid(data:Pick<ClaimData,'decimalResolution'>,values:readonly number[]):number[]{
  const resolution=data.decimalResolution;if(!resolution)return [...values];
  const step=Number(resolution);if(!(step>0)||!Number.isFinite(step))return [...values];
  const places=Math.max(0,Math.min(20,Math.ceil(-Math.log10(step)-1e-9)));
  return values.map(v=>Number((Math.round(v/step)*step).toFixed(places)));
}
/** Pooled within-unit residual SD (unit fixed effects plus the within-unit exposure slope). Falls
 * back to the outcome SD when no within-unit variation exists; a constant outcome has no scale. */
function withinUnitScale(data:ClaimData,groups:ReadonlyMap<string,readonly number[]>):number{
  const yt:number[]=[],xt:number[]=[];
  for(const g of groups.values()){const my=g.reduce((s,i)=>s+data.y[i]!,0)/g.length,mx=g.reduce((s,i)=>s+data.x[i]!,0)/g.length;for(const i of g){yt.push(data.y[i]!-my);xt.push(data.x[i]!-mx);}}
  const sxx=xt.reduce((s,v)=>s+v*v,0),beta=sxx>0?xt.reduce((s,v,i)=>s+v*yt[i]!,0)/sxx:0,resid=yt.map((v,i)=>v-beta*xt[i]!);
  const df=Math.max(1,data.y.length-groups.size-(sxx>0?1:0)),within=Math.sqrt(resid.reduce((s,v)=>s+v*v,0)/df);
  if(within>0&&Number.isFinite(within))return within;
  const mean=data.y.reduce((s,v)=>s+v,0)/data.y.length,overall=Math.sqrt(data.y.reduce((s,v)=>s+(v-mean)**2,0)/Math.max(1,data.y.length-1));
  if(overall>0&&Number.isFinite(overall))return overall;
  throw new Error('constant outcome has no null-twin scale');
}
/** Draw from the null on the estimand's scale, preserving unit structure.
 * Adjusted continuous nulls use iid Gaussian errors, not a second projection of
 * permuted reduced residuals (whose covariance I-H is not exchangeable). */
export function nullTwin(claim:PlanClaim,data:ClaimData,seed:string):{x:number[];y:number[]} {
  const logistic=['logistic slope','log odds ratio','odds ratio'].includes(claim.estimand?.toLowerCase()??'');
  const rng=randomStream(seed+':null-model');
  const design=registeredDesign(claim);
  // Registered designs draw nulls on the procedure's own null scale (K2b-fix1 findings 7 and 8).
  if(design==='brunner-munzel'&&new Set(data.units).size===data.units.length){
    // P = 1/2: exchangeable arms. Relabel the observed outcomes (never an additive shift by 0.5).
    if(claim.nullValue!==.5)throw new Error('Brunner–Munzel null twins require the canonical P = 1/2 null');
    return nullData(data,'labels',seed);
  }
  if((design==='two-group'||design==='ratio')&&!claim.adjustment.length&&new Set(data.units).size===data.units.length)return armResampledNull(claim,data,design,seed);
  // K2b-fix2: the exact binary RD is calibrated at the locked RD null. Each arm is drawn Bernoulli at
  // its Farrington–Manning restricted MLE under p_b − p_a = null, with the arm sizes fixed. Never an
  // additive shift rounded back onto the 0/1 grid (that undid the null and gave RD ≈ 0 twins).
  if(design==='binary'&&!claim.adjustment.length&&new Set(data.units).size===data.units.length){
    const {levels,pa,pb}=binaryRatesAt(data,claim.nullValue),draw=randomStream(seed+':binary-rd-null');
    return {x:[...data.x],y:data.x.map(x=>draw.uniform()<(x===levels[0]?pa:pb)?1:0)};
  }
  if(logistic){
    const coefficient=claim.estimand?.toLowerCase()==='odds ratio'?Math.log(claim.nullValue):claim.nullValue;
    if(!Number.isFinite(coefficient))throw new Error('invalid logistic null');
    if(!claim.adjustment.length&&coefficient===0)return nullData(data,'labels',seed);
    const fit=logisticFit([data.x.map(()=>1),...modelNuisance(data)],data.y,data.x.map(x=>coefficient*x));
    return {x:[...data.x],y:fit.probabilities.map(p=>rng.uniform()<p?1:0)};
  }
  if(new Set(data.units).size<data.units.length){
    // Stress the weak mean null without symmetrizing observed residuals. Rotate
    // heteroskedastic, skew-shape and serially correlated nulls deterministically.
    const mode=rng.integer(3),normal=()=>Math.sqrt(-2*Math.log(Math.max(Number.MIN_VALUE,rng.uniform())))*Math.cos(2*Math.PI*rng.uniform());
    const groups=new Map<string,number[]>();data.units.forEach((u,i)=>{const g=groups.get(u)??[];g.push(i);groups.set(u,g);});
    // Amendment 5 (metamorphic invariance): the stress noise is in the data's own units, the pooled
    // within-unit residual SD after the within-unit exposure slope, so rescaling y rescales the twin.
    const scale=withinUnitScale(data,groups);
    const y=[...data.y];let serial=normal();
    for(const g of groups.values()){
      const center=g.reduce((s,i)=>s+data.y[i]!,0)/g.length;
      serial=.8*serial+.6*normal();
      for(const i of g){serial=.9*serial+Math.sqrt(1-.9**2)*normal();const error=mode===0?(data.x[i]===1?5:1)*normal():mode===1?(data.x[i]===1?Math.exp(normal())-Math.exp(.5):normal()):serial;y[i]=center+claim.nullValue*data.x[i]!+scale*error;}
    }
    return {x:[...data.x],y};
  }
  if(data.y.every(v=>v===0||v===1)&&claim.adjustment.length){
    if(claim.nullValue!==0)throw new Error('binary additive nonzero null requires a reviewed probability model');
    return nullData(data,'freedman-lane',seed);
  }
  const centered={...data,y:data.y.map((y,i)=>y-claim.nullValue*data.x[i]!)};
  if(!claim.adjustment.length){const sample=nullData(centered,'labels',seed);return {...sample,y:sample.y.map((y,i)=>y+claim.nullValue*sample.x[i]!)};}
  const q=orthogonal([data.x.map(()=>1),...modelNuisance(data)]),e=residual(centered.y,q),sigma=Math.sqrt(dot(e,e)/(e.length-q.length));
  return {x:[...data.x],y:e.map((_,i)=>centered.y[i]!-e[i]!+claim.nullValue*data.x[i]!+sigma*Math.sqrt(-2*Math.log(Math.max(Number.MIN_VALUE,rng.uniform())))*Math.cos(2*Math.PI*rng.uniform()))};
}
/** Equal-weight unit contrast plasmode. Unit intercepts stay fixed; the same
 * estimator removes the observed effect before whole-unit residual sign flips. */
export function pairedPlasmode(data:ClaimData,truth:number,seed:string):number[] {
  const contrasts=pairedContrasts(data),observed=contrasts.reduce((s,v)=>s+v,0)/contrasts.length;
  const groups=new Map<string,number[]>();data.units.forEach((u,i)=>{const g=groups.get(u)??[];g.push(i);groups.set(u,g);});
  const y=[...data.y],rng=randomStream(seed+':unit-plasmode'),binary=data.y.every(v=>v===0||v===1);
  for(const g of groups.values()){
    const intercept=g.reduce((s,i)=>s+data.y[i]!-observed*data.x[i]!,0)/g.length,sign=rng.integer(2)?1:-1,u=rng.uniform();
    for(const i of g){const base=intercept+truth*data.x[i]!;
      if(binary){if(base<0||base>1)throw new Error('binary unit plasmode outside probability support');y[i]=u<base?1:0;}
      else y[i]=base+sign*(data.y[i]!-observed*data.x[i]!-intercept);
    }
  }
  return y;
}
export interface SimulationRequest { index:number; seed:string; phase:'null-1'|'null-2'|'planted'; x:number[]; y:number[]; publicShift?:number;
  /** Host-only: a G3 changed-truth probe twin (K2b-fix2). Only probe twins may be re-drawn for
   * logistic estimability; null and planted twins are never conditioned on it. */
  probe?:true; }
export interface PublicTwinTable {header:readonly string[];rows:readonly (readonly string[])[];}
export interface PublicOutcomeSupport {type:string;categories:readonly string[];bounds:{lower:string;upper:string}|null;}
/** Smallest declared/serialized unit of numeric precision, including the exponent in tokens. */
export function decimalQuantum(tokens:readonly string[],resolution?:string|null):number{
  if(resolution!==undefined&&resolution!==null){const q=Number(resolution);if(!Number.isFinite(q)||q<=0)throw new Error('invalid declared decimal resolution');return q;}
  const powers=tokens.map(token=>{const [mantissa,exponent='0']=token.split(/[eE]/);const decimals=(mantissa!.split('.')[1]??'').length;const power=Number(exponent)-decimals;if(!Number.isFinite(power)||Math.abs(power)>300)throw new Error('unsupported numeric token exponent');return power;});
  return powers.length?10**Math.min(...powers):1;
}
/** Generate outcomes solely from worker-visible rows, public unit tokens and declared outcome
 * support. No private replicate grouping or simulated private-unit vector enters this model. */
export function generatePublicTwinOutcomeRows(table:PublicTwinTable,exposure:string,outcome:string,support:PublicOutcomeSupport,
  resolution:string|null,seed:string,publicShift=0,scale:'identity'|'log'='identity'):string[]{
  const xi=table.header.indexOf(exposure),yi=table.header.indexOf(outcome),ui=table.header.indexOf('unit_id');
  if(xi<0||yi<0||ui<0||table.rows.some(row=>row.length!==table.header.length))throw new Error('public twin table schema unavailable');
  const values=table.rows.map(row=>row[yi]!),x=table.rows.map(row=>Number(row[xi]!));
  if(!table.rows.length||x.some(v=>!Number.isFinite(v)))throw new Error('public twin model inputs unavailable');
  // Replicate rows with the same public unit and exposure share the same draw. This
  // preserves the public replicate structure without consulting private collapse groups.
  const rowRng=(i:number)=>randomStream(`${seed}:public-row:${table.rows[i]![ui]}:${x[i]}`);
  // K2b-fix2: a binary logit shift pivots at the midrange of the observed exposure, so a two-arm
  // design moves its arms in opposite directions under any coding (1/2, 0/1, −1/1); binaryProbeShift
  // bounds the shift with the same pivot.
  const pivot=(Math.min(...x)+Math.max(...x))/2;
  if(support.type==='binary'||support.type==='ordinal'||support.categories.length>0){
    const categories=[...support.categories];
    if(categories.length<2||support.type==='binary'&&categories.length!==2)throw new Error('declared categorical support unavailable');
    if(values.some(v=>!categories.includes(v)))throw new Error('observed outcome outside declared categorical support');
    const global=categories.map(category=>values.filter(v=>v===category).length),byX=new Map<string,number[]>();
    x.forEach((value,i)=>{const key=String(value),counts=byX.get(key)??categories.map(()=>0),index=categories.indexOf(values[i]!);counts[index]=(counts[index]??0)+1;byX.set(key,counts);});
    return values.map((_,i)=>{const counts=[...(byX.get(String(x[i]))??global)].map(n=>n+.5),rng=rowRng(i);
      if(publicShift!==0){if(support.type==='binary'&&categories.every(c=>Number.isFinite(Number(c)))){
          const p=counts[1]!/(counts[0]!+counts[1]!),logit=Math.log(p/(1-p))+publicShift*(x[i]!-pivot);counts[0]=1-expit(logit);counts[1]=expit(logit);
        }else if(support.type==='ordinal'&&categories.every(c=>Number.isFinite(Number(c)))){
          for(let j=0;j<counts.length;j++)counts[j]=counts[j]!*Math.exp(publicShift*x[i]!*Number(categories[j]!));
        }else throw new Error('public shift cannot preserve declared categorical support');}
      const total=counts.reduce((s,n)=>s+n,0);let draw=rng.uniform()*total;
      for(let j=0;j<categories.length;j++){draw-=counts[j]!;if(draw<0)return categories[j]!;}return categories.at(-1)!;});
  }
  // A registered geometric-mean-ratio design is modelled on the log scale (K2b-fix2): the linear
  // generator below runs on log y, publicShift is a log-ratio slope shift, and every twin is positive.
  const logScale=scale==='log';
  const y=values.map(Number).map(v=>logScale?Math.log(v):v);if(y.some(v=>!Number.isFinite(v)))throw new Error(logScale?'log-scale public twin requires positive outcomes':'numeric public twin outcome required');
  const mean=(v:number[])=>v.reduce((s,n)=>s+n,0)/v.length,meanX=mean(x),meanY=mean(y),den=x.reduce((s,v)=>s+(v-meanX)**2,0);
  const slope=den>0?x.reduce((s,v,i)=>s+(v-meanX)*(y[i]!-meanY),0)/den:0,intercept=meanY-slope*meanX;
  const residuals=y.map((v,i)=>v-(intercept+slope*x[i]!)),residualMean=mean(residuals),centered=residuals.map(v=>v-residualMean);
  const residualScale=Math.sqrt(centered.reduce((s,v)=>s+v*v,0)/Math.max(1,centered.length-1)),outcomeScale=Math.sqrt(y.reduce((s,v)=>s+(v-meanY)**2,0)/Math.max(1,y.length-1));
  // K2b-fix1 (k1b-round4 finding 24): twin tokens follow the RAW column's grammar through the same
  // formatter as every other twin (exponent case, sign and width, normalised mantissa, the column's
  // finest fixed decimal place; never a negative zero). A fixed-decimal column is quantised on the
  // grid it displays, so the printed token is the generated value.
  const format=columnFormatter(values),scientific=values.some(t=>/[eE]/.test(t));
  const displayed=scientific?0:10**-Math.max(0,...values.map(t=>(t.split('.')[1]??'').length));
  const quantum=Math.max(displayed,support.type==='count'?Math.max(1,decimalQuantum(values,resolution)):decimalQuantum(values,resolution));
  const noiseScale=Math.max(quantum,residualScale,outcomeScale*.2);
  const declaredLower=support.bounds?Number(support.bounds.lower):-Infinity,upper=support.bounds?Number(support.bounds.upper):Infinity;
  const positive=support.type==='positive-concentration'||logScale,lower=positive?Math.max(declaredLower,Number.MIN_VALUE):declaredLower;
  // On the log scale the noise floor is the relative size of one display quantum.
  const logNoise=logScale?Math.max(residualScale,outcomeScale*.2,quantum/Math.max(Number.MIN_VALUE,Math.min(...values.map(Number)))):0;
  return values.map((_,i)=>{const rng=rowRng(i),z=Math.sqrt(-2*Math.log(Math.max(Number.MIN_VALUE,rng.uniform())))*Math.cos(2*Math.PI*rng.uniform());
    const residual=centered[rng.integer(centered.length)]??0;let value=intercept+(slope+publicShift)*x[i]!+residual+z*(logScale?logNoise:noiseScale);
    if(logScale)value=Math.exp(value);
    value=Math.min(upper,Math.max(lower,value));if(support.type==='count')value=Math.max(0,Math.round(value));
    value=Math.round(value/quantum)*quantum;if(positive&&value<=0)value=quantum;
    if(!Number.isFinite(value)||value<lower||value>upper)throw new Error('numeric twin outside declared outcome support');
    const token=format(Number(value.toPrecision(15))),printed=Number(token);
    if(!Number.isFinite(printed)||printed<lower||printed>upper||positive&&printed<=0)throw new Error('formatted numeric twin outside declared outcome support');
    return token;});
}
/** Logit shift per unit exposure for the binary changed-truth twin (K2b-fix1, k1b-round4 finding 21;
 * pivot and band K2b-fix2). The public generator adds shift·(x − pivot) to each exposure level's
 * smoothed logit (counts + 1/2), with the pivot at the midrange of the observed exposure, so the shift
 * does not depend on how the exposure is coded and a slope change moves the low and high levels in
 * opposite directions. The old max(1, 8·SE) (about 5.8 for n = 40) separated almost every twin; the
 * shift is at most one log-odds across the observed exposure range, and no level may leave the band
 * [min(0.1, p), max(0.9, p)] around its own smoothed rate p (a level beyond 0.1 or 0.9 may still move
 * toward the centre). When that band blocks both directions (typical of dose-response data with an
 * empty or full level on either side of the pivot), levels already at or beyond 0.1 or 0.9 stop
 * constraining the shift: the one-log-odds cap bounds how far they move and the estimable re-draw
 * handles separation. Of the two feasible directions the larger shift is used (more rows change, so
 * fewer twin pairs are uninformative); a tie goes to the claim's direction. Returns 0 when no shift of
 * at least 0.1 log-odds over the range fits (the probe then fails closed with that reason). */
export function binaryProbeShift(x:readonly number[],y:readonly number[],direction:'two-sided'|'greater'|'less'):number{
  if(!x.length||x.length!==y.length||x.some(v=>!Number.isFinite(v)))return 0;
  const min=Math.min(...x),max=Math.max(...x),range=max-min;if(!(range>0))return 0;
  const pivot=(min+max)/2,levels=new Map<number,{n:number;ones:number}>();x.forEach((v,i)=>{const l=levels.get(v)??{n:0,ones:0};l.n++;if(y[i]===1)l.ones++;levels.set(v,l);});
  const logit=(p:number)=>Math.log(p/(1-p)),minimum=.1/range;
  const choose=(interiorOnly:boolean):number=>{
    let lo=-1/range,hi=1/range;
    for(const [v,{n,ones}] of levels){
      const d=v-pivot,p=(ones+.5)/(n+1);if(d===0||interiorOnly&&(p<=.1||p>=.9))continue;
      const centre=logit(p),a=(logit(Math.min(.1,p))-centre)/d,b=(logit(Math.max(.9,p))-centre)/d;
      lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));
    }
    const preferred=direction==='less'?lo:hi,other=direction==='less'?hi:lo,chosen=Math.abs(other)>Math.abs(preferred)+1e-12?other:preferred;
    return Math.abs(chosen)>=minimum?chosen:0;
  };
  return choose(false)||choose(true);
}
/** The scale public twins are generated on: log for a registered geometric-mean-ratio design (its
 * estimand needs positive outcomes and a multiplicative shift), the outcome's own scale otherwise. */
export function twinScale(claim:PlanClaim):'identity'|'log' {return registeredDesign(claim)==='ratio'?'log':'identity';}
/** The registered estimand's point estimate on host data (K2b-fix2): the geometric-mean ratio b/a for
 * the ratio design, the Brunner–Munzel relative effect P(a<b) + P(a=b)/2, the risk difference
 * p_b − p_a for the binary design; otherwise the linear-model estimate. null when undefined. */
export function designEstimate(claim:PlanClaim,data:Pick<ClaimData,'x'|'y'>&Partial<ClaimData>):number|null {
  const design=registeredDesign(claim);
  if(design==='ratio'||design==='brunner-munzel'||design==='binary'){
    const levels=[...new Set(data.x)].sort((u,v)=>u-v);if(levels.length!==2)return null;
    const a=data.y.filter((_,i)=>data.x[i]===levels[0]),b=data.y.filter((_,i)=>data.x[i]===levels[1]),mean=(v:number[])=>v.reduce((t,n)=>t+n,0)/v.length;
    if(!a.length||!b.length||[...a,...b].some(v=>!Number.isFinite(v)))return null;
    if(design==='binary')return mean(b)-mean(a);
    if(design==='ratio')return [...a,...b].every(v=>v>0)?Math.exp(mean(b.map(Math.log))-mean(a.map(Math.log))):null;
    let t=0;for(const u of a)for(const v of b)t+=v>u?1:v===u?.5:0;return t/(a.length*b.length);
  }
  try{return linearEntry(claim,data as ClaimData).estimate;}catch{return null;}
}
/** Deterministic re-draws allowed for a logistic public twin without an MLE (finding 21). */
const LOGISTIC_TWIN_REDRAWS=16;
/** Public twin outcomes for the worker (K2b-fix1, k1b-round4 finding 21). A logistic twin with no MLE
 * is never handed to a worker when the observed public look itself has one: estimability is judged on
 * public rows only (public replicate tokens collapsed, the trusted logistic rule), a separated draw is
 * re-drawn on derived seeds, and the twin is refused when no estimable draw appears. When the observed
 * look is itself not estimable nothing is re-drawn (the probe already fails on the look). */
export function estimablePublicTwinOutcomes(table:PublicTwinTable,claim:PlanClaim,publicView:Omit<ClaimData,'sourceRowGroups'|'publicTwinData'>,support:PublicOutcomeSupport,
  resolution:string|null,seed:string,publicShift=0):string[]{
  const generate=(s:string)=>generatePublicTwinOutcomeRows(table,claim.exposure!,claim.outcome!,support,resolution,s,publicShift,twinScale(claim));
  const first=generate(seed);
  if(claim.test!=='logistic')return first;
  const xi=table.header.indexOf(claim.exposure!),yi=table.header.indexOf(claim.outcome!),tableX=table.rows.map(r=>Number(r[xi]!));
  const estimable=(values:readonly string[])=>{try{
    if(publicView.x.length!==values.length||tableX.some((v,i)=>v!==publicView.x[i]))return false;
    linearEntry(claim,collapseContractRows({...publicView,y:values.map(Number)} as ClaimData,claim));return true;}catch{return false;}};
  if(!estimable(table.rows.map(r=>r[yi]!)))return first;
  let outcomes=first;
  for(let attempt=1;!estimable(outcomes)&&attempt<=LOGISTIC_TWIN_REDRAWS;attempt++)outcomes=generate(`${seed}:estimable-redraw:${attempt}`);
  if(!estimable(outcomes))throw new Error('logistic twin refused: no estimable public twin after bounded re-draws');
  return outcomes;
}
/** The public twin outcomes a simulation request is run on (K2b-fix2): only a G3 probe twin is
 * re-drawn for logistic estimability; null and planted twins are drawn once, never conditioned on
 * estimability (a separated one reaches the worker, whose refusal fails that simulation closed). */
export function publicTwinOutcomes(table:PublicTwinTable,claim:PlanClaim,publicView:Omit<ClaimData,'sourceRowGroups'|'publicTwinData'>,support:PublicOutcomeSupport,
  resolution:string|null,request:Pick<SimulationRequest,'seed'|'publicShift'|'probe'>):string[]{
  return request.probe?estimablePublicTwinOutcomes(table,claim,publicView,support,resolution,request.seed,request.publicShift??0)
    :generatePublicTwinOutcomeRows(table,claim.exposure!,claim.outcome!,support,resolution,request.seed,request.publicShift??0,twinScale(claim));
}
/** Host-only collapse of generated rows. Categorical outcomes select a valid replicate instead
 * of averaging Bernoulli/category codes into an undeclared value. */
export function collapsePublicTwinOutcomeRows(outcomes:readonly string[],groups:readonly (readonly number[])[],categories:readonly string[]=[],requireAgreement=false,averageCategories=false):number[]{
  return groups.map(group=>{
    if(!group.length||group.some(i=>i<0||i>=outcomes.length))throw new Error('twin collapse mapping incomplete');
    if(categories.length){const values=group.map(i=>outcomes[i]!);if(values.some(value=>!categories.includes(value)))throw new Error('collapsed twin outside declared categorical support');if(requireAgreement&&values.some(value=>value!==values[0]))throw new Error('binary replicate outcomes disagree');const selected=averageCategories?values.reduce((s,value)=>s+Number(value),0)/values.length:Number(values[0]);if(!Number.isFinite(selected))throw new Error('categorical support unavailable to numeric kernel');return selected;}
    const values=group.map(i=>Number(outcomes[i]!));if(values.some(v=>!Number.isFinite(v)))throw new Error('numeric twin outcome unavailable');return values.reduce((s,v)=>s+v,0)/values.length;
  });
}
/** Trusted injection seam for deterministic fixtures / V3's controlled executor. It is a host
 * callback, never a JSON field or worker-supplied precomputed simulation document. */
export interface SimulationEntry extends PrimaryEntry {hostExpectedEstimate?:number|null;}
export type SimulationRunner=((request:SimulationRequest)=>Promise<SimulationEntry|null>)&{publicOnlyTwins?:true};
export function simulationRunner(executor:OfflineExecutor,frozen:FrozenCode,staged:StagedInputs,claim:PlanClaim,data:ClaimData):SimulationRunner{
  const runner:SimulationRunner=async request=>{
    let hostExpectedEstimate:number|null|undefined;
    const run=await executor.run(frozen,staged,'all',raw=>{
      // Every generated worker byte is a function of public RAW and its public unit_id tokens.
      const table=staged.contractMode?parseContractTable(data.file,readFileSync(path.join(raw,data.file))):data;
      const yi=table.header.indexOf(claim.outcome!),sep=data.file.endsWith('.csv')?',':'\t';
      const definition=[...(staged.verifiedContract?.tables.values()??[])].find(t=>t.definition.file.path===data.file)?.definition.columns.find(c=>c.name===claim.outcome);
      let support=definition?.measurement??{type:'continuous',categories:[],bounds:null};
      // A locked logistic analysis and the registered binary risk-difference design (K2b-fix1,
      // k1b-round4 finding 20) both require a 0/1 outcome; their twins must stay 0/1 too.
      const binaryAnalysis=claim.test==='logistic'?'logistic':registeredDesign(claim)==='binary'?'binary risk-difference':null;
      if(binaryAnalysis){
        const publicValues=table.rows.map(r=>r[yi]!),numeric=publicValues.map(Number);
        if(!numeric.every(v=>v===0||v===1)||!numeric.includes(0)||!numeric.includes(1))throw new Error(`${binaryAnalysis} twin refused: public outcome lacks both binary classes`);
        // Preserve that support even when source metadata labels integer 0/1 storage continuous.
        support={type:'binary',categories:[...new Set(publicValues)].sort(),bounds:null,unit:(support as {unit?:string}).unit??'original-scale'};
      }
      const outcomes=publicTwinOutcomes(table,claim,data.publicTwinData??data,support,definition?.decimal_resolution??null,request);
      const rows=table.rows.map((r,i)=>{const row=[...r];row[yi]=outcomes[i]!;return row;});
      // Private groups are consulted only after generation, on the host, to collapse the
      // public twin output for its matching software estimate.
      const groupMap=data.sourceRowGroups??table.rows.map((_,i)=>[i]);
      if(groupMap.length===data.units.length){
        const xi=table.header.indexOf(claim.exposure!),x=table.rows.map(r=>Number(r[xi]!)),categorical=support.type==='binary'||support.type==='ordinal'||support.categories.length>0;
        const average=(values:number[],group:number[])=>group.reduce((s,index)=>s+values[index]!,0)/group.length;
        // On the registered estimand's scale (K2b-fix2), so ratio, rank and binary twins compare like with like.
        try{hostExpectedEstimate=designEstimate(claim,{...data,x:groupMap.map(g=>average(x,g)),y:collapsePublicTwinOutcomeRows(outcomes,groupMap,categorical?support.categories:[],claim.test==='logistic',claim.test!=='logistic')});}catch{hostExpectedEstimate=null;}
      }
      const bytes=data.file.endsWith('.json')?JSON.stringify(rows.map(r=>Object.fromEntries(table.header.map((h,i)=>[h,r[i]]))))+'\n'
        :[table.header,...rows].map(r=>r.map(v=>/["\r\n]/.test(v)||v.includes(sep)?`"${v.replaceAll('"','""')}"`:v).join(sep)).join('\n')+'\n';
      chmodSync(path.join(raw,data.file),0o600);
      writeFileSync(path.join(raw,data.file),bytes);
      chmodSync(path.join(raw,data.file),0o400);
    },{[claim.id]:createHash('sha256').update(request.seed).digest('hex')});
    if(run.status!=='ok'||!run.files['primary.json'])return null;
    const entry=findEntry(parsePrimary(run.files['primary.json']).primary,claim.metric,true);
    return entry?{...entry,...(hostExpectedEstimate===undefined?{}:{hostExpectedEstimate})}:null;
  };
  runner.publicOnlyTwins=true;return runner;
}
const validP=(p:unknown):p is number=>typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1;
export async function nullCalibration(lockedClaim:PlanClaim,data:ClaimData,seed:string,run:SimulationRunner,registered?:RegisteredProcedure|null,identity?:{planHash:string;contractHash:string;inputHash:string;codeHash:string},procedureB=9_999):Promise<GateResult>{
  // A registered procedure is calibrated at the level it decides at (one-sided .025 for directional claims).
  const claim=registered&&identity?{...lockedClaim,alpha:decisionAlpha(lockedClaim)}:lockedClaim;
  const scheme=claim.adjustment.length?'freedman-lane':'labels', stream1=seed+':null-1',stream2=seed+':null-2';
  const count=async(n:number,phase:'null-1'|'null-2',stream:string)=>{let rejected=0;for(let i=0;i<n;i++){
    const sampleSeed=`${stream}:${i}`,sample=nullTwin(claim,data,sampleSeed);
    const entry=await run({index:i,phase,seed:sampleSeed,...roundedSample(data,claim,sample)});
    if(!entry||!validP(entry.p))throw new Error('incomplete simulation');if(entry.p<=claim.alpha)rejected++;
  }return rejected;};
  try{
    const runProcedure=memoRegisteredProcedure();
    // K2b-fix2: the sequential rule is applied to informative twins only. A twin the procedure refuses
    // is replaced by the next draw (at most 2n draws per stage) instead of counting as a non-rejection,
    // which diluted the rule; a stage that cannot collect n informative twins carries no calibration
    // information and fails.
    const countRegistered=async(n:number,stream:string)=>{let rejected=0,refused=0,informative=0,attempts=0;for(;informative<n&&attempts<2*n;attempts++){
      const sample=nullTwin(claim,data,`${stream}:${attempts}`),rounded=roundedSample(data,claim,sample),twin={...data,x:rounded.x,y:onDeclaredGrid(data,rounded.y)};
      const result=runProcedure(registered!,claim,twin,identity!,procedureB);if(result.status==='refused'){refused++;continue;}if(!Number.isFinite(result.p))throw new Error('registered calibration p-value invalid');informative++;if(result.p<=claim.alpha)rejected++;
    }return {rejected,refused,informative,attempts};};
    const countNull=async(n:number,phase:'null-1'|'null-2',stream:string)=>registered&&identity?countRegistered(n,stream):{rejected:await count(n,phase,stream),refused:0,informative:n,attempts:n};
    const firstResult=await countNull(200,'null-1',stream1),first=firstResult.rejected,uninformativeFirst=firstResult.informative<200,initial=uninformativeFirst?'fail':decideCalibration(claim.alpha,first);
    const extensionResult=initial==='extend'?await countNull(400,'null-2',stream2):undefined,extension=extensionResult?.rejected;
    const uninformative=uninformativeFirst||(extensionResult!==undefined&&extensionResult.informative<400);
    const decision=uninformative?'fail':decideCalibration(claim.alpha,first,extension);
    const design=registeredDesign(claim),repeatedUnits=new Set(data.units).size<data.units.length;
    // Honest scope (K2b-fix1 finding 7, made per design in K2b-fix2): a check at the claim's observed
    // design with the 200/600 sequential rule over informative twins. It is never amendment 6's
    // worst-case design-matched calibration (laws in D on the design skeleton, N >= 5,000, CP upper <=
    // alpha_max); the validated bound stamped on a Confirmed label rests on the K2a release grid, which
    // G5c enforces. Where the null is a relabeling of the observed outcomes, a permutation branch is
    // exact by construction, so the check cannot detect its anti-conservatism: it says so.
    const kind:'binary'|'arms'|'relabel'|'stress'|'model'=registered&&design==='binary'&&!claim.adjustment.length&&!repeatedUnits?'binary'
      :registered&&(design==='two-group'||design==='ratio')&&!claim.adjustment.length&&!repeatedUnits?'arms'
      :repeatedUnits?'stress':claim.test==='logistic'||scheme==='freedman-lane'?'model':'relabel';
    const nullGenerator=kind==='binary'?'Farrington–Manning constrained Bernoulli null at the locked risk difference (arm sizes fixed)'
      :kind==='arms'?`smoothed arm bootstrap of centered residuals (variance-matched Gaussian kernel, rounded to the data resolution) at the locked null${design==='ratio'?' (log scale)':''}; arms not exchangeable`
      :kind==='stress'?'heteroskedastic/shape/serial weak-mean null stress (within-unit residual scale); model-based':claim.test==='logistic'?'binary null model':scheme==='freedman-lane'?'Gaussian reduced model':design==='brunner-munzel'?'observed-outcome relabeling at P = 1/2':'labels';
    const rule='200/600 sequential rule over informative twins (a refused twin is redrawn, never counted as a non-rejection)',bound='not worst-case design-matched calibration; the validated bound rests on the K2a release grid enforced by G5c';
    const calibrationScope=kind==='arms'?`observed-design null check (${rule}): non-exchangeable arms with the observed sizes and spreads exercise the registered procedure's Behrens–Fisher behaviour; ${bound}`
      :kind==='binary'?`observed-design null check (${rule}) at the constrained null rates and observed arm sizes; ${bound}`
      :kind==='relabel'?`exchangeable relabeling of the observed outcomes (${rule}): a permutation branch is exact by construction under relabeling, so this check cannot detect its anti-conservatism and is not design-matched; ${bound}`
      :`model-based null (${rule}); not matched to the observed error law; ${bound}`;
    return gateResult('G5a',decision==='pass'?'passed':'failed',uninformative?'null calibration twins were mostly refused; no calibration information':'null calibration at the locked alpha',{claimId:claim.id,evidence:{ruleVersion:'alpha-aware-v2',alpha:claim.alpha,scheme,nullGenerator,unit:claim.unit,strata:claim.strata,
      calibrationScope,observedDesignMatched:kind==='arms'||kind==='binary',
      calibrationSource:registered?'registered-procedure':'legacy-simulation',procedureId:registered?.procedureId,
      stage1:{trials:firstResult.informative,rejections:first,refused:firstResult.refused,attempts:firstResult.attempts},...(extensionResult===undefined?{}:{stage2:{trials:extensionResult.informative,rejections:extensionResult.rejected,refused:extensionResult.refused,attempts:extensionResult.attempts},seedStream2:stream2}),seedStream1:stream1}});
  }catch(e){return gateResult('G5a','failed','null simulation execution or output incomplete',{claimId:claim.id,evidence:{calibrationSource:registered&&identity?'registered-procedure':'legacy-simulation',...(registered?{procedureId:registered.procedureId}:{}),failure:e instanceof Error?e.message:'unknown'}});}
}
export async function plantedEffect(lockedClaim:PlanClaim,data:ClaimData,seed:string,run:SimulationRunner,maxPermutations?:number,registered?:RegisteredProcedure|null,identity?:{planHash:string;contractHash:string;inputHash:string;codeHash:string}):Promise<GateResult[]>{
  // Power and coverage are judged at the registered procedure's decision level.
  const claim=registered&&identity?{...lockedClaim,alpha:decisionAlpha(lockedClaim)}:lockedClaim;
  const unavailable=()=>['G5b-power','G5b-recovery'].map(g=>gateResult(g as 'G5b-power'|'G5b-recovery','failed','planted simulations unavailable',{claimId:claim.id}));
  if(claim.mei===null||claim.mei<=0)return unavailable();
  // Plant on the registered estimand's own scale (K2b-fix1 finding 8): a geometric-mean ratio is
  // planted multiplicatively (log scale), a Brunner–Munzel relative effect as the location shift whose
  // population relative effect equals the planted truth. Truth and coverage stay on that scale.
  const design=registered?registeredDesign(claim):null,scaleKind=design==='ratio'?'log-ratio':design==='brunner-munzel'?'relative-effect':design==='binary'?'risk-difference':'additive';
  // The signed MEI is on the estimand's MEI scale (owner MEI policy, K2b-fix2): a ratio MEI is a
  // log-ratio, so the planted truth is null·e^{±MEI} (ratio 1.25 at the policy MEI), never null ± MEI.
  const effect=claim.direction==='less'?-claim.mei:claim.mei, truth=scaleKind==='log-ratio'?claim.nullValue*Math.exp(effect):claim.nullValue+effect;
  if(scaleKind==='log-ratio'&&(!(truth>0)||data.y.some(v=>!(v>0))))return unavailable();
  if(scaleKind==='relative-effect'&&!(truth>0&&truth<1))return unavailable();
  if(scaleKind==='risk-difference'&&!(truth>-1&&truth<1))return unavailable();
  try{
    // K2b-fix2: a risk difference is planted on the RD scale whatever the exposure coding: each arm is
    // Bernoulli at its Farrington–Manning restricted MLE under p_b − p_a = truth (arm sizes fixed).
    const rdRates=scaleKind==='risk-difference'?binaryRatesAt(data,truth):null,runProcedure=memoRegisteredProcedure();
    const errors:number[]=[],truths:number[]=[];let rejections=0,covered=0,unresolved=0,workerEstimatesMatch=true;
    const work=scaleKind==='log-ratio'?{...data,y:data.y.map(Math.log)}:data;
    const observed=linearEntry(claim,work).estimate!;
    const q=orthogonal([data.x.map(()=>1),...modelNuisance(data),data.x]);
    const base=residual(work.y,q),fitted0=work.y.map((v,j)=>v-base[j]!-observed*data.x[j]!);
    const shift=scaleKind==='log-ratio'?Math.log(truth):scaleKind==='relative-effect'?relativeEffectShift(base,truth):truth;
    // Two bounded workers overlap sandbox startup; results are reduced in seed order.
    // Drain both on failure so no execution survives a terminal return.
    let next=0,aborted=false;
    const worker=async()=>{try{while(!aborted&&next<100){
      const i=next++,sampleSeed=`${seed}:planted:${i}`;
      // Remove the observed exposure slope before planting, so the truth is the signed MEI.
      const shuffled=nullData({...work,y:base},'freedman-lane',sampleSeed+':residual').y;
      const binary=data.y.every(v=>v===0||v===1);
      const logistic=['logistic slope','log odds ratio','odds ratio'].includes(claim.estimand?.toLowerCase()??'');
      const fittedLogistic=logistic?logisticFit([data.x.map(()=>1),...modelNuisance(data),data.x],data.y):null;
      const plantedCoefficient=claim.estimand?.toLowerCase()==='odds ratio'?Math.log(truth):truth;
      if(logistic&&!Number.isFinite(plantedCoefficient))throw new Error('invalid planted odds ratio');
      const probabilities=rdRates?data.x.map(x=>x===rdRates.levels[0]?rdRates.pa:rdRates.pb):fittedLogistic?fittedLogistic.probabilities.map((p,j)=>expit(Math.log(p/(1-p))-fittedLogistic.beta.at(-1)!*data.x[j]!+plantedCoefficient*data.x[j]!)):fitted0.map((v,j)=>v+truth*data.x[j]!);
      if(binary&&new Set(data.units).size===data.units.length&&probabilities.some(p=>p<0||p>1))throw new Error('binary MEI plasmode outside probability support');
      const rng=randomStream(sampleSeed+':bernoulli');
      const unrounded=rdRates?probabilities.map(p=>rng.uniform()<p?1:0):scaleKind!=='additive'?shuffled.map((v,j)=>{const value=fitted0[j]!+v+shift*data.x[j]!;return scaleKind==='log-ratio'?Math.exp(value):value;})
        :new Set(data.units).size<data.units.length?pairedPlasmode(data,truth,sampleSeed):binary?probabilities.map(p=>rng.uniform()<p?1:0):shuffled.map((v,j)=>fitted0[j]!+v+truth*data.x[j]!);
      const sample=roundedSample(data,claim,{x:data.x,y:unrounded}),y=sample.y;
      // Quantization is a deterministic perturbation of the planted signal. Account for its
      // coefficient, without absorbing the permuted residual coefficient into the truth.
      // Rounding is a deterministic perturbation of the planted signal; account for its coefficient
      // on the planting scale (log scale for a ratio). A relative effect keeps its planted truth.
      const rounding=binary||scaleKind==='relative-effect'?0:scaleKind==='log-ratio'?linearEntry(claim,{...data,y:y.map((v,j)=>Math.log(v)-Math.log(unrounded[j]!))}).estimate!:linearEntry(claim,{...data,y:y.map((v,j)=>v-unrounded[j]!)}).estimate!;
      const roundedTruth=scaleKind==='log-ratio'?truth*Math.exp(rounding):truth+rounding;truths[i]=roundedTruth;
      const e=await run({index:i,phase:'planted',seed:sampleSeed,x:[...data.x],y});
      if(!e||e.estimate===null||!Number.isFinite(e.estimate))throw new Error('incomplete planting');
      const planted={...data,x:[...data.x],y};
      const procedure=registered&&identity?runProcedure(registered,claim,planted,identity,maxPermutations??9_999):null;
      if(procedure&&procedure.status!=='ok'){unresolved++;errors[i]=0;workerEstimatesMatch=false;continue;}
      const decision=procedure?{status:'resolved' as const,decisionP:procedure.p}:{...kernelDecision(claim,planted,sampleSeed+':kernel',maxPermutations)};
      if(decision.status==='unresolved')unresolved++;
      const trusted=procedure?{estimate:procedure.estimate,ci:procedure.ci}:linearEntry(claim,planted);
      // Same relative rule as G3 (numericAgreement): no absolute floor, so a worker returning 0 on
      // planted runs at a tiny measurement scale cannot match a nonzero trusted estimate.
      workerEstimatesMatch &&= numericAgreement(e.estimate,e.hostExpectedEstimate??trusted.estimate!);
      const logScale=claim.estimand?.toLowerCase()==='odds ratio'||scaleKind==='log-ratio';
      errors[i]=logScale?Math.log(trusted.estimate!)-Math.log(roundedTruth):trusted.estimate!-roundedTruth;if(decision.status==='reject'||procedure?.p!==undefined&&procedure.p<=claim.alpha)rejections++;if(trusted.ci![0]<=roundedTruth&&trusted.ci![1]>=roundedTruth)covered++;
    }}catch(e){aborted=true;throw e;}};
    const finished=await Promise.allSettled([worker(),worker()]);
    if(finished.some(r=>r.status==='rejected'))return unavailable();
    const bias=errors.reduce((a,b)=>a+b,0)/100,seMean=Math.sqrt(errors.reduce((s,v)=>s+(v-bias)**2,0)/99/100),power=rejections/100,coverage=covered/100;
    // Amendment 4 rule: coverage >= 1 - alpha - tolerance, judged on the observed coverage of the
    // 100 planted draws (an exactly calibrated interval passes about 99% of the time; true coverage
    // .85 at nominal .95 fails about 90%). The Wilson interval is reported as a diagnostic only.
    const nominal=1-claim.alpha,z=1.959963984540054,den=1+z*z/100,center=(coverage+z*z/200)/den,half=z*Math.sqrt(coverage*(1-coverage)/100+z*z/40000)/den;
    const coverageCI:[number,number]=[Math.max(0,center-half),Math.min(1,center+half)],coverageTolerance=POLICY.g5bCoverageTolerance,coverageCalibrated=coverageMeetsNominal(coverage,nominal,coverageTolerance);
    const evidence={calibrationMethod:G5B_COVERAGE_METHOD,recoveryScale:claim.estimand?.toLowerCase()==='odds ratio'?'log odds ratio':scaleKind==='log-ratio'?'log geometric-mean ratio':scaleKind==='relative-effect'?'relative effect (planted location shift)':scaleKind==='risk-difference'?'risk difference':'estimand',...(scaleKind==='relative-effect'?{plantedShift:shift}:{}),workerEstimatesMatch,unresolved,maxPermutations,roundedTruthRange:[Math.min(...truths),Math.max(...truths)],intervalSource:registered&&identity?'registered procedure interval':new Set(data.units).size<data.units.length?'software cluster contrast Student interval':data.y.every(v=>v===0||v===1)?'software HC3 interval':'software Student interval',seeds:100,alpha:claim.alpha,effect,truth,power,bias,seMean,coverage,coverageCI,ciLevel:nominal,coverageTolerance,coverageCalibrated,seedStream:seed+':planted'};
    return [gateResult('G5b-power',power>=.8&&unresolved===0?'passed':'failed','power at the signed locked MEI',{claimId:claim.id,evidence}),
      gateResult('G5b-recovery',unresolved===0&&coverageCalibrated?'passed':'failed','design-matched interval coverage calibration at the signed locked effect',{claimId:claim.id,evidence})];
  }catch{return unavailable();}
}
/** results.json claims bound to locked claim ids (gauntlet parser, aliases and key folding). An
 * unparseable, ambiguous or duplicated file, or an unkeyed block that cannot be bound to exactly
 * one locked claim, is invalid: claimed() is then null and G3 fails closed for every claim. */
export interface ReportedClaims{readonly invalid:boolean;readonly entries:ReadonlyMap<string,PrimaryEntry>;readonly ids:readonly string[];claimed(claim:PlanClaim):Record<string,ClaimedNumber>|null;}
export function bindReported(parsed:ReportedParseResult,plan:Plan|null):ReportedClaims{
  const blocks=new Map(parsed.reported?.entries??[]);let invalid=parsed.status==='invalid';
  const unkeyed=blocks.get('*');
  if(unkeyed){blocks.delete('*');const only=plan?.claims.length===1?plan.claims[0]!.id:null;if(only===null||blocks.has(only))invalid=true;else blocks.set(only,unkeyed);}
  const entries:ReadonlyMap<string,PrimaryEntry>=invalid?new Map():blocks;
  return {invalid,entries,ids:[...entries.keys()],claimed:claim=>{if(invalid)return null;const entry=entries.get(claim.id);return entry?reportedNumbers(entry):{};}};
}
export function localGates(input:{plan:Plan|null;lock:PlanLock|null;firstLookAt:number|null;staged:StagedInputs|null;first:Execution;rerun:Execution;script:string|null;reported:ReportedClaims}):GateResult[]{
  const primary=parsePrimary(input.first.files['primary.json']??null).primary;
  const gates:GateResult[]=[evaluateG2({plan:input.plan,lock:input.lock,firstLookAt:input.firstLookAt})];
  if(input.staged)gates.push(input.staged.gate);
  for(const c of input.plan?.claims??[]){
    const one=input.plan!.claims.length===1;
    const firstEntry=findEntry(primary,c.metric,one),rerunEntry=findEntry(parsePrimary(input.rerun.files['primary.json']??null).primary,c.metric,one);
    const rerunGate=firstEntry&&rerunEntry?evaluateG4({recorded:snapshotOutputs({claim:entryNumbers(firstEntry)}),reruns:[snapshotOutputs({claim:entryNumbers(rerunEntry)})]}):gateResult('G4','not-run','claim outputs unavailable');
    gates.push({...rerunGate,claimId:c.id,...(input.first.status==='failed'||input.rerun.status==='failed'?{outcome:'failed' as const,summary:'worker execution failed'}:{})});
    const table=c.knobs.table,units=typeof table==='string'?input.staged?.tableUnits?.[table]:undefined,effective=input.staged?new Set(units??input.staged.units):null;
    const claimPrimary=primary?{...primary,nUnits:firstEntry?.nUnits??primary.nUnits}:null;
    gates.push(...contractGates(input.staged,[c],input.first.effectiveInputsVerified,input.plan?planLockHash(input.plan):undefined));
    const claimed=input.reported.claimed(c);
    gates.push(claimed===null?gateResult('G3','failed','results.json is unreadable, ambiguous or has a claim that cannot be bound; claimed numbers cannot be compared',{claimId:c.id,code:'reported-unreadable'})
      :evaluateG3({claimId:c.id,claimed,recomputed:input.first.status==='ok'?entryNumbers(findEntry(primary,c.metric,input.plan!.claims.length===1))??{}:input.first.status==='failed'?{}:null}));}
  // Numbers reported for a claim outside the locked plan have no trusted computation: never vacuous.
  for(const [id,entry] of input.reported.entries){
    if(input.plan?.claims.some(c=>c.id===id))continue;
    const numbers=Object.keys(reportedNumbers(entry));
    if(numbers.length)gates.push(gateResult('G3','failed','numbers reported for a claim outside the locked plan have no trusted software computation',{claimId:id,code:'unplanned-numbers',evidence:{compared:0,uncomputed:numbers}}));
  }
  return gates;
}
export function signedGates(authority:GateAuthority,binding:Binding,gates:readonly GateResult[]):SignedGate[]{return gates.map(g=>authority.seal(binding,g));}
export function multiplicity(plan:Plan,primary:PrimaryOutputs|null):GateResult[]{return evaluateG6(plan,primary);}

/** B1/CR-A3: a null twin and an alternative twin must change both the estimate and p.
 * The worker does not receive phase/seed metadata. This is a diagnostic, not a proof of lineage. */
/** Binary changed-truth twin pairs tried before the probe fails for want of an informative pair. */
const BINARY_PROBE_PAIRS=8;
export async function dataDependence(claim:PlanClaim,data:ClaimData,lookRun:SimulationRunner,seed='dependence',requireP=true,report?:(reason:string)=>void):Promise<boolean>{
  // Every request is a G3 probe twin (only these may be re-drawn for logistic estimability).
  const run:SimulationRunner=Object.assign((request:SimulationRequest)=>lookRun({...request,probe:true}),lookRun.publicOnlyTwins?{publicOnlyTwins:true as const}:{});
  const fail=(reason:string)=>{report?.(reason);return false;};
  try{
    // K2b-fix1 (k1b-round4 finding 19): fit, branch and size the shift on the public rows with
    // public replicate rows collapsed on their public unit token, by the same rule as the private
    // collapse (mean for linear claims, agreement required for logistic ones). Public replicate
    // tokens repeat, so the raw row view sent linearEntry into its paired branch and the probe threw
    // before any twin. No private grouping enters this view, so twins stay private-layout invariant.
    const publicRows=data.publicTwinData??data,binaryOutcome=publicRows.y.every(v=>v===0||v===1);
    const publicData=collapseContractRows(publicRows as ClaimData,claim),design=registeredDesign(claim);
    // The visit-contrast branch belongs to locked within-unit designs only (a dose-response
    // regression with several exposure levels is a between-unit design).
    if((design==='paired'||design==='repeated')&&new Set(publicData.x).size>2&&new Set(publicData.units).size<publicData.units.length){
      const control=Number(claim.knobs.controlLevel),treated=Number(claim.knobs.treatedLevel);
      if(!Number.isFinite(control)||!Number.isFinite(treated)||control===treated)return fail('visit-contrast probe refused: locked controlLevel and treatedLevel are missing or equal');
      const groups=new Map<string,{control:number[];treated:number[]}>();publicData.units.forEach((u,i)=>{
        if(publicData.x[i]!==control&&publicData.x[i]!==treated)return;const g=groups.get(u)??{control:[],treated:[]};
        (publicData.x[i]===control?g.control:g.treated).push(publicData.y[i]!);groups.set(u,g);
      });
      const contrasts=[...groups.values()].filter(g=>g.control.length===1&&g.treated.length===1).map(g=>g.treated[0]!-g.control[0]!);
      if(contrasts.length<3||contrasts.length!==groups.size)return fail('visit-contrast probe refused: fewer than three complete public unit contrasts');
      const observed=contrasts.reduce((s,v)=>s+v,0)/contrasts.length,se=Math.sqrt(contrasts.reduce((s,v)=>s+(v-observed)**2,0)/(contrasts.length-1)/contrasts.length);
      const delta=(claim.direction==='less'?-1:1)*16*Math.max(1,8*se)*(1+generator(seed)()),twinSeed=seed+':repeated-contrast';
      const entries=[];
      for(let i=0;i<2;i++){const y=[...publicData.y];if(i)publicData.x.forEach((x,j)=>{if(x===treated)y[j]=y[j]!+delta;});
        entries.push(await run({index:i,phase:'planted',seed:twinSeed,x:[...publicData.x],y,...(run.publicOnlyTwins?{publicShift:i*delta/(treated-control)}:{})}));}
      const [a,b]=entries;return !!a&&!!b&&a.estimate!==null&&b.estimate!==null&&(!requireP||validP(a.p)&&validP(b.p)&&Math.abs(b.p-a.p)>=claim.alpha)&&Math.abs(b.estimate-a.estimate)>=Math.abs(delta)*.5||fail('estimate must depend on input: the visit-contrast estimate did not move with the planted change');
    }
    if(binaryOutcome) {
      const min=Math.min(...publicData.x),max=Math.max(...publicData.x);if(min===max)return fail('binary probe refused: no exposure contrast in the public rows');
      // The public view must itself be estimable; the twin shift is bounded on the public rows the
      // generator reads (K2b-fix1 finding 21), never 8·SE log-odds.
      try{linearEntry(claim,publicData);}catch{return fail('binary probe refused: the observed public look has no trusted estimate');}
      const shift=binaryProbeShift(publicRows.x,publicRows.y,claim.direction);
      if(run.publicOnlyTwins&&shift===0)return fail('binary probe refused: no bounded logit shift of at least 0.1 log-odds over the exposure range keeps every exposure level inside its probability band');
      // K2b-fix2: both twins of a pair share one seed (common random numbers), so the shift acts on
      // shared uniforms and every row that changes moves the same way: a lattice estimate cannot land
      // on the same value by chance. A pair whose host-side twin estimates are equal (no row changed)
      // carries no information about the worker and is replaced by the next pair; this depends only on
      // host-generated data, never on the worker's output.
      for(let attempt=0;attempt<BINARY_PROBE_PAIRS;attempt++){
        const pairSeed=`${seed}:binary-pair:${attempt}`,rng=randomStream(pairSeed),u=publicData.x.map(()=>rng.uniform()),entries=[],host:(number|null|undefined)[]=[];
        for(let i=0;i<2;i++){
          const y=publicData.x.map((x,j)=>u[j]!<(i===0?.5:.1+.8*(x-min)/(max-min))?1:0),entry=await run({index:i,phase:'planted',seed:pairSeed,x:[...publicData.x],y,...(run.publicOnlyTwins?{publicShift:i*shift}:{})});
          entries.push(entry);host.push(run.publicOnlyTwins?entry?.hostExpectedEstimate:designEstimate(claim,{...publicData,y}));
        }
        const [a,b]=entries;
        if(!a||!b||a.estimate===null||b.estimate===null||!Number.isFinite(a.estimate)||!Number.isFinite(b.estimate))return fail('a changed-truth twin returned no estimate (the worker failed or the twin was refused)');
        if(typeof host[0]==='number'&&typeof host[1]==='number'&&Number.isFinite(host[0])&&Number.isFinite(host[1])&&Math.abs(host[1]-host[0])<=.01)continue;
        if(requireP&&!(validP(a.p)&&validP(b.p)&&Math.abs(b.p-a.p)>=claim.alpha))return fail('the reported p-value did not change between changed-truth twins');
        return Math.abs(b.estimate-a.estimate)>.01||fail('the reported estimate did not change between changed-truth twins');
      }
      return fail(`no informative binary twin pair in ${BINARY_PROBE_PAIRS} attempts (the shifted twin changed no outcome)`);
    }
    // K2b-fix2: the registered ratio and Brunner–Munzel estimands are not additive in y, so the
    // changed truth is planted and judged on their own scale. A ratio twin shifts the log-ratio slope
    // (twins stay positive; the log GMR moves by delta times the exposure range). A relative-effect twin
    // pushes the arms apart, away from the observed side, until the relative effect reaches 0 or 1.
    if(design==='ratio'||design==='brunner-munzel'){
      const levels=[...new Set(publicData.x)].sort((u,v)=>u-v);if(levels.length!==2)return fail('two-arm probe refused: the public rows do not have exactly two exposure levels');
      if(design==='ratio'&&publicData.y.some(v=>!(v>0)))return fail('ratio probe refused: a public outcome is not positive');
      const work=design==='ratio'?{...publicData,y:publicData.y.map(Math.log)}:publicData,linear={...claim,estimand:'linear difference',nullValue:0};
      const range=levels[1]!-levels[0]!,fit=linearEntry(linear,work),observedEffect=designEstimate(claim,publicData);
      if(observedEffect===null||fit.estimate===null)return fail('two-arm probe refused: the observed public look has no estimate');
      const resid=residual(work.y,orthogonal([work.x.map(()=>1),work.x])),fitted0=work.y.map((v,j)=>v-resid[j]!-fit.estimate!*work.x[j]!);
      const away=design==='ratio'?(claim.direction==='less'?-1:1):observedEffect>.5?-1:observedEffect<.5?1:claim.direction==='less'?-1:1;
      const delta=away*(design==='ratio'?1:16)*Math.max(1,8*(fit.se??0))*(1+generator(seed)()),pairedSeed=seed+':twin-pair',results=[];
      for(let i=0;i<2;i++){
        const shuffled=nullData({...work,y:resid},'freedman-lane',pairedSeed).y,raw=shuffled.map((e,j)=>fitted0[j]!+e+i*delta*work.x[j]!);
        const sample=roundedSample(publicData,claim,{x:[...publicData.x],y:design==='ratio'?raw.map(Math.exp):raw});
        results.push(await run({index:i,phase:'planted',seed:pairedSeed,...sample,...(run.publicOnlyTwins?{publicShift:i*delta}:{})}));
      }
      const [a,b]=results;if(!a||!b||a.estimate===null||b.estimate===null||!Number.isFinite(a.estimate)||!Number.isFinite(b.estimate))return fail('a changed-truth twin returned no estimate (the worker failed or the twin was refused)');
      if(requireP&&!(validP(a.p)&&validP(b.p)&&Math.abs(b.p-a.p)>=claim.alpha))return fail('the reported p-value did not change between changed-truth twins');
      if(design==='ratio')return a.estimate>0&&b.estimate>0&&Math.abs(Math.log(b.estimate)-Math.log(a.estimate))>=Math.abs(delta)*range*.5||fail('estimate must depend on input: the reported ratio did not move with the planted log-ratio change');
      return a.estimate>=0&&a.estimate<=1&&b.estimate>=0&&b.estimate<=1&&Math.abs(b.estimate-a.estimate)>=.25||fail('estimate must depend on input: the reported relative effect did not move with the planted separation');
    }
    const base=residual(publicData.y,orthogonal([publicData.x.map(()=>1),...modelNuisance(publicData),publicData.x]));
    const observed=linearEntry(claim,publicData);
    const fitted0=publicData.y.map((v,j)=>v-base[j]!-observed.estimate!*publicData.x[j]!);
    const delta=(claim.direction==='less'?-1:1)*16*Math.max(1,8*(observed.se??0))*(1+generator(seed)());
    const results=[];
    // Common random numbers isolate the changed truth from unrelated twin noise. The two
    // outcomes still differ in their seeded treatment shift, while sharing residual draws.
    const pairedSeed=seed+':twin-pair';
    for(let i=0;i<2;i++){
      const shuffled=nullData({...publicData,y:base},'freedman-lane',pairedSeed).y;
      const sample=roundedSample(publicData,claim,{x:[...publicData.x],y:shuffled.map((e,j)=>fitted0[j]!+e+(claim.nullValue+i*delta)*publicData.x[j]!)});
      results.push(await run({index:i,phase:'planted',seed:pairedSeed,...sample,...(run.publicOnlyTwins?{publicShift:i*delta}:{})}));
    }
    const [a,b]=results;
    return !!a&&!!b&&a.estimate!==null&&b.estimate!==null&&(!requireP||validP(a.p)&&validP(b.p)&&Math.abs(b.p-a.p)>=claim.alpha)&&Math.abs(b.estimate-a.estimate)>=Math.abs(delta)*.5||fail('estimate must depend on input: the reported estimate did not move with the planted change');
  }catch(e){return fail(`changed-truth probe unavailable: ${e instanceof Error?e.message:String(e)}`);}
}

/** Coloc is recomputed by trusted code from already harmonised inputs; worker result envelopes
 * are not an input to this producer. */
export { runRegisteredColoc as produceColoc } from './procedure-registry.ts';
