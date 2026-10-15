/** Practice v3: only keys, served design and inventories cross this boundary.
 * Each non-design column has a distinct PRF stream, including its missing mask.
 * No real non-design value is assigned back to its original observation.
 */
import {dictionaryColumns,dictionaryTextColumn,validateMeasurementDictionary} from './measurement-dictionary.ts';
import {createHmac} from 'node:crypto';
import type {Table} from './tabular.ts';
import {missingValue,type StructureDeclaration,type PracticeViolation} from './practice-structure.ts';
import {syntheticNumber} from './synthesis-values.ts';
import {summaryDomain} from './practice-summary.ts';
import {dateInventory} from './practice-dates.ts';
export function independentRandom(seed:string,context:string):()=>number{let i=0;return()=>createHmac('sha256',seed).update(JSON.stringify(['independent/v3',context,i++])).digest().readUInt32BE(0)/2**32;}
const shuffle=<T>(values:readonly T[],rand:()=>number):T[]=>{const a=[...values];for(let i=a.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[a[i],a[j]]=[a[j]!,a[i]!];}return a;};
export function trustedDesign(d:StructureDeclaration):Set<string>{
 const semantic=new Set([...(d.randomization?.strata??[]),...(d.randomization?.unit?[d.randomization.unit]:[]),...(d.randomization?.visit?[d.randomization.visit]:[])]);
 for(const name of d.randomization?.columns??[])if(!semantic.has(name)&&!d.keys.includes(name))throw new Error('Refusing arbitrary served design column');
 for(const name of new Set([...semantic,...(d.randomization?.columns??[])]))if(d.outcomes?.includes(name)||/^(outcome|measurement|response|endpoint|decimal)$/i.test(d.roles?.[name]??''))throw new Error('Refusing outcome or measurement in served design');
 return new Set([...semantic,...(d.randomization?.columns??[]),...(d.randomization?.mode==='summary'?[]:d.exposures??[])]);
}
export function naturalBlocks(t:Table,j:number,d:StructureDeclaration):number[][]{
 const rows=t.rows.map((_,i)=>[i]),candidates=d.randomization?.unit?[d.randomization.unit]:d.units;
 const choices=candidates.flatMap(unit=>{
  const uj=t.header.indexOf(unit);if(uj<0)return [];
  const blocks=new Map<string,number[]>();t.rows.forEach((r,i)=>{const k=missingValue(r[uj]??'',d.missing)?`missing:${i}`:r[uj]!;let b=blocks.get(k);if(!b){b=[];blocks.set(k,b);}b.push(i);});
  const b=[...blocks.values()];return b.every(indices=>indices.every(i=>t.rows[i]![j]===t.rows[indices[0]!]![j]))?[b]:[];
 });
 return choices.sort((a,b)=>a.length-b.length)[0]??rows;
}
interface Numeric {value:number;prefix:string;suffix:string;decimals:number;comma:boolean;exponent:boolean;plus:boolean}
export function numericCell(v:string):Numeric|null{
 const m=/^(\s*(?:[<>≤≥]=?\s*)?)([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?)(\s*(?:[%\p{L}µμ][\p{L}\p{N}µμ%/ .^−-]*)?)$/u.exec(v);if(!m)return null;
 const token=m[2]!,value=Number(token.replace(',','.'));if(!Number.isFinite(value))return null;
 return{value,prefix:m[1]!,suffix:m[3]!,decimals:token.split(/[.,]/)[1]?.split(/[eE]/)[0]?.length??0,comma:token.includes(','),exponent:/e/i.test(token),plus:token.startsWith('+')};
}
export interface ColumnInventory {
 kind:'number'|'date'|'levels'|'text'; unit:string|null; missing:{code:string;count:number}[];
 min:number;max:number;integer:boolean;levels:string[];formats:Omit<Numeric,'value'>[];
 date:null|{min:number;max:number;quantum:number;templates:string[]};
}
export function columnInventory(t:Table,j:number,d:StructureDeclaration):ColumnInventory {
 const name=t.header[j]!;
 if(dictionaryTextColumn(t,j,d))return {kind:'text',unit:null,missing:[],min:0,max:0,integer:false,levels:[],formats:[],date:null};
 if(d.measurementDictionary&&!dictionaryColumns(d).has(name)){const levels={...d.levels};delete levels[name];d={...d,levels,roles:{...d.roles,[name]:d.formats?.[name]?.storage==='integer'||d.roles?.[name]==='integer'?'integer':'decimal'}};t={...t,rows:t.rows.map(r=>r.map((v,k)=>k===j?v.trim():v))};}
 const values=t.rows.map(r=>r[j]??''),present=values.filter(v=>!missingValue(v,d.missing)),blocks=naturalBlocks(t,j,d);
 const unit=(d.randomization?.unit?[d.randomization.unit]:d.units).find(name=>{const uj=t.header.indexOf(name);return uj>=0&&blocks.length<t.rows.length&&blocks.every(b=>b.every(i=>t.rows[i]![uj]===t.rows[b[0]!]![uj]));})??null;
 const counts=new Map<string,{code:string;count:number}>();for(const b of blocks)if(missingValue(values[b[0]!]!,d.missing)){const code=values[b[0]!]!,c=counts.get(code)??{code,count:0};c.count+=b.length;counts.set(code,c);}
 const dates=dateInventory(present,d.randomization?.dateFormats?.[name]);
 if(!dates&&present.some(v=>/^\d{4}-\d{2}-\d{2}(?:[T ]|$)/.test(v)))throw new Error('Refusing unsupported or invalid date inventory');
 const numeric=present.map(numericCell),pool=numeric.filter((v):v is Numeric=>v!==null);
 const isNumeric=!d.levels?.[name]&&!['categorical','category'].includes(d.roles?.[name]??'')&&pool.length>0&&present.every((v,i)=>numeric[i]!==null||/^(?:[<>]=?\s*(?:LOD|LOQ)|ND|NQ)$/i.test(v));
 const levels=[...new Set(d.levels?.[name]??present)].sort(),freeText=!dates&&!isNumeric&&!d.levels?.[name]&&!['categorical','category'].includes(d.roles?.[name]??'')&&(levels.length>32||present.some(v=>/[\r\n=;]/.test(v)||v.length>100)||d.roles?.[name]==='text'&&!d.levels?.[name]&&present.some(v=>!/^[\p{L}µμ]+\/[\p{L}µμ]+$/u.test(v)));
 const summary=summaryDomain(t.header,name,d.bounds),format=d.formats?.[name]??(d.matrix?d.matrixCells:undefined);
 return {kind:dates?'date':isNumeric?'number':freeText?'text':'levels',unit,missing:[...counts.values()].sort((a,b)=>a.code.localeCompare(b.code)),
 min:isNumeric?(summary?.min??d.bounds?.[name]?.min??format?.min??pool.reduce((n,v)=>Math.min(n,v.value),Infinity)):0,
 max:isNumeric?(summary?.max??d.bounds?.[name]?.max??format?.max??pool.reduce((n,v)=>Math.max(n,v.value),-Infinity)):0,
 integer:!!isNumeric&&!summary&&(['integer','count'].includes(d.roles?.[name]??'')||pool.every(v=>Number.isInteger(v.value)&&!v.exponent&&v.decimals===0)),
 levels:isNumeric?levels.filter(v=>!numericCell(v)):freeText?[]:dates?[]:levels,
 formats:[...new Set(pool.map(({value,...f})=>JSON.stringify({...f,decimals:summary?Math.max(6,f.decimals):f.decimals})))].sort().map(s=>JSON.parse(s)),
 date:dates?{min:dates.min,max:dates.max,quantum:dates.quantum,templates:dates.templates}:null};
}
function fixedDecimal(value:number,places:number):string{
 if(places<=100)return value.toFixed(places);
 const [mantissa,exponent]=Math.abs(value).toExponential(16).split('e'),digits=mantissa!.replace('.',''),point=1+Number(exponent);
 const expanded=point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length)+'.':digits.slice(0,point)+'.'+digits.slice(point);
 const [whole,fraction='']=expanded.split('.');return (value<0?'-':'')+whole+'.'+fraction.padEnd(places,'0').slice(0,places);
}
export function independentColumn(t:Table,j:number,d:StructureDeclaration,seed:string,inventory?:ColumnInventory,enforceCoverage=true):string[]{
 const name=t.header[j]!,c=inventory??columnInventory(t,j,d),rand=independentRandom(seed,JSON.stringify([t.file,name]));
 const groups=new Map<string,number[]>();t.rows.forEach((r,i)=>{const value=c.unit?r[t.header.indexOf(c.unit)]!:'';const key=c.unit&&!missingValue(value,d.missing)?JSON.stringify(['unit',value]):JSON.stringify(['row',i]);const g=groups.get(key)??[];g.push(i);groups.set(key,g);});
 const blocks=[...groups.values()],missing=new Map<number,string>();
 // Only per-column missing row totals enter this draw. Never condition on
 // the source distribution across unit sizes (that is a joint relationship).
 if(c.missing.length){let assigned=false;
  for(let attempt=0;attempt<4096&&!assigned;attempt++){
   missing.clear();const slots=shuffle(blocks.map((_,i)=>i),rand);
   for(const m of shuffle(c.missing,rand)){let remaining=m.count;
    for(const k of slots)if(!missing.has(k)&&blocks[k]!.length<=remaining){missing.set(k,m.code);remaining-=blocks[k]!.length;if(!remaining)break;}
    if(remaining)break;
   }
   assigned=c.missing.every(m=>[...missing].reduce((n,[k,code])=>n+(code===m.code?blocks[k]!.length:0),0)===m.count);
  }
  if(!assigned)throw new Error('Infeasible whole-unit missingness inventory');
 }
 const result=t.rows.map(()=>''),dates=c.date?dateInventory(c.date.templates,d.randomization?.dateFormats?.[name]):null;
 const format=d.formats?.[name]??(d.matrix?d.matrixCells:undefined);
 const draw=()=>{
  if(c.kind==='date'){if(!dates||!c.date)throw new Error('Invalid date inventory');return dates.render(c.date.min+Math.floor(rand()*(Math.floor((c.date.max-c.date.min)/c.date.quantum)+1))*c.date.quantum,rand());}
  if(c.kind==='number'){
   const index=Math.floor(rand()*(c.formats.length+c.levels.length));if(index>=c.formats.length)return c.levels[index-c.formats.length]!;
   const p=c.formats[index]!,lo=c.min,hi=c.max,v=c.integer?Math.ceil(lo)+Math.floor(rand()*(Math.floor(hi)-Math.ceil(lo)+1)):lo+rand()*(hi-lo);
   let s=c.integer?String(v):p.exponent?v.toExponential(Math.max(3,p.decimals)):fixedDecimal(v,p.decimals);
   if(format?.precision&&format.precision!=='exact'||format?.resolution)s=syntheticNumber({name,type:c.integer?'integer':'number',missing:0,distinct:0,levels:null,min:lo,max:hi},{...format,...(c.integer?{storage:'integer' as const}:{}),min:lo,max:hi},rand);
   if(Number(s)>hi||Number(s)<lo)s=String(v);if(p.comma)s=s.replace('.',',');if(p.plus&&v>=0)s='+'+s;return p.prefix+s+p.suffix;
  }
  if(c.kind==='text')return 'practice-redacted';
  return c.levels.length?c.levels[Math.floor(rand()*c.levels.length)]!:(d.missing?.[0]??'');
 };
 blocks.forEach((b,k)=>{const value=missing.get(k)??draw();for(const i of b)result[i]=value;});
 if(!enforceCoverage)return result;
 // Fixed one-per-level floor, never source frequencies. Repeated key strata
 // include dictionary joins; a versioned registry also covers its latest rows.
 const levels=c.kind==='levels'?c.levels:c.kind==='number'&&c.integer&&c.max-c.min===1?[String(c.min),String(c.max)]:[];
 const available=blocks.flatMap((_,k)=>missing.has(k)?[]:[k]),coverageGroups:number[][]=[available];
 const strata=[...new Set([...d.keys,...trustedDesign(d)])].filter(n=>n!==name);
 const addGroups=(eligible:Set<number>)=>{for(const key of strata){const at=t.header.indexOf(key);if(at<0)continue;const partition=new Map<string,number[]>();for(const k of available){if(!eligible.has(k))continue;const v=t.rows[blocks[k]![0]!]![at]!;if(!v||missingValue(v,d.missing))continue;const g=partition.get(v)??[];g.push(k);partition.set(v,g);}for(const g of partition.values())if(g.length>=Math.max(2,levels.length))coverageGroups.push(g);}};
 addGroups(new Set(available));
 const revision=t.header.findIndex(n=>/^(revision|version)$/i.test(n));
 if(revision>=0&&revision!==j)for(const key of d.keys){const at=t.header.indexOf(key);if(at<0)continue;const latest=new Map<string,number>();for(const k of available){const row=t.rows[blocks[k]![0]!]!,old=latest.get(row[at]!);if(old===undefined||Number(row[revision])>=Number(t.rows[blocks[old]![0]!]![revision]))latest.set(row[at]!,k);}if(latest.size<available.length)addGroups(new Set(latest.values()));}
 const set=(k:number,v:string)=>{for(const i of blocks[k]!)result[i]=v;};
 if(levels.length>available.length)throw new Error(`Infeasible fixed practice level coverage: ${t.file}:${name} (${available.length} slots, ${levels.length} levels)`);
 if(levels.length){
  const eligible=coverageGroups.filter(g=>g.length>=levels.length),complete=(g:number[])=>levels.every(v=>g.some(k=>result[blocks[k]![0]!]===v));
  for(let pass=0;pass<4096&&!eligible.every(complete);pass++)for(const g of shuffle(eligible,rand)){
   for(const v of shuffle(levels,rand))if(!g.some(k=>result[blocks[k]![0]!]===v)){
    const counts=new Map<string,number>();for(const k of g){const value=result[blocks[k]![0]!]!;counts.set(value,(counts.get(value)??0)+1);}
    const donors=shuffle(g.filter(k=>counts.get(result[blocks[k]![0]!]!)!>1),rand);
    if(donors.length)set(donors[0]!,v);
   }
  }
  if(!eligible.every(complete))throw new Error('Infeasible fixed practice level coverage');
 }
 if(c.kind==='number'&&c.min<c.max&&!levels.length)for(const g of coverageGroups.filter(g=>g.length>=2)){
  if(new Set(g.map(k=>numericCell(result[blocks[k]![0]!]!)?.value)).size===1){
   // Regenerate from the column domain, with a seed-local retry budget.
   for(let tries=0;tries<256&&new Set(g.map(k=>numericCell(result[blocks[k]![0]!]!)?.value)).size===1;tries++)set(g[g.length-1]!,draw());
   if(new Set(g.map(k=>numericCell(result[blocks[k]![0]!]!)?.value)).size===1)throw new Error('Degenerate practice numeric subset');
  }
 }
 return result;
}
export function independentRecords(t:Table,d:StructureDeclaration,seed:string,inventories?:readonly ColumnInventory[]):Table{
 const rows=t.rows.map(r=>[...r]),design=trustedDesign(d);
 // Matrix sample columns share one feasible cell domain. Independently drawing
 // from disjoint sample-specific ranges would itself disclose a group contrast.
 if(d.matrix){
  const cells=t.header.flatMap((name,j)=>d.keys.includes(name)||d.formats?.[name]?[]:[{name,j}]);
  let min=-Infinity,max=Infinity;const domains:typeof cells=[];
  for(const c of cells){const values=t.rows.map(r=>r[c.j]!).filter(v=>!missingValue(v,d.missing)).map(numericCell);if(!values.length||values.some(v=>!v))continue;domains.push(c);min=Math.max(min,values.reduce((n,v)=>Math.min(n,v!.value),Infinity));max=Math.min(max,values.reduce((n,v)=>Math.max(n,v!.value),-Infinity));}
  if(domains.length){if(min>max)throw new Error('Refusing answer-bearing disjoint matrix cell domains');d={...d,bounds:{...d.bounds,...Object.fromEntries(domains.map(c=>[c.name,{min,max}]))}};}
 }

 // Date-valued design indices preserve slot identity and order, never real gaps.
 for(const name of design){
  const j=t.header.indexOf(name);if(j<0||d.keys.includes(name)||d.exposures?.includes(name))continue;
  const present=t.rows.map(r=>r[j]!).filter(v=>!missingValue(v,d.missing)),dates=dateInventory(present,d.randomization?.dateFormats?.[name]);if(!dates)continue;
  const levels=[...new Set(present)].sort((a,b)=>dates.parse(a)!-dates.parse(b)!),ticks=Math.floor((dates.max-dates.min)/dates.quantum)+1;
  if(levels.length>1&&ticks<=levels.length)throw new Error('Refusing date index without fresh interval capacity');
  const rand=independentRandom(seed,JSON.stringify([t.file,name,'fresh-design-dates'])),selected=new Set<number>();
  for(let i=ticks-levels.length;i<ticks;i++){const candidate=Math.floor(rand()*(i+1));selected.add(selected.has(candidate)?i:candidate);}
  const values=[...selected].sort((a,b)=>a-b).map(i=>dates.render(dates.min+i*dates.quantum)),mapping=new Map(levels.map((v,i)=>[v,values[i]!]));
  rows.forEach(r=>{if(mapping.has(r[j]!))r[j]=mapping.get(r[j]!)!;});
 }
 for(let j=0;j<t.header.length;j++){
  const name=t.header[j]!;
  if(d.keys.includes(name)&&!d.outcomes?.includes(name)||design.has(name))continue;
  const values=independentColumn(t,j,d,seed,inventories?.[j]);rows.forEach((r,i)=>{r[j]=values[i]!;});
 }
 // Only explicitly served inequalities authorize dependence among numeric values.
 for(const bound of d.randomization?.inequalities??[]){
  const j=t.header.indexOf(bound.lower),upper=t.header.indexOf(bound.upper);if(j<0||upper<0)throw new Error('Served bound references an absent column');
  const values=t.rows.map(r=>numericCell(r[j]??'')).filter((n):n is Numeric=>n!==null),lo=d.bounds?.[bound.lower]?.min??Math.min(...values.map(n=>n.value));
  const hi=d.bounds?.[bound.lower]?.max??Math.max(...values.map(n=>n.value)),integer=values.every(n=>Number.isInteger(n.value));
  const rand=independentRandom(seed,JSON.stringify([t.file,bound,'served-bound']));
  for(const block of naturalBlocks(t,j,d)){
   const slots=block.filter(i=>!missingValue(rows[i]![j]!,d.missing)&&!missingValue(rows[i]![upper]!,d.missing));if(!slots.length)continue;
   const cap=Math.min(hi,...slots.map(i=>Number(rows[i]![upper])));if(cap<lo)throw new Error('Served bound has no feasible practice domain');
   const value=integer?String(Math.ceil(lo)+Math.floor(rand()*(Math.floor(cap)-Math.ceil(lo)+1))):String(lo+rand()*(cap-lo));
   for(const i of slots)rows[i]![j]=value;
  }
 }
 // Ordering constraints come only from the served contract; original gaps are not read.
 for(const shape of d.randomization?.increasing??[]){
  const j=t.header.indexOf(shape.column),uj=t.header.indexOf(shape.unit??d.randomization?.unit??''),index=t.header.indexOf(shape.index??d.randomization?.visit??'');
  if(j<0||uj<0)throw new Error('Served date/order constraint references an absent column or unit');
  const groups=new Map<string,number[]>();rows.forEach((r,i)=>{const key=r[uj]!;groups.set(key,[...(groups.get(key)??[]),i]);});
  const date=dateInventory(rows.map(r=>r[j]!).filter(v=>!missingValue(v,d.missing)),d.randomization?.dateFormats?.[shape.column]);
  for(const b of groups.values()){
   const slots=b.filter(i=>!missingValue(rows[i]![j]!,d.missing)).sort((a,b)=>index<0?a-b:Number(rows[a]![index])-Number(rows[b]![index]));
   const values=slots.map(i=>rows[i]![j]!).sort((a,b)=>(date?.parse(a)??Number(a))-(date?.parse(b)??Number(b)));
   slots.forEach((i,k)=>{rows[i]![j]=values[k]!;});
  }
 }
 return {...t,rows};
}
/** Inventory check independent of generation decisions: never compare joint profiles. */
export function checkIndependentInventory(t:Table,p:Table,d:StructureDeclaration):PracticeViolation[]{
 if(d.measurementDictionary)validateMeasurementDictionary(d.measurementDictionary);const fixed=dictionaryColumns(d);
 if(d.measurementDictionary){const levels={...d.levels},roles={...d.roles};t.header.forEach((name,j)=>{if(!fixed.has(name)&&!dictionaryTextColumn(t,j,d)){delete levels[name];roles[name]=d.formats?.[name]?.storage==='integer'||d.roles?.[name]==='integer'?'integer':'decimal';}});d={...d,levels,roles};}
 const failures:PracticeViolation[]=[];
 if(JSON.stringify(t.header)!==JSON.stringify(p.header)||t.rows.length!==p.rows.length)return[{file:t.file,check:'shape',detail:'practice schema or row count changed'}];
 const multiplicities=(table:Table,indices:number[])=>{const m=new Map<string,number>();for(const r of table.rows){const v=JSON.stringify(indices.map(j=>r[j]));m.set(v,(m.get(v)??0)+1);}return JSON.stringify([...m.values()].sort((a,b)=>a-b));};
 const keys=d.keys.filter(k=>!d.exposures?.includes(k)&&!d.outcomes?.includes(k)).map(k=>t.header.indexOf(k)).filter(j=>j>=0);
 for(const js of [...keys.map(j=>[j]),...(keys.length?[keys]:[])])if(multiplicities(t,js)!==multiplicities(p,js))failures.push({file:t.file,check:'key-shape',detail:'identity cardinality or one-to-many shape changed'});
 const unit=d.randomization?.unit??(d.units.length===1?d.units[0]:undefined),uj=unit?t.header.indexOf(unit):-1;
 const design=[...trustedDesign(d)].filter(n=>!d.keys.includes(n)&&!d.exposures?.includes(n)).map(n=>t.header.indexOf(n)).filter(j=>j>=0);
 const signatures=(table:Table,cols:number[])=>{
  const ranks=new Map<number,Map<string,number>>();for(const j of cols){const values=table.rows.map(r=>r[j]!).filter(v=>!missingValue(v,d.missing)),date=dateInventory(values,d.randomization?.dateFormats?.[table.header[j]!]);if(date)ranks.set(j,new Map([...new Set(values)].sort((a,b)=>date.parse(a)!-date.parse(b)!).map((v,i)=>[v,i])));}
  const m=new Map<string,string[]>();table.rows.forEach((r,i)=>{const k=uj<0?String(i):r[uj]!,value=JSON.stringify(cols.map(j=>ranks.get(j)?.get(r[j]!)??r[j]));const block=m.get(k);if(block)block.push(value);else m.set(k,[value]);});return JSON.stringify([...m.values()].map(v=>v.sort()).sort());};
 if(design.length&&signatures(t,design)!==signatures(p,design))failures.push({file:t.file,check:'design',detail:'served design slots changed'});
 for(const exposure of d.randomization?.mode==='summary'?[]:d.exposures??[]){const j=t.header.indexOf(exposure);if(j>=0){const counts=(table:Table)=>JSON.stringify(table.rows.map(r=>r[j]).sort());const allocation=new Map<string,string>();let paired=false;if(uj>=0)for(const r of t.rows){const key=r[uj]!,value=r[j]!;if(allocation.has(key)&&allocation.get(key)!==value){paired=true;break;}allocation.set(key,value);}if(counts(t)!==counts(p)||paired&&signatures(t,[j])!==signatures(p,[j]))failures.push({file:t.file,check:'allocation',detail:'exposure allocation sizes or pairing changed'});}}
 for(let j=0;j<t.header.length;j++){
  const name=t.header[j]!;if(dictionaryTextColumn(t,j,d)){if(p.rows.some(r=>r[j]!=='practice-redacted'))failures.push({file:t.file,check:'inventory',detail:`${name} must be redacted dictionary text`});continue;}if(fixed.has(name)||d.keys.includes(name)&&!d.outcomes?.includes(name))continue;
  const a=t.rows.map(r=>r[j]??''),b=p.rows.map(r=>r[j]??''),present=a.filter(v=>!missingValue(v,d.missing)),generated=b.filter(v=>!missingValue(v,d.missing));
  const date=dateInventory(present,d.randomization?.dateFormats?.[name]),numeric=present.map(numericCell);
  let bad=false;
  if(date)bad=generated.some(v=>{const n=date.parse(v);return n===null||n<date.min||n>date.max;});
  else if(!d.levels?.[name]&&!['categorical','category'].includes(d.roles?.[name]??'')&&present.length&&numeric.some(n=>n!==null)&&present.every((v,i)=>numeric[i]!==null||/^(?:[<>]=?\s*(?:LOD|LOQ)|ND|NQ)$/i.test(v))){
   const numericPool=numeric.filter((n):n is Numeric=>n!==null);
   const summary=summaryDomain(t.header,name,d.bounds),format=d.formats?.[name]??(d.matrix?d.matrixCells:undefined);
   const lo=summary?.min??d.bounds?.[name]?.min??format?.min??numericPool.reduce((a,n)=>Math.min(a,n.value),Infinity),hi=summary?.max??d.bounds?.[name]?.max??format?.max??numericPool.reduce((a,n)=>Math.max(a,n.value),-Infinity);
   const integer=!summary&&(['integer','count'].includes(d.roles?.[name]??'')||numericPool.every(n=>Number.isInteger(n.value)&&n.decimals===0&&!n.exponent));
   bad=generated.some(v=>{const n=numericCell(v);if(!n)return !present.includes(v);return n.value<lo-1e-10||n.value>hi+1e-10||integer&&!Number.isInteger(n.value);});
  }else if(d.levels?.[name])bad=generated.some(v=>!d.levels![name]!.includes(v));
  if(bad)failures.push({file:t.file,check:'inventory',detail:`${name} violates its permitted type/domain/format`});
  if(a.filter(v=>missingValue(v,d.missing)).length!==b.filter(v=>missingValue(v,d.missing)).length)failures.push({file:t.file,check:'missingness',detail:`${name} changed its missing count`});
 }
 for(const bound of d.randomization?.inequalities??[]){const a=t.header.indexOf(bound.lower),b=t.header.indexOf(bound.upper);if(a<0||b<0||p.rows.some(r=>!missingValue(r[a]??'',d.missing)&&!missingValue(r[b]??'',d.missing)&&Number(r[a])>Number(r[b])))failures.push({file:t.file,check:'bounds',detail:`served ${bound.lower} <= ${bound.upper} violated`});}
 return failures;
}
