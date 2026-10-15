import { normalizeId, assertCoarse, assertCrossIdentity } from './identity.ts';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { delimited } from '../../bio-pipeline/src/validity.ts';
import type { ParsedStageTable, SingleParseStage } from './stage-parser.ts';

export interface TableDeclaration { mode: 'analysis-table' | 'repeated-measures'; idColumn: string; unitColumn?: string; acknowledgeContentDuplicates?: boolean; nonBiologicalColumns?: string[]; }
export type StageDeclarations = Readonly<Record<string, TableDeclaration>>;
/** Explicit identity is never inferred from numeric content or column spelling. */
export function declaredTable(file:string, bytes:Buffer, declaration:TableDeclaration,model:readonly string[]=['x','y','p','simple']):ParsedStageTable {
  if (!declaration||typeof declaration!=='object'||Object.keys(declaration).some(k=>!['mode','idColumn','unitColumn','acknowledgeContentDuplicates','nonBiologicalColumns'].includes(k))||!['analysis-table','repeated-measures'].includes(declaration.mode) || !declaration.idColumn || declaration.mode==='repeated-measures'&&!declaration.unitColumn) throw new Error('invalid staging declaration');
  if(declaration.acknowledgeContentDuplicates!==undefined&&typeof declaration.acknowledgeContentDuplicates!=='boolean')throw new Error('invalid content acknowledgement');
  if(declaration.mode==='analysis-table'&&declaration.unitColumn!==undefined&&declaration.unitColumn!==declaration.idColumn)throw new Error('analysis-table unitColumn must equal idColumn; use repeated-measures for a coarser unit');
  const text=bytes.toString('utf8').replace(/^\uFEFF/, ''); let records:string[][];
  if(file.endsWith('.json')) {
    const objects:unknown=JSON.parse(text);
    if(!Array.isArray(objects)||!objects.length||objects.some(o=>!o||typeof o!=='object'||Array.isArray(o)))throw new Error('invalid declared JSON table');
    const header=Object.keys(objects[0]);
    records=[header,...objects.map(o=>{if(Object.keys(o).join('\0')!==header.join('\0'))throw new Error('ragged table');return header.map(k=>{const v=o[k];if(typeof v!=='string'&&typeof v!=='number')throw new Error('non-scalar table');return String(v);});})];
  } else { if(!/\.(csv|tsv)$/.test(file))throw new Error('unsupported declared table');records=delimited(text,file.endsWith('.csv')?',':'\t'); }
  const header=records.shift()!, rows=records;
  if(!header?.length||!rows.length||new Set(header).size!==header.length||header.some(h=>!h.trim())||rows.some(r=>r.length!==header.length))throw new Error('empty or ragged declared table');
  const id=header.indexOf(declaration.idColumn),unit=header.indexOf(declaration.mode==='analysis-table'?declaration.idColumn:declaration.unitColumn!);
  if(id<0||unit<0)throw new Error('declared identity column missing');
  const ids=rows.map(r=>normalizeId(r[id]!)),donor=rows.map(r=>normalizeId(r[unit]!));
  if([...ids,...donor].some(v=>!v.trim()||/^(na|nan|null|none|\.)$/i.test(v))||new Set(ids).size!==ids.length)throw new Error('missing or repeated declared row identity');
  if(declaration.mode==='repeated-measures'&&declaration.idColumn===declaration.unitColumn)throw new Error('repeated measures require a distinct biological unit column');
  const content=header.map((_,i)=>i).filter(i=>i!==id&&i!==unit&&header[i]!=='unit_id');
  const signatures=rows.map(r=>canonicalSha256(content.map(i=>r[i])));
  const bySignature=new Map<string,Set<string>>();signatures.forEach((s,i)=>{const set=bySignature.get(s)??new Set();set.add(donor[i]!);bySignature.set(s,set);});
  if([...bySignature.values()].some(ids=>ids.size>1)&&declaration.acknowledgeContentDuplicates!==true)throw new Error('identical content under distinct units requires locked acknowledgeContentDuplicates');
  const existing=header.indexOf('unit_id');
  if(existing>=0&&rows.some((r,i)=>normalizeId(r[existing]!)!==donor[i]))throw new Error('unit_id conflicts with declared unit');
  if(declaration.nonBiologicalColumns!==undefined&&(!Array.isArray(declaration.nonBiologicalColumns)||declaration.nonBiologicalColumns.some(c=>typeof c!=='string'||!header.includes(c))))throw new Error('invalid non-biological columns');
  const table:ParsedStageTable={file,sha256:canonicalSha256(text),bytes:bytes.length,axis:'rows',header,rows,ids,donor,signatures,columns:[],annotations:[],annotationCount:0,sparse:0,dictionary:false};
  assertCoarse(table,model,declaration.nonBiologicalColumns);
  return table;
}
export function declaredStage(raw:string,declarations:StageDeclarations,onParse?:(file:string)=>void,models:Readonly<Record<string,readonly string[]>>={}):SingleParseStage {
  const files=readdirSync(raw).sort().filter(f=>f!=='manifest.json'&&/\.(csv|tsv|json)$/i.test(f));
  if(!files.length||files.includes('units.tsv')||files.some(f=>!Object.hasOwn(declarations,f))||Object.keys(declarations).some(f=>!files.includes(f)||path.basename(f)!==f))throw new Error('every analysis table needs an explicit staging declaration');
  const tables=files.map(file=>{onParse?.(file);return declaredTable(file,readFileSync(path.join(raw,file)),declarations[file]!,models[file]);});
  assertCrossIdentity(tables,models,Object.fromEntries(Object.entries(declarations).map(([f,d])=>[f,d.nonBiologicalColumns??[]])));
  const byUnit=new Map<string,Set<string>>(),byId=new Map<string,string>();
  for(const t of tables)t.ids.forEach((id,i)=>{const unit=t.donor[i]!,prior=byId.get(id);if(prior!==undefined&&prior!==unit)throw new Error('inconsistent declared identity across tables');byId.set(id,unit);const ids=byUnit.get(unit)??new Set([unit]);ids.add(id);byUnit.set(unit,ids);});
  for(const [unit,ids] of byUnit)for(const id of ids)if(byUnit.has(id)&&id!==unit)throw new Error('row identity collides with another declared unit');
  for(const t of tables)if(t.ids.some((id,i)=>id!==t.donor[i])){
    // A matching column name alone is not a foreign-key declaration: independent
    // training/held-out cohorts legitimately use the same biological ID column.
    const parents=tables.find(other=>other!==t&&other.ids.some(id=>t.donor.includes(id)));
    if(parents&&t.donor.some(id=>!parents.ids.includes(id)))throw new Error('orphan biological-unit reference');
  }
  const groups=[...byUnit.values()].map(ids=>[...ids]);
  const datasets=tables.map(t=>({file:t.file,allowed:true,effectiveN:new Set(t.donor).size,rowCount:t.rows.length,units:[...new Set(t.donor)].map(u=>t.ids.filter((_,i)=>t.donor[i]===u)),findings:[{name:'content signatures checked; declared duplicates acknowledged',passed:true,warning:new Set(t.signatures).size<t.signatures.length}]}));
  return {tables,groups,manifestHash:canonicalSha256(tables.map(t=>t.sha256)),document:{status:'allowed',exitCode:0,evidence:{allowed:true,datasets},handling:'declared',engine:'declared-v1'}};
}
export function declaredEffectiveTable(t:ParsedStageTable):string {
  const present=t.header.includes('unit_id'),header=present?t.header:[...t.header,'unit_id'],rows=t.rows.map((r,i)=>present?r.map((v,c)=>c===t.header.indexOf('unit_id')?t.donor[i]!:v):[...r,t.donor[i]!]);
  if(t.file.endsWith('.json'))return JSON.stringify(rows.map(r=>Object.fromEntries(header.map((h,i)=>[h,r[i]]))))+'\n';
  const sep=t.file.endsWith('.csv')?',':'\t';return [header,...rows].map(r=>r.map(v=>/["\r\n]/.test(v)||v.includes(sep)?`"${v.replaceAll('"','""')}"`:v).join(sep)).join('\n')+'\n';
}
