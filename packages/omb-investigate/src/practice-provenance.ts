import {validateMeasurementDictionary,validateDictionaryTargets,dictionaryColumns,dictionaryRows,checkDictionaryRows} from './measurement-dictionary.ts';
import {universalOrders,applyOrders,type ShapeOrder} from './practice-order.ts';
import {coverJoinedCohorts} from './practice-coverage.ts';
import {freshGwas} from './practice-gwas.ts';
/** The rebuild process receives this closed inventory language, never source rows.
 * The compiler is the only function allowed to read measurements. A renderer cannot
 * recover a source cross-column relationship: those values are absent from its input.
 */
import {mkdtempSync,writeFileSync,readFileSync,rmSync,readdirSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {columnInventory,independentColumn,independentRecords,independentRandom,trustedDesign,type ColumnInventory} from './practice-independent.ts';
import {aliasPracticeKeys,reassignExposure,resolvePracticeKeys,allocationDeclaration,opaqueKey,reorderPractice} from './practice-exposure.ts';
import {practiceReferences,referenceDeclarations} from './practice-references.ts';
import {dateInventory} from './practice-dates.ts';
import {correlationAxis} from './practice-matrix.ts';
import {writePhysical,type PhysicalFormat} from './physical-format.ts';
import type {StructureDeclaration} from './practice-structure.ts';
import type {SynthesisTable} from './synthesis-schema.ts';
import type {Table} from './tabular.ts';
export interface AllowedTable {
 file:string;delimiter:string;header:string[];rows:number;physical:PhysicalFormat|null;
 declaration:StructureDeclaration;slots:{column:number;values:string[];date:boolean}[];
 inventories:(ColumnInventory|null)[];correlation:boolean;orders?:ShapeOrder[];
}
export interface AllowedPractice {version:1;seed:string;tables:AllowedTable[];schema?:unknown;registries?:{file:string;rows:string[][]}[]}
function closed(value:unknown,keys:string[],label:string):asserts value is Record<string,any>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new Error(`Provenance input outside allowed language: ${label}`);
}
const safePath=(s:string)=>{if(typeof s!=='string'||path.isAbsolute(s)||s.split(/[\\/]/).includes('..'))throw new Error('Unsafe provenance path');};
function inventory(c:ColumnInventory){
 closed(c,['kind','unit','missing','min','max','integer','levels','formats','date'],'inventory');
 if(!['number','date','levels','text'].includes(c.kind)||![c.min,c.max].every(Number.isFinite)||c.min>c.max||typeof c.integer!=='boolean'||c.unit!==null&&typeof c.unit!=='string')throw new Error('Invalid inventory');
 if(!Array.isArray(c.levels)||c.levels.some(v=>typeof v!=='string')||new Set(c.levels).size!==c.levels.length)throw new Error('Invalid level set');
 for(const f of c.formats){closed(f,['prefix','suffix','decimals','comma','exponent','plus'],'format');if(typeof f.prefix!=='string'||typeof f.suffix!=='string'||!Number.isInteger(f.decimals)||f.decimals<0||f.decimals>10000||[f.comma,f.exponent,f.plus].some(v=>typeof v!=='boolean'))throw new Error('Invalid numeric format');}
 for(const m of c.missing){closed(m,['code','count'],'missing');if(typeof m.code!=='string'||!Number.isInteger(m.count)||m.count<0)throw new Error('Invalid missing inventory');}
 if(c.kind==='text'&&c.levels.length)throw new Error('Free text in inventory');
 if(c.date){closed(c.date,['min','max','quantum','templates'],'date');if(JSON.stringify(dateInventory(c.date.templates)?.templates)!==JSON.stringify(c.date.templates))throw new Error('Real dates in format templates');if(!Number.isFinite(c.date.min)||!Number.isFinite(c.date.max)||!(c.date.quantum>0)||!dateInventory(c.date.templates))throw new Error('Invalid date inventory');}
}
function declaration(d:StructureDeclaration){
 closed(d,['matrix','matrixNamespace','matrixCells','formats','keyNamespaces','keySeparators','keys','units','roles','levels','bounds','missing','randomization','outcomes','exposures','headerReferences','measurementDictionary'],'declaration');
 if(Object.hasOwn(d,'measurementDictionary'))validateMeasurementDictionary(d.measurementDictionary);
 for(const f of [...Object.values(d.formats??{}),...(d.matrixCells?[d.matrixCells]:[])]){closed(f,['name','encoding','namespace','separator','storage','precision','resolution','min','max','levels','missing'],'served format');if(f.precision&&typeof f.precision==='object')closed(f.precision,['decimals','significant'],'precision');}
 for(const b of Object.values(d.bounds??{}))if(b)closed(b,['min','max'],'bounds');
 if(d.randomization){closed(d.randomization,['mode','unit','strata','orderRequired','columns','visit','dateFormats','inequalities','increasing'],'design');for(const b of d.randomization.inequalities??[])closed(b,['lower','upper'],'inequality');for(const b of d.randomization.increasing??[])closed(b,['column','unit','index'],'increasing');}
 for(const map of [d.roles,d.keyNamespaces,d.keySeparators,d.randomization?.dateFormats])if(map&&Object.values(map).some(v=>typeof v!=='string'))throw new Error('Non-string served metadata');
 for(const levels of Object.values(d.levels??{}))if(levels&&(!Array.isArray(levels)||levels.some(v=>typeof v!=='string')))throw new Error('Non-level values in metadata');
 trustedDesign(d);
}
function physical(p:PhysicalFormat|null){
 if(!p)return;
 if(p.kind==='text'){closed(p,['kind','encoding','bom','newline','trailing','quoted','decimals','literalQuotes'],'physical text');if(p.quoted.length!==1)throw new Error('Per-cell quote masks forbidden');}
 else if(p.kind==='zip'){closed(p,['kind','path','member','compression','inner','entries'],'archive');for(const e of p.entries??[]){closed(e,['name','compression','directory'],'archive member');safePath(e.name);}if(p.inner)physical(p.inner);}
 else if(p.kind==='xlsx'){closed(p,['kind','path','sheet','layout','types'],'workbook');closed(p.layout,['sheet','state','rows','columns','merges','headerRows','headers','formats','sheetOrder'],'workbook layout');if(p.types?.length!==1||p.layout.formats.length!==1)throw new Error('Per-cell workbook descriptors forbidden');}
 else if(p.kind==='nested-json'){closed(p,['kind','path','paths','types'],'nested JSON');safePath(p.path);if(p.paths.length!==p.types.length||p.paths.some(v=>!Array.isArray(v)||!v.length||v.length>17||v.some(k=>typeof k!=='string'||!k||k.includes('.')))||p.types.some(v=>!['string','number','boolean'].includes(v)))throw new Error('Invalid nested JSON schema');}
 else if('storage' in p){closed(p,['kind','path','storage','labels'],'statistical format');safePath(p.path);if(!p.storage.every(v=>['number','integer','string','boolean'].includes(v)))throw new Error('Invalid storage type');for(const labels of Object.values(p.labels)){for(const [code,label] of Object.entries(labels))if(!Number.isFinite(Number(code))||typeof label!=='string')throw new Error('Invalid value label');}}
 else throw new Error('Unknown physical type');
}
export function validateAllowedPractice(input:AllowedPractice):void{
 closed(input,['version','seed','tables','schema','registries'],'root');if(input.version!==1||typeof input.seed!=='string')throw new Error('Invalid provenance version/seed');
 for(const r of input.registries??[]){closed(r,['file','rows'],'registry');safePath(r.file);for(const row of r.rows){if(row.length!==5)throw new Error('Invalid alias registry');for(const cell of row.slice(2)){const check=(v:unknown):boolean=>v===null||typeof v==='string'&&(/^(?:practice_[a-f0-9]{24}|\d{1,15})$/.test(v))||typeof v==='number'&&Number.isSafeInteger(v)||Array.isArray(v)&&v.every(check);if(!check(JSON.parse(cell)))throw new Error('Non-alias registry value');}}}
 if(input.schema!==undefined){const s=input.schema;closed(s,['schema','dataset','tables','note'],'worker schema');if(s.schema!=='omb-investigate/schema-view@1'||s.note!=='Column inventories only. Level sets have no empirical frequencies.'||typeof s.dataset!=='string')throw new Error('Nonstructural schema metadata');for(const t of s.tables){closed(t,['file','rows','columns','parsed'],'schema table');safePath(t.file);if(!Number.isInteger(t.rows)||typeof t.parsed!=='boolean')throw new Error('Invalid schema shape');for(const c of t.columns){closed(c,['name','type','missing','distinct','levels','min','max'],'schema column');if(typeof c.name!=='string'||!['integer','number','string','empty'].includes(c.type)||![c.missing,c.distinct].every(Number.isInteger)||[c.min,c.max].some(v=>v!==undefined&&!Number.isFinite(v)))throw new Error('Non-inventory schema values');if(c.levels&&Object.values(c.levels).some(n=>n!==1))throw new Error('Empirical schema counts forbidden');}}}
 for(const t of input.tables){closed(t,['file','delimiter','header','rows','physical','declaration','slots','inventories','correlation','orders'],'table');safePath(t.file);declaration(t.declaration);physical(t.physical);
  if(!Number.isInteger(t.rows)||t.rows<0||t.inventories.length!==t.header.length)throw new Error('Invalid inventory shape');
  const design=trustedDesign(t.declaration),columns=new Set<number>(),fixed=dictionaryColumns(t.declaration);
  if(t.declaration.measurementDictionary){if(t.rows!==t.declaration.measurementDictionary.measurements.length)throw new Error('Invalid dictionary provenance row count');dictionaryRows(t.header,t.declaration.measurementDictionary);for(let j=0;j<t.header.length;j++)if(fixed.has(t.header[j]!)&&(t.inventories[j]!==null||t.slots.some(s=>s.column===j)))throw new Error('Raw dictionary cells forbidden in provenance');
   if(Object.keys(t.declaration.levels??{}).length||Object.keys(t.declaration.bounds??{}).length||Object.keys(t.declaration.keyNamespaces??{}).length||Object.keys(t.declaration.keySeparators??{}).length||t.declaration.randomization||t.declaration.missing!==null)throw new Error('Noncanonical dictionary declaration');
   for(let j=0;j<t.header.length;j++){const name=t.header[j]!,c=t.inventories[j],f=t.declaration.formats?.[name];if(!f)throw new Error('Absent dictionary format');closed(f,['name','storage','precision','resolution'],'dictionary format');if(f.name!==name)throw new Error('Invalid dictionary format name');
    if(fixed.has(name)){if(f.storage!=='string'||Object.keys(f).length!==2)throw new Error('Noncanonical fixed dictionary format');continue;}
    if(!c||c.unit!==null||c.date!==null||c.levels.length||c.formats.some(f=>f.prefix!==''||f.suffix!=='')||c.missing.some(m=>!['','na','nan','null','none','.','n/a','-'].includes(m.code.toLowerCase())))throw new Error('Nonprojected dictionary inventory payload');
    if(c.kind==='text'){if(f.storage!=='string'||Object.keys(f).length!==2||c.min!==0||c.max!==0||c.integer||c.missing.length||c.formats.length)throw new Error('Noncanonical redacted dictionary text');}
    else if(c.kind!=='number'||f.storage!==(c.integer?'integer':'number'))throw new Error('Invalid dictionary numeric inventory');
   }
  }
  for(const s of t.slots){closed(s,['column','values','date'],'slot');const name=t.header[s.column];if(name===undefined||columns.has(s.column)||s.values.length!==t.rows||!(t.declaration.keys.includes(name)&&!t.declaration.outcomes?.includes(name))&&!design.has(name)&&!t.declaration.headerReferences?.includes(s.column))throw new Error('Non-design values in provenance slots');columns.add(s.column);
   if(t.declaration.keys.includes(name)&&!t.declaration.exposures?.includes(name)&&!t.declaration.headerReferences?.includes(s.column))for(const value of s.values){for(const part of t.declaration.keySeparators?.[name]?value.split(t.declaration.keySeparators[name]!):[value])if(part&&!['NA','NaN','null','none','.','N/A','-'].includes(part)&&!t.declaration.missing?.includes(part)&&! /^(?:practice_[a-f0-9]{24}|\d{1,15})$/.test(part))throw new Error('Original key bytes in provenance alias topology');}
  }
  t.inventories.forEach((c,j)=>{if(c)inventory(c);else if(!columns.has(j)&&!fixed.has(t.header[j]!)&&!t.correlation)throw new Error('Absent measurement inventory');});
  for(const o of t.orders??[]){closed(o,['lower','upper'],'shape order');const a=t.inventories[o.lower],b=t.inventories[o.upper];if(!Number.isInteger(o.lower)||!Number.isInteger(o.upper)||o.lower===o.upper||columns.has(o.lower)||columns.has(o.upper)||!a||!b||!['number','date'].includes(a.kind)||a.kind!==b.kind)throw new Error('Invalid shape order');}
 }
 validateDictionaryTargets(input.tables,Object.fromEntries(input.tables.map(t=>[t.file,t.declaration])));
 if(input.schema!==undefined){const schema=input.schema as {tables:{file:string;rows:number;columns:Record<string,any>[]}[]};for(const t of input.tables){const d=t.declaration.measurementDictionary;if(!d)continue;const view=schema.tables.find(v=>v.file===t.file),fixed=dictionaryColumns(t.declaration),rows=dictionaryRows(t.header,d);
  if(!view||view.rows!==t.rows||JSON.stringify(view.columns.map(c=>c.name))!==JSON.stringify(t.header))throw new Error('Dictionary schema shape differs from projection');
  for(let j=0;j<t.header.length;j++){const c=view.columns[j]!;if(fixed.has(t.header[j]!)){const values=rows.map(r=>r[j]!),levels=[...new Set(values)].sort();if(![-1,levels.length].includes(c.distinct)||c.missing!==0||c.levels!==null&&JSON.stringify(Object.keys(c.levels??{}).sort())!==JSON.stringify(levels)||c.min!==undefined&&c.min!==Math.min(...values.map(Number))||c.max!==undefined&&c.max!==Math.max(...values.map(Number)))throw new Error('Nonprojected dictionary schema metadata');}
   else if(t.inventories[j]?.kind==='text'&&(c.type!=='string'||c.missing!==0||c.distinct!==-1||c.levels!==null||c.min!==undefined||c.max!==undefined))throw new Error('Nonprojected dictionary schema text');
   else if(t.inventories[j]?.kind==='number'&&(c.levels!==null||c.distinct!==-1||!['integer','number'].includes(c.type)||c.missing!==t.inventories[j]!.missing.reduce((n,m)=>n+m.count,0)))throw new Error('Nonprojected dictionary schema numeric inventory');
  }
 }}
}
/** Project physical descriptors to column inventories. No source template survives. */
export function allowedPhysical(p:PhysicalFormat|undefined,width:number):PhysicalFormat|null{
 if(!p)return null;
 if(p.kind==='text')return {kind:p.kind,encoding:p.encoding,bom:p.bom,newline:p.newline,trailing:p.trailing,quoted:[Array.from({length:width},(_,j)=>p.quoted.some(r=>r[j]))],decimals:[...p.decimals],...(p.literalQuotes?{literalQuotes:true}:{})};
 if(p.kind==='nested-json')return structuredClone(p);
 if('storage' in p)return {kind:p.kind,path:p.path,storage:[...p.storage],labels:structuredClone(p.labels)};
 if(p.kind==='zip')return {kind:p.kind,path:p.path,member:p.member!,compression:p.compression!,entries:(p.entries??[]).map(e=>({...e})),...(p.inner?{inner:allowedPhysical(p.inner,width)!}:{})};
 return {kind:p.kind,path:p.path,sheet:p.sheet!,types:[Array.from({length:width},(_,j)=>p.types!.every(r=>r[j]==='n')?'n':'s')],layout:{sheet:p.layout.sheet,state:'visible',rows:p.layout.rows,columns:p.layout.columns,merges:[...p.layout.merges].sort(),headerRows:p.layout.headerRows,headers:p.layout.headers,formats:[Array.from({length:width},(_,j)=>[...new Set<string>(p.layout.formats.map((r:string[])=>r[j]!))].sort()[0]!)],sheetOrder:[...p.layout.sheetOrder]}};
}
export function compilePractice(tables:readonly Table[],decl:Readonly<Record<string,StructureDeclaration>>,schema:readonly SynthesisTable[],seed:string):AllowedPractice{
 validateDictionaryTargets(tables,decl);for(const t of tables){const d=decl[t.file]?.measurementDictionary;if(d)checkDictionaryRows(t,d,true);}
 const resolved=resolvePracticeKeys(tables,Object.fromEntries(tables.map(t=>[t.file,allocationDeclaration(t,decl[t.file]!)]))),refs=practiceReferences(tables,resolved),ds=referenceDeclarations(resolved,refs);
 const skeleton=tables.map(t=>({...t,rows:t.rows.map(()=>t.header.map(()=>''))}));
 for(const t of tables){const d=ds[t.file]!,design=trustedDesign(d),p=skeleton.find(p=>p.file===t.file)!;
  for(let j=0;j<t.header.length;j++)if(d.keys.includes(t.header[j]!)&&!d.outcomes?.includes(t.header[j]!)||design.has(t.header[j]!)||d.headerReferences?.includes(j))t.rows.forEach((r,i)=>{p.rows[i]![j]=r[j]!;});
  reassignExposure(t,p,d,seed);
 }
 aliasPracticeKeys(tables,skeleton,ds,seed);
 const result:AllowedPractice={version:1,seed,tables:tables.map(t=>{
  const d=ds[t.file]!,p=skeleton.find(p=>p.file===t.file)!,s=schema.find(s=>s.file===t.file),design=trustedDesign(d),fixed=dictionaryColumns(d),correlation=!!s&&!!correlationAxis(t,s);
  const inventories=t.header.map((name,j)=>fixed.has(name)||d.keys.includes(name)&&!d.outcomes?.includes(name)||design.has(name)&&!dateInventory(t.rows.map(r=>r[j]!))||d.headerReferences?.includes(j)?null:columnInventory(t,j,d));
  if(d.matrix&&!correlation){const cells=inventories.filter((c,j)=>c?.kind==='number'&&!d.formats?.[t.header[j]!]) as ColumnInventory[];if(cells.length){const lo=Math.max(...cells.map(c=>c.min)),hi=Math.min(...cells.map(c=>c.max));if(lo>hi)throw new Error('Refusing answer-bearing disjoint matrix cell domains');for(const c of cells){c.min=lo;c.max=hi;}}}
  const slots=t.header.flatMap((name,j)=>!fixed.has(name)&&(d.keys.includes(name)&&!d.outcomes?.includes(name)||design.has(name)||d.headerReferences?.includes(j))?[{column:j,values:p.rows.map(r=>r[j]!),date:!!inventories[j]?.date&&design.has(name)}]:[]);
  // Date indices transmit ranks only; original gaps are not structural input.
  for(const slot of slots.filter(s=>s.date)){const date=dateInventory(slot.values)!,levels=[...new Set(slot.values)].sort((a,b)=>date.parse(a)!-date.parse(b)!);slot.values=slot.values.map(v=>String(levels.indexOf(v)));}
  const header=s?.matrix?t.header.map(h=>s.fixedHeaders.includes(h)?h:opaqueKey(seed,h,s.headerNamespace?!!schema.some(t=>t.columns?.some(c=>c.namespace===s.headerNamespace&&c.storage==='integer')):/^\d+$/.test(h),s.headerNamespace)):[...t.header];
  const rename=(name:string)=>header[t.header.indexOf(name)]??name;
  const clean=JSON.parse(JSON.stringify({...d,keys:d.keys.map(rename),...(d.formats?{formats:Object.fromEntries(Object.entries(d.formats).map(([k,v])=>[rename(k),{...v,name:rename(v.name)}]))}:{}),...(d.bounds?{bounds:Object.fromEntries(Object.entries(d.bounds).map(([k,v])=>[rename(k),v]))}:{}),...(d.levels?{levels:Object.fromEntries(Object.entries(d.levels).map(([k,v])=>[rename(k),v]))}:{}),...(d.roles?{roles:Object.fromEntries(Object.entries(d.roles).map(([k,v])=>[rename(k),v]))}:{})}));delete clean.structural;
  if(d.measurementDictionary){
   clean.levels={};clean.bounds={};clean.keyNamespaces={};clean.keySeparators={};clean.units=[];clean.missing=null;delete clean.randomization;
   clean.formats=Object.fromEntries(header.map((name,j)=>{const c=inventories[j],f=d.formats?.[name];return [name,{name,storage:fixed.has(name)||c?.kind==='text'?'string':c?.integer?'integer':'number',...(!fixed.has(name)&&c?.kind==='number'?{...(f?.precision!==undefined?{precision:f.precision}:{}),...(f?.resolution!==undefined?{resolution:f.resolution}:{})}:{})}];}));
   clean.roles=Object.fromEntries(header.map((name,j)=>[name,fixed.has(name)||inventories[j]?.kind==='text'?'text':inventories[j]?.integer?'integer':'decimal']));
  }
  return {file:t.file,delimiter:t.delimiter,header,rows:t.rows.length,physical:allowedPhysical(t.physical,t.header.length),declaration:clean,slots,inventories,correlation,orders:d.matrix?[]:universalOrders(t,inventories.map((c,j)=>slots.some(s=>s.column===j)?null:c))};
 })};result.tables.sort((a,b)=>a.file.localeCompare(b.file));validateAllowedPractice(result);return result;
}
export function renderPractice(input:AllowedPractice):Table[]{
 validateAllowedPractice(input);
 const tables=input.tables.map(t=>{
  const d=t.declaration,p:Table={file:t.file,delimiter:t.delimiter,header:[...t.header],rows:Array.from({length:t.rows},()=>t.header.map(()=>'')),...(t.physical?{physical:structuredClone(t.physical)}:{})};
  if(d.measurementDictionary)p.rows=dictionaryRows(t.header,d.measurementDictionary);
  for(const s of t.slots){let values=s.values;
   if(s.date){const c=t.inventories[s.column]!,date=c.date!,renderer=dateInventory(date.templates)!,n=new Set(values).size,ticks=Math.floor((date.max-date.min)/date.quantum)+1;
    if(n>1&&ticks<=n)throw new Error('Refusing date index without fresh interval capacity');const rand=independentRandom(input.seed,JSON.stringify([t.file,s.column,'design-date'])),chosen=new Set<number>();for(let k=ticks-n;k<ticks;k++){const v=Math.floor(rand()*(k+1));chosen.add(chosen.has(v)?k:v);}const slots=[...chosen].sort((a,b)=>a-b).map(k=>renderer.render(date.min+k*date.quantum));values=values.map(v=>slots[Number(v)]!);
   }values.forEach((v,i)=>{p.rows[i]![s.column]=v;});
  }
  for(let j=0;j<t.header.length;j++)if(t.inventories[j]&&!t.slots.some(s=>s.column===j)){const values=independentColumn(p,j,d,input.seed,t.inventories[j]!);values.forEach((v,i)=>{p.rows[i]![j]=v;});}
  applyOrders(p,d,t.inventories,t.orders??[],input.seed);
  // Apply served shape constraints to fresh values only.
  if(d.randomization?.inequalities?.length||d.randomization?.increasing?.length){const bounds={...d.bounds,...Object.fromEntries(t.inventories.flatMap((c,j)=>c?.kind==='number'?[[t.header[j]!,{min:c.min,max:c.max}]]:[]))};const shaped=independentRecords(p,{...d,bounds,keys:t.header,outcomes:[]},input.seed);p.rows=shaped.rows;}
  if(t.correlation){const key=t.header.findIndex(h=>d.keys.includes(h)),axis=p.rows.map(r=>p.header.indexOf(r[key]!));if(axis.some(j=>j<0))throw new Error('Invalid correlation aliases');const rand=independentRandom(input.seed,`correlation:${t.file}`),u=p.rows.map(()=>rand()-.5);p.rows.forEach((r,i)=>axis.forEach((j,k)=>{r[j]=String(i===k?1:u[i]!*u[k]!/Math.sqrt((1+u[i]!**2)*(1+u[k]!**2)));}));}
  if(p.physical?.kind==='xlsx'){const types=p.physical.types![0]!;p.physical.types=Array.from({length:p.rows.length},()=>types);}
  reorderPractice(p,input.seed);return p;
 });
 coverJoinedCohorts(tables,input);
 freshGwas(tables,input.tables,input.seed);
 for(const r of input.registries??[])tables.push({file:r.file,delimiter:'\t',header:['namespace','encoding','original','canonical','target'],rows:r.rows,physical:{kind:'text',encoding:'utf8',bom:'',newline:'\n',trailing:true,quoted:[[]],decimals:[],literalQuotes:true}});
 return tables;
}
function files(root:string):string[]{return readdirSync(root,{recursive:true}).map(String).filter(f=>{const s=lstatSync(path.join(root,f));if(s.isSymbolicLink())throw new Error('Symlink in practice mount');return s.isFile();}).sort();}
export function auditRebuild(input:AllowedPractice,dir:string,schemaDir?:string):string[]{
 const temp=mkdtempSync(path.join(tmpdir(),'amani-rebuild-'));
 try{validateAllowedPractice(input);writeFileSync(path.join(temp,'input.json'),JSON.stringify(input));
  const worker=fileURLToPath(new URL('./practice-rebuild.ts',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-transform-types',worker,path.join(temp,'input.json'),path.join(temp,'out')],{env:{PATH:process.env.PATH!,TZ:'UTC'},encoding:'utf8',maxBuffer:1024*1024,timeout:600000});
  if(run.status!==0)throw new Error(`Practice rebuild failed: ${run.stderr.slice(-2000)}`);
  const schemaFailures=schemaDir&&input.schema!==undefined?(JSON.stringify(files(schemaDir))!==JSON.stringify(['schema.json'])||!readFileSync(path.join(schemaDir,'schema.json')).equals(readFileSync(path.join(temp,'out-schema/schema.json')))?['worker-visible schema bytes differ from provenance rebuild']:[]):[];
  const expected=files(path.join(temp,'out')),actual=files(dir);if(JSON.stringify(actual)!==JSON.stringify(expected))return ['worker-visible file set differs from provenance rebuild'];
  return [...schemaFailures,...expected.flatMap(f=>readFileSync(path.join(dir,f)).equals(readFileSync(path.join(temp,'out',f)))?[]:[`worker-visible bytes differ from provenance rebuild: ${f}`])];
 }finally{rmSync(temp,{recursive:true,force:true});}
}

export function auditSchemaProjection(schema:unknown,dir:string):void{
 const empty=mkdtempSync(path.join(tmpdir(),'amani-schema-'));try{const errors=auditRebuild({version:1,seed:'schema',tables:[],schema},empty,dir);if(errors.length)throw new Error(errors.join('; '));}finally{rmSync(empty,{recursive:true,force:true});}
}
