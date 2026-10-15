import { numericAgreement } from './numeric.ts';
import { welchEntry, mlLogisticEntry } from './worker-methods.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { studentP } from './student-tail.ts';
import { studentCritical, linearEntry } from './linear.ts';
import type { ClaimData } from './producers.ts';
import type { PrimaryEntry, PlanClaim } from '../../omb-gauntlet/src/index.ts';

/** B7 only checks inversion identities when the stated p/CI method is Student-Wald.
 * Permutation p-values and bootstrap CIs are not algebraic inverses. */
export function numberConsistency(entry:PrimaryEntry,claim:PlanClaim,df:number):string[] {
  const flags:string[]=[];const {estimate,ci,p,se}=entry;
  if(entry.raw.invalidNumbers)flags.push('malformed reported numbers: '+entry.raw.invalidNumbers);
  if(estimate===null||!Number.isFinite(estimate))flags.push('missing/nonfinite estimate');
  if(se!==null&&(!Number.isFinite(se)||se<0))flags.push('invalid SE');
  if(p!==null&&(!Number.isFinite(p)||p<0||p>1))flags.push('invalid p');
  if(ci&&(!ci.every(Number.isFinite)||ci[0]>ci[1]||estimate!==null&&(estimate<ci[0]||estimate>ci[1])))flags.push('CI excludes its own estimate');
  if(entry.raw.intervalMethod==='log-wald'&&estimate!==null&&ci&&se!==null) {
    if(estimate<=0||ci[0]<=0||ci[1]<=0||se<=0)flags.push('invalid ratio or log-scale SE');
    else if(Math.abs(Math.log(estimate)-(Math.log(ci[0])+Math.log(ci[1]))/2)>1e-6)flags.push('ratio CI geometric-center inconsistency');
  }
  if(entry.raw.intervalMethod==='student-wald'&&estimate!==null&&se!==null&&se>0&&df>0){
    const half=studentCritical(df,claim.alpha)*se,t=(estimate-claim.nullValue)/se,expectedP=studentP(t,df,claim.direction);
    const near=numericAgreement;
    if(ci&&(!near(ci[0],estimate-half)||!near(ci[1],estimate+half)))flags.push('CI/SE inconsistency');
    if(claim.test==='linear'&&p!==null&&!near(p,expectedP))flags.push('p/estimate/SE inconsistency');
  }
  return flags;
}
export function softwareSeed(binding:unknown,claimId:string,stream:string):string { return canonicalSha256([binding,claimId,stream]); }
export interface SeedScan { status:'flagged'|'no-static-finding'; findings:{file:string;line:number;reason:string}[]; limitation:string; }
/** B6 tripwire. A clean scan is NEVER evidence that RNG use is absent (dynamic code can
 * evade static scans). Seeds are host-generated tokens, not values chosen in a worker plan. */
export function scanSeeds(files:Readonly<Record<string,string>>,declaredSoftwareSeeds:readonly string[]):SeedScan {
  const findings:SeedScan['findings']=[];
  const rng=/\b(?:Math\s*\.\s*random|random\s*\.|(?:np|numpy)\s*\.\s*random|numpy\.random|default_rng\s*\(|set\.seed\s*\(|r(?:norm|unif|binom|pois|exp|gamma|beta|chisq|t|f|lnorm|geom|nbinom|multinom|hyper|weibull|cauchy|logis|signrank|wilcox)\s*\(|sample(?:\.int)?\s*\(|torch\s*\.\s*(?:manual_seed|rand\w*)|jax\.random|secrets\s*\.|os\s*\.\s*urandom|PCG64\s*\(|\w+\s*\.\s*rvs\s*\(|make_\w+\s*\(|[Ff]aker\b|s?rand\s*\()|\.Random\.seed/;
  for(const [file,source] of Object.entries(files)){
    const lines=source.split(/\r?\n/);
    const normalized=source.replace(/\s*\.\s*/g,'.');
    const moduleImport=/\b(?:from|import)\s+(?:numpy\.random|random|scipy|sklearn|faker)\b/;
    const candidates=lines.flatMap((line,i)=>!/^\s*(#|\/\/)/.test(line)&&(rng.test(line)||moduleImport.test(line))?[i]:[]);
    if(!candidates.length&&(rng.test(normalized)||moduleImport.test(normalized)))candidates.push(0);
    for(const i of candidates)if(!declaredSoftwareSeeds.some(seed=>lines[i]!.includes(JSON.stringify(seed))))findings.push({file,line:i+1,reason:'RNG use outside a declared software seed; runtime lineage requires review'});
  }
  return {status:findings.length?'flagged':'no-static-finding',findings,limitation:'Static tripwire only; dynamic RNG, subprocesses and encoded code can evade it. No clean-scan pass is awarded.'};
}

/** Declared p methods (trimmed, case-folded). A Map, so prototype keys such as constructor or
 * __proto__ are unknown methods, never Student. */
const P_METHODS:ReadonlyMap<string,'student'|'kernel'|'welch'|'logistic'>=new Map([['student','student'],['student-t','student'],['t-test','student'],['pooled','student'],
  ['kernel','kernel'],['permutation','kernel'],['randomization','kernel'],['randomisation','kernel'],['exact','kernel'],['sign-flip','kernel'],
  ['welch','welch'],['welch-t','welch'],['welch t-test','welch'],['logistic','logistic'],['glm','logistic'],['wald','logistic'],['ml','logistic']]);
const declaredMethod=(declared:unknown)=>declared===undefined?undefined:P_METHODS.get(String(declared).trim().toLowerCase());
const LOGISTIC_ESTIMANDS=new Set(['logistic slope','log odds ratio','odds ratio']);
/** A declared method selects the trusted computation, so it must estimate the locked estimand:
 * Welch/Student estimate an additive difference, ML logistic a (log) odds ratio or slope. The
 * deciding kernel is defined for every supported estimand. */
function methodMatchesEstimand(method:'student'|'kernel'|'welch'|'logistic',claim:PlanClaim):boolean{
  if(method==='kernel')return true;
  return LOGISTIC_ESTIMANDS.has(claim.estimand?.trim().toLowerCase()??'')?method==='logistic':method==='student'||method==='welch';
}
/** Worker p values are verified against their own declared calculation. The
 * deciding randomization p stays separate. Legacy outputs without pMethod may
 * match either reviewed calculation; no unverified p is admitted. An unknown method, or one that
 * does not estimate the claim's estimand, is flagged and never changes the trusted estimate. */
export function workerNumbers(claim:PlanClaim,data:ClaimData,entry:PrimaryEntry,kernel:PrimaryEntry):{numbers:Record<string,number>;flags:string[]} {
  const declared=entry.raw.pMethod;
  const method=declaredMethod(declared);
  const flags=declared!==undefined&&method===undefined?['unsupported p method']:[];
  const usable=method!==undefined&&claim.kind!=='out-of-sample'&&!methodMatchesEstimand(method,claim)?(flags.push('p method does not match the claim estimand'),undefined):method;
  let fit:PrimaryEntry;
  if(claim.kind==='out-of-sample')fit=kernel;
  else if(usable==='welch'||usable==='logistic'){
    try{fit=usable==='welch'?welchEntry(claim,data):mlLogisticEntry(claim,data);}catch{flags.push('p method unavailable for this design');fit=linearEntry(claim,data);}
  }else fit=linearEntry(claim,data);
  const near=(a:number|null,b:number|null)=>a!==null&&b!==null&&numericAgreement(a,b);
  let expected=fit.p;
  const kernelP=usable==='kernel'||declared===undefined&&near(entry.p,kernel.p);
  if(kernelP)expected=kernel.p;
  // Amendment 13: a worker p, SE or CI with no trusted counterpart is stripped (listed as unverified
  // by checkNumbers), never a disagreement; one with a counterpart must agree with it.
  if(entry.p!==null&&expected!==null&&!near(entry.p,expected))flags.push('p disagrees with its recomputed test');
  const df=Number(fit.raw.df);
  // Validate each displayed quantity against full-precision software output.
  // Reconstructing a CI from already rounded estimate/SE compounds display error.
  if(entry.se!==null&&fit.se!==null&&!near(entry.se,fit.se))flags.push('SE disagrees with recomputation');
  if(entry.ci&&fit.ci&&(!near(entry.ci[0],fit.ci[0])||!near(entry.ci[1],fit.ci[1])))flags.push('CI/SE inconsistency');
  const verifiable={...entry,p:expected===null?null:entry.p,se:fit.se===null?null:entry.se,ci:fit.ci?entry.ci:null};
  flags.push(...numberConsistency({...verifiable,raw:{...entry.raw,intervalMethod:'display-checked'}},{...claim,test:'kernel'},df));
  return {numbers:{estimate:fit.estimate!,...(expected===null?{}:{p:expected}),...(fit.se===null?{}:{se:fit.se}),...(fit.nUnits===null?{}:{n_units:fit.nUnits}),...(fit.ci?{'ci.0':fit.ci[0],'ci.1':fit.ci[1]}:{})},flags};
}
const ADDITIVE_ESTIMANDS=new Set(['linear difference','linear slope','mean difference','additive difference','additive slope']);
/** G3 numbers when a registered procedure decided the claim (design section C, brief item 6): the
 * trusted estimate, interval, SE and unit count are the registered procedure's own output, never a
 * legacy linear recomputation. A worker p may still be verified against its own declared calculation
 * for additive estimands (Student/Welch on the same rows); otherwise it is compared with the
 * procedure p. Interval endpoints are trusted only when the decision-rule interval is finite. */
export function registeredNumbers(claim:PlanClaim,data:ClaimData,entry:PrimaryEntry|null,procedure:PrimaryEntry):{numbers:Record<string,number>;flags:string[]} {
  const flags:string[]=[];let p=procedure.p;
  if(entry){
    const declared=entry.raw.pMethod,method=declaredMethod(declared);
    if(declared!==undefined&&method===undefined)flags.push('unsupported p method');
    const usable=method!==undefined&&!methodMatchesEstimand(method,claim)?(flags.push('p method does not match the claim estimand'),undefined):method;
    const near=(a:number|null,b:number|null)=>a!==null&&b!==null&&numericAgreement(a,b),additive=ADDITIVE_ESTIMANDS.has(claim.estimand?.trim().toLowerCase()??'');
    if(usable&&usable!=='kernel'){
      if(!additive)flags.push('p method does not match the registered estimand');
      else try{p=(usable==='welch'?welchEntry(claim,data):usable==='logistic'?mlLogisticEntry(claim,data):linearEntry(claim,data)).p;}catch{flags.push('p method unavailable for this design');}
    }else if(declared===undefined&&additive&&entry.p!==null&&!near(entry.p,procedure.p)){
      // Legacy outputs without pMethod may match either reviewed calculation (B7); no unverified p.
      try{p=linearEntry(claim,data).p;}catch{/* no Student counterpart: compared with the procedure p */}
    }
    if(entry.p!==null&&p!==null&&!near(entry.p,p))flags.push('p disagrees with its recomputed test');
    if(entry.se!==null&&procedure.se!==null&&!near(entry.se,procedure.se))flags.push('SE disagrees with the registered procedure');
    const ci=procedure.ci&&procedure.ci.every(Number.isFinite)?procedure.ci:null;
    if(entry.ci&&ci&&(!near(entry.ci[0],ci[0])||!near(entry.ci[1],ci[1])))flags.push('CI disagrees with the registered decision-rule interval');
    flags.push(...numberConsistency({...entry,p:p===null?null:entry.p,se:procedure.se===null?null:entry.se,ci:ci?entry.ci:null,raw:{...entry.raw,intervalMethod:'display-checked'}},{...claim,test:'kernel'},NaN));
  }
  const ci=procedure.ci&&procedure.ci.every(Number.isFinite)?procedure.ci:null;
  return {numbers:{estimate:procedure.estimate!,...(p===null?{}:{p}),...(procedure.se===null?{}:{se:procedure.se}),...(procedure.nUnits===null?{}:{n_units:procedure.nUnits}),...(ci?{'ci.0':ci[0],'ci.1':ci[1]}:{})},flags};
}
