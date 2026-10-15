import {decodeNestedJson,encodeNestedJson,type NestedJsonFormat} from './physical-json.ts';
import { codecPython } from './codec-runtime.ts';
/** Physical codecs are host-only. The descriptor never enters the published schema view. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Table } from './tabular.ts';
export interface TextFormat {
  kind: 'text'; encoding: 'utf8' | 'latin1' | 'utf16le'; bom: string; newline: string; trailing: boolean;
  quoted: boolean[][]; decimals: number[]; literalQuotes?: boolean;
}
export interface ContainerFormat { kind: 'xlsx' | 'zip'; path: string; sheet?: string; layout?: any; types?: string[][]; member?: string; compression?: number; inner?: PhysicalFormat; entries?: {name:string;compression:number;directory:boolean}[] }
export interface StatisticalFormat {kind:'xpt'|'sav'|'dta'|'parquet';path:string;storage:('number'|'integer'|'string'|'boolean')[];labels:Record<string,Record<string,string>>}
export type PhysicalFormat = TextFormat | ContainerFormat | StatisticalFormat | NestedJsonFormat;
const bridge = fileURLToPath(new URL('./physical-containers.py', import.meta.url));
function container(q: unknown): any {
  const python = codecPython();
  const r = spawnSync(python, [bridge], { input: JSON.stringify(q), encoding:'utf8', maxBuffer:256_000_000 });
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EACCES' || code === 'ENOTDIR') {
      throw new Error(`Physical format codec runtime unavailable (${code}): ${python}; provision the pinned host codec environment with pixi install --frozen --manifest-path packages/omb-investigate/format-runtime/pixi.toml before running an investigation`, { cause: r.error });
    }
  }
  if (r.status !== 0) throw new Error(`Physical format codec: ${r.stderr || r.error}`);
  return JSON.parse(r.stdout);
}
/** RFC-style records, including quoted delimiters, tabs and embedded newlines. */
export function parsePhysicalRecords(text: string, delimiter: string): {rows:string[][];quoted:boolean[][]} {
  const rows:string[][]=[], quotes:boolean[][]=[]; let row:string[]=[], qr:boolean[]=[], value='', inside=false, was=false;
  const cell=()=>{row.push(value);qr.push(was);value='';was=false;};
  for(let i=0;i<text.length;i++) { const c=text[i]!;
    if(inside) { if(c==='"'&&text[i+1]==='"'){value+='"';i++;}else if(c==='"')inside=false;else value+=c; }
    else if(c==='"'&&value===''){inside=true;was=true;}
    else if(c===delimiter)cell();
    else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;cell();rows.push(row);quotes.push(qr);row=[];qr=[];}
    else value+=c;
  }
  if(inside)throw new Error('Unterminated quoted field');
  if(value||row.length||was){cell();rows.push(row);quotes.push(qr);}
  return {rows,quoted:quotes};
}
const records = parsePhysicalRecords;
export function decodeText(file:string, bytes:Buffer):Table|null {
  let bom='',encoding:TextFormat['encoding']='utf8';
  if(bytes.subarray(0,3).equals(Buffer.from([239,187,191]))){bom='efbbbf';bytes=bytes.subarray(3);}
  else if(bytes.subarray(0,2).equals(Buffer.from([255,254]))){bom='fffe';bytes=bytes.subarray(2);encoding='utf16le';}
  if(encoding==='utf8')try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{encoding='latin1';}
  const text=bytes.toString(encoding);
  if(file.endsWith('.json')){
    const records:unknown=JSON.parse(text);if(!Array.isArray(records)||!records.length||records.some(r=>!r||typeof r!=='object'||Array.isArray(r)))return null;
    const nested=decodeNestedJson(file,records);if(nested)return nested;
    const header=[...new Set(records.flatMap(r=>Object.keys(r)))];
    return {file,delimiter:'json',header,rows:records.map(r=>header.map(k=>r[k]==null?'':typeof r[k]==='object'?JSON.stringify(r[k]):String(r[k])))};
  }
  const first=text.split(/\r?\n/,1)[0]??'';
  const delimiter=['\t',';',',','|'].map(d=>({d,n:records(first,d).rows[0]?.length??0})).sort((a,b)=>b.n-a.n)[0]!.d;
  // Served identity registries explicitly store JSON strings in unquoted TSV cells.
  // Those quotes belong to the JSON value, not to the enclosing TSV dialect.
  const literalQuotes=delimiter==='\t'&&first==='namespace\tencoding\toriginal\tcanonical\ttarget';
  const rawRows=text.replace(/(?:\r\n|\r|\n)$/,'').split(/\r\n|\r|\n/).map(r=>r.split(delimiter));
  const parsed=literalQuotes?{rows:rawRows,quoted:rawRows.map(r=>r.map(()=>false))}:records(text,delimiter);if(!parsed.rows.length)return null;
  const header=parsed.rows.shift()!,rows=parsed.rows;
  const decimals=header.flatMap((_,j)=>delimiter!==','&&rows.some(r=>/^[+-]?\d+,\d+$/.test(r[j]??''))&&rows.every(r=>!r[j]||/^[+-]?\d+(?:,\d+)?$/.test(r[j]!)||/^(NA|NaN|null)$/i.test(r[j]!))?[j]:[]);
  for(const r of rows)for(const j of decimals)r[j]=r[j]!.replace(',','.');
  return {file,delimiter,header,rows,physical:{kind:'text',encoding,bom,newline:text.includes('\r\n')?'\r\n':text.includes('\r')?'\r':'\n',trailing:/[\r\n]$/.test(text),quoted:parsed.quoted,decimals,...(literalQuotes?{literalQuotes:true}:{})}};
}
export function encodeText(t:Table):Buffer {
  const f=t.physical;if(f?.kind==='nested-json')return encodeNestedJson(t,f);if(!f||f.kind!=='text')return Buffer.from(t.delimiter==='json' ? JSON.stringify(t.rows.map(r=>Object.fromEntries(t.header.map((k,j)=>[k,r[j]??'']))))+'\n' : [t.header,...t.rows].map(r=>r.map(v=>v.includes(t.delimiter)||/["\r\n]/.test(v)?'"'+v.replaceAll('"','""')+'"':v).join(t.delimiter)).join('\n')+'\n');
  const text=[t.header,...t.rows].map((r,i)=>r.map((v,j)=>{
    if(i>0&&f.decimals.includes(j)&&/^[+-]?\d+(?:\.\d+)?$/.test(v)){if(!v.includes('.'))v+='.0';v=v.replace('.',',');}
    if(f.literalQuotes){if(v.includes(t.delimiter)||/[\r\n]/.test(v))throw new Error('Invalid literal TSV cell');return v;}
    return f.quoted.some(row=>row[j])||v.includes(t.delimiter)||/["\r\n]/.test(v)?'"'+v.replaceAll('"','""')+'"':v;
  }).join(t.delimiter)).join(f.newline)+(f.trailing?f.newline:'');
  if(f.encoding==='latin1'&&[...text].some(c=>c.charCodeAt(0)>255))throw new Error('Practice value is not representable in served encoding');
  return Buffer.concat([Buffer.from(f.bom,'hex'),Buffer.from(text,f.encoding)]);
}
export function readPhysical(file:string,name:string):Table[] { return decodePhysical(name,readFileSync(file)); }
function decodePhysical(name:string,bytes:Buffer):Table[] {
  const statistical=/\.(xpt|sav|dta|parquet)$/i.exec(name);
  if(statistical){const kind=statistical[1]!.toLowerCase() as StatisticalFormat['kind'];const t=container({op:'read',kind,bytes:bytes.toString('base64')});return [{file:name,delimiter:'\t',header:t.header,rows:t.rows,physical:{kind,path:name,storage:t.storage,labels:t.labels}}];}
  if(/\.xlsx$/i.test(name))return container({op:'read',kind:'xlsx',bytes:bytes.toString('base64')}).map((s:any)=>({file:`${name}::${s.sheet}`,delimiter:'\t',header:s.header,rows:s.rows,physical:{kind:'xlsx',path:name,sheet:s.sheet,layout:s.layout,types:s.types}}));
  if(/\.zip$/i.test(name)) {
    const entries=container({op:'read',kind:'zip',bytes:bytes.toString('base64')}) as any[];
    return entries.flatMap(e=>{if(e.directory)return [];if(!/\.(csv|tsv|txt)(\.gz)?$/i.test(e.name))throw new Error(`Unsupported archive member: ${e.name}`);
      return decodePhysical(e.name,Buffer.from(e.bytes,'base64')).map(t=>({...t,file:`${name}::${e.name}`,physical:{kind:'zip' as const,path:name,member:e.name,compression:e.compression,...(t.physical?{inner:t.physical}:{}),entries:entries.map(({name,compression,directory})=>({name,compression,directory}))}}));});
  }
  const t=decodeText(name,/\.gz$/i.test(name)?gunzipSync(bytes):bytes);return t?[t]:[];
}
export function physicalPath(t:Table):string{return t.physical&&t.physical.kind!=='text'?t.physical.path:t.file;}
export function writePhysical(dir:string,tables:readonly Table[]):void {
  const groups=new Map<string,Table[]>();for(const t of tables)groups.set(physicalPath(t),[...(groups.get(physicalPath(t))??[]),t]);
  for(const [name,ts] of groups){const f=path.join(dir,name);mkdirSync(path.dirname(f),{recursive:true});const p=ts[0]!.physical;
    let bytes:Buffer;
    if(p&&'storage' in p)bytes=Buffer.from(container({op:'write',kind:p.kind,tables:ts.map(t=>({...t,...t.physical}))}),'base64');
    else if(p&&p.kind==='xlsx')bytes=Buffer.from(container({op:'write',kind:p.kind,tables:ts.map(t=>({...t,...t.physical}))}),'base64');
    else if(p&&p.kind==='zip'){
      const members:Record<string,string>={};for(const e of p.entries??[])if(e.directory)members[e.name]='';
      for(const t of ts){const m=t.physical as ContainerFormat;const b=encodeText({...t,physical:m.inner!});members[m.member!]=(/\.gz$/i.test(m.member!)?gzipSync(b):b).toString('base64');}
      bytes=Buffer.from(container({op:'write',kind:p.kind,entries:p.entries,members}),'base64');
    }else {bytes=encodeText(ts[0]!);if(/\.gz$/i.test(name))bytes=gzipSync(bytes);}
    writeFileSync(f,bytes);
  }
}
/** Independent re-read checks actual bytes, never the generator's in-memory descriptor. */
export function formatSignature(t:Table):string {
  const p=t.physical;
  if(!p)return JSON.stringify({delimiter:t.delimiter});
  if(p.kind==='text')return JSON.stringify({file:t.file,delimiter:t.delimiter,encoding:p.encoding,bom:p.bom,newline:p.newline,trailing:p.trailing,quoted:t.header.map((_,j)=>p.quoted.some(row=>row[j])),decimals:p.decimals,literalQuotes:p.literalQuotes});
  if(p.kind==='nested-json')return JSON.stringify(p);
  if('storage' in p)return JSON.stringify({kind:p.kind,path:p.path,storage:p.storage,labels:p.labels});
  return JSON.stringify({kind:p.kind,path:p.path,sheet:p.sheet,layout:p.layout?{...p.layout,sheetOrder:[...p.layout.sheetOrder],formats:t.header.map((_,j)=>[...new Set(p.layout.formats.map((r:string[])=>r[j]))].sort()[0])}:undefined,member:p.member,compression:p.compression,entries:p.entries,inner:p.inner?formatSignature({...t,physical:p.inner}):null});
}

/** Inspect serialized containers independently of the structural descriptor. */
export function auditPhysicalMetadata(file:string):boolean {
  const kind=/\.(xlsx|zip|xpt|sav|dta|parquet)$/i.exec(file)?.[1]?.toLowerCase()??null;
  return !kind || container({op:'audit',kind,bytes:readFileSync(file).toString('base64')})===true;
}
