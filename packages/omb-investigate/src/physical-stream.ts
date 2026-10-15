/** Bounded record streaming with the same physical codec as small tables. */
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';
import { decodeText, parsePhysicalRecords, type TextFormat } from './physical-format.ts';
import type { Table } from './tabular.ts';
const source=(file:string)=>file.endsWith('.gz')?createReadStream(file).pipe(createGunzip()):createReadStream(file);
async function encoding(file:string):Promise<Pick<TextFormat,'encoding'|'bom'>> {
 let first=true,bom='',kind:TextFormat['encoding']='utf8',valid=true;const decoder=new TextDecoder('utf8',{fatal:true});
 for await(const chunk of source(file)) {let b=Buffer.from(chunk);if(first){first=false;if(b.subarray(0,3).equals(Buffer.from('efbbbf','hex'))){bom='efbbbf';b=b.subarray(3);}else if(b.subarray(0,2).equals(Buffer.from('fffe','hex'))){return {encoding:'utf16le',bom:'fffe'};}}
  if(valid)try{decoder.decode(b,{stream:true});}catch{valid=false;}
 }
 if(valid)try{decoder.decode();}catch{valid=false;}
 if(!valid)kind='latin1';return {encoding:kind,bom};
}
async function* records(file:string,format:Pick<TextFormat,'encoding'|'bom'>):AsyncGenerator<{text:string;ending:string}> {
 const decoder=new StringDecoder(format.encoding);let first=true,pending='',quoted=false,cr=false;
 function* consume(text:string){for(const c of text){
  if(cr){cr=false;if(c==='\n'){yield {text:pending,ending:'\r\n'};pending='';continue;}yield {text:pending,ending:'\r'};pending='';}
  if(c==='"')quoted=!quoted;
  if(!quoted&&c==='\r'){cr=true;continue;}
  if(!quoted&&c==='\n'){yield {text:pending,ending:'\n'};pending='';continue;}
  pending+=c;if(pending.length>8_000_000)throw new Error('Delimited record exceeds 8 MB streaming cap');
 }}
 for await(const chunk of source(file)){let b=Buffer.from(chunk);if(first){first=false;b=b.subarray(format.bom.length/2);}yield* consume(decoder.write(b));}
 yield* consume(decoder.end());if(quoted)throw new Error('Unterminated quoted field');if(cr)yield {text:pending,ending:'\r'};else if(pending)yield {text:pending,ending:''};
}
export interface PhysicalRecord { table:Table; ending:string }
export async function* physicalRecords(file:string,name:string):AsyncGenerator<PhysicalRecord> {
 const e=await encoding(file);let header:Table|undefined;
 for await(const record of records(file,e)){
  if(!header){header=decodeText(name,Buffer.concat([Buffer.from(e.bom,'hex'),Buffer.from(record.text+record.ending,e.encoding)]))!;if(!header)continue;yield {table:header,ending:record.ending};continue;}
  const f=header.physical as TextFormat;
  const p=f.literalQuotes?{rows:[record.text.split(header.delimiter)],quoted:[header.header.map(()=>false)]}:parsePhysicalRecords(record.text,header.delimiter);
  // Blank records are physical records too. Retain their shape.
  const row=p.rows[0]??[''],quotes=p.quoted[0]??[false];
  const decimals=header.delimiter===','?[]:row.flatMap((v,j)=>/^[+-]?\d+,\d+$/.test(v)?[j]:[]);
  for(const j of decimals)row[j]=row[j]!.replace(',','.');
  yield {table:{...header,rows:[row],physical:{...f,quoted:[f.quoted[0]!,quotes],decimals,trailing:!!record.ending}},ending:record.ending};
 }
}
/** Reservoir rows and a digest of EVERY record's quoting/newline shape (no values). */
export async function samplePhysical(file:string,name:string,random:()=>number):Promise<{table:Table;rows:number;formatHash:string}|null> {
 let header:Table|undefined,rows=0,trailing=false;const sample:Table[]=[],hash=createHash('sha256');
 for await(const r of physicalRecords(file,name)){
  const f=r.table.physical as TextFormat;
  trailing=!!r.ending;
  hash.update(JSON.stringify([f.quoted.at(-1),r.ending])+'\n');
  if(!header){header=r.table;continue;}rows++;
  if(sample.length<2000)sample.push(r.table);else{const j=Math.floor(random()*rows);if(j<2000)sample[j]=r.table;}
 }
 if(!header)return null;
 const f=header.physical as TextFormat;
 return {rows,formatHash:hash.digest('hex'),table:{...header,rows:sample.flatMap(t=>t.rows),physical:{...f,trailing,quoted:[f.quoted[0]!,...sample.map(t=>(t.physical as TextFormat).quoted[1]!)],decimals:[...new Set(sample.flatMap(t=>(t.physical as TextFormat).decimals))]}}};
}
