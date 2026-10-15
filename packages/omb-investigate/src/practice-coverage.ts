/** Fixed-floor cohort coverage using only generated values and admitted key/design slots. */
import type {AllowedPractice} from './practice-provenance.ts';
import type {Table} from './tabular.ts';
import {independentRandom} from './practice-independent.ts';
export function coverJoinedCohorts(tables:Table[],input:AllowedPractice):void {
 const flags=input.tables.flatMap((t,ti)=>t.inventories.flatMap((c,j)=>
  c?.kind==='number'&&c.integer&&c.min===0&&c.max===1&&/^(?:active|included|eligible|keep|selected|retained)$/i.test(t.header[j]!)&&!t.declaration.outcomes?.includes(t.header[j]!)?[{ti,j,c}]:[]));
 if(!flags.length)return;
 const neighbours=input.tables.map((a,i)=>input.tables.flatMap((b,k)=>{
  const keys=a.declaration.keys.filter(n=>b.declaration.keys.includes(n));return i!==k&&keys.length?[{ti:k,keys}]:[];
 }));
 type Ref={ti:number;ri:number};
 const refs=(ti:number,ri:number,seen:Set<number>):Ref[]|null=>{
  const next=new Set([...seen,ti]),result:Ref[]=[{ti,ri}],row=tables[ti]!.rows[ri]!;
  for(const edge of neighbours[ti]!.filter(e=>!next.has(e.ti))){
   const target=tables[edge.ti]!;
   let matches=target.rows.flatMap((r,k)=>edge.keys.every(n=>r[target.header.indexOf(n)]===row[tables[ti]!.header.indexOf(n)])?[k]:[]);
   if(!matches.length)return null;
   const revision=target.header.findIndex(n=>/^(revision|version)$/i.test(n));
   if(revision>=0){const greatest=Math.max(...matches.map(k=>Number(target.rows[k]![revision])));matches=matches.filter(k=>Number(target.rows[k]![revision])===greatest);}
   for(const k of matches){const more=refs(edge.ti,k,next);if(!more)return null;result.push(...more);}
  }
  return result;
 };
 const groups:Ref[][][]=[];
 for(const [ti,t] of input.tables.entries())for(const name of new Set([...(t.declaration.exposures??[]),...Object.keys(t.declaration.levels??{})])){
  const j=t.header.indexOf(name);if(j<0||flags.some(f=>f.ti===ti&&f.j===j)||t.declaration.outcomes?.includes(name))continue;
  const levels=t.declaration.levels?.[name]??t.inventories[j]?.levels??[];
  for(const level of levels){const witnesses=tables[ti]!.rows.flatMap((r,ri)=>{if(r[j]!==level)return [];const joined=refs(ti,ri,new Set());return joined?[joined]:[];});
   if(witnesses.length>=2)groups.push(witnesses);
  }
 }
 if(!groups.length)return;
 const eligible=(w:Ref[])=>w.every(r=>flags.filter(f=>f.ti===r.ti).every(f=>tables[r.ti]!.rows[r.ri]![f.j]==='1'));
 const covered=()=>groups.every(g=>g.filter(eligible).length>=2);
 const cells=flags.flatMap(f=>{
  const t=tables[f.ti]!,units=new Map<string,number[]>();
  t.rows.forEach((r,ri)=>{if(!['0','1'].includes(r[f.j]!))return;const key=f.c.unit?r[t.header.indexOf(f.c.unit)]!:String(ri);const list=units.get(key)??[];list.push(ri);units.set(key,list);});
  return [...units.values()].map(rows=>({...f,rows}));
 });
 for(const c of cells)for(const ri of c.rows)tables[c.ti]!.rows[ri]![c.j]='1';
 if(!covered())throw Error('Infeasible fixed joined-cohort coverage');
 const random=independentRandom(input.seed,'joined-cohort-floor/v1');
 const ordered=cells.map(c=>({c,rank:random()})).sort((a,b)=>a.rank-b.rank).map(x=>x.c);
 for(const c of ordered){
  // Seed-local fresh occupancy; never inherit real eligibility frequencies.
  if(random()>=.5&&cells.some(x=>x.ti===c.ti&&x.j===c.j&&tables[x.ti]!.rows[x.rows[0]!]![x.j]==='0'))continue;
  for(const ri of c.rows)tables[c.ti]!.rows[ri]![c.j]='0';
  if(!covered())for(const ri of c.rows)tables[c.ti]!.rows[ri]![c.j]='1';
 }
 for(const f of flags)if(!tables[f.ti]!.rows.some(r=>r[f.j]==='0'))throw Error('Infeasible eligibility level floor');
}
