import type {Table} from './tabular.ts';
export interface NestedJsonFormat {kind:'nested-json';path:string;paths:string[][];types:('string'|'number'|'boolean')[]}
/** Flatten leaves, never stringify an entire object into a free-text inventory. */
export function decodeNestedJson(file:string,records:Record<string,unknown>[]):Table|null {
 if(!records.some(r=>Object.values(r).some(v=>v!==null&&typeof v==='object')))return null;
 const paths:string[][]=[],types:(NestedJsonFormat['types'][number]|null)[]=[],index=new Map<string,number>(),objects=new Set<string>();
 function walk(v:unknown,p:string[],row:Map<number,string>){
  if(Array.isArray(v))throw new Error('Nested JSON arrays require an explicit array schema');
  if(v!==null&&typeof v==='object'){const name=p.join('.');if(index.has(name))throw new Error('Inconsistent nested JSON object/leaf path');objects.add(name);for(const [k,x] of Object.entries(v)){if(!k||k.includes('.')||p.length>16)throw new Error('Ambiguous or excessive nested JSON path');walk(x,[...p,k],row);}return;}
  const name=p.join('.');if(objects.has(name))throw new Error('Inconsistent nested JSON object/leaf path');let j=index.get(name);const type=v===null?null:typeof v;
  if(type!==null&&!['string','number','boolean'].includes(type))throw new Error('Unsupported JSON leaf');
  if(j===undefined){j=paths.length;index.set(name,j);paths.push(p);types.push(type as NestedJsonFormat['types'][number]|null);}
  else if(type!==null){if(types[j]===null)types[j]=type as NestedJsonFormat['types'][number];else if(types[j]!==type)throw new Error('Mixed nested JSON leaf storage');}
  row.set(j,v===null?'':typeof v==='boolean'?(v?'1':'0'):String(v));
 }
 const rows=records.map(r=>{const row=new Map<number,string>();walk(r,[],row);return row;});
 return {file,delimiter:'json',header:paths.map(p=>p.join('.')),rows:rows.map(r=>paths.map((_,j)=>r.get(j)??'')),physical:{kind:'nested-json',path:file,paths,types:types.map(type=>type??'string')}};
}
export function encodeNestedJson(t:Table,p:NestedJsonFormat):Buffer {
 const records=t.rows.map(row=>{const record:Record<string,any>=Object.create(null);p.paths.forEach((parts,j)=>{let node=record;for(const k of parts.slice(0,-1)){node[k]??=Object.create(null);node=node[k];}const v=row[j]??'';node[parts.at(-1)!]=v===''?null:p.types[j]==='number'?Number(v):p.types[j]==='boolean'?v==='1':v;});return record;});
 return Buffer.from(JSON.stringify(records)+'\n');
}
