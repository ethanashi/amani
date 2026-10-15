import { scientificOutcomes } from './scientific-outcome.ts';
import { redactedOutput, redactBlockedOutputs } from './output-redaction.ts';
import { diagnosticTransport, type DiagnosticTransport } from './diagnostic-transport.ts';
import { COLOC_REGISTRATION, COLOC_REGISTRY_HASH } from './procedure-registry.ts';
import { produceColoc } from './producers.ts';
import type { ColocInput } from '../../omb-procedures/src/coloc.ts';
import { certifyProcedureOutputs } from './procedure-diagnostics.ts';
import {buildTrustedIntegrity,type TrustedIntegrity} from "../../omb-investigate/src/integrity.ts";
import {isHardStopKind} from '../../omb-gauntlet/src/routing.ts';
import { capLabel, NOT_SEQUESTERED_LIMITATION, OS_SEPARATION_LIMITATION } from './degraded.ts';
import { osAttestationFault } from './os-attestation.ts';
import { HELD_OUT_PIPELINE_DOMAIN, PIPELINE_EVIDENCE_LIMITATION, pipelineEvidenceFault } from './heldout-evidence.ts';
import { partitionContains, stageWithContract, type ContractHostInput } from './contract-stage.ts';
import { detectContractContradictions, contradictionsForUnits } from './contract-detectors.ts';
import { factGate, produceFact, type FactSpec } from './facts.ts';
import { performanceKernel, performanceRecovery, type PredictionData, type PerformanceSettings } from './performance.ts';
import { numericAgreement } from './numeric.ts';
import { workerNumbers, registeredNumbers, scanSeeds } from './integrity.ts';
import { treeManifest } from './stage.ts';
import { mkdirSync, mkdtempSync, readFileSync, lstatSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { POLICY } from '../../omb-gauntlet/src/policy.ts';
import { limitationLines, certify, parsePlan, parsePrimary, parseReported, planLockHash, isStatistical, renderProse, gateResult,
  meiCap, meiFloor, describeMei, reportedNumbers, entryNumbers, findEntry, readCappedFile, FILE_CAPS, type ClaimedNumber, type PlanClaim, type Plan, type PlanLock, type PrimaryEntry, type PrimaryOutputs, type Certification } from '../../omb-gauntlet/src/index.ts';
import { GateAuthority, SignedGateBoard, outside, type Binding, type SignedGate } from './auth.ts';
import { type StagedInputs } from './stage.ts';
import { OfflineExecutor, freezeCode, type Execution, type FrozenCode } from './execution.ts';
import { bindReported, claimData, dataDependence, confounding, kernelDecision, localGates, nullCalibration, plantedEffect, simulationRunner, signedGates, type SimulationRunner, type ClaimData } from './producers.ts';
import { linearEntry } from './linear.ts';
import type { PermutationResult } from './permutation.ts';
import { canonicalClaim, decisionAlpha, deriveProcedureSeed, resolveRegisteredProcedure, registeredResultWithinEnvelope, runRegisteredProcedure } from './procedure-registry.ts';
import type { ProcedureResult } from '../../omb-procedures/src/index.ts';
import { runConfirm, type ConfirmRequest, type ConfirmResult } from '../../omb-store/src/confirm-runner.ts';
import type { OmbStore } from '../../omb-store/src/store.ts';
export interface ReproductionTarget {
  value:number; tolerance:{abs:number;rel:number};
  table:string; exposure:string; outcome:string; adjustment:readonly string[]; strata:readonly string[];
  nullValue:number; estimand:string; producer?:FactSpec;
}
export interface ProgramMultiplicityDataset {
  outcomeDatasetHash:string;
  /** Includes unrun proposals; null claimId entries consume ordinal and wealth. */
  hypotheses:readonly {claimId:string|null;ordinal:number}[];
  priorRejectionOrdinals:readonly number[];
  alpha:number;
  w0:number;
}
function cardMatches(card:ReproductionTarget,claim:PlanClaim):boolean {
  if(claim.estimand==='deterministic fact'&&(!card.producer||canonicalSha256(card.producer)!==canonicalSha256(claim.knobs.producer??null)))return false;
  if(typeof card.table!=='string'||typeof card.exposure!=='string'||typeof card.outcome!=='string'||typeof card.estimand!=='string'||!Array.isArray(card.adjustment)||!Array.isArray(card.strata)||!Number.isFinite(card.nullValue))return false;
  return canonicalSha256([card.table,card.exposure,card.outcome,card.adjustment,card.strata,card.nullValue,card.estimand])===
    canonicalSha256([claim.knobs.table,claim.exposure,claim.outcome,claim.adjustment,claim.strata,claim.nullValue,claim.estimand]);
}
export interface CertifyRequest {
  workdir:string; rawDir:string; stateRoot:string; executionId:string; lock:PlanLock|null;
  /** Trusted store sequence of the first look, never inferred from worker mtime. */
  firstLookAt:number|null; adopt?:boolean; now:()=>number;
  authority:GateAuthority; executor:OfflineExecutor;
  /** Trusted envelopes from V5/V8 only. The worker mailbox is never used as a gate source. */
  externalGates?:readonly unknown[];
  /** Input identity is required for locked confirmation; code pin is optional. Host supplied. */
  expectedInputHash?:string; expectedCodeHash?:string;
  /** Host-only, never discovered in rawDir/workdir. */
  contract?:ContractHostInput['contract']; expectedContractHash?:string;
  contractVerification?:Omit<ContractHostInput,'contract'|'expectedContractHash'>;
  /** Attested by the host; missing or false caps Confirmed in all modes. */
  osUserSeparation?:boolean;
  maxPermutations?:number; simulations?:boolean;
  /** Trusted task-card reproduction targets, indexed by locked claim id. Never read from worker files. */
  reproductionTargets?:Readonly<Record<string,ReproductionTarget>>;
  simulationFactory?:(claimId:string,data:ClaimData)=>SimulationRunner;
  /** Required trusted program-wide LORD++ state supplied by omb-store for statistical confirmation. */
  programMultiplicity?:readonly ProgramMultiplicityDataset[];
  hypothesisOrdinals?:Readonly<Record<string,number>>;
  /** Trusted two-phase held-out requests, keyed by locked claim ID. `pipelineEvidence` is the
   * host-sealed amendment-11 evidence (see heldout-evidence.ts); without it heldOut:true is withheld. */
  heldOutConfirmations?:Readonly<Record<string,Omit<ConfirmRequest,'store'>&{store:OmbStore;pipelineEvidence?:unknown}>>;
}
export interface CertifiedReport extends Partial<DiagnosticTransport> { integrity?:TrustedIntegrity; jobs:{look:number;rerun:number;simulationRequests:number}; binding:Binding; certification:Certification; gates:SignedGate[]; kernel:Record<string,PermutationResult>; warnings:string[]; report:string;
  procedures:Record<string,ReturnType<typeof resolveRegisteredProcedure>>; procedureResults:Record<string,ProcedureResult>;
  /** Amendment 13: worker numbers with no trusted counterpart, by claim, as "<surface>.<field>" names
   * (claimed = results.json, look/rerun = software-run primary.json). Stripped: never compared, never
   * a disagreement, and their values never appear in a verified field. */
  unverifiedWorkerNumbers:Record<string,string[]>; }
/** Host retries of a held-out result pending persistence (each retry is itself bounded in omb-store). */
const HELD_OUT_PERSISTENCE_RETRIES=3;
/** Nominal program alpha for LORD++ (two-sided .05; α_max = 6.25% is a release bound, not a level). */
const PROGRAM_ALPHA_MAX=.05;
function lordThreshold(index:number,rejections:readonly number[],alpha:number,w0:number):number {
  const gamma=(t:number)=>1/(t*(t+1));
  if(!Number.isSafeInteger(index)||index<1||!(alpha>0&&alpha<1)||!(w0>0&&w0<=alpha)||rejections.some((r,i)=>!Number.isSafeInteger(r)||r<1||r>=index||(i>0&&r<=rejections[i-1]!)))throw new Error('invalid LORD++ state');
  return w0*gamma(index)+rejections.reduce((sum,t,j)=>sum+(j===0?alpha-w0:alpha)*gamma(index-t),0);
}
export function computeProgramMultiplicity(plan:Plan,primary:PrimaryOutputs|null,state:readonly ProgramMultiplicityDataset[]):{gates:ReturnType<typeof gateResult>[];alphas:Record<string,number>;ordinals:Record<string,number>} {
  const gates:ReturnType<typeof gateResult>[]=[],alphas:Record<string,number>={},ordinals:Record<string,number>={};
  for(const claim of plan.claims.filter(c=>isStatistical(c.kind)&&!c.exploratory)){
    const matches=state.flatMap(dataset=>dataset.hypotheses.filter(h=>h.claimId===claim.id).map(h=>({dataset,h})));
    if(matches.length!==1){gates.push(gateResult('G6','failed','program-wide hypothesis ordinal is missing or ambiguous',{claimId:claim.id,code:'hypothesis-not-registered'}));continue;}
    const {dataset,h}=matches[0]!;try{
      if(!/^[a-f0-9]{64}$/.test(dataset.outcomeDatasetHash)||!dataset.hypotheses.some(v=>v.ordinal===h.ordinal)||dataset.hypotheses.some((v,i)=>!Number.isSafeInteger(v.ordinal)||v.ordinal<1||(i>0&&v.ordinal<=dataset.hypotheses[i-1]!.ordinal)))throw new Error('invalid registered hypothesis family');
      // A rejection counts only at a registered ordinal below this claim's (the soundness check: an
      // unregistered rejection would raise LORD++ wealth). Every ordinal 1..N is registered (unrun
      // proposals included). The subset rule runs first so each rule has a case only it catches
      // (K2b-fix2, k2b-fix1-verify new defect "G6 regression coverage").
      if(dataset.priorRejectionOrdinals.some(r=>!dataset.hypotheses.some(v=>v.ordinal===r)||r>=h.ordinal))throw new Error('prior rejection at an unregistered or later ordinal');
      if(dataset.hypotheses.some((v,i)=>v.ordinal!==i+1))throw new Error('registered hypothesis ordinals must be exactly 1..N');
      const p=primary?findEntry(primary,claim.metric,plan.claims.length===1)?.p:null;if(typeof p!=='number'||!Number.isFinite(p)||p<0||p>1)throw new Error('software p-value unavailable');
      if(dataset.alpha>PROGRAM_ALPHA_MAX)throw new Error('program alpha exceeds the owner decision cap');
      // Owner decision: directional claims are decided at one-sided .025 at most (the level K2a
      // calibrated the false-direction bound at), whatever wealth LORD++ has accumulated.
      const lord=lordThreshold(h.ordinal,dataset.priorRejectionOrdinals,dataset.alpha,dataset.w0),threshold=claim.direction==='two-sided'?lord:Math.min(lord,POLICY.directionalAlphaMax);
      alphas[claim.id]=threshold;ordinals[claim.id]=h.ordinal;
      gates.push(gateResult('G6','passed','program-wide LORD++ decision computed from the registered hypothesis sequence',{claimId:claim.id,evidence:{rule:'LORD++',outcomeDatasetHash:dataset.outcomeDatasetHash,hypothesisOrdinal:h.ordinal,registeredHypotheses:dataset.hypotheses.length,registeredOrdinals:dataset.hypotheses.map(v=>v.ordinal),includingUnrun:true,priorRejectionOrdinals:dataset.priorRejectionOrdinals,direction:claim.direction,alpha:dataset.alpha,lordThreshold:lord,threshold,p,adjustedDecision:p<=threshold}}));
    }catch(e){gates.push(gateResult('G6','failed',e instanceof Error?e.message:'program multiplicity state invalid',{claimId:claim.id,code:'invalid-program-multiplicity'}));}
  }
  return {gates,alphas,ordinals};
}
/** A trusted apply prediction. `unit` (a store HMAC of the row's contract floor-unit nodes) and
 * `simpleRule` (the locked simple-rule value of the same row) are integration-patch fields; the
 * current runConfirm returns row tokens, predictions and outcomes only. */
type TrustedPrediction=ConfirmResult['predictions'][number]&{unit?:unknown;simpleRule?:unknown};
const clusterShape=(units:readonly string[])=>[...units.reduce((m,u)=>m.set(u,(m.get(u)??0)+1),new Map<string,number>()).values()].sort((a,b)=>a-b).join(',');
/** Held-out resampling units are contract units, never row-level apply tokens (which hash the row
 * index, so replicate rows would count as independent units). Store floor-unit tokens are used when
 * present and the claim is at the floor; a row token stands for its unit only when every staged row
 * is its own claim unit. Anything else fails closed. The result must reproduce the contract's
 * unit count and cluster-size structure. */
function heldOutUnits(predictions:readonly TrustedPrediction[],contractUnits:readonly string[],claimAtFloor:boolean):string[] {
  const tokens=predictions.map(p=>p.token),storeUnits=predictions.map(p=>p.unit);
  if(new Set(tokens).size!==tokens.length||tokens.some(t=>typeof t!=='string'||!t))throw new Error('held-out apply tokens are missing or repeated');
  let units:string[];
  if(storeUnits.every(u=>typeof u==='string'&&u.length>0)){
    if(!claimAtFloor)throw new Error('held-out store unit tokens are contract floor units; the claim unit is coarser than the floor');
    units=storeUnits as string[];
  }else if(storeUnits.some(u=>u!==undefined))throw new Error('held-out store unit tokens are incomplete or malformed');
  else if(new Set(contractUnits).size===contractUnits.length)units=tokens;
  else throw new Error('held-out apply tokens are row-level and the table has replicate rows per contract unit; store unit tokens are required');
  if(clusterShape(units)!==clusterShape(contractUnits))throw new Error('held-out apply units disagree with the contract unit structure');
  return units;
}
/** The declared simple-rule baseline on the trusted held-out route, joined by apply token. Staged
 * rows are in source order while runConfirm emits a keyed shuffle, so pairing data.rows by position
 * would score the baseline against other units' outcomes. Token-joined store values are used when
 * present; a constant column is order-free; anything else fails closed. */
function heldOutSimpleRule(predictions:readonly TrustedPrediction[],staged:readonly string[]):number[] {
  const values=predictions.map(p=>p.simpleRule);
  if(values.every(v=>v!==undefined))return values.map(v=>typeof v==='number'?v:typeof v==='string'&&v.trim()?Number(v):Number.NaN);
  if(values.some(v=>v!==undefined))throw new Error('held-out simple-rule values are incomplete');
  const numbers=staged.map(v=>v.trim()?Number(v):Number.NaN);
  if(numbers.length&&numbers.every(v=>Number.isFinite(v))&&new Set(numbers).size===1)return predictions.map(()=>numbers[0]!);
  throw new Error('held-out simple-rule baseline cannot be joined to apply tokens (staged order is not apply order); token-joined store values are required');
}
function read(file:string):string|null{try{const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>5_000_000)return null;return readFileSync(file,'utf8');}catch{return null;}}
function json(text:string|null):unknown{try{return text===null?null:JSON.parse(text);}catch{return null;}}
const noExecution=():Execution=>({status:'not-run',reason:'execution unavailable',files:{},snapshot:null,effectiveInputsVerified:false});
/** G3 over every reported number (amendment 13). Each claimed (results.json) and look/rerun
 * (primary.json) number with a trusted software value is compared with it. A number with no trusted
 * counterpart is stripped and listed as an unverified worker number: not compared, not a
 * disagreement. A present-but-unreadable number is a parse failure (a disagreement). Only actual
 * comparisons are counted, and nothing compared never passes. */
export function checkNumbers(trusted:Readonly<Record<string,number>>,claimed:Record<string,ClaimedNumber>|null,
  looks:readonly {role:string;execution:Execution;entry:PrimaryEntry|null}[],equal:(key:string,value:number,expected:number)=>boolean):{compared:number;disagreements:string[];unverified:string[];kernelGrade:'passed'|'failed'|'not-compared';executionGrade:'passed'|'failed'|'not-compared'}{
  const disagreements:string[]=[],unverified:string[]=[],surfaceCompared:Record<string,number>={},surfaceFailed=new Set<string>();let compared=0;
  const check=(label:string,numbers:Record<string,ClaimedNumber>)=>{surfaceCompared[label]??=0;for(const [key,{value}] of Object.entries(numbers)){
    const expected=trusted[key];
    if(!Number.isFinite(value)){disagreements.push(`${label}.${key}`);surfaceFailed.add(label);}
    else if(expected===undefined)unverified.push(`${label}.${key}`);
    else{compared++;surfaceCompared[label]!++;if(!equal(key,value,expected)){disagreements.push(`${label}.${key}`);surfaceFailed.add(label);}}
  }};
  if(claimed===null){disagreements.push('claimed.unreadable');surfaceFailed.add('claimed');}else check('claimed',claimed);
  for(const {role,execution,entry} of looks){
    if(execution.status!=='ok'){disagreements.push(role+'.execution');surfaceFailed.add(role);}
    if(entry?.estimate==null){disagreements.push(role+'.estimate');surfaceFailed.add(role);}
    if(entry)check(role,reportedNumbers(entry));
  }
  if(compared===0)disagreements.push('nothing-compared');
  const grade=(labels:readonly string[]):'passed'|'failed'|'not-compared'=>{const n=labels.reduce((s,k)=>s+(surfaceCompared[k]??0),0);return labels.some(k=>surfaceFailed.has(k))?'failed':n===0?'not-compared':'passed';};
  return {compared,disagreements,unverified,kernelGrade:grade(['claimed']),executionGrade:grade(['look','rerun'])};
}
function numbersGates(gates:import('../../omb-gauntlet/src/index.ts').GateResult[],claimId:string,checked:{compared:number;disagreements:string[];unverified:string[];kernelGrade?:string;executionGrade?:string},trustedSource:string,strataAdjusted:boolean):void{
  const {compared,disagreements,unverified}=checked,ok=disagreements.length===0;
  // Names only: an unverified worker value never enters a signed gate.
  const stripped=unverified.length?`; ${unverified.length} unverified worker number(s) stripped`:'';
  for(let i=0;i<gates.length;i++){
    const existing=gates[i]!;if(existing.claimId!==claimId||existing.gate!=='G3'&&existing.gate!=='G4')continue;
    const g=existing.gate==='G3'?gateResult('G3','passed',`${compared} reported number(s) equal the ${trustedSource}${stripped}`,{claimId,evidence:{compared,mismatched:[],missingRecomputed:[],trustedSource,kernelGrade:checked.kernelGrade??'not-compared',executionGrade:checked.executionGrade??'not-compared',corroboratedSurfaces:['claimed','look','rerun'].filter(k=>!disagreements.some(d=>d.startsWith(k+'.'))),relCap:1e-8,displayPrecisionCap:0.005,minimumSignificantDigits:3,kernelRelativeTolerance:1e-8,strataAdjusted}})
      :gateResult('G4','passed','both looks agree with full-precision trusted computation',{claimId,evidence:{classification:'reproduced',reruns:1,rel:1e-8,trustedComputation:true,trustedSource,kernelRelativeTolerance:1e-8,displayPrecisionCap:0.005,minimumSignificantDigits:3}});
    gates[i]={...g,outcome:ok?g.outcome:'failed',summary:ok?g.summary:'worker numbers disagree with trusted look computation',evidence:{...g.evidence,kernelAgreement:ok,kernelDisagreements:disagreements,unverifiedWorkerNumbers:unverified}};
  }
}
/** Host entry point. Scientific/malformed/unavailable results still write a report. Only
 * positively observed trusted-path mutation voids claims; missing evidence never passes. */
export async function certifyDirectory(request:CertifyRequest):Promise<CertifiedReport>{
  mkdirSync(request.stateRoot,{recursive:true,mode:0o700});
  if(!outside(request.stateRoot,request.workdir)||!outside(request.workdir,request.stateRoot))throw new Error('host state and worker scopes must be disjoint');
  for(const grant of [...request.executor.options.runtimeRoots,...request.executor.options.toolPath.split(path.delimiter)]){
    if(!outside(request.stateRoot,grant)||!outside(request.workdir,grant)||!outside(request.rawDir,grant))throw new Error('runtime grants overlap authority or worker inputs');
  }
  const job=mkdtempSync(path.join(request.stateRoot,'job-')),warnings:string[]=[],hardStops:string[]=[];
  // Run-wide floor from the trusted host. Held-out results may only LOWER it (monotone): no store
  // result or attestation callback ever raises it, for its own claim or for any other claim.
  let osSeparated=request.osUserSeparation===true;
  const lowerSeparation=(claimId:string,reason:string)=>{if(osSeparated)warnings.push(`${claimId}: ${reason}; OS-user separation not established, every claim is capped at Tentative`);osSeparated=false;};
  // Per-claim caps (held-out evidence a claim lacks). Only ever added to, never removed.
  const claimCaps=new Map<string,string[]>();
  const capClaim=(claimId:string,limitation:string)=>{const list=claimCaps.get(claimId)??[];if(!list.includes(limitation))list.push(limitation);claimCaps.set(claimId,list);};
  const parsed=parsePlan(read(path.join(request.workdir,'plan.json'))), originalPlan=parsed.plan;
  warnings.push(...parsed.issues.map(i=>i.message));
  if(request.lock!==null&&originalPlan&&(!originalPlan.plainStatement||originalPlan.paperSet===undefined)){
    warnings.push('plan-refused: locked plan requires plain_statement and paper_set');for(const c of originalPlan.claims)capClaim(c.id,'plan-refused: locked plan context incomplete');
  }
  const adopted=request.adopt===true||request.lock===null;
  const trustedInputs=adopted||!!request.expectedInputHash&&outside(request.rawDir,request.workdir)&&outside(request.workdir,request.rawDir);
  if(!trustedInputs)warnings.push('confirmatory inputs require a host hash pin and a raw directory disjoint from worker scope');
  if(adopted)warnings.push('adopted inputs and plan are exploratory; source provenance is not established');
  const plan:Plan|null=originalPlan?{...originalPlan,claims:originalPlan.claims.map(c=>{
    // Refutation, planting and G7 use the locked MEI capped by software policy; materiality uses the
    // locked MEI raised to the registered floor (owner MEI policy, kernel v3 2026-10-12: a locked plan
    // may declare a larger MEI, never a smaller one). Both are on the estimand's MEI scale (the log
    // scale for a geometric-mean ratio). A smaller locked MEI only tightens refutation and planting.
    const cap=meiCap(c.estimand),floor=meiFloor(c.estimand),mei=cap===null||c.mei===null?null:Math.min(c.mei,cap);
    const materialMei=c.mei===null||floor===null?c.mei:Math.max(c.mei,floor);
    if(c.mei!==null&&mei!==c.mei)warnings.push(`${c.id}: MEI tightened by software policy to ${mei===null?'unavailable':describeMei(c.estimand,mei)}`);
    if(materialMei!==c.mei)warnings.push(`${c.id}: locked MEI ${describeMei(c.estimand,c.mei)} is below the registered minimum effect of interest ${describeMei(c.estimand,floor)}; materiality is judged at the registered minimum`);
    const card=request.reproductionTargets?.[c.id];
    const valid=card&&cardMatches(card,c)&&Number.isFinite(card.value)&&Number.isFinite(card.tolerance.abs)&&card.tolerance.abs>=0&&Number.isFinite(card.tolerance.rel)&&card.tolerance.rel>=0;
    const declared=c.target?.tolerance,allowed=valid?Math.min(Math.max(card.tolerance.abs,card.tolerance.rel*Math.abs(card.value)),declared?Math.max(declared.abs,declared.rel*Math.abs(card.value)):Infinity):0;
    // Decisions, materiality and planted truths use the registered procedure's null scale.
    return canonicalClaim({...c,metric:c.id,mei,materialMei,exploratory:adopted||!trustedInputs||c.exploratory,target:c.kind==='reproduction'?(valid?{value:card.value,tolerance:{abs:allowed,rel:0}}:null):c.target});
  })}:null;
  // One parser, alias table and key folding for primary.json and results.json (gauntlet). Missing is
  // absent; a refused file (symlink or not regular, over the cap, unreadable) is invalid: G3 fails closed.
  const resultsRead=readCappedFile(path.join(request.workdir,'results.json'),FILE_CAPS.results);
  const reported=bindReported(parseReported(resultsRead.status==='read'?resultsRead.text:resultsRead.status==='refused'?{refused:resultsRead.reason}:null),originalPlan);
  if(resultsRead.status==='refused')warnings.push(`results.json refused (${resultsRead.reason}); claimed numbers fail G3 closed`);
  else if(reported.invalid)warnings.push('results.json is unreadable, ambiguous or has a claim that cannot be bound; claimed numbers fail G3 closed');
  const unverifiedWorkerNumbers:Record<string,string[]>={};
  const recordUnverified=(claimId:string,checked:{unverified:string[]})=>{if(!checked.unverified.length)return;unverifiedWorkerNumbers[claimId]=checked.unverified;
    warnings.push(`${claimId}: unverified worker numbers (no software computation; stripped, not verified): ${checked.unverified.join(', ')}`);};


  const scientificLimitations=new Map<string,string[]>(), procedures:Record<string,ReturnType<typeof resolveRegisteredProcedure>>={},procedureResults:Record<string,ProcedureResult>={};
  const kernel:Record<string,PermutationResult>={}, modelBased=new Set<string>(),jobs={look:0,rerun:0,simulationRequests:0};
  const counted=(run:SimulationRunner):SimulationRunner=>Object.assign(async(sample:Parameters<SimulationRunner>[0])=>{jobs.simulationRequests++;return run(sample);},
    run.publicOnlyTwins?{publicOnlyTwins:true as const}:{});
  let staged:StagedInputs|null=null,frozen:FrozenCode|null=null,first=noExecution(),rerun=noExecution();
  let primary:PrimaryOutputs|null=null;
  try{
    const contractIntent=request.contract!==undefined||request.expectedContractHash!==undefined||request.contractVerification!==undefined;
    try{staged=stageWithContract(request.rawDir,path.join(job,'contract-stage'),request.contract?{...request.contractVerification,contract:request.contract,
      expectedContractHash:request.expectedContractHash??'',tokenKey:request.authority.deriveKey('omb-public-unit-token-root/v1')}:undefined,contractIntent&&!request.contract);}catch(e){warnings.push(`staging unavailable: ${e instanceof Error?e.message:String(e)}`);}
    if(Array.isArray(staged?.gate.evidence.warnings))warnings.push(...staged.gate.evidence.warnings.filter((w):w is string=>typeof w==='string'));
    try{frozen=freezeCode(request.workdir,path.join(job,'frozen'));}catch(e){warnings.push(`code freeze unavailable: ${e instanceof Error?e.message:String(e)}`);}
    const binding:Binding={planHash:originalPlan?planLockHash(originalPlan):canonicalSha256(null),inputManifestHash:staged?.inputManifestHash??canonicalSha256(null),frozenCodeHash:frozen?.hash??canonicalSha256(null),executionId:request.executionId,...(staged?.verifiedContract?{contractHash:staged.verifiedContract.contract.public.hash,partitionHash:staged.verifiedContract.partitionHash,privateContractHash:staged.verifiedContract.contract.sealed_private?.hash??null}: {})};
    if(request.expectedInputHash&&request.expectedInputHash!==binding.inputManifestHash&&staged)hardStops.push('trusted-path-changed');
    if(request.expectedCodeHash&&request.expectedCodeHash!==binding.frozenCodeHash&&frozen)hardStops.push('trusted-path-changed');
    const performanceIdentity={planHash:binding.planHash,contractHash:binding.contractHash??canonicalSha256(null),inputHash:binding.inputManifestHash,codeHash:binding.frozenCodeHash};
    const softwareSeeds=Object.fromEntries((originalPlan?.claims??[]).map(c=>{
      let procedureId='unregistered';try{if(staged)procedureId=resolveRegisteredProcedure(canonicalClaim(c),claimData(staged,c))?.procedureId??procedureId;}catch{/* unavailable design binds to the explicit unregistered domain */}
      return [c.id,deriveProcedureSeed({planHash:binding.planHash,contractHash:binding.contractHash??null,inputHash:binding.inputManifestHash,codeHash:binding.frozenCodeHash},procedureId,c.id,'executor')];
    }));
    if((!contractIntent||staged?.verifiedContract)&&staged&&frozen&&!warnings.some(w=>w.startsWith('plan-refused:'))&&!hardStops.length){jobs.look++;first=await request.executor.run(frozen,staged,'all',undefined,softwareSeeds);if(!first.trustedChange){jobs.rerun++;rerun=await request.executor.run(frozen,staged,'all',undefined,softwareSeeds);}}
    for(const execution of [first,rerun])if(execution.status!=='ok'){warnings.push(execution.reason);if(execution.trustedChange===true)hardStops.push('trusted-path-changed');}
    primary=parsePrimary(first.files['primary.json']??null).primary;
    const gates=localGates({plan:originalPlan,lock:adopted?null:request.lock,firstLookAt:request.firstLookAt,staged,first,rerun,script:read(path.join(request.workdir,'run_all.sh')),reported});
    const analysisUnits:Record<string,string[]>={};
    const detectorReport=staged?.verifiedContract?detectContractContradictions(staged.verifiedContract):null;
    const entries=new Map<string,import('../../omb-gauntlet/src/index.ts').PrimaryEntry>();
    if(frozen){const sources=Object.fromEntries(Object.keys(treeManifest(frozen.directory)).map(f=>[f,readFileSync(path.join(frozen!.directory,f),'utf8')]));const scan=scanSeeds(sources,Object.values(softwareSeeds));warnings.push(...scan.findings.map(f=>`B6 ${f.file}:${f.line}: ${f.reason}`));}
    for(const claim of originalPlan?.claims??[])if(claim.kind==='data-integrity'&&claim.knobs.producer&&staged)gates.push(factGate(staged,claim));
    for(const lockedClaim of originalPlan?.claims??[]){
      if(!isStatistical(lockedClaim.kind)&&lockedClaim.kind!=='reproduction')continue;
      // The locked claim (bound by planHash) on the registered procedure's null scale.
      const claim=canonicalClaim(lockedClaim),effective=plan!.claims.find(c=>c.id===claim.id)!;

      try{
        if(Object.keys(originalPlan!.knobs).length)throw new Error('unsupported plan-level knob; kernel cannot reinterpret it');
        if(!trustedInputs)throw new Error('untrusted input identity or worker raw scope');
        if(hardStops.length)throw new Error('trusted identity changed; computation voided');
        if(!staged||!frozen)throw new Error('staged inputs or frozen code unavailable');
        if(claim.kind==='reproduction'&&!effective.target)throw new Error('trusted task-card estimand match and target required for reproduction');
        if(claim.kind==='reproduction'&&claim.estimand==='deterministic fact') {
          const fact=produceFact(staged,claim.knobs.producer as unknown as FactSpec);
          const entry={key:claim.id,estimate:fact.value,p:null,ci:null,se:null,nUnits:null,raw:{}};
          entries.set(claim.id,entry);
          // Software computes the predicate and the claim table's effective unit count, nothing else.
          // A reported p, SE or CI has no trusted counterpart: stripped and listed (amendment 13).
          const table=String(claim.knobs.table),trusted={estimate:fact.value,n_units:(staged.tableUnits?.[table]??staged.units).length};
          const looks=([['look',first],['rerun',rerun]] as const).map(([role,execution])=>({role,execution,entry:findEntry(parsePrimary(execution.files['primary.json']??null).primary,claim.metric,originalPlan!.claims.length===1)}));
          const checked=checkNumbers(trusted,reported.claimed(claim),looks,(_key,value,expected)=>value===expected);
          numbersGates(gates,claim.id,checked,'registered deterministic fact computation',false);recordUnverified(claim.id,checked);
          gates.push(gateResult('G5b-recovery','not-applicable','deterministic recomputation has no sampling recovery question',{claimId:claim.id,evidence:{deterministicRecomputation:true,producer:'registered-fact-v1'}}));
          continue;
        }
        const data=claimData(staged,claim);
        if(claim.kind!=="out-of-sample")analysisUnits[claim.id]=[...new Set(data.units)];
        const registered=resolveRegisteredProcedure(claim,data);
        const calibrationProcedure=registered?.withinEnvelope&&registered.diagnosticsPassed?registered:null;
        const contentSeed=deriveProcedureSeed({planHash:binding.planHash,contractHash:binding.contractHash??null,inputHash:binding.inputManifestHash,codeHash:binding.frozenCodeHash},registered?.procedureId??'unregistered',claim.id,'claim-simulation');
        procedures[claim.id]=registered;
        gates.push(registered===null
          ?gateResult('G5c','failed','no registered procedure matches the locked estimand and observed design',{claimId:claim.id,code:'no-match'})
          :gateResult('G5c',registered.withinEnvelope&&registered.diagnosticsPassed?'passed':'failed',registered.limitation??'registered procedure and validity diagnostics passed',{claimId:claim.id,code:registered.withinEnvelope&&registered.diagnosticsPassed?'registered':'outside-envelope',evidence:{procedureId:registered.procedureId,registryVersion:registered.registryVersion,registryHash:registered.registryHash,registered:true,withinEnvelope:registered.withinEnvelope,diagnosticsPassed:registered.diagnosticsPassed,design:registered.design,envelope:registered.envelope}}));
        let result:PermutationResult;
    let performanceJob:{data:PredictionData;settings:PerformanceSettings}|null=null;
        if(claim.kind==='out-of-sample') {
          if(claim.strata.length||claim.adjustment.length)throw new Error('performance strata and adjustment are not implemented');
          const config=claim.knobs.performance as unknown as PerformanceSettings & {simpleRuleColumn:string;trainingTable:string;trainingPrevalence:number};
          if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(k=>!['metric','thresholds','bins','bootstrapDraws','threshold','monteCarlo','simpleRuleColumn','trainingTable','trainingPrevalence'].includes(k)))throw new Error('locked performance configuration required; unknown settings are not executed');
          if(claim.test!=='paired prediction permutation')throw new Error('held-out performance requires paired prediction permutation; whole-pipeline CV not provided');
          const col=data.header.indexOf(config.simpleRuleColumn);
          if(col<0)throw new Error('declared simple-rule probabilities missing');
          if(claim.estimand!==`${config.metric==='net-benefit'?'net benefit':config.metric} improvement`)throw new Error('performance estimand must name improvement in the locked metric');
          // K1 owns partition selection: trainingTable and worker splits cannot choose dev units.
          const vc=staged.verifiedContract!;
          const heldTable=[...vc.tables.values()].find(t=>t.definition.file.path===data.file)!;
          const claimLevel=claim.unit==='unit_id'?vc.resolver.hierarchy.floor!:claim.unit!;
          const candidates=[...vc.tables.values()].filter(t=>t.definition.orientation.unit_axis==='rows'&&t.definition.file.path!==data.file&&t.header.includes(claim.outcome!)&&vc.partitions.some(p=>
            partitionContains(vc,p,heldTable.units,'held-out',claimLevel)&&partitionContains(vc,p,t.units,'dev',claimLevel)));
          if(candidates.length!==1)throw new Error('unambiguous contract dev table required');
          const train=claimData(staged,{...claim,knobs:{table:candidates[0]!.definition.file.path},exposure:claim.outcome,outcome:claim.outcome,adjustment:[],strata:[]});
          if(!train.y.every(y=>y===0||y===1)||Math.abs(train.y.reduce<number>((s,y)=>s+y,0)/train.y.length-config.trainingPrevalence)>1e-12)throw new Error('baseline prevalence differs from trusted training outcomes');
          let performanceUnits=data.units,performanceOutcome=data.y,performancePredictions=data.x,performanceSimpleRule=data.rows.map(r=>Number(r[col])),trustedHeldOut=false,heldOutProvenance:string|undefined;
          const heldOut=request.heldOutConfirmations?.[claim.id];
          if(heldOut){
            if(heldOut.tuple.planLockHash!==binding.planHash||heldOut.tuple.contractHash!==binding.contractHash||heldOut.tuple.frozenCodeHash!==binding.frozenCodeHash||heldOut.tuple.dataHash!==binding.inputManifestHash)throw new Error('held-out store tuple differs from the locked plan, contract, code or input hashes');
            const {pipelineEvidence,...confirmRequest}=heldOut;
            let applied:ConfirmResult;
            try{applied=await runConfirm(confirmRequest);}catch(e){lowerSeparation(claim.id,'held-out apply threw before reporting separation');throw e;}
            // K2b-fix2: a validated result whose store write hit a transient error is retried on the
            // host (the same validated bytes; apply never runs again), a bounded number of times.
            for(let attempt=0;applied.status==='persistence-pending'&&typeof applied.retryPersistence==='function'&&attempt<HELD_OUT_PERSISTENCE_RETRIES;attempt++){
              try{applied=await applied.retryPersistence();}catch(e){lowerSeparation(claim.id,'held-out persistence retry threw');throw e;}
            }
            // Checked before the status check: a failed or refused apply also lowers the flag. A result
            // still pending persistence was validated and reports its own separation fields; it fails
            // this claim below but is not evidence of a degraded host.
            if(applied.status!=='completed'&&applied.status!=='persistence-pending'||applied.separation!=='OS-user separation'||applied.claimCeiling!=='requires-certification')lowerSeparation(claim.id,'held-out store result has no OS-user separation or a Tentative ceiling');
            // The attestation is a callback: verify it against the real OS before it counts.
            const attestationFault=osAttestationFault(heldOut.mode,heldOut.store);
            if(attestationFault!==null)lowerSeparation(claim.id,`held-out attestation not verified against the OS (${attestationFault})`);
            if(applied.status==='persistence-pending')throw new Error(`held-out result still pending persistence after ${HELD_OUT_PERSISTENCE_RETRIES} host retries; the look is spent and this claim is not certified`);
            if(applied.status!=='completed'||applied.predictions.length!==data.y.length)throw new Error(applied.limitation??'trusted held-out apply unavailable');
            // Owner decision: without logged no-egress proof the held-out look is "internal, not
            // sequestered" and the claim stays Tentative; heldOut:true is withheld from G9.
            const sequestered=applied.sequestration==='eligible-for-sequestered-checks'&&applied.curatedEligible===true;
            if(!sequestered){capClaim(claim.id,NOT_SEQUESTERED_LIMITATION);warnings.push(`${claim.id}: held-out apply is internal, not sequestered (no logged no-egress proof for training and apply); capped at Tentative`);}
            // Checked at the level the claim is decided at (one-sided .025 for a directional claim),
            // never the locked alpha (K2b-fix2, k2b-fix1-verify new defect "amendment-11 alpha").
            const pipelineFault=pipelineEvidenceFault(request.authority.verifyEvidence(pipelineEvidence,HELD_OUT_PIPELINE_DOMAIN,binding,claim.id),decisionAlpha(claim));
            if(pipelineFault!==null){capClaim(claim.id,PIPELINE_EVIDENCE_LIMITATION);warnings.push(`${claim.id}: amendment-11 held-out evidence unavailable (${pipelineFault}); capped at Tentative`);}
            trustedHeldOut=sequestered&&pipelineFault===null;
            if(!trustedHeldOut)heldOutProvenance=`trusted omb-store runConfirm application; heldOut withheld: ${[sequestered?null:'internal, not sequestered',pipelineFault].filter(v=>v!==null).join('; ')}`;
            performanceUnits=heldOutUnits(applied.predictions,data.units,claimLevel===vc.resolver.hierarchy.floor);performanceOutcome=applied.predictions.map(p=>Number(p.outcome));performancePredictions=applied.predictions.map(p=>p.prediction);
            if(performanceOutcome.some(v=>!Number.isFinite(v)))throw new Error('held-out outcomes are nonnumeric');
            performanceSimpleRule=heldOutSimpleRule(applied.predictions,data.rows.map(r=>r[col]!));
          }
          performanceJob={data:{units:performanceUnits,outcome:performanceOutcome,probability:performancePredictions,simpleRule:performanceSimpleRule,trainingUnits:[...new Set(train.units)],trainingPrevalence:config.trainingPrevalence,trustedHeldOut,...(heldOutProvenance?{heldOutProvenance}:{})},settings:config};
          // Content-derived seeds (amendment 6): the execution ID never enters a random stream.
          const pack=performanceKernel(claim,performanceJob.data,config,deriveProcedureSeed(performanceIdentity,'performance',claim.id,'performance-kernel'));
          entries.set(claim.id,pack.entry);gates.push(pack.gate);
          if(!heldOut)warnings.push(`${claim.id}: external prediction columns are unverified; no trusted held-out apply artifact or B22 test-unit influence proof`);
          gates.push(gateResult('G1c','passed','frozen held-out prediction comparison; no causal effect claimed',{claimId:claim.id,evidence:{aligned:[],strong:[],unhandled:[],insufficient:[],jointStatus:'estimable',threshold:.5}}));
          result={status:pack.entry.p!<=claim.alpha?'reject':'retain',p:pack.entry.p,pLower:pack.entry.p!,pUpper:pack.entry.p!,evaluated:1,total:'performance',extreme:0,estimate:pack.entry.estimate!,statistic:pack.entry.estimate!,scheme:'labels',alpha:claim.alpha,guarantee:'exact under exchangeability',stopping:'monte-carlo-fixed'};
        }else {
          gates.push(confounding(claim,data));
          // Runs the registered procedure as the claim's trusted computation. `descriptive`: the claim is
          // outside the envelope (G5c stays failed), so the result is reported without a validated bound.
          const runRegistered=(reg:NonNullable<typeof registered>,descriptive:boolean):PermutationResult=>{
            let procedureResult:ProcedureResult;
            try{procedureResult=runRegisteredProcedure(reg,claim,data,{planHash:binding.planHash,contractHash:binding.contractHash??canonicalSha256(null),inputHash:binding.inputManifestHash,codeHash:binding.frozenCodeHash},request.maxPermutations??9_999);}
            catch(e){const gi=gates.findIndex(v=>v.gate==='G5c'&&v.claimId===claim.id);if(gi>=0)gates[gi]=gateResult('G5c','failed',e instanceof Error?e.message:'registered procedure execution unavailable',{claimId:claim.id,code:'procedure-execution-refused',evidence:{procedureId:reg.procedureId,registryVersion:reg.registryVersion,registryHash:reg.registryHash,registered:true,withinEnvelope:reg.withinEnvelope,diagnosticsPassed:reg.diagnosticsPassed}});throw e;}
            const diagnosticCertificate=certifyProcedureOutputs(reg,procedureResult,
              {estimate:procedureResult.estimate,p:procedureResult.p,ci:procedureResult.ci,[claim.kind]:true},
              ['estimate','p','ci',claim.kind]);
            if(diagnosticCertificate.status==='refused'||['estimate','p','ci',claim.kind].some(field=>diagnosticCertificate.blocked.some(block=>field===block||field.startsWith(block+'.')||block.startsWith(field+'.')))) procedureResult={...procedureResult,status:'refused',
              refusal:`procedure diagnostics block: ${diagnosticCertificate.refused.join(', ')}`};
            procedureResults[claim.id]=procedureResult;
            if(procedureResult.status==='refused'){
              const g=gates.findIndex(v=>v.gate==='G5c'&&v.claimId===claim.id);if(g>=0)gates[g]=gateResult('G5c','failed',procedureResult.refusal??'registered procedure refused the data',{claimId:claim.id,code:'validity-refusal',evidence:{procedureId:reg.procedureId,registryVersion:reg.registryVersion,registryHash:reg.registryHash,registered:true,withinEnvelope:reg.withinEnvelope,diagnosticsPassed:false}});
              throw new Error(procedureResult.refusal??'registered procedure refused the data');
            }
            if(!descriptive&&!registeredResultWithinEnvelope(reg,claim,data,procedureResult)){
              const limitation=reg.design==='regression'?'registered HC2/Bell–McCaffrey degrees of freedom or binary exposure minimum is outside the calibrated envelope':'registered procedure result is outside its calibrated envelope';
              procedures[claim.id]={...reg,withinEnvelope:false,limitation};
              const g=gates.findIndex(v=>v.gate==='G5c'&&v.claimId===claim.id);if(g>=0)gates[g]=gateResult('G5c','failed',limitation,{claimId:claim.id,code:'outside-executed-envelope',evidence:{procedureId:reg.procedureId,registryVersion:reg.registryVersion,registryHash:reg.registryHash,registered:true,withinEnvelope:false,diagnosticsPassed:true,design:reg.design,envelope:{...reg.envelope,...procedureResult.envelope,...procedureResult.components}}});
            }
            const p=procedureResult.p;
            // n is the number of independent units the procedure resampled (paired and crossover
            // designs carry several rows per unit).
            entries.set(claim.id,{key:claim.id,estimate:procedureResult.estimate,p,ci:procedureResult.ci,se:typeof procedureResult.components.se==='number'?procedureResult.components.se:null,nUnits:new Set(data.units).size,raw:{procedureId:procedureResult.procedure,...procedureResult.components}});
            return {status:p<=decisionAlpha(claim)?'reject':'retain',p,pLower:p,pUpper:p,evaluated:Number(procedureResult.components.permDraws??procedureResult.components.flipDraws??1),total:String(procedureResult.components.permDraws??procedureResult.components.flipDraws??1),extreme:0,estimate:procedureResult.estimate,statistic:Number(procedureResult.components.t??procedureResult.components.tT??0),scheme:'labels',alpha:decisionAlpha(claim),guarantee:procedureResult.procedure,stopping:'monte-carlo-fixed',decisionP:p};
          };
          if(registered&&registered.withinEnvelope&&registered.diagnosticsPassed)result=runRegistered(registered,false);
          else {
            let legacy:PermutationResult|null=null,legacyError:unknown=null;
            try{legacy=kernelDecision(claim,data,softwareSeeds[claim.id]!,request.maxPermutations);}catch(e){legacyError=e;}
            if(legacy){
              result=legacy;
              const computed=linearEntry(claim,data);
              entries.set(claim.id,{...computed,key:claim.id,p:result.status==='unresolved'?null:result.decisionP??result.p??result.pUpper,estimate:result.estimate});
            }else if(registered&&registered.diagnosticsPassed&&!registered.structural){
              // K2b-fix2: the legacy kernel cannot compute this registered design, and the claim is
              // outside its envelope only for envelope size or allocation (no structural defect), so
              // the registered procedure supplies trusted numbers descriptively. G5c stays failed:
              // Tentative at most, and no validated bound is stamped.
              result=runRegistered(registered,true);
            }else{
              // A matched registered procedure that is outside its envelope stays the claim's primary
              // reason when the legacy kernel cannot compute these rows.
              const message=legacyError instanceof Error?legacyError.message:String(legacyError);
              throw registered?new Error(`outside the registered envelope (${registered.limitation??'validity diagnostics refused'}); legacy kernel unavailable: ${message}`):legacyError;
            }
          }
        }
        // The registry guarantee is stamped only when the registered procedure decided the claim inside
        // its envelope (G5c passed). Otherwise the deciding kernel keeps its own guarantee, so a
        // legacy model-based disclosure is never replaced by a validated-bound claim.
        const g5cPassed=gates.find(g=>g.gate==='G5c'&&g.claimId===claim.id)?.outcome==='passed';
        if(registered&&procedureResults[claim.id]?.status==='ok'&&result.status!=='unresolved')
          result={...result,guarantee:g5cPassed?registered.guarantee:'registered procedure result outside its calibrated envelope; no validated bound'};
        kernel[claim.id]=result;

        if(result.guarantee.startsWith('model-based'))modelBased.add(claim.id);
        // Bind both worker surfaces to the actual look, irrespective of role recognition.
        // Worker intervals never drive decisions; any reported interval must match software.
        const kernelEntry=entries.get(claim.id)!;
        const looks=([['look',first],['rerun',rerun]] as const).map(([role,execution])=>({role,execution,entry:findEntry(parsePrimary(execution.files['primary.json']??null).primary,claim.metric,originalPlan!.claims.length===1)}));
        const lookEntry=looks[0]!.entry;
        // A registered procedure that decided the claim is also G3's trusted computation.
        const registeredRan=procedureResults[claim.id]?.status==='ok';
        const numbersFor=(entry:PrimaryEntry|null)=>registeredRan?registeredNumbers(claim,data,entry,kernelEntry):entry?workerNumbers(claim,data,entry,kernelEntry):{numbers:entryNumbers(kernelEntry)!,flags:[]};
        const trusted=numbersFor(lookEntry).numbers;
        const checked=checkNumbers(trusted,reported.claimed(claim),looks,(key,value,expected)=>key==='n_units'?value===expected:numericAgreement(value,expected));
        for(const {role,entry} of looks)if(entry)checked.disagreements.push(...numbersFor(entry).flags.map(flag=>role+'.B7:'+flag));
        numbersGates(gates,claim.id,checked,'trusted software computation',claim.strata.length>0);recordUnverified(claim.id,checked);
        if(claim.kind==='out-of-sample') {
          const skillRan=Boolean(gates.find(g=>g.gate==='G9'&&g.claimId===claim.id)?.evidence.skill);
          gates.push(gateResult('G5a',skillRan?'passed':'not-run',skillRan?'trusted fixed prediction-pair randomization kernel':'event support unavailable; skill randomization did not run',{claimId:claim.id,evidence:{ruleVersion:'prediction-pair-v1',kernelExecuted:skillRan,alpha:claim.alpha}}));
          if(request.simulations!==false&&performanceJob)gates.push(...performanceRecovery(effective,performanceJob.data,performanceJob.settings,deriveProcedureSeed(performanceIdentity,'performance',claim.id,'performance-recovery')));
          continue;
        }
        const program=counted(request.simulationFactory?.(claim.id,data)??simulationRunner(request.executor,frozen,staged,claim,data));
        // A failed or refused probe records why (K2b-fix2) instead of a bare failure.
        let probeReason:string|null=null;
        const dependent=await dataDependence(claim,data,program,contentSeed+':dependence',false,reason=>{probeReason??=reason;}),g3=gates.findIndex(g=>g.gate==='G3'&&g.claimId===claim.id);
        if(g3>=0)gates[g3]={...gates[g3]!,outcome:dependent?gates[g3]!.outcome:'failed',summary:dependent?gates[g3]!.summary:`changed-truth probe failed: ${probeReason??'estimate must depend on input'}`,evidence:{...gates[g3]!.evidence,dataDependence:dependent,...(dependent?{}:{dataDependenceReason:probeReason??'estimate must depend on input'})}};
        if(request.simulations!==false&&calibrationProcedure){
          // A locked worker-test name never waives calibration. Registered designs calibrate
          // the actual procedure implementation that supplies the claim's decision and interval.
          const calibrationIdentity={planHash:binding.planHash,contractHash:binding.contractHash??canonicalSha256(null),inputHash:binding.inputManifestHash,codeHash:binding.frozenCodeHash};
          gates.push(await nullCalibration(claim,data,deriveProcedureSeed(calibrationIdentity,registered?.procedureId??'unregistered',claim.id,'calibration'),async sample=>{
            const twin={...data,x:sample.x,y:sample.y},r=kernelDecision(claim,twin,sample.seed,request.maxPermutations);
            return r.status==='unresolved'?null:{...linearEntry(claim,twin),p:r.decisionP??r.p??r.pUpper};
          },calibrationProcedure,calibrationIdentity,request.maxPermutations??9_999));
        }else if(request.simulations===false)gates.push(gateResult('G5a','not-run','design calibration disabled',{claimId:claim.id}));
        else gates.push(gateResult('G5a','failed','no registered procedure passed the locked design envelope; legacy calibration cannot substitute',{claimId:claim.id,code:'registered-calibration-required'}));
        if(request.simulations!==false&&frozen&&calibrationProcedure){
          const run=counted(request.simulationFactory?.(claim.id,data)??simulationRunner(request.executor,frozen,staged,claim,data));
          const calibrationIdentity={planHash:binding.planHash,contractHash:binding.contractHash??canonicalSha256(null),inputHash:binding.inputManifestHash,codeHash:binding.frozenCodeHash};
          gates.push(...await plantedEffect(effective,data,deriveProcedureSeed(calibrationIdentity,registered?.procedureId??'unregistered',claim.id,'planted'),run,request.maxPermutations,calibrationProcedure,calibrationIdentity));
        }else if(request.simulations!==false&&frozen)gates.push(...(['G5b-power','G5b-recovery'] as const).map(g=>gateResult(g,'failed','registered design-matched interval procedure is unavailable',{claimId:claim.id,code:'registered-calibration-required'})));
      }catch(e){
        modelBased.add(claim.id);warnings.push(`${claim.id}: ${e instanceof Error?e.message:'kernel unavailable'}`);
        // Unavailable trusted values never fall back to worker p/CI, including in Holm.
        entries.delete(claim.id);
        for(let i=0;i<gates.length;i++)if(gates[i]!.gate==='G3'&&gates[i]!.claimId===claim.id||gates[i]!.gate==='G4'&&gates[i]!.claimId===claim.id)gates[i]={...gates[i]!,outcome:'failed',summary:'trusted look computation unavailable'};
        for(const gate of ['G5a','G5b-power','G5b-recovery'] as const)if(!gates.some(g=>g.gate===gate&&g.claimId===claim.id))gates.push(gateResult(gate,'failed','unsupported or unavailable trusted computation',{claimId:claim.id}));
        if(!gates.some(g=>g.gate==='G1c'&&g.claimId===claim.id))gates.push(gateResult('G1c','not-run','confounding unavailable',{claimId:claim.id}));
      }
    }
    // K1 owns advisory propagation, including nonstatistical/unsupported claims and companion tables.
    for(const claim of originalPlan?.claims??[])if(detectorReport&&staged?.verifiedContract){
      const contractTable=[...staged.verifiedContract.tables.values()].find(t=>t.definition.file.path===claim.knobs.table);
      const v=staged.verifiedContract,level=claim.unit==='unit_id'?v.resolver.hierarchy.floor!:claim.unit!;
      const advisory=contradictionsForUnits(v,detectorReport,contractTable?.units??[],level);
      scientificLimitations.set(claim.id,[...detectorReport.limitations,...advisory.map(f=>`Advisory contract contradiction (${f.detector}): ${f.detail}`)]);
      const index=gates.findIndex(g=>g.gate==='G1a'&&g.claimId===claim.id);
      if(index>=0)gates[index]={...gates[index]!,evidence:{...gates[index]!.evidence,contradictionFindings:advisory.map(f=>({code:f.code,detector:f.detector,admission:f.admission,score:f.score}))}};
    }
    const decisionPrimary=primary?{...primary,nUnits:staged?.units.length??null,entries}:null;
    let decisionAlphaByClaim:Record<string,number>={},hypothesisOrdinals=request.hypothesisOrdinals??{};
    if(plan&&request.programMultiplicity){const g6=computeProgramMultiplicity(plan,decisionPrimary,request.programMultiplicity);gates.push(...g6.gates);decisionAlphaByClaim=g6.alphas;hypothesisOrdinals={...hypothesisOrdinals,...g6.ordinals};}
    else if(plan)for(const claim of plan.claims.filter(c=>isStatistical(c.kind)&&!c.exploratory))
      gates.push(gateResult('G6','failed','trusted program-wide multiplicity state is required for statistical certification',{claimId:claim.id,code:'program-state-required'}));
    const envelopes=signedGates(request.authority,binding,gates);
    // Even well-formed signed external results cannot replace locally owned gates.
    const external=(request.externalGates??[]).filter(value=>{
      const g=request.authority.verify(value,binding);return g!==null&&['G7','G8','CIT'].includes(g.gate);
    });
    const board=new SignedGateBoard([...envelopes,...external],binding,request.authority);
    if(external.length!==(request.externalGates??[]).length)warnings.push('unsigned, stale, or unauthorized external gate refused');
    let certification=certify({plan,primary:decisionPrimary,metricsJson:null,gates:board.results,hardStops:hardStops.filter(isHardStopKind),reportedClaimIds:reported.ids,
      ...(Object.keys(decisionAlphaByClaim).length?{decisionAlphaByClaim}:{}),...(Object.keys(hypothesisOrdinals).length?{hypothesisOrdinals}:{})});
    // Rebuild all label surfaces and prose together before adding scientific limitations.
    // Run-wide OS cap plus per-claim held-out caps; limitations are stamped even when the label was
    // already below the cap.
    certification={...certification,assessments:certification.assessments.map(a=>{
      const reasons=[...(osSeparated?[]:[OS_SEPARATION_LIMITATION]),...(claimCaps.get(a.claimId)??[])];
      if(!reasons.length)return a;
      const label=capLabel(a.label,reasons),claim=plan?.claims.find(c=>c.id===a.claimId)??null;
      return {...a,label,status:label.status,taskStatus:label.taskStatus,limitations:[...limitationLines({claim,label,board}),...reasons]};
    })};
    // Registry text is stamped only for a claim whose G5c passed; the inversion sentence only where
    // the registered procedure supplied both the p-value and the interval.
    const g5cPassed=(claimId:string)=>gates.some(g=>g.gate==='G5c'&&g.claimId===claimId&&g.outcome==='passed');
    const registeredLine=(claimId:string)=>{const p=procedures[claimId];if(!p)return [];
      // The registered limitation is the claim's primary reason when it is outside the envelope.
      const g5c=gates.find(g=>g.gate==='G5c'&&g.claimId===claimId);
      return [g5cPassed(claimId)?`Registered procedure ${p.procedureId}: ${p.guarantee}`:`Registered procedure ${p.procedureId} was not applied inside its calibrated envelope (G5c failed); no validated bound is stamped. Reason: ${p.limitation??g5c?.summary??'outside the registered envelope'}.`];};
    // K2b-fix2: the G5a scope is stated on the claim itself, not only in gate evidence: what null the
    // twins came from, that it is never worst-case calibration, and when it cannot detect a
    // permutation branch's anti-conservatism (an exchangeable relabeling).
    const calibrationLine=(claimId:string)=>{const e=gates.find(g=>g.gate==='G5a'&&g.claimId===claimId)?.evidence;
      return e?.ruleVersion==='alpha-aware-v2'&&typeof e.calibrationScope==='string'?[`Null calibration (G5a): ${e.calibrationScope}.`]:[];};
    certification={...certification,assessments:certification.assessments.map(a=>({...a,limitations:[...(g5cPassed(a.claimId)?[...a.limitations,...registeredLine(a.claimId)]:[...registeredLine(a.claimId),...a.limitations]),...calibrationLine(a.claimId),...(scientificLimitations.get(a.claimId)??[]),
      ...(isStatistical(a.kind??'citation')?[modelBased.has(a.claimId)?`${kernel[a.claimId]?.guarantee??'model-based: assumptions A1-A4'}${kernel[a.claimId]?.modelReference?'; '+kernel[a.claimId]!.modelReference:''}; no exact alpha guarantee is claimed.`:
        kernel[a.claimId]?.status==='unresolved'?'Permutation work limit reached: the decision is unresolved; no parametric fallback.':
          procedureResults[a.claimId]?.status==='ok'?'Registered decision-rule intervals invert their procedure p-values. LORD++ controls decisions per registered outcome dataset, including unrun proposals.':
            `${kernel[a.claimId]?.guarantee??'legacy kernel'}; the reported interval is a separate software computation and does not invert the decision p-value. LORD++ controls decisions per registered outcome dataset, including unrun proposals.`]:[])]}))};
    const scientific = originalPlan && !hardStops.length ? scientificOutcomes(originalPlan,request.rawDir,first,rerun) : {};
    certification={...certification,assessments:certification.assessments.map(a=>{
      const d=scientific[a.claimId];if(!d||a.label.voided)return a;
      const reasons=[`${d.reason}: ${d.detail} (${d.source})`];
      const label={...a.label,status:'insufficient-evidence' as const,taskStatus:'insufficient-evidence' as const,reasons};
      return {...a,label,status:label.status,taskStatus:label.taskStatus,limitations:[...reasons,...a.limitations]};
    })};
    const lines=['# Certified report','',`Execution: ${binding.executionId}`,`Plan: ${binding.planHash}`,`Inputs: ${binding.inputManifestHash}`,`Code: ${binding.frozenCodeHash}`,''];
    const adjustedClaims=(originalPlan?.claims??[]).filter(c=>c.adjustment.length>0);
    // Say what actually decided and calibrated each adjusted claim (K2b-fix2): only a registered
    // procedure that implements the adjustment may decide it inside an envelope; a legacy
    // Freedman–Lane decision is outside every envelope; no calibration is claimed that did not run.
    if(adjustedClaims.length)lines.push('## Methods','',...adjustedClaims.map(c=>{
      const decided=procedureResults[c.id]?.status==='ok'?`decided by the registered procedure ${procedureResults[c.id]!.procedure}`:kernel[c.id]?.scheme==='freedman-lane'?'decided by the legacy Freedman–Lane permutation kernel, outside every registered envelope':'not decided by a trusted computation';
      const g5a=gates.find(g=>g.gate==='G5a'&&g.claimId===c.id),generator=typeof g5a?.evidence.nullGenerator==='string'?g5a.evidence.nullGenerator:null;
      return `- ${c.id} (adjusted for ${c.adjustment.join(', ')}): ${decided}; null calibration ${g5a?.outcome==='passed'||g5a?.outcome==='failed'&&generator?`by ${generator} (${g5a.outcome})`:'not run'}.`;
    }),'');
    for(const a of certification.assessments){lines.push(`## ${a.claimId}: ${a.status}`,'',...(a.status==='refuted'?[`Minimum effect of interest: ${(c=>describeMei(c?.estimand??null,c?.mei??null))(plan?.claims.find(c=>c.id===a.claimId))}`,'']:[]),...a.limitations.map(l=>`- ${l}`),'');}
    const draft=read(path.join(request.workdir,'REPORT.md'));
    if(draft){const rendered=renderProse(draft,certification.metrics);lines.push('## Worker narrative (unverified)','',rendered.text.split(/\r?\n/).map(line=>'> '+line.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/[\\`*_{}\[\]()#+.!|~-]/g,'\\$&')).join('\n'),'');warnings.push(...rendered.issues.map(i=>i.kind));}
    lines.push('## Software limitations','',...certification.reportLimitations.map(l=>`- ${l}`),'',...warnings.map(w=>`- Warning: ${w}`),'');
    const integrity=buildTrustedIntegrity(staged,originalPlan?.claims??[],detectorReport,analysisUnits);
    const transport:Partial<import('./diagnostic-transport.ts').DiagnosticTransport>=originalPlan ? diagnosticTransport(originalPlan,staged?path.join(staged.directory,"RAW"):request.rawDir,procedureResults,Object.fromEntries(certification.metrics.values),
      !hardStops.length && trustedInputs && !!request.lock && request.lock.planHash===planLockHash(originalPlan) && request.firstLookAt!==null && request.lock.lockedAt<request.firstLookAt) : {};
    if (transport.diagnostics) for(const [id,d] of Object.entries(scientific)) {
      const source=`scientific_outcomes.${id}`;
      transport.outputs![source]={...d};
      transport.claimSources![id]=[`claim:${id}`];
      transport.diagnostics.push({id:`${id}:numerical-validity:${d.reason}`,mandatory:true,assumption:'the requested scientific quantity is estimable',status:'fail',
        blocks:[`claim:${id}`,`${id}.estimate`,`${id}.p`,`${id}.ci`],valid_alternatives:[source],detail:`${d.reason}: ${d.detail} (${d.source})`});
      if(Object.keys(scientific).length===originalPlan!.claims.length && new Set(Object.values(scientific).map(v=>v.reason)).size===1){
        transport.reportBindings!['/status']={source,value:'abstain'};
        transport.reportBindings!['/reason_code']={source,value:d.reason};
        for(const field of ['estimate','coefficient','effect','uncertainty','standard_error','se','p','survival_difference'])transport.reportBindings![`/${field}`]={source,value:null};
        if(d.reason==='missing-endpoint')transport.reportBindings!['/endpoint_available']={source,value:false};
      }
    }
    const result:CertifiedReport={...transport,integrity,jobs,binding,certification,gates:[...envelopes,...external as SignedGate[]],kernel,procedures,procedureResults,warnings,report:lines.join('\n'),unverifiedWorkerNumbers};
    const out=path.join(request.stateRoot,'out');mkdirSync(out,{recursive:true,mode:0o700});
    writeFileSync(path.join(out,'report.md'),result.report,{mode:0o600});
    // Seal the JSON representation actually written, including null for non-finite bounds.
    const workerOutput=JSON.stringify({primary:json(first.files['primary.json']??null),metrics:json(first.files['metrics.json']??null)})+'\n';
    const body=JSON.parse(JSON.stringify({...result,
      ...(result.outputs ? {outputs:redactBlockedOutputs(result.outputs,result.diagnostics ?? [])} : {}),
      procedureResults:redactBlockedOutputs(result.procedureResults,result.diagnostics ?? []),
      hardStops:[...hardStops],
      labelCaps:Object.fromEntries(certification.assessments.map(a=>[a.claimId,[...(osSeparated?[]:[OS_SEPARATION_LIMITATION]),...(claimCaps.get(a.claimId)??[])]])),
      workerOutputSha256:canonicalSha256(JSON.parse(workerOutput)),
      numericTolerance:{rule:'numericAgreement@1',relative:1e-8,minimumSignificantDigits:3},
      certification:{...certification,metrics:{values:Object.fromEntries(certification.metrics.values),ambiguous:[...certification.metrics.ambiguous]}}}));
    const certificationSeal=request.authority.sealEvidence('omb/certification@1',binding,'*',{sha256:canonicalSha256(body)});
    writeFileSync(path.join(out,'certification.json'),JSON.stringify({...body,certificationSeal},null,2)+'\n',{mode:0o600});
    writeFileSync(path.join(out,'worker-output-unscored.json'),workerOutput,{mode:0o600});
    writeFileSync(path.join(out,'results.json'),JSON.stringify({claims:certification.assessments.map(a=>({id:a.claimId,status:a.taskStatus,software_status:a.status,material:a.decision.material??null,...a.decision.values,mei:originalPlan?.claims.find(c=>c.id===a.claimId)?.mei??null,refutationMei:plan?.claims.find(c=>c.id===a.claimId)?.mei??null,limitations:a.limitations}))},null,2)+'\n',{mode:0o600});
    return result;
  }catch(error){
    const reason=`certification unavailable: ${error instanceof Error?error.message:String(error)}`;warnings.push(reason);
    const binding:Binding={planHash:originalPlan?planLockHash(originalPlan):canonicalSha256(null),inputManifestHash:staged?.inputManifestHash??canonicalSha256(null),frozenCodeHash:frozen?.hash??canonicalSha256(null),executionId:request.executionId};
    const fallback=certify({plan,primary:null,metricsJson:null,gates:[],hardStops:hardStops.filter(isHardStopKind),reportedClaimIds:reported.ids});
    const certification={...fallback,assessments:fallback.assessments.map(a=>({...a,status:'insufficient-evidence' as const,taskStatus:'insufficient-evidence' as const,label:{...a.label,status:'insufficient-evidence' as const,taskStatus:'insufficient-evidence' as const},limitations:[...a.limitations,reason]}))};
    return {jobs,binding,certification,gates:[],kernel,procedures,procedureResults,warnings,report:'# Certified report\n\n'+reason,unverifiedWorkerNumbers};
  }finally{rmSync(job,{recursive:true,force:true});}
}

/** Host API for K4 posterior certification. Input configuration must be locked by the caller;
 * this binds the entire harmonised input (including priors, LD, window and thresholds). The
 * statistical claim parser remains a frequentist API, not a place to reinterpret PP.H4 as p. */
export function certifyColoc(input: ColocInput, rules?: readonly {id:string;on_fail:readonly string[]}[]) {
  const result=produceColoc(input);
  const active=(id:string)=>result.diagnostics.some(d=>d.id===id && d.status!=='pass' && (d.status!=='not-evaluable'||COLOC_REGISTRATION.assumptions.find(a=>a.id===id)?.mandatory!==false));
  const maskBlocked=active('coloc.mask-separates-signals'),conditionBlocked=active('coloc.ld-reference-match');
  const pairs=result.coloc.per_signal.map((pair,index)=>{
    const conditioning=conditionBlocked?null:pair.conditioning,masking=maskBlocked?null:pair.masking;
    // Common restriction supports a pair only when each trait has one common lead.
    const commonLead=(id:string,trait:readonly import('../../omb-procedures/src/coloc.ts').ColocVariant[])=>trait.find(v=>v.id===id)?.maf!>=.05;
    const commonEligible=commonLead(pair.exposure_lead,input.exposure)&&commonLead(pair.outcome_lead,input.outcome)&&
      result.coloc.leads.exposure.filter(id=>commonLead(id,input.exposure)).length===1&&result.coloc.leads.outcome.filter(id=>commonLead(id,input.outcome)).length<=1;
    const common=commonEligible?result.coloc.common:null;
    const routes=[conditioning,masking,common].filter(v=>v!==null);
    const shared=routes.some(v=>v.verdict==='shared-variant'),nonshared=routes.some(v=>v.verdict!=='shared-variant');
    const verdict:import('../../omb-procedures/src/coloc-abf.ts').ColocVerdict=routes.length<2||shared&&nonshared?'method-sensitive':shared?'shared-variant':routes.some(v=>v.verdict==='inconclusive')?'inconclusive':'distinct-variants';
    const posterior=verdict==='method-sensitive'?null:(conditioning??masking??common);
    // A method-specific verdict is never a second, contradictory official answer.
    const strip=(v:NonNullable<typeof conditioning>,route:string)=>{const {verdict:_,...rest}=v;return verdict==='method-sensitive' ? redactedOutput(`coloc.per_signal.${index}.${route}`,rest,'coloc.methods-agree') : rest;};
    return {exposure_lead:pair.exposure_lead,outcome_lead:pair.outcome_lead,exposure_detected:pair.exposure_detected,outcome_detected:pair.outcome_detected,
      ...(conditioning?{conditioning:strip(conditioning,'conditioning')}:{}),...(masking?{masking:strip(masking,'masking')}:{}),...(common?{common:strip(common,'common')}:{}),
      pp_h4:posterior?.pp_h4??null,verdict,methods:[...(conditioning?['conditioning']:[]),...(masking?['masking']:[]),...(common?['common']:[])]};
  });
  const agreement=result.diagnostics.find(d=>d.id==='coloc.methods-agree')!;
  agreement.status=pairs.some(p=>p.verdict==='method-sensitive')?'fail':'pass';
  agreement.detail='Agreement is recomputed using only unblocked routes and the eligible common-variant cross-check.';
  const outputs={
    'coloc.single':result.coloc.single,'coloc.per_signal':pairs,
    'coloc.conditioning':conditionBlocked?null:pairs.map(p=>p.conditioning??null),
    'coloc.masking':maskBlocked?null:pairs.map(p=>p.masking??null),
    'coloc.common':result.coloc.common,
    'coloc.method_verdicts':agreement.status==='pass'?pairs.map(p=>p.verdict):null,
  };
  const metadata={...COLOC_REGISTRATION,assumptions:COLOC_REGISTRATION.assumptions.map(a=>{
    const proposed=rules?.find(r=>r.id===a.id);
    return proposed ? {...a,default_rule:{...a.default_rule,on_fail:a.default_rule.on_fail.filter(x=>proposed.on_fail.includes(x))}} : a;
  })};
  const certification=certifyProcedureOutputs(metadata,result,outputs,['coloc.single']);
  return {...certification,status:result.status==='refused'?'refused' as const:certification.status,
    official:result.status==='refused'?{}:certification.official,
    outputs:result.status==='refused'?{}:Object.fromEntries(Object.entries(outputs).filter(([k,v])=>v!==null&&!certification.blocked.includes(k))),
    procedure:COLOC_REGISTRATION.procedureId,registryHash:COLOC_REGISTRY_HASH,
    inputHash:canonicalSha256(input),guarantee:COLOC_REGISTRATION.guarantee,audit:result};
}
