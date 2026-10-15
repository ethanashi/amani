/** Trusted served design, never inferred from header references or source neighbors.
 * Constants are declared explicitly, checked against the source, and reconstructed
 * without source rows. Numbers are allowed only as visit order/nominal offset. */
import path from 'node:path';
import type {Table} from './tabular.ts';
import type {StructureDeclaration,PracticeViolation} from './practice-structure.ts';
export interface MeasurementDictionary {
 version:1;target:string;
 fields:{measurement:string;unit:string;slot?:string;order?:string;offset?:string;baseline?:string};
 measurements:{column:string;unit:string;slot?:string}[];
 visits?:{offsetUnit:'second'|'minute'|'hour'|'day'|'week'|'month'|'year';slots:{id:string;order:number;offset:number;baseline:boolean}[]};
}
function fail(message:string):never{throw new Error('Invalid measurement dictionary: '+message);}
function closed(v:unknown,allowed:readonly string[],required:readonly string[],label:string):asserts v is Record<string,any>{
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(v,k)))fail('closed '+label+' fields');
}
const name=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\x00-\x1f\x7f]/.test(v)&&v.trim()===v;
const slotId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(v);
// A broad SI/physical vocabulary, not arbitrary words. Prefix/base composition
// admits new scales without admitting result nouns or unbounded prose as units.
const symbol='(?:da|[YZEPTGMkhdcmunpfazyµμ])?(?:mol|kat|Hz|Pa|Wb|Bq|Gy|Sv|ohm|cd|[mgsAKLlNJWTVCFΩSH])';
const word='(?:(?:yocto|zepto|atto|femto|pico|nano|micro|milli|centi|deci|deca|hecto|kilo|mega|giga|tera|peta|exa|zetta|yotta)?(?:grams?|metres?|meters?|litres?|liters?|moles?|seconds?|amperes?|kelvins?|hertz|newtons?|pascals?|joules?|watts?|coulombs?|volts?|farads?|ohms?|siemens|webers?|teslas?|henrys?|becquerels?|grays?|sieverts?|katals?))';
const atom='(?:'+symbol+'|'+word+'|unitless|dimensionless|percent|%|IU|U|AU|degC|°C|degF|°F|mmHg|cmH2O|bpm|min|h|d|days?|weeks?|months?|years?)';
const unitPattern=new RegExp('^'+atom+'(?:\\^?[+-]?[123])?(?:[./*·]'+atom+'(?:\\^?[+-]?[123])?){0,5}$','u');
export function validateMeasurementDictionary(value:unknown):MeasurementDictionary{
 closed(value,['version','target','fields','measurements','visits'],['version','target','fields','measurements'],'dictionary');
 if(value.version!==1||!name(value.target)||path.isAbsolute(value.target)||value.target.includes('\\')||value.target.split('/').some((p:string)=>!p||p==='.'||p==='..'))fail('version/target path');
 closed(value.fields,['measurement','unit','slot','order','offset','baseline'],['measurement','unit'],'binding');
 const bindings=Object.values(value.fields);if(bindings.some(v=>!name(v))||new Set(bindings).size!==bindings.length)fail('distinct binding column names required');
 if(!Array.isArray(value.measurements)||!value.measurements.length||value.measurements.length>4096)fail('bounded measurement entries required');
 const visited=new Set<string>();
 if(Object.hasOwn(value,'visits')){
  closed(value.visits,['offsetUnit','slots'],['offsetUnit','slots'],'visit');
  if(!['second','minute','hour','day','week','month','year'].includes(value.visits.offsetUnit)||!Array.isArray(value.visits.slots)||!value.visits.slots.length||value.visits.slots.length>256)fail('visit units/slots');
  let baseline=0,previous=-Infinity;
  value.visits.slots.forEach((s:unknown,i:number)=>{
   closed(s,['id','order','offset','baseline'],['id','order','offset','baseline'],'slot');
   if(!slotId(s.id)||visited.has(s.id)||typeof s.order!=='number'||!Number.isSafeInteger(s.order)||s.order!==i||typeof s.offset!=='number'||!Number.isFinite(s.offset)||Math.abs(s.offset)>1e12||s.offset<=previous||typeof s.baseline!=='boolean')fail('finite ordered visit slots');
   if(s.baseline){baseline++;if(s.offset!==0)fail('baseline offset must be zero');}visited.add(s.id);previous=s.offset;
  });
  if(baseline!==1)fail('exactly one baseline required');
 }else if(Object.keys(value.fields).some(k=>!['measurement','unit'].includes(k)))fail('visit bindings require visits');
 const columns=new Set<string>(),used=new Set<string>();
 for(const m of value.measurements){
  closed(m,['column','unit',...(value.visits?['slot']:[])],['column','unit',...(value.visits?['slot']:[])],'measurement');
  if(!name(m.column)||columns.has(m.column))fail('distinct measurement columns required');columns.add(m.column);
  if(typeof m.unit!=='string'||m.unit.length>96||!unitPattern.test(m.unit))fail('bounded physical unit grammar required');
  if(value.visits){if(!slotId(m.slot)||!visited.has(m.slot))fail('unknown visit slot');used.add(m.slot);}
 }
 if([...visited].some(s=>!used.has(s)))fail('unused visit slot');
 // Fresh closed object: no prototype or caller-owned extension enters provenance.
 return JSON.parse(JSON.stringify(value)) as MeasurementDictionary;
}
const numericRole=/^(integer|decimal|number|float|count|measurement|outcome)$/;
const bareNumber=/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/;
export function dictionaryTextColumn(t:Table,j:number,d:StructureDeclaration):boolean{
 if(!d.measurementDictionary||dictionaryColumns(d).has(t.header[j]!))return false;
 const name=t.header[j]!,declared=['integer','number'].includes(d.formats?.[name]?.storage??'')||numericRole.test(d.roles?.[name]??'');
 const present=t.rows.map(r=>r[j]??'').filter(v=>d.missing? !d.missing.includes(v):!['','na','nan','null','none','.','n/a','-'].includes(v.trim().toLowerCase()));
 return !declared||!present.length||present.some(v=>!bareNumber.test(v.trim())||!Number.isFinite(Number(v.trim().replace(',','.'))));
}
export const dictionaryColumns=(d:StructureDeclaration):Set<string>=>new Set(d.measurementDictionary?Object.values(d.measurementDictionary.fields):[]);
/** Canonical constants only; no source formatting or source ordering survives. */
export function dictionaryRows(header:readonly string[],raw:MeasurementDictionary):string[][]{
 const d=validateMeasurementDictionary(raw);
 if(new Set(header).size!==header.length||Object.values(d.fields).some(n=>!header.includes(n)))fail('missing/duplicate bound source header');
 const slots=new Map(d.visits?.slots.map(s=>[s.id,s]));
 return d.measurements.toSorted((a,b)=>a.column.localeCompare(b.column)).map(m=>{
  const row=header.map(()=>''),s=m.slot?slots.get(m.slot):undefined;
  const values={measurement:m.column,unit:m.unit,...(s?{slot:s.id,order:String(s.order),offset:String(s.offset),baseline:String(s.baseline)}:{})};
  for(const [field,column] of Object.entries(d.fields))row[header.indexOf(column)]=values[field as keyof typeof values]!;
  return row;
 });
}
export function checkDictionaryRows(t:Table,d:MeasurementDictionary,source=false):void{
 const indices=[...dictionaryColumns({keys:[],units:[],measurementDictionary:d})].map(n=>t.header.indexOf(n));
 const expected=dictionaryRows(t.header,d),sort=(rows:string[][])=>JSON.stringify(rows.map(r=>JSON.stringify(indices.map(j=>r[j]))).sort());
 let rows=t.rows;
 if(source){const numeric=[d.fields.order,d.fields.offset].filter((v):v is string=>!!v).map(n=>t.header.indexOf(n));rows=rows.map(row=>row.map((v,j)=>{if(!numeric.includes(j))return v;if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v)||!Number.isFinite(Number(v)))fail('invalid numeric source schedule');return String(Number(v));}));}
 if(t.rows.length!==expected.length||sort(rows)!==sort(expected))fail('source/projection row bijection differs from declared constants');
}
type Shape={file:string;header:readonly string[]};
/** Re-run against the closed rebuild shapes as well as actual source tables. */
export function validateDictionaryTargets(tables:readonly Shape[],decl:Readonly<Record<string,StructureDeclaration>>):void{
 for(const t of tables){const sd=decl[t.file];if(!sd||!Object.hasOwn(sd,'measurementDictionary'))continue;const raw=sd.measurementDictionary;const d=validateMeasurementDictionary(raw),target=tables.find(t=>t.file===d.target),td=decl[d.target];
  dictionaryRows(t.header,d);
  if(sd.matrix||!target||!td||target.file===t.file||td.matrix||new Set(target.header).size!==target.header.length)fail('target table missing or unsuitable');
  const random=sd.randomization,design=[...(random?.columns??[]),...(random?.strata??[]),random?.unit,random?.visit];
  if([...dictionaryColumns(sd)].some(n=>sd.outcomes?.includes(n))||sd.exposures?.some(n=>t.header.includes(n))||sd.keys.some(n=>n!==d.fields.measurement)||sd.units.length||design.some(n=>n&&t.header.includes(n)))fail('dictionary metadata cannot carry scientific identity/allocation/outcome design');
  for(const m of d.measurements){const format=td.formats?.[m.column],role=td.roles?.[m.column];
   if(!target.header.includes(m.column)||td.keys.includes(m.column)||td.exposures?.includes(m.column)||!(['integer','number'].includes(format?.storage??'')||/^(integer|decimal|number|float|count|measurement|outcome)$/.test(role??'')))fail('target must be an explicitly declared measurement column');
  }
 }
}
export function auditDictionaryProjection(real:readonly Table[],practice:readonly Table[],decl:Readonly<Record<string,StructureDeclaration>>):{failures:PracticeViolation[];fields:Map<string,Set<string>>}{
 const failures:PracticeViolation[]=[],fields=new Map<string,Set<string>>();
 try{validateDictionaryTargets(real,decl);}catch(error){failures.push({file:'*',check:'measurement-dictionary',detail:String(error)});return{failures,fields};}
 for(const source of real){const d=decl[source.file]?.measurementDictionary;if(!d)continue;
  try{checkDictionaryRows(source,d,true);const p=practice.find(t=>t.file===source.file);if(!p)fail('projection table missing');checkDictionaryRows(p,d);fields.set(source.file,dictionaryColumns(decl[source.file]!));}
  catch(error){failures.push({file:source.file,check:'measurement-dictionary',detail:String(error)});}
 }
 return{failures,fields};
}
