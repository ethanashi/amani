import { casefold } from './casefold.ts';
import { detectNearDuplicates } from '../../bio-checks/src/validity/duplicates.ts';
import type { ParsedStageTable } from './stage-parser.ts';
/** Value identity, independent of headers. Missing values are never identities. */
export function normalizeId(value:string):string {
  return casefold(value.normalize('NFKC').replace(/[\p{Cf}\s]/gu,'')).replace(/\d+/g,s=>s.replace(/^0+(?=\d)/,''));
}
export const missingId=(v:string)=>/^(?:|na|nan|null|none|n\/a|\.)$/.test(normalizeId(v));
export function identityColumns(t:Pick<ParsedStageTable,'header'|'rows'>,model:readonly string[]=[]):number[] {
  return t.header.flatMap((name,c)=>{
    if(model.includes(name))return [];
    const values=t.rows.map(r=>normalizeId(r[c]!)).filter(v=>!missingId(v)),distinct=new Set(values).size;
    // At least two identifiers and a nontrivial partition. Binary measurements alone
    // are insufficient; string IDs can describe a two-donor experiment.
    const strings=values.some(v=>!Number.isFinite(Number(v)));
    const integers=values.every(v=>/^[+-]?\d+$/.test(v))&&distinct>=3;
    return distinct>=2&&(strings||integers)?[c]:[];
  });
}
export function identityRelated(a:string,b:string):boolean {
  a=normalizeId(a);b=normalizeId(b);
  return a===b||a.startsWith(b+'-')||b.startsWith(a+'-')||a.startsWith(b+'_')||b.startsWith(a+'_');
}
export function assertCoarse(t:ParsedStageTable,model:readonly string[]=[],nonBiological:readonly string[]=[]):void {
  for(const c of identityColumns(t,model)){
    if(nonBiological.includes(t.header[c]!))continue;
    const units=new Map<string,string>();
    for(let i=0;i<t.rows.length;i++){
      const key=normalizeId(t.rows[i]![c]!),unit=normalizeId(t.donor[i]!);
      if(units.has(key)&&units.get(key)!==unit)throw new Error(`${t.file}: declared unit splits a detected biological unit (${t.header[c]})`);
      units.set(key,unit);
    }
  }
}
/** Refuse inconsistent links; never merge local numbering across cohorts by itself. */
export function assertCrossIdentity(tables:readonly ParsedStageTable[],models:Readonly<Record<string,readonly string[]>>={},nonBio:Readonly<Record<string,readonly string[]>>={}):void {
  const index=new Map<string,{table:string;unit:string}[]>();
  for(const t of tables.filter(t=>t.axis==='rows')){
    const cols=identityColumns(t,models[t.file]??['x','y','p','simple']).filter(c=>!nonBio[t.file]?.includes(t.header[c]!));
    for(let i=0;i<t.rows.length;i++)for(const c of cols){
      const key=normalizeId(t.rows[i]![c]!),unit=normalizeId(t.donor[i]!);
      // Delimiter prefixes make barcode containment an indexed lookup.
      const keys=[key,...key.split(/[-_]/).slice(0,-1).map((_,j)=>key.split(/[-_]/).slice(0,j+1).join(key.includes('-')?'-':'_'))];
      for(const k of keys){const prior=index.get(k)??[];for(const p of prior)if(p.table!==t.file&&p.unit!==unit)throw new Error(`${t.file}: declared units split a biological identity across tables (${p.table})`);}
      const list=index.get(key)??[];list.push({table:t.file,unit});index.set(key,list);
    }
  }
  // Reverse prefix direction (short patient table after long sample table).
  const keys=[...index.keys()].sort();
  for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length&&keys[j]!.startsWith(keys[i]!);j++)if(identityRelated(keys[i]!,keys[j]!)){
    for(const a of index.get(keys[i]!)!)for(const b of index.get(keys[j]!)!)if(a.table!==b.table&&a.unit!==b.unit)throw new Error(`${b.table}: barcode biological identity across tables (${a.table})`);
  }
  // Equal local IDs are not permission to union separate cohorts. Content must agree.
  for(let a=0;a<tables.length;a++)for(let b=a+1;b<tables.length;b++){
    const left=tables[a]!,right=tables[b]!;if(left.axis!=='rows'||right.axis!=='rows')continue;
    const ids=new Map(left.ids.map((id,i)=>[normalizeId(id),i]));
    const shared=left.header.filter(h=>right.header.includes(h)&&!identityColumns(left,models[left.file]??['x','y']).includes(left.header.indexOf(h))&&h!=='unit_id');
    for(let j=0;j<right.ids.length;j++){const i=ids.get(normalizeId(right.ids[j]!));if(i===undefined||!/^[a-z_-]*\d+$/.test(normalizeId(right.ids[j]!)))continue;
      if(shared.length<3||new Set(shared.map(h=>left.rows[i]![left.header.indexOf(h)])).size<3||shared.some(h=>left.rows[i]![left.header.indexOf(h)]!==right.rows[j]![right.header.indexOf(h)]))throw new Error(`${right.file}: ambiguous local identity overlap with ${left.file}`);
    }
  }
}
export interface DuplicateFinding { table:string; otherTable:string; left:string; right:string; kind:'exact'|'near'|'unavailable'; }
/** Hash all-but-one fields, then verify: deterministic candidate generation, no
 * quadratic full row search. Missing tokens stay comparable, never per-ID salted. */
export function contentFindings(tables:readonly ParsedStageTable[],models:Readonly<Record<string,readonly string[]>>={}):DuplicateFinding[] {
  const out:DuplicateFinding[]=[],seen=new Set<string>();
  for(let a=0;a<tables.length;a++)for(let b=a;b<tables.length;b++){
    const l=tables[a]!,r=tables[b]!;if(l.axis!=='rows'||r.axis!=='rows'||l.dictionary||r.dictionary)continue;
    const isIdentity=(t:ParsedStageTable,c:number)=>t.header[c]==='unit_id'||t.rows.every((row,i)=>normalizeId(row[c]!)===normalizeId(t.ids[i]!)||normalizeId(row[c]!)===normalizeId(t.donor[i]!))||identityColumns(t,models[t.file]??['x','y','p','simple']).includes(c)&&t.rows.every(row=>!Number.isFinite(Number(row[c])));
    const fields=l.header.filter((h,c)=>!isIdentity(l,c)&&r.header.includes(h)&&!isIdentity(r,r.header.indexOf(h)));
    if(fields.length<2)continue;
    const lc=fields.map(h=>l.header.indexOf(h)),rc=fields.map(h=>r.header.indexOf(h));
    const values=(t:ParsedStageTable,i:number,cols:number[])=>cols.map(c=>missingId(t.rows[i]![c]!)?'NA':t.rows[i]![c]!.trim());
    const index=new Map<string,number[]>();
    for(let i=0;i<l.rows.length;i++){
      const v=values(l,i,lc);for(let omit=-1;omit<(fields.length>=3?fields.length:0);omit++){
        const key=JSON.stringify([omit,v.filter((_,j)=>j!==omit)]),list=index.get(key)??[];list.push(i);index.set(key,list);
      }
    }
    for(let j=0;j<r.rows.length;j++){
      const v=values(r,j,rc),candidates=new Set<number>();for(let omit=-1;omit<(fields.length>=3?fields.length:0);omit++)for(const i of index.get(JSON.stringify([omit,v.filter((_,k)=>k!==omit)]))??[])candidates.add(i);
      for(const i of candidates){if(a===b&&i>=j||normalizeId(l.donor[i]!)===normalizeId(r.donor[j]!)&&a===b)continue;
        const u=values(l,i,lc),diff=u.flatMap((x,k)=>x!==v[k]?[k]:[]),informative=u.filter(x=>x!=='NA').length;
        const near=diff.length===1&&informative>=3&&Number.isFinite(Number(u[diff[0]!] ))&&Number.isFinite(Number(v[diff[0]!] ))&&Math.abs(Number(u[diff[0]!])-Number(v[diff[0]!]))<=.001*Math.max(Math.abs(Number(u[diff[0]!])),Math.abs(Number(v[diff[0]!])));
        if(diff.length&& !near)continue;
        const key=JSON.stringify([l.file,i,r.file,j]);if(seen.has(key))continue;seen.add(key);out.push({table:l.file,otherTable:r.file,left:l.ids[i]!,right:r.ids[j]!,kind:diff.length?'near':'exact'});
      }
    }
  }
  const matrices=tables.filter(t=>t.axis==='columns'),families=new Map<string,ParsedStageTable[]>();
  for(const t of matrices){const key=JSON.stringify(t.annotations),list=families.get(key)??[];list.push(t);families.set(key,list);}
  for(const family of families.values()){
    const vectors=family.flatMap(t=>t.columns.flatMap((vector,i)=>informativeProfile(t,i)&&[...vector].every(Number.isFinite)?[{id:`${t.file}:${i}`,vector,t,i}]:[]));
    if(vectors.length<2)continue;
    const report=detectNearDuplicates({rows:vectors.map(v=>({id:v.id,vector:v.vector})),idField:'id',vectorOf:'vector'}),byId=new Map(vectors.map(v=>[v.id,v]));
    const pair=(ids:readonly string[],kind:DuplicateFinding['kind'])=>{const a=byId.get(ids[0]!)!,b=byId.get(ids[1]!)!;out.push({table:a.t.file,otherTable:b.t.file,left:a.t.ids[a.i]!,right:b.t.ids[b.i]!,kind});};
    if(report.status==='invalid'){for(const t of family)out.push({table:t.file,otherTable:t.file,left:'unavailable',right:'unavailable',kind:'unavailable'});continue;}
    for(const p of report.pairs)pair(p.ids,'near');
    for(const g of report.identicalGroups)for(let i=1;i<g.length;i++)pair([g[0]!,g[i]!],'exact');
  }
  return out;
}
export function informativeProfile(t:ParsedStageTable,i:number):boolean {
  const v=t.columns[i];if(!v)return false;
  const finite=[...v].filter(Number.isFinite);return finite.length>=3&&new Set(finite).size>=3&&finite.length>=v.length/2;
}
/** Prediction provenance comparison includes every staged table, not a worker-selected
 * training table. A shared local ID is ambiguous and therefore cannot prove a split. */
export function assertHeldOutDisjoint(held:ParsedStageTable,tables:readonly ParsedStageTable[],models:Readonly<Record<string,readonly string[]>>={}):string[] {
 const values=(t:ParsedStageTable)=>new Set([...t.ids,...t.donor,...identityColumns(t,models[t.file]??['x','y','p','simple']).flatMap(c=>t.rows.map(r=>r[c]!))].map(normalizeId));
 const a=values(held),checked:string[]=[];
 for(const t of tables){if(t.file===held.file||t.dictionary)continue;checked.push(t.file);const b=values(t);
  const prefixes=(v:string)=>v.split(/[-_]/).map((_,i)=>v.split(/[-_]/).slice(0,i+1).join(v.includes('-')?'-':'_'));
  if([...a].some(v=>prefixes(v).some(p=>b.has(p)))||[...b].some(v=>prefixes(v).some(p=>a.has(p))))throw new Error(`${held.file}: held-out identity overlaps ${t.file}`);
 }
 const content=contentFindings([held,...tables.filter(t=>t.file!==held.file)],models).filter(f=>f.table!==f.otherTable&&(f.table===held.file||f.otherTable===held.file));
 if(content.length)throw new Error(`${held.file}: held-out content overlap with ${content[0]!.otherTable}`);
 return checked;
}
