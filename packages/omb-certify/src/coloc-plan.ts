import {COLOC_DIAGNOSTIC_POLICY} from '../../omb-procedures/src/coloc.ts';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import type { ColocInput, ColocVariant } from '../../omb-procedures/src/coloc.ts';
import type { ColocPriors } from '../../omb-procedures/src/coloc-abf.ts';
/** Design-only source binding, locked before data. All effect/allele work remains trusted. */
export interface ColocPlanSpec {
  id:string; exposure_table:string; outcome_table:string; reference_table:string;
  instrument:string; window_bp:number; priors:ColocPriors;
  outcome_p_threshold:number; exposure_p_threshold?:number;
  report_path:string; claim_ids:string[];
}
export function colocPlanSpecs(shared:unknown):ColocPlanSpec[] {
  const raw=(shared as {coloc_procedures?:unknown}|undefined)?.coloc_procedures;
  if(raw===undefined)return [];
  if(!Array.isArray(raw))throw new Error('coloc_procedures must be a list');
  const seen=new Set<string>();
  for(const s of raw) {
    if(!s || typeof s!=='object' || typeof s.id!=='string' || !/^[a-z0-9_-]+$/i.test(s.id) || seen.has(s.id))throw new Error('unique coloc procedure id required');
    seen.add(s.id);
    for(const k of ['exposure_table','outcome_table','reference_table'])if(typeof s[k]!=='string'||!s[k]||path.isAbsolute(s[k])||s[k].split(/[\\/]/).some((v:string)=>v==='..'||v===''))throw new Error('coloc table must be a relative input path');
    if(typeof s.instrument!=='string'||!s.instrument||!Number.isSafeInteger(s.window_bp)||s.window_bp<1||s.window_bp>1000000)throw new Error('locked instrument and window required');
    if(typeof s.report_path!=='string'||!/^\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+$/i.test(s.report_path)||!Array.isArray(s.claim_ids)||!s.claim_ids.every((v:unknown)=>typeof v==='string'))throw new Error('coloc report and claim bindings required');
    for(const p of [s.exposure_p_threshold??COLOC_DIAGNOSTIC_POLICY.signal_p_floor,s.outcome_p_threshold])if(!Number.isFinite(p)||p<COLOC_DIAGNOSTIC_POLICY.signal_p_floor||p>=1)throw new Error('signal threshold is stricter than registry floor or invalid');
    for(const p of ['p1','p2','p12'])if(!Number.isFinite(s.priors?.[p])||s.priors[p]<=0||s.priors[p]>=1)throw new Error('locked coloc priors required');
    for(const p of ['sd1','sd2'])if(!Number.isFinite(s.priors?.[p])||s.priors[p]<=0)throw new Error('locked prior SD required');
    const allowed=new Set(['id','exposure_table','outcome_table','reference_table','instrument','window_bp','priors','outcome_p_threshold','exposure_p_threshold','report_path','claim_ids']);
    if(Object.keys(s).some(k=>!allowed.has(k)))throw new Error('unregistered coloc setting');
  }
  return raw;
}
const comp=(s:string)=>s.replace(/[ACGT]/g,c=>({A:'T',T:'A',C:'G',G:'C'})[c]!);
const key=(v:Record<string,string>,ref=false)=>{
  const a=v[ref?'counted_allele':'effect_allele']!.toUpperCase(),b=v.other_allele!.toUpperCase();
  return [v.chromosome,Number(v.position),[[a,b].sort().join('/'),[comp(a),comp(b)].sort().join('/')].sort()[0]].join(':');
};
export function readColocInput(root:string,s:ColocPlanSpec):ColocInput {
  root=path.resolve(root);
  const rows=(file:string)=>{
    const full=path.join(root,file);for(let p=full;p!==path.resolve(root);p=path.dirname(p)){if(lstatSync(p).isSymbolicLink())throw new Error('linked coloc input');}
    const lines=readFileSync(full,'utf8').trimEnd().split(/\r?\n/),header=lines.shift()!.split('\t');
    if(new Set(header).size!==header.length)throw new Error('duplicate input columns');
    return lines.map(line=>Object.fromEntries(line.split('\t').map((v,i)=>[header[i]!,v])));
  };
  const exposureRows=rows(s.exposure_table),outcomeRows=rows(s.outcome_table),refRows=rows(s.reference_table);
  const anchors=exposureRows.filter(v=>v.variant?.split(',').includes(s.instrument));if(anchors.length!==1)throw new Error('instrument not uniquely identifiable');
  const anchor=anchors[0]!,pos=Number(anchor.position),within=(v:Record<string,string>)=>v.chromosome===anchor.chromosome&&Math.abs(Number(v.position)-pos)<=s.window_bp;
  const unique=(rs:Record<string,string>[],ref=false)=>{const m=new Map<string,Record<string,string>|null>();for(const v of rs.filter(within)){const k=key(v,ref);m.set(k,m.has(k)?null:v);}return m;};
  const ea=unique(exposureRows),ob=unique(outcomeRows),rr=unique(refRows,true);
  const exposure:ColocVariant[]=[],outcome:ColocVariant[]=[],dosages:number[][]=[],ids:string[]=[],alleles:string[]=[],frequencies:number[]=[];
  const variant=(v:Record<string,string>,id:string):ColocVariant=>{const eaf=Number(v.effect_allele_frequency);return {id,chromosome:v.chromosome!,position:Number(v.position),effect_allele:v.effect_allele!,other_allele:v.other_allele!,beta:Number(v.beta),se:Number(v.standard_error),eaf,maf:Math.min(eaf,1-eaf)};};
  for(const [k,x] of ea) {
    const y=ob.get(k),r=rr.get(k);if(!x||!y||!r)continue;
    const values=Object.keys(r).filter(k=>/^ind\d+$/.test(k)).sort().map(k=>Number(r[k]));
    if(values.length<3||values.some(v=>!Number.isFinite(v)||v<0||v>2)||new Set(values).size<2)continue;
    const id=x.variant||k;exposure.push(variant(x,id));outcome.push(variant(y,id));ids.push(id);alleles.push(r.counted_allele!);dosages.push(values);frequencies.push(values.reduce((a,b)=>a+b,0)/(2*values.length));
  }
  return {exposure,outcome,reference:{ids,effect_alleles:alleles,effect_allele_frequencies:frequencies,dosages},window:{chromosome:anchor.chromosome!,start:pos-s.window_bp,end:pos+s.window_bp},priors:s.priors,outcome_p_threshold:s.outcome_p_threshold,...(s.exposure_p_threshold===undefined?{}:{exposure_p_threshold:s.exposure_p_threshold})};
}
