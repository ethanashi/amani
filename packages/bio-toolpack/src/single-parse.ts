// V2 staging engine for `omb-check gates --handling collapse --single-parse`.
// One parse per table. Matrix content lives in typed columns, never millions of JS objects.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { delimited } from '../../bio-pipeline/src/validity.ts';
export interface ParsedStageTable {
  file: string; sha256: string; bytes: number; axis: 'rows'|'columns'; header: string[];
  ids: string[]; donor: string[]; signatures: string[]; rows: string[][];
  columns: Float64Array[]; annotations: string[][]; annotationCount: number;
  sparse: number; dictionary: boolean;
}
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const missing = (s: string) => /^(?:|na|nan|n\/a|null|none|\.)$/i.test(s.trim());
const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
function unique(ids: string[]): void {
  if (!ids.length || ids.some(id=>!id.trim()||missing(id)) || new Set(ids).size!==ids.length) throw new Error('missing or repeated identities');
}
export function parseStageTable(file: string, bytes: Buffer): ParsedStageTable {
  const text=bytes.toString('utf8').replace(/^\uFEFF/,''), ext=path.extname(file).toLowerCase();
  const base={file,sha256:hash(bytes),bytes:bytes.length,sparse:0,dictionary:false};
  if (!['.csv','.tsv','.json'].includes(ext)) throw new Error('unsupported staged table');
  let records: string[][];
  if (ext === '.json') {
    const objects: unknown=JSON.parse(text);
    if (!Array.isArray(objects)||!objects.length||objects.some(o=>!o||typeof o!=='object'||Array.isArray(o))) throw new Error('invalid JSON table');
    const header=Object.keys(objects[0] as object);
    if (objects.some(o=>Object.keys(o).join('\0')!==header.join('\0'))) throw new Error('ragged JSON table');
    records=[header,...objects.map(o=>header.map(k=>{
      const v=(o as Record<string,unknown>)[k];
      if (typeof v!=='string'&&typeof v!=='number') throw new Error('non-scalar table value'); return String(v);
    }))];
  } else if (!text.includes('"')) {
    // Native split is much faster than per-character concatenation on the 287 MB w0 matrix.
    records=text.replace(/\r?\n$/,'').split(/\r?\n/).map(line=>line.split(ext==='.tsv'?'\t':','));
  } else records=delimited(text,ext==='.tsv'?'\t':',');
  const header=records.shift()!;
  if (!header||records.length===0||new Set(header).size!==header.length||header.some(h=>!h.trim())||records.some(r=>r.length!==header.length)) throw new Error('empty or ragged table');
  let annotationCount=0;
  while (/^(?:hugo_symbol|entrez_gene_id|gene(?:_?id)?|symbol|feature)$/i.test(header[annotationCount]??'')) annotationCount++;
  if (annotationCount>0 && annotationCount<header.length) {
    const ids=header.slice(annotationCount); unique(ids); unique(records.map(r=>r[0]!));
    const columns=ids.map(()=>new Float64Array(records.length));
    const gaps=new Uint32Array(ids.length);
    for (let r=0;r<records.length;r++) for (let c=0;c<ids.length;c++) {
      const cell=records[r]![c+annotationCount]!;
      const number=cell.trim()===''?NaN:Number(cell);
      if(cell!==''&&Number.isFinite(number))columns[c]![r]=number||0;
      else if(missing(cell)){columns[c]![r]=NaN;gaps[c]=gaps[c]!+1;}
      else throw new Error('nonnumeric matrix');
    }
    const signatures=columns.map(c=>hash(new Uint8Array(c.buffer)));
    // Sparse vectors never establish content identity. Keep them distinct, report the warning.
    let sparse=0; gaps.forEach((gap,i)=>{const count=records.length-gap;if(count<Math.min(3,records.length)||count<records.length/2){signatures[i]=hash('sparse:'+ids[i]);sparse++;}});
    const annotations=records.map(r=>r.slice(0,annotationCount));
    return {...base,sparse,axis:'columns',header,ids,donor:[...ids],signatures,rows:records,columns,annotations,annotationCount};
  }
  const idCandidates=header.map((h,i)=>({h,i,rank:/^(?:sample_?id|sample|id)$/i.test(h)?3:/^(?:patient_?id|patient)$/i.test(h)?2:/^(?:donor|cellline|attribute)(?:_?id)?$/i.test(h)?1:0}))
    .filter(c=>c.rank>0&&new Set(records.map(r=>r[c.i])).size===records.length&&records.every(r=>!missing(r[c.i]!)));
  const rank=Math.max(...idCandidates.map(c=>c.rank)), best=idCandidates.filter(c=>c.rank===rank);
  if(best.length!==1) throw new Error('ambiguous identity; staging declaration required');
  const idIndex=best[0]!.i, ids=records.map(r=>r[idIndex]!);unique(ids);
  const donorIndices=header.map((h,i)=>/^(?:donor|patient|cellline)(?:_?id)?$/i.test(h)&&i!==idIndex?i:-1).filter(i=>i>=0);
  if(donorIndices.length>1) throw new Error('ambiguous biological unit');
  const donorIndex=donorIndices[0]??idIndex, donor=records.map(r=>r[donorIndex]!);
  if(donor.some(missing)) throw new Error('missing biological unit');
  const content=header.map((_,i)=>i).filter(i=>i!==idIndex&&i!==donorIndex&&header[i]!=='unit_id');
  if(!content.length) throw new Error('no comparison content');
  let sparse=0;
  const signatures=records.map((r,i)=>{
    const cells=content.map(c=>r[c]!); const informative=cells.filter(c=>!missing(c)).length;
    if(informative<Math.min(3,cells.length)||informative<cells.length/2){sparse++;return hash('sparse:'+ids[i]);}
    return canonicalSha256(cells);
  });
  const dictionary=['ATTRIBUTE_ID','LEVEL','DATATYPE','DISPLAY_NAME','DESCRIPTION'].every(h=>header.map(x=>x.toUpperCase()).includes(h));
  return {...base,sparse,dictionary,axis:'rows',header,ids,donor,signatures,rows:records,columns:[],annotations:[],annotationCount:0};
}
export interface SingleParseStage { tables: ParsedStageTable[]; groups: string[][]; document: Record<string,unknown>; manifestHash: string; }
/** Cross-table duplicates merge only when every table that contains both IDs agrees.
 * Biological donor identity always merges before splitting. Dictionaries are not subjects. */
export function singleParseGates(dir: string, onParse?: (file:string)=>void): SingleParseStage {
  const files=readdirSync(dir).sort().filter(f=>f!=='manifest.json');
  if(!files.length) throw new Error('no staged tables');
  const tables=files.map(file=>{const full=path.join(dir,file);if(!lstatSync(full).isFile())throw new Error('staged links/directories refused'); const bytes=readFileSync(full);onParse?.(file);return parseStageTable(file,bytes);});
  const subjects=tables.filter(t=>!t.dictionary), ids=[...new Set(subjects.flatMap(t=>t.ids))], parent=new Map(ids.map(id=>[id,id]));
  const root=(id:string):string=>{let p=parent.get(id);if(!p)throw new Error('orphan unit');while(p!==parent.get(p))p=parent.get(p)!;return p;};
  const merge=(a:string,b:string)=>{parent.set(root(b),root(a));};
  const lookups=subjects.map(t=>new Map(t.ids.map((id,i)=>[id,i])));
  const donorOf=new Map<string,string>();
  for(const t of subjects)if(t.axis==='rows')t.ids.forEach((id,i)=>{const donor=t.donor[i]!;if(donor!==id){const prior=donorOf.get(id);if(prior&&prior!==donor)throw new Error('inconsistent donor identity');donorOf.set(id,donor);}});
  const rowFor=(id:string,table:number):number|undefined=>lookups[table]!.get(id)??lookups[table]!.get(donorOf.get(id)??id);
  subjects.forEach((t,ti)=>{
    const seen=new Map<string,string>(), donors=new Map<string,string>();
    t.ids.forEach((id,i)=>{
      const previous=seen.get(t.signatures[i]!);
      if(previous && subjects.every((other,oi)=>{
        const a=rowFor(previous,oi),b=rowFor(id,oi);
        return a===undefined||b===undefined||other.signatures[a]===other.signatures[b]||other.donor[a]===other.donor[b];
      }))merge(previous,id);else seen.set(t.signatures[i]!,id);
      if(t.axis==='rows'){const donor=t.donor[i]!, peer=donors.get(donor);if(peer)merge(peer,id);else donors.set(donor,id);}
    });
    void ti;
  });
  for(const [sample,donor] of donorOf)if(parent.has(donor))merge(donor,sample);
  // Sample tables referencing a separate patient table must have complete joins.
  let orphans=0;
  for(const t of subjects)if(t.axis==='rows'&&t.ids.some((id,i)=>id!==t.donor[i])){
    const patient=subjects.find(other=>other!==t&&other.ids.some(id=>t.donor.includes(id)));
    if(patient)orphans+=t.donor.filter(id=>!patient.ids.includes(id)).length;
  }
  const groupsByRoot=new Map<string,string[]>();for(const id of ids){const r=root(id),g=groupsByRoot.get(r)??[];g.push(id);groupsByRoot.set(r,g);}
  const groups=[...groupsByRoot.values()];
  const datasets=tables.map(t=>{
    const groupsLocal=new Map<string,string[]>();t.ids.forEach(id=>{const r=t.dictionary?id:root(id),g=groupsLocal.get(r)??[];g.push(id);groupsLocal.set(r,g);});
    const units=[...groupsLocal.values()];return {file:t.file,allowed:orphans===0,effectiveN:units.length,rowCount:t.ids.length,units,
      findings:[{name:'single-parse full-content and biological units',passed:true},{name:'orphan references',passed:orphans===0}],sparseRows:t.sparse};
  });
  return {tables,groups,manifestHash:canonicalSha256(tables.map(t=>({file:t.file,sha256:t.sha256,bytes:t.bytes}))),
    document:{status:orphans?'blocked':'allowed',exitCode:orphans?1:0,evidence:{allowed:orphans===0,datasets},handling:'collapse',engine:'single-parse-v2'}};
}
export function effectiveTable(t: ParsedStageTable, groups: readonly (readonly string[])[]): string {
  const byId=new Map<string,string>();groups.forEach(g=>g.forEach(id=>byId.set(id,g[0]!)));
  const seen=new Set<string>(), keep=t.ids.map((id,i)=>({i,unit:byId.get(id)??id})).filter(({unit})=>{if(seen.has(unit))return false;seen.add(unit);return true;});
  const sep=t.file.endsWith('.csv')?',':'\t', cell=(v:string)=>/["\r\n]/.test(v)||v.includes(sep)?`"${v.replaceAll('"','""')}"`:v;
  const lines=(rows:string[][])=>rows.map(r=>r.map(cell).join(sep)).join('\n')+'\n';
  if(t.axis==='columns'){
    const output=[lines([[...t.header.slice(0,t.annotationCount),...keep.map(k=>t.ids[k.i]!) ]])];
    for(let r=0;r<t.annotations.length;r++)output.push(t.annotations[r]!.map(cell).join(sep)+sep+keep.map(k=>t.rows[r]![k.i+t.annotationCount]).join(sep)+'\n');
    return output.join('');
  }
  const existing=t.header.indexOf('unit_id');
  if(existing>=0&&t.rows.some((r,i)=>r[existing]!==byId.get(t.ids[i]!)))throw new Error('worker unit_id conflicts with software units');
  const header=existing<0?[...t.header,'unit_id']:t.header;
  const rows=keep.map(k=>existing<0?[...t.rows[k.i]!,k.unit]:t.rows[k.i]!);
  return t.file.endsWith('.json')?JSON.stringify(rows.map(r=>Object.fromEntries(header.map((h,i)=>[h,r[i]]))))+'\n':lines([header,...rows]);
}
