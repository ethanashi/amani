import { normalizeId } from './identity.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { gateResult, type PlanClaim, type GateResult } from '../../omb-gauntlet/src/index.ts';
import { declaredTable } from './declared-stage.ts';
import { parseStageTable, type ParsedStageTable } from './stage-parser.ts';
import type { StagedInputs } from './stage.ts';

export const FACT_PRODUCERS = Object.freeze(['identity-overlap','content-overlap','id-set-equality','row-accounting','deterministic-mismatch'] as const);
export type FactProducer = typeof FACT_PRODUCERS[number];
export interface FactSpec { producer:FactProducer; view?:'raw'|'effective'; left:string; right:string; idColumn:string; rightIdColumn?:string; fields?:string[]; excluded?:string; reasonColumn?:string; allowedReasons?:string[]; column?:string; target?:number; tolerance?:number; }
export interface ProducedFact { value:0|1; producer:FactProducer; version:1; evidence:Record<string,unknown>; }
function table(staged:StagedInputs,name:string,view:'raw'|'effective'='raw'):ParsedStageTable {
  if(typeof name!=='string'||path.basename(name)!==name||name==='units.tsv')throw new Error('invalid fact table');
  if(staged.contractMode){if(!staged.verifiedContract?.contract.public.content.structure.tables.some(t=>t.file.path===name))throw new Error('fact table is not public');const t=staged.verifiedContract&&[...staged.verifiedContract.tables.values()].find(t=>t.definition.file.path===name);if(!t)throw new Error('fact table absent from verified contract');return {file:name,sha256:t.definition.file.sha256,bytes:0,axis:t.definition.orientation.unit_axis,header:t.header,rows:t.rows,ids:t.keys.map(k=>JSON.stringify(k)),donor:t.units,signatures:[],columns:[],annotations:[],annotationCount:0,sparse:0,dictionary:false};}
  const bytes=readFileSync(path.join(staged.directory,view==='raw'?'SOURCE':'RAW',name)),decl=staged.declarations?.[name];
  return decl?declaredTable(name,bytes,decl):parseStageTable(name,bytes);
}
function column(t:ParsedStageTable,name:string):string[]{const i=t.header.indexOf(name);if(t.axis!=='rows'||i<0)throw new Error('fact column unavailable');const values=t.rows.map(r=>r[i]!);if(values.some(v=>!v.trim()))throw new Error('missing fact value');return values;}
/** Registry is reviewed code, not a registry of callbacks supplied by the worker. Unknown
 * producer/configuration is unavailable. Facts are predicates (H holds=1), not worker numbers. */
export function produceFact(staged:StagedInputs,spec:FactSpec):ProducedFact {
  if(!spec||typeof spec!=='object'||Array.isArray(spec)||Object.keys(spec).some(k=>!['producer','view','left','right','idColumn','rightIdColumn','fields','excluded','reasonColumn','allowedReasons','column','target','tolerance'].includes(k)))throw new Error('unknown fact configuration');
  if(!FACT_PRODUCERS.includes(spec.producer))throw new Error('unregistered fact producer');
  if(spec.view!==undefined&&!['raw','effective'].includes(spec.view))throw new Error('unknown fact input view');
  const resolve=(tableName:string,col:string,value:string)=>{const v=staged.verifiedContract;if(!v)return normalizeId(value);const t=[...v.tables.values()].find(t=>t.definition.file.path===tableName),ns=t?.definition.columns.find(c=>c.name===col)?.namespace;if(!ns)throw new Error('fact identity lacks a contract namespace');return v.resolver.resolve(v.layer,ns,value,'token');};
  const left=table(staged,spec.left,spec.view),right=table(staged,spec.right,spec.view),a=column(left,spec.idColumn).map(value=>resolve(spec.left,spec.idColumn,value)),b=column(right,spec.rightIdColumn??spec.idColumn).map(value=>resolve(spec.right,spec.rightIdColumn??spec.idColumn,value));
  const aset=new Set(a),bset=new Set(b);let holds=false;let detail:Record<string,unknown>={};
  switch(spec.producer){
    case 'identity-overlap': {const overlap=[...aset].filter(id=>bset.has(id)).length;holds=overlap>0;detail={overlap};break;}
    case 'id-set-equality':holds=aset.size===bset.size&&[...aset].every(id=>bset.has(id));break;
    case 'content-overlap':{
      if(!spec.fields?.length||new Set(spec.fields).size!==spec.fields.length||spec.fields.includes(spec.idColumn))throw new Error('declared content fields required');
      const signatures=(t:ParsedStageTable)=>{const columns=spec.fields!.map(f=>column(t,f));return t.rows.map((_,i)=>canonicalSha256(columns.map(c=>c[i])));};
      const ah=new Set(signatures(left)),overlap=signatures(right).filter(h=>ah.has(h)).length;holds=overlap>0;detail={overlap};break;
    }
    case 'row-accounting':{
      if(!spec.excluded||!spec.reasonColumn||!spec.allowedReasons?.length||spec.allowedReasons.some(r=>!r.trim()))throw new Error('declared exclusion reasons required');
      const excluded=table(staged,spec.excluded,spec.view),e=column(excluded,spec.idColumn).map(normalizeId),reasons=column(excluded,spec.reasonColumn),eset=new Set(e);
      holds=aset.size===a.length&&bset.size===b.length&&eset.size===e.length&&reasons.every(r=>spec.allowedReasons!.includes(r))&&b.every(id=>aset.has(id)&&!eset.has(id))&&e.every(id=>aset.has(id))&&aset.size===bset.size+eset.size;
      detail={input:a.length,analyzed:b.length,excluded:e.length,reasons:Object.fromEntries(spec.allowedReasons.map(r=>[r,reasons.filter(v=>v===r).length]))};break;
    }
    case 'deterministic-mismatch':{
      if(!spec.column||!Number.isFinite(spec.target)||!Number.isFinite(spec.tolerance)||spec.tolerance!<0)throw new Error('declared deterministic target and tolerance required');
      const values=column(right,spec.column).map(Number);if(values.length!==1||!values.every(Number.isFinite))throw new Error('deterministic scalar required');
      holds=Math.abs(values[0]!-spec.target!)>spec.tolerance!;detail={observed:values[0],target:spec.target,tolerance:spec.tolerance};break;
    }
  }
  return {value:holds?1:0,producer:spec.producer,version:1,evidence:{...detail,view:spec.view??'raw',sourceHash:staged.effectiveManifestHash,specHash:canonicalSha256(spec)}};
}
export function factGate(staged:StagedInputs,claim:PlanClaim):GateResult {
  try {
    if(!claim.knobs.producer||typeof claim.knobs.producer!=='object'||Array.isArray(claim.knobs.producer))throw new Error('registered fact specification required');
    const result=produceFact(staged,claim.knobs.producer as unknown as FactSpec);
    return gateResult('G1','passed','reviewed deterministic predicate computed',{claimId:claim.id,evidence:{facts:{[claim.fact??claim.metric]:result.value},datasets:staged.gate.evidence.datasets,producer:result.producer,producerVersion:result.version,provenance:result.evidence}});
  }catch(e){return gateResult('G1','not-run',e instanceof Error?e.message:'fact unavailable',{claimId:claim.id});}
}
