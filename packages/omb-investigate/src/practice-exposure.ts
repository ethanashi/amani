import {dictionaryColumns} from './measurement-dictionary.ts';
import {dateInventory} from './practice-dates.ts';
/** Host randomization layer. It does not inspect measurement roles, values or proxy names.
 * Conditioning is limited to served design metadata. Outcome blinding remains independent.
 */
import { createHmac } from 'node:crypto';
import type { Table } from './tabular.ts';
import { missingValue, nonDataRows, PracticeStructureError, type StructureDeclaration } from './practice-structure.ts';
import { practiceReferences, canonicalKey } from './practice-references.ts';

function random(seed: string, context: string): () => number {
  let i = 0;
  return () => createHmac('sha256', seed).update(JSON.stringify([context, i++])).digest().readUInt32BE(0) / 2 ** 32;
}
function shuffle<T>(a: readonly T[], rand: () => number): T[] {
  const b = [...a];
  for (let i=b.length-1;i>0;i--) { const j=Math.floor(rand()*(i+1));[b[i],b[j]]=[b[j]!,b[i]!]; }
  return b;
}
export function opaqueKey(seed: string, value: string, numeric = false, namespace = ''): string {
  const hex = createHmac('sha256',seed).update(JSON.stringify(['practice-key/v3',namespace,value])).digest('hex');
  return numeric ? String(parseInt(hex.slice(0,12),16)) : `practice_${hex.slice(0,24)}`;
}

export function reassignExposure(real: Table, practice: Table, d: StructureDeclaration, seed: string): void {
  const ex = (d.exposures ?? []).map(n=>real.header.indexOf(n)).filter(j=>j>=0);
  if (!ex.length) return;
  if(d.randomization?.mode==='summary')return;

  if (d.randomization?.orderRequired) throw new PracticeStructureError(`Refusing answer-bearing required order: ${real.file}`);
  const candidates=d.units.filter(n=>!d.exposures?.includes(n)&&real.header.includes(n));
  const refines=(fine:string,coarse:string)=>{
    const a=real.header.indexOf(fine),b=real.header.indexOf(coarse),mapping=new Map<string,string>();
    for(const r of real.rows){const x=r[a]??'',y=r[b]??'';if(mapping.has(x)&&mapping.get(x)!==y)return false;mapping.set(x,y);}return true;
  };
  const coarsest=candidates.filter(c=>candidates.every(f=>refines(f,c)));
  if(!d.randomization?.unit&&candidates.length&&!coarsest.length)throw new PracticeStructureError('Unsafe crossed unit identities require a served randomization unit');
  const unit = d.randomization?.unit ?? coarsest[0];
  const uj = unit ? real.header.indexOf(unit) : -1;
  if (unit && uj<0) throw new PracticeStructureError(`Unsafe missing randomization unit: ${unit}`);
  const strata=(d.randomization?.strata ?? []).map(n=>real.header.indexOf(n));
  if (strata.some(j=>j<0 || ex.includes(j))) throw new PracticeStructureError('Unsafe served randomization strata');
  const units = new Map<string,number[]>();
  real.rows.forEach((r,i)=>{
    if (ex.some(j=>missingValue(r[j]??'',d.missing)) || uj>=0 && missingValue(r[uj]??'',d.missing)) throw new PracticeStructureError('Unsafe missing exposure or unit');
    const k=uj<0?String(i):r[uj]!;units.set(k,[...(units.get(k)??[]),i]);
  });
  const tuple=(i:number)=>JSON.stringify(ex.map(j=>real.rows[i]![j]));
  const put=(i:number,source:number)=>ex.forEach(j=>{practice.rows[i]![j]=real.rows[source]![j]!;});
  const blocks=[...units.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,b])=>b);
  const varying=blocks.map(b=>new Set(b.map(tuple)).size>1);
  const rand=random(seed,`exposure:${JSON.stringify(d.exposures)}`);
  if (varying.some(Boolean)) {
    // Repeated treatment periods / matched sets: swap complete treatment labels, so
    // observations at the same treatment period always move together. Concordant
    // sets have one label and a valid identity permutation; they do not make the
    // other sets unpaired. No outcome values participate in this allocation draw.
    for (const b of blocks) {
      const labels=[...new Map(b.map(i=>[tuple(i),i])).values()];
      const permutation=shuffle(labels,rand);
      for (const i of b) put(i,permutation[labels.findIndex(label=>tuple(label)===tuple(i))]!);
    }
  } else {
    const groups=new Map<string,number[][]>();
    for (const b of blocks) {
      const signatures=b.map(i=>JSON.stringify(strata.map(j=>real.rows[i]![j])));
      if (new Set(signatures).size!==1) throw new PracticeStructureError('Unsafe within-unit stratum variation');
      let group=groups.get(signatures[0]!);if(!group){group=[];groups.set(signatures[0]!,group);}group.push(b);
    }
    for (const group of groups.values()) {
      if (new Set(group.map(b=>tuple(b[0]!))).size<2) throw new PracticeStructureError('Unsafe exposure-constant randomization block');
      // Condition on declared group sizes, never invent size strata. Uniform
      // permutations accepted at the original weighted totals preserve both
      // cluster counts and row counts even with unequal cluster sizes.
      const totals=(labels:number[])=>{const m=new Map<string,number>();group.forEach((b,k)=>{const key=tuple(labels[k]!);m.set(key,(m.get(key)??0)+b.length);});return JSON.stringify([...m].sort());};
      const source=group.map(b=>b[0]!),target=totals(source);let labels:number[]|undefined;
      for(let attempt=0;attempt<4096;attempt++){const candidate=shuffle(source,rand);if(totals(candidate)===target){labels=candidate;break;}}
      if(!labels)throw new PracticeStructureError('Unsafe allocation: cannot sample the declared group sizes');
      group.forEach((b,k)=>b.forEach(i=>put(i,labels![k]!)));

    }
  }
}

/** Alias the complete discovered key component, using source values before any
 * row reordering. Equality is maintained across differently named FK columns.
 */
export function aliasPracticeKeys(real: readonly Table[], practice: readonly Table[], declarations: Readonly<Record<string,StructureDeclaration>>, seed: string): void {
  const refs=practiceReferences(real,declarations);
  const marked=new Set<string>();
  const id=(file:string,j:number)=>JSON.stringify([file,j]);
  for (const t of real) for (const name of declarations[t.file]?.keys??[]) {
    const j=t.header.indexOf(name);
    if (j>=0 && !dictionaryColumns(declarations[t.file]!).has(name) && !declarations[t.file]?.exposures?.includes(name) && !declarations[t.file]?.outcomes?.includes(name)) marked.add(id(t.file,j));
  }
  for(const r of refs)if(r.targetColumn!==null && !declarations[r.file]?.exposures?.includes(real.find(t=>t.file===r.file)!.header[r.column]!) && !declarations[r.target]?.exposures?.includes(real.find(t=>t.file===r.target)!.header[r.targetColumn]!)){marked.add(id(r.file,r.column));marked.add(id(r.target,r.targetColumn));}
  for (let change=true;change;) { change=false;for(const r of refs) {
    if(r.targetColumn===null)continue;
    const a=id(r.file,r.column),b=id(r.target,r.targetColumn);
    if(marked.has(a)!==marked.has(b)){marked.add(a);marked.add(b);change=true;}
  }}
  const resolved=resolvePracticeKeys(real,declarations);
  const namespaceStorage=new Map<string,boolean>();
  for(const d of Object.values(resolved))for(const [name,ns] of Object.entries(d.keyNamespaces??{})){
    const storage=d.formats?.[name]?.storage;
    if(storage==='string')namespaceStorage.set(ns,false);
    else if(storage&&!namespaceStorage.has(ns))namespaceStorage.set(ns,true);
  }
  for(const t of real){const p=practice.find(p=>p.file===t.file)!,d=resolved[t.file]!;
    for(let j=0;j<t.header.length;j++)if(marked.has(id(t.file,j)))t.rows.forEach((r,i)=>{
      const name=t.header[j]!,v=r[j]??'',ns=d.keyNamespaces?.[name]??'',separator=d.keySeparators?.[name];
      if(missingValue(v,d.missing))return;
      const storage=d.formats?.[name]?.storage;
      const numeric=d.formats?.[name]?.encoding==='decimal'||(namespaceStorage.get(ns)??(storage?storage!=='string':/^\d+$/.test(v)));
      p.rows[i]![j]=(separator?v.split(separator):[v]).map(value=>opaqueKey(seed,canonicalKey(value,d,name),numeric,ns)).join(separator??'');
    });
  }
}
export function reorderPractice(table: Table, seed: string): void {
  table.rows=shuffle(table.rows,random(seed,`row-order:${table.file}`));
}

/** Declared and exact discovered joins form one opaque identity graph. */
export function resolvePracticeKeys(real:readonly Table[],declarations:Readonly<Record<string,StructureDeclaration>>):Record<string,StructureDeclaration>{
 const result=Object.fromEntries(Object.entries(declarations).map(([file,d])=>[file,{...d,keys:[...d.keys],keyNamespaces:{...d.keyNamespaces}}]));
 const refs=practiceReferences(real,declarations);
 for(const r of refs){
  if(r.targetColumn===null)continue;
  for(const [file,j] of [[r.file,r.column],[r.target,r.targetColumn]] as const){const d=result[file]!,name=real.find(t=>t.file===file)!.header[j]!;if(!d.exposures?.includes(name)&&!d.outcomes?.includes(name)&&!d.keys.includes(name))d.keys.push(name);}
 }
 for(let pass=0;pass<real.length;pass++)for(const r of refs){const a=result[r.file]!,an=real.find(t=>t.file===r.file)!.header[r.column]!,b=result[r.target]!;if(r.targetColumn===null){if(b.matrixNamespace)a.keyNamespaces[an]=b.matrixNamespace;continue;}const bn=real.find(t=>t.file===r.target)!.header[r.targetColumn]!;const ns=a.keyNamespaces[an]??b.keyNamespaces[bn];if(ns){a.keyNamespaces[an]=ns;b.keyNamespaces[bn]=ns;}}
 return result;
}

/** Served matrix identity axes stay opaque keys regardless of plan role names.
 * A measurement-to-measurement estimand has no allocation labels to preserve. */
export function allocationDeclaration(t:Table,d:StructureDeclaration):StructureDeclaration {
 if(d.matrix)d={...d,...(d.outcomes?{outcomes:d.outcomes.filter(name=>!d.keys.includes(name))}:{}),...(d.exposures?{exposures:d.exposures.filter(name=>!d.keys.includes(name))}:{})};
 if(d.randomization?.mode==='summary'||!d.exposures?.length)return d;
 const continuous=d.exposures.some(name=>{
  const j=t.header.indexOf(name);if(j<0)return false;
  const values=t.rows.map(r=>r[j]??'').filter(v=>!missingValue(v,d.missing));
  if(dateInventory(values))return true;
  if(d.levels?.[name]||['categorical','category'].includes(d.roles?.[name]??''))return false;
  return values.length>0&&values.every(v=>Number.isFinite(Number(v)))&&new Set(values).size>2;
 });
 return continuous?{...d,randomization:{...d.randomization,mode:'summary'}}:d;
}
