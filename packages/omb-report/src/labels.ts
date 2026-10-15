import { validLock } from './lock.ts';
import type { ClaimView, ReportContext } from './context.ts';
import { assertContext } from './context.ts';
import { requireThat, record, finite } from './common.ts';
import {checksSentence,smallNumber} from './sentence-style.ts';
export const LABEL_VERSION='paper-labels@2';
export const CHECK_NAMES:Readonly<Record<string,string>>=Object.freeze({G1:'raw-file and unit checks',G1a:'effective units',G1b:'disjoint data splits',G1c:'measured confounding',G2:'plan locked before the look',G3:'recomputed numbers',G4:'reproduced',G5a:'false-alarm calibration','G5b-power':'ability to detect the smallest effect of interest','G5b-recovery':'interval coverage',G5c:'procedure validity',G6:'multiple-testing control',G7:'independently re-implemented',G8:'recorded data look',G9:'prediction performance',CIT:'reference resolution'});
export interface ThreePartLabel {preSpecification:string;checks:string;evidenceType:string;outcome:string;full:string;short:string}
export function threePartLabel(ctx:ReportContext,id:string):ThreePartLabel{
 assertContext(ctx);const c=ctx.claims.find(c=>c.id===id);requireThat(c,'unknown label claim');
 const timestamp=record(ctx.input.timestamps[0]);const date=registrationValues(ctx).lock_date??'date unavailable';
 const registration=typeof timestamp.osfId==='string'?`, OSF ${timestamp.osfId}`:', registration ID unavailable';
 const preSpecification=validLock(ctx,c.id)?`pre-registered (plan locked ${date}${registration})`:'post hoc (exploratory)';
 const failed=c.requirements.filter(r=>!r.passed);const all=['confirmed','replicated'].includes(c.status)&&c.requirements.length>0&&failed.length===0;
 const checks=all?'all required checks passed':`${c.requirements.filter(r=>r.passed).length} of ${c.requirements.length} required checks passed${failed.length?` (not passed: ${failed.map(r=>CHECK_NAMES[r.gate]??'unknown required check').join('; ')})`:c.requirements.length?' (referee label remains tentative)':' (required checks unavailable)'}`;
 const outcome=outcomeText(ctx,c);const full=[preSpecification,checks,c.evidenceType,outcome].join('; ');
 const short=`(${validLock(ctx,c.id)?'pre-registered':'post hoc (exploratory)'}; ${all?'all required checks passed':`${c.requirements.filter(r=>r.passed).length} of ${c.requirements.length} required checks passed`}; ${c.evidenceType}; ${c.status})`;
 return {preSpecification,checks,evidenceType:c.evidenceType,outcome,full,short};
}
/** Compact table presentation; the full protected label remains in the prose and crosswalk. */
export function tableEvidenceLabel(ctx:ReportContext,id:string):string {
 const label=threePartLabel(ctx,id),c=ctx.claims.find(c=>c.id===id)!;
 const status=c.status.replaceAll('-',' ');
 return `${status[0]!.toUpperCase()+status.slice(1)} · ${validLock(ctx,id)?'pre-registered':'post hoc (exploratory)'} · ${c.requirements.filter(r=>r.passed).length} of ${c.requirements.length} checks passed · ${label.evidenceType}`;
}
export function outcomeText(ctx:ReportContext,c:ClaimView):string{
 const slot=(s:string)=>ctx.slots.get(`m:${c.id}.${s}`)?.display??'unavailable';
 switch(c.status){
 case 'confirmed':return c.kind==='data-integrity'?'a deterministic software check of the raw files; no statistical inference':validLock(ctx,c.id)?'the pre-registered prediction held':'the post hoc prediction held';
 case 'tentative':return c.requirements.length&&c.requirements.every(r=>r.passed)?'supported, but the referee label remains tentative':'supported, but not every required check passed';
 case 'replicated':return 'held again in independent data';
 case 'refuted':return c.kind==='data-integrity'?'the asserted raw-file property did not hold':`ruled out at the smallest effect of interest (equivalence bound ${slot('mei')}); smaller effects are not excluded`;
 case 'insufficient-evidence':return `the data could not decide; interval width ${slot('ci_width')}; units needed for power of 0.8 at the smallest effect of interest: ${slot('power_n')}`;
 case 'non-identifiable':return 'not identifiable from these data: the exposure is aligned with a measured covariate';
 case 'exploratory':return 'observed in exploratory analysis; not tested on held-out data';
 case 'voided':return `voided: ${c.reason}; not counted`;
 }
}
export const LABEL_CROSSWALK=Object.freeze({preRegistered:'ICH E9: confirmatory design (the result may remain tentative)',postHoc:'ICH E9: exploratory',internal:'TRIPOD: internal validation',external:'TRIPOD: external validation',certainty:'These labels are not GRADE certainty grades.'});

export function registrationValues(ctx:ReportContext):{lock_date:string|null;plan_hash:string|null;osf_id:string|null}{
 const lock=record(ctx.input.lock),nested=record(lock.record),timestamp=record(ctx.input.timestamps[0]);const time=lock.time_ms??nested.time_ms??lock.at;
 return {lock_date:finite(time)&&Math.abs(time)<=8.64e15?new Date(time).toISOString():null,plan_hash:typeof timestamp.planHash==='string'?timestamp.planHash:null,osf_id:typeof timestamp.osfId==='string'?timestamp.osfId:null};
}

/** Reading presentation of the same protected registration/check/evidence facts. */
export function proseEvidenceLabel(ctx:ReportContext,id:string):string {
 const c=ctx.claims.find(c=>c.id===id);requireThat(c,'unknown label claim');
 const passed=c.requirements.filter(r=>r.passed).length;
 return `This was ${validLock(ctx,id)?'a pre-registered':'a post hoc'} analysis. ${checksSentence(passed,c.requirements.length)} ${c.evidenceType==='validation not established'?'Validation has not been established':`The evidence supports ${c.evidenceType}`}.`;
}

/** Factor only identical facts for claims actually requested in this Results block.
 * Mixed registrations, checks and evidence types remain explicitly attributed. */
export function resultsEvidencePresentation(ctx:ReportContext,ids:readonly string[]):{shared:string;labels:Map<string,string>;sharedProvides:string[];localProvides:Map<string,string[]>} {
 const claims=[...new Set(ids)].map(id=>{const c=ctx.claims.find(c=>c.id===id);requireThat(c,'unknown Results claim');return c;});
 const labels=new Map(claims.map(c=>[c.id,[] as string[]])),shared:string[]=[],sharedProvides:string[]=[],localProvides=new Map(claims.map(c=>[c.id,[] as string[]]));
 const list=(xs:string[])=>xs.length<3?xs.join(' and '):xs.slice(0,-1).join(', ')+' and '+xs.at(-1);
 const names=(cs:typeof claims)=>new Set(cs.map(c=>String(c.plan.outcome))).size===1?list(cs.map(c=>String(c.plan.exposure)))+' in relation to '+String(cs[0]!.plan.outcome):list(cs.map(c=>String(c.plan.exposure)+' in relation to '+String(c.plan.outcome)));
 for(const field of ['registration','evidence','checks'] as const){
  const groups=new Map<string,typeof claims>();
  for(const c of claims){const value=field==='registration'?(validLock(ctx,c.id)?'pre-registered':'post hoc'):field==='checks'?checksSentence(c.requirements.filter(r=>r.passed).length,c.requirements.length):c.evidenceType;groups.set(value,[...groups.get(value)??[],c]);}
  for(const [value,cs]of groups){
   const single=field==='registration'?`This was a ${value} analysis.`:field==='checks'?value:value==='validation not established'?'Validation has not been established.':`The evidence supports ${value}.`;
   if(cs.length===1){labels.get(cs[0]!.id)!.push(single);localProvides.get(cs[0]!.id)!.push(`label-part:${cs[0]!.id}:${field}`);continue;}
   sharedProvides.push(...cs.map(c=>`label-part:${c.id}:${field}`));
   const all=cs.length===claims.length;
   if(field==='registration')shared.push(all?`${cs.length===2?'Both':'All '+smallNumber(cs.length)} analyses were ${value}.`:`The analyses of ${names(cs)} were ${value}.`);
   else if(field==='checks')shared.push(all?value:value.replace(/\.$/u,` for ${names(cs)}.`));
   else shared.push(value==='validation not established'?(all?'Validation has not been established for any of these analyses.':`Validation has not been established for ${names(cs)}.`):`The analyses of ${names(cs)} support ${value}.`);
  }
 }
 return {shared:shared.join(' '),sharedProvides,localProvides,labels:new Map([...labels].map(([id,parts])=>[id,parts.join(' ')]))};
}
