import { lstatSync,readFileSync } from 'node:fs';
import path from 'node:path';
import type { MetaAnalysisInput } from '../../omb-procedures/src/meta-analysis.ts';
import type { SurrogacyInput } from '../../omb-procedures/src/surrogacy.ts';
import { TIERC_REGISTRATIONS,type TiercKind } from './tierc.ts';
import { delimited } from '../../bio-pipeline/src/validity.ts';
/** Arm-level adverse-event input: the host pairs the staged table's rows into trials. Column names and arm
 * labels are locked in the plan; every row must pair, so the certified input covers the whole table. */
export interface TiercArms {trial:string;arm:string;treatment:string;control:string;events:string;total:string}
export interface TiercPlanSpec {id:string;kind:TiercKind;table:string;settings:Omit<MetaAnalysisInput,'trials'>|Omit<SurrogacyInput,'trials'>;report_path:string;claim_ids:string[];arms?:TiercArms}
/** Host-verified provenance of a built input: the outcome column it counts and its row coverage. */
export interface TiercInputSource {kind:'arms';table:string;column:string;rows:number;trials:number;complete:boolean}
const ARM_KEYS=['trial','arm','treatment','control','events','total'];
export function tiercPlanSpecs(shared:unknown):TiercPlanSpec[]{
 const raw=(shared as {tierc_procedures?:unknown}|undefined)?.tierc_procedures;if(raw===undefined)return [];if(!Array.isArray(raw))throw new Error('tierc_procedures must be a list');const ids=new Set<string>(),paths=new Set<string>(),claims=new Set<string>();
 for(const s of raw){if(!s||typeof s!=='object'||typeof s.id!=='string'||!/^[a-z0-9_-]+$/i.test(s.id)||ids.has(s.id)||!Object.hasOwn(TIERC_REGISTRATIONS,s.kind))throw new Error('unique Tier C procedure ID and registered kind required');ids.add(s.id);
 if(typeof s.table!=='string'||!s.table||path.isAbsolute(s.table)||s.table.split(/[\\/]/).some((x:string)=>x==='..'||x==='.'||x===''))throw new Error('Tier C table must be a relative input path');
 if(typeof s.report_path!=='string'||!/^\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+$/i.test(s.report_path)||paths.has(s.report_path)||!Array.isArray(s.claim_ids)||s.claim_ids.length===0||s.claim_ids.some((v:unknown)=>typeof v!=='string'||!v||claims.has(v)))throw new Error('unique report and claim bindings required');paths.add(s.report_path);s.claim_ids.forEach((v:string)=>claims.add(v));
 if(!s.settings||typeof s.settings!=='object'||Array.isArray(s.settings))throw new Error('locked Tier C settings required');const allowed=s.kind==='adverse-events'?['measure','model','continuityCorrection','role']:['ciMethod','bootstrapReplicates','surrogateBenefitDirection','outcomeBenefitDirection','predictAt'];
 if(Object.keys(s.settings).some(k=>!allowed.includes(k))||Object.keys(s).some(k=>!['id','kind','table','settings','report_path','claim_ids','arms'].includes(k)))throw new Error('unregistered Tier C setting');
 if(s.kind==='adverse-events'&&(!['OR','RR','RD'].includes(s.settings.measure)||s.settings.model!==undefined&&!['MH','Peto','exact','DL'].includes(s.settings.model)||s.settings.continuityCorrection!==undefined&&(!Number.isFinite(s.settings.continuityCorrection)||s.settings.continuityCorrection<0||s.settings.continuityCorrection>1)||s.settings.role!==undefined&&!['primary','sensitivity'].includes(s.settings.role)))throw new Error('invalid adverse-event settings');
 if(s.kind==='trial-surrogacy'&&(s.settings.ciMethod!==undefined&&!['fisher','bootstrap'].includes(s.settings.ciMethod)||s.settings.bootstrapReplicates!==undefined&&(!Number.isSafeInteger(s.settings.bootstrapReplicates)||s.settings.bootstrapReplicates<1000||s.settings.bootstrapReplicates>10000)||['surrogateBenefitDirection','outcomeBenefitDirection'].some(k=>s.settings[k]!==undefined&&!['greater','less'].includes(s.settings[k]))||s.settings.predictAt!==undefined&&(!Array.isArray(s.settings.predictAt)||s.settings.predictAt.some((x:unknown)=>typeof x!=='number'||!Number.isFinite(x)))))throw new Error('invalid surrogacy settings');
 if(s.arms!==undefined){const a=s.arms;
  if(s.kind!=='adverse-events'||!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).length!==ARM_KEYS.length||ARM_KEYS.some(k=>typeof a[k]!=='string'||!a[k]||/[\t\r\n]/.test(a[k]))||a.treatment===a.control||new Set([a.trial,a.arm,a.events,a.total]).size!==4||!/\.(?:tsv|csv)$/i.test(s.table))throw new Error('invalid arm-level Tier C declaration (arms)');}
 }
 return raw;
}
/** Only the locked staged-input directory is read. No worker-produced estimates are accepted. */
function readTiercBytes(root:string,s:TiercPlanSpec):string{root=path.resolve(root);const full=path.resolve(root,s.table);if(!full.startsWith(root+path.sep))throw new Error('Tier C path escape');for(let p=full;p!==root;p=path.dirname(p))if(lstatSync(p).isSymbolicLink())throw new Error('linked Tier C input');if(lstatSync(full).size>4*1024*1024)throw new Error('Tier C trial table exceeds size cap');return readFileSync(full,'utf8');}
export function readTiercTrials(root:string,s:TiercPlanSpec):unknown[]{return readTiercInput(root,s).trials;}
export function readTiercInput(root:string,s:TiercPlanSpec):{trials:unknown[];source?:TiercInputSource}{
 const text=readTiercBytes(root,s);
 if(!s.arms){const rows=JSON.parse(text);if(!Array.isArray(rows))throw new Error('Tier C input must be a JSON trial array');return {trials:rows};}
 const a=s.arms,body=text.replace(/^\uFEFF/,'').replace(/\r?\n$/,''),sep=/\.tsv$/i.test(s.table)?'\t':',';
 const records=body.includes('"')?delimited(body,sep):body.split(/\r?\n/).map(line=>line.split(sep));
 const header=records.shift()??[];
 if(!header.length||new Set(header).size!==header.length||!records.length||records.some(r=>r.length!==header.length))throw new Error('empty, ragged or duplicate-header arm-level Tier C table');
 const at=(name:string)=>{const i=header.indexOf(name);if(i<0)throw new Error(`arm-level Tier C column missing: ${name}`);return i;};
 const [ti,ai,ei,ni]=[at(a.trial),at(a.arm),at(a.events),at(a.total)];
 const integer=(cell:string)=>{if(!/^(?:0|[1-9]\d*)$/.test(cell)||!Number.isSafeInteger(Number(cell)))throw new Error('arm-level Tier C counts must be non-negative integers');return Number(cell);};
 const trials=new Map<string,{t?:[number,number];c?:[number,number]}>();
 for(const r of records){
  const id=r[ti]!,label=r[ai]!;
  if(!id.trim()||/^(?:na|nan|n\/a|null|none|\.)$/i.test(id.trim()))throw new Error('arm-level Tier C trial code missing');
  if(label!==a.treatment&&label!==a.control)throw new Error('undeclared arm label in arm-level Tier C table');
  const trial=trials.get(id)??{},side=label===a.treatment?'t':'c';
  if(trial[side])throw new Error('repeated arm within an arm-level Tier C trial');
  trial[side]=[integer(r[ei]!),integer(r[ni]!)];trials.set(id,trial);
 }
 const out=[...trials.entries()].sort(([x],[y])=>x<y?-1:x>y?1:0).map(([id,t])=>{
  if(!t.t||!t.c)throw new Error('arm-level Tier C trial lacks a treatment or control arm');
  return {id,eventsTreatment:t.t[0],totalTreatment:t.t[1],eventsControl:t.c[0],totalControl:t.c[1]};
 });
 return {trials:out,source:{kind:'arms',table:s.table,column:a.events,rows:records.length,trials:out.length,complete:records.length===2*out.length}};
}
