/** Universal ordering is shape; neither row membership nor observed gaps cross this boundary. */
import type {Table} from './tabular.ts';
import type {ColumnInventory} from './practice-independent.ts';
import {numericCell, independentColumn} from './practice-independent.ts';
import {dateInventory} from './practice-dates.ts';
import {missingValue,type StructureDeclaration} from './practice-structure.ts';
export interface ShapeOrder {lower:number;upper:number}
function value(cell:string,c:ColumnInventory):number|null {
 return c.kind==='date'?dateInventory(c.date!.templates)?.parse(cell)??null:numericCell(cell)?.value??null;
}
export function universalOrders(t:Table, inventories:readonly (ColumnInventory|null)[]):ShapeOrder[]{
 const out:ShapeOrder[]=[];
 // Parse each column once and short-circuit the first counterexample. Wide
 // genotype tables otherwise multiply a full row scan by every column pair.
 const columns=inventories.map((c,j)=>{
  if(!c||!['date','number'].includes(c.kind))return null;
  const parse=c.date?dateInventory(c.date.templates)?.parse:(v:string)=>numericCell(v)?.value??null;
  const values=t.rows.map(r=>parse?.(r[j]!)??null);
  return values.every((v,i)=>v===null?c.missing.some(m=>m.code===t.rows[i]![j]):v>=(c.date?.min??c.min)&&v<=(c.date?.max??c.max))?values:null;
 });
 for(let a=0;a<t.header.length;a++)for(let b=0;b<t.header.length;b++){
  const x=columns[a],y=columns[b];
  if(a===b||!x||!y||!x.length||inventories[a]!.kind!==inventories[b]!.kind)continue;
  let strict=false,ordered=true;
  for(let i=0;i<x.length;i++){if(x[i]===null||y[i]===null)continue;if(x[i]!>y[i]!){ordered=false;break;}if(x[i]!<y[i]!)strict=true;}
  if(ordered&&strict)out.push({lower:a,upper:b});
 }
 return out;
}
export function applyOrders(t:Table,d:StructureDeclaration,inventories:readonly (ColumnInventory|null)[],orders:readonly ShapeOrder[],seed:string):void{
 orders=orders.filter(o=>{const a=inventories[o.lower]!,b=inventories[o.upper]!;return (a.date?.max??a.max)>(b.date?.min??b.min);});
 if(!orders.length)return;
 const pending=new Set(orders.flatMap(o=>[o.lower,o.upper])),sorted:number[]=[];
 while(pending.size){const next=[...pending].find(j=>!orders.some(o=>o.upper===j&&pending.has(o.lower)));if(next===undefined)throw new Error('Cyclic practice shape order');pending.delete(next);sorted.push(next);}
 const upper=new Map<number,number>();
 for(const j of [...sorted].reverse()){
  const c=inventories[j]!;let cap=c.date?.max??c.max;
  for(const o of orders.filter(o=>o.lower===j))cap=Math.min(cap,upper.get(o.upper)!);
  upper.set(j,cap);
 }
 for(let i=0;i<t.rows.length;i++)for(const j of sorted){
  const c=inventories[j]!;if(missingValue(t.rows[i]![j]!,d.missing))continue;let lo=c.date?.min??c.min,hi=upper.get(j)!;
  for(const o of orders.filter(o=>o.upper===j)){const n=value(t.rows[i]![o.lower]!,inventories[o.lower]!);if(n!==null)lo=Math.max(lo,n);}
  if(c.date){const base=c.date.min,q=c.date.quantum;lo=base+Math.ceil((lo-base)/q)*q;hi=base+Math.floor((hi-base)/q)*q;}
  if(lo>hi)throw new Error('Infeasible practice shape order');
  const inventory={...c,unit:null,missing:[],min:lo,max:hi,...(c.date?{date:{...c.date,min:lo,max:hi}}:{})};
  const one={...t,rows:[t.rows[i]!]};
  t.rows[i]![j]=independentColumn(one,j,d,seed+':shape:'+i,inventory,false)[0]!;
 }
}
