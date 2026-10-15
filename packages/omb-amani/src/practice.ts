import {auditDictionaryProjection} from '../../omb-investigate/src/measurement-dictionary.ts';
import {compilePractice,renderPractice} from '../../omb-investigate/src/practice-provenance.ts';
import {independentRecords,checkIndependentInventory} from '../../omb-investigate/src/practice-independent.ts';
import { auditPracticeLeakage } from '../../omb-investigate/src/practice-audit.ts';
import { reassignExposure, aliasPracticeKeys, reorderPractice, opaqueKey, allocationDeclaration } from '../../omb-investigate/src/practice-exposure.ts';
import path from 'node:path';
import { readPhysical, writePhysical } from '../../omb-investigate/src/physical-format.ts';
import { createHmac } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Table } from '../../omb-investigate/src/tabular.ts';
import { parseTable, formatTable } from '../../omb-investigate/src/tabular.ts';
import { ambiguousPracticeBound, blindRecordTable, hasOutcomeRole, missingValue, nonDataRows, practiceStructure, swapKeepsBounds, type PracticeStructure, type StructureDeclaration } from '../../omb-investigate/src/practice-structure.ts';
import type { Task } from './task.ts';
import { blindCorrelation } from './practice-correlation.ts';

export function random(seed: string, context: string): () => number {
  let i = 0;
  return () => createHmac('sha256', seed).update(JSON.stringify([context, i++])).digest().readUInt32BE(0) / 2 ** 32;
}
export function permute<T>(values: readonly T[], rand: () => number): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}
export function readTable(file: string, name: string): Table | null {
  const physical = file.split('::')[0]!;
  return readPhysical(physical, name.split('::')[0]!).find(t=>t.file===name) ?? null;
}
export function writeTable(file: string, table: Table): void {
  const base=file.split('::')[0]!, name=table.file.split('::')[0]!;
  if(table.physical && table.physical.kind!=='text') {
    const others=readPhysical(base,name).filter(t=>t.file!==table.file);
    writePhysical(base.slice(0,-name.length),[...others,table]);
  } else writePhysical(file.slice(0,-table.file.length),[table]);
}
export function integerNamespace(task: Task, ns?: string): boolean {
  const members = task.identity.flatMap(d => d.columns ?? []).filter(c => c.namespace === ns);
  return !!ns && members.some(c => c.storage === 'integer') && !members.some(c => c.storage === 'string');
}
/** Only the served vocabulary's join/coordinate roles are structural. Alleles
 * are exempt only as an explicitly declared pair beside a variant key/coordinate;
 * an unknown role (even on an allele-looking column) is blinded by default. */
function declaredColumns(table: Table, task: Task): { name: string; role?: string }[] {
  const contract = task.publicContract as any;
  const tables = contract?.structure?.tables ?? contract?.tables ?? [];
  const declared = tables.find((t: any) => String(t.path ?? t.file?.path ?? t.file).replace(/^data\//, '') === table.file)?.columns;
  if (declared) return declared;
  const d=task.identity.find(d=>d.file===table.file);
  return d?.columns?.map(c=>({...c,name:c.name,role:d.identifiers.includes(c.name)?'id':c.storage==='number'?'decimal':c.storage==='integer'?'integer':c.levels?'categorical':'text'})) ?? [];
}
export function practiceKeyColumns(table: Table, task: Task): Set<string> {
  const columns = declaredColumns(table, task);
  const keys = new Set(columns.filter(c => ['id','identifier','unit','key'].includes(c.role ?? '')).map(c => c.name));
  return keys;
}
/** Served-contract practice declaration of one record table: structural keys,
 * entity units (identifiers, never coordinates or alleles), roles and levels. */
export function practiceDeclaration(file: string, task: Task): StructureDeclaration {
  const d = task.identity.find(d => d.file === file);
  const columns = declaredColumns({ file, delimiter: '\t', header: [], rows: [] }, task) as { name: string; role?: string; namespace?: string }[];
  const keys = [...new Set([...practiceKeyColumns({ file, delimiter: '\t', header: [], rows: [] }, task), ...(d?.identifiers ?? []).filter(name=>!['chromosome','position'].includes(columns.find(c=>c.name===name)?.role??''))])];
  const units = columns.filter(c=>c.namespace==='unit'||c.role==='unit').map(c=>c.name);
  const declared = d?.columns ?? [];
  const contract=task.publicContract as any;
  const table=(contract?.structure?.tables??contract?.tables??[]).find((t:any)=>String(t.path??t.file?.path??t.file).replace(/^data\//,'')===file);
  const design=table?.randomization??table?.design??contract?.design;
  if(design && typeof design==='object') {
    const semantic=new Set([...['unit','cluster','pair','visit','timeIndex'].map(k=>design[k]),...(design.blindingStrata??[])]);
    if((design.columns??[]).some((name:string)=>!semantic.has(name)))throw new Error('Refusing arbitrary served design.columns: use explicit unit/cluster/pair/strata/visit/index semantics');
    if(columns.some(c=>semantic.has(c.name)&&/^(outcome|measurement|response|endpoint|decimal)$/i.test(c.role??'')))throw new Error('Refusing measurement or outcome in served design');
  }
  const randomization=design && typeof design==='object'?{
    ...(design.mode==='summary'?{mode:'summary' as const}:{}),
    ...(typeof (design.cluster??design.pair??design.unit)==='string'?{unit:design.cluster??design.pair??design.unit}:{}),
    columns:[...new Set([...(Array.isArray(design.columns)?design.columns:[]),...['unit','cluster','pair','visit','timeIndex'].map(k=>design[k]).filter(x=>typeof x==='string')])],
    ...(typeof (design.visit??design.timeIndex)==='string'?{visit:design.visit??design.timeIndex}:{}),
    ...(Array.isArray(design.increasing)?{increasing:design.increasing.filter((b:any)=>columns.some(c=>c.name===b.column))}:{}),
    ...(Array.isArray(design.inequalities)?{inequalities:design.inequalities.filter((b:any)=>columns.some(c=>c.name===b.lower)&&columns.some(c=>c.name===b.upper))}:{}),
    ...(design.dateFormats?{dateFormats:design.dateFormats}:{}),
    ...(Array.isArray(design.blindingStrata)?{strata:design.blindingStrata.filter((x:unknown):x is string=>typeof x==='string')}:{}),
    ...(design.orderRequired===true?{orderRequired:true}:{})
  }:undefined;
  return { ...(d?.measurementDictionary?{measurementDictionary:d.measurementDictionary}:{}),matrix:d?.matrix??false, ...(d?.headerNamespace?{matrixNamespace:d.headerNamespace}:{}), ...(d?.cells?{matrixCells:d.cells}:{}), formats:Object.fromEntries(declared.map(c=>[c.name,c])), keyNamespaces:Object.fromEntries(declared.filter(c=>c.namespace).map(c=>[c.name,c.namespace!])), keySeparators:Object.fromEntries(declared.filter(c=>c.separator).map(c=>[c.name,c.separator!])), keys, units, ...(randomization?{randomization,units:randomization.unit?[randomization.unit]:units}:{}), roles: Object.fromEntries(columns.map(c => [c.name, c.role])),
    levels: Object.fromEntries(declared.filter(c => c.levels?.length).map(c => [c.name, c.levels!])),
    bounds: Object.fromEntries(declared.filter(c => c.min !== undefined || c.max !== undefined).map(c => [c.name, { ...(c.min !== undefined ? { min: c.min } : {}), ...(c.max !== undefined ? { max: c.max } : {}) }])),
    missing: d?.missing ?? null };
}
/** The practice structure of a declared record table (null for matrices). */
export function cardPracticeStructure(real: Table, task: Task, declaration?: StructureDeclaration): PracticeStructure | null {
  const d = task.identity.find(d => d.file === real.file);
  return d && !d.matrix ? practiceStructure(real, declaration ?? practiceDeclaration(real.file, task)) : null;
}
/** Refuse before mounting: no non-key column may be the original column, except a
 * design column the real table proves structural (it must then be exactly the
 * original, and it can never carry an outcome or measurement role). A degenerate numeric/
 * categorical column cannot be safely permuted; refuse it rather than quietly
 * calling it a key or manufacturing an invalid category. */
export function assertPracticeBlinded(real: Table, practice: Table, task: Task, declaration?: StructureDeclaration,context?:{real:readonly Table[];practice:readonly Table[];declarations:Readonly<Record<string,StructureDeclaration>>}): void {
 const d=allocationDeclaration(real,declaration??practiceDeclaration(real.file,task));
 const schema=task.identity.find(t=>t.file===real.file);
 const comparable=schema?.matrix?{...practice,header:real.header}:practice;
 const failures=checkIndependentInventory(real,comparable,d);
 const graph=d.measurementDictionary?context:undefined;
 const dictionary=auditDictionaryProjection(graph?.real??[real],graph?.practice??[practice],graph?.declarations??{[real.file]:d});failures.push(...dictionary.failures);
 const fixed=dictionary.fields.get(real.file);
 for(let j=0;j<real.header.length;j++){
  const name=real.header[j]!;
  if(fixed?.has(name)||d.keys.includes(name)&&!d.outcomes?.includes(name)||d.exposures?.includes(name)||d.randomization?.columns?.includes(name)||d.headerReferences?.includes(j))continue;
  const values=real.rows.map(r=>r[j]);
  if(new Set(values).size>1&&real.rows.every((r,i)=>r[j]===practice.rows[i]?.[j]))failures.push({file:real.file,check:'unchanged',detail:`unchanged non-key column ${name}`});
 }
 failures.push(...auditPracticeLeakage(graph?.real??[real],graph?.practice??[practice],graph?.declarations??{[real.file]:d}));
 if(failures.length)throw new Error(`Refusing practice leakage or invalid structure: ${failures[0]!.detail}`);
}
export function blindTable(table: Table, task: Task, seed: string, declaration?: StructureDeclaration, deferGraph = false): Table {
 const schema=task.identity.find(d=>d.file===table.file);
 if(!schema)throw new Error(`No contract roles for practice table: ${table.file}`);
 const d=allocationDeclaration(table,declaration??practiceDeclaration(table.file,task));
 if(!deferGraph)return renderPractice(compilePractice([table],{[table.file]:d},task.identity,seed))[0]!;
 const result=independentRecords(table,d,seed);
 reassignExposure(table,result,d,seed);
 if(schema.matrix)blindCorrelation(table,result,schema,seed);
 if(!deferGraph){
  aliasPracticeKeys([table],[result],{[table.file]:d},seed);
  if(schema.matrix)result.header=result.header.map(h=>schema.fixedHeaders.includes(h)?h:opaqueKey(seed,h));
  reorderPractice(result,seed);
 }
 return result;
}
