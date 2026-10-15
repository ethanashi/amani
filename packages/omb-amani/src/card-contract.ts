import {canonicalJson, canonicalSha256} from '../../bio-core/src/index.ts';
import {buildContract, contentHash, evidencePointers, type ContractStructure, type DataContract, type Column} from '../../omb-contract/src/index.ts';
import {parseContractTable, sha256} from '../../omb-certify/src/contract-verifier.ts';
import {object, type Json} from './results.ts';

type Namespace = {id:string; kind:string; entries:number; registry:{path:string;sha256:string}};
type ServedColumn = {name:string;role:string;namespace?:string;separator?:string|null};
type ServedTable = {path:string;sha256:string;dataset:string;layout:string;columns:ServedColumn[];missing:string[];matrix?:{header_namespace:string}};
export type CardTranslation = {ok:true;contract:DataContract;assets:Map<string,Buffer>;recordSets:Map<string,string>;entityNamespace:string;coarserNamespace:string|null}|{ok:false;reason:string};
const strip = (p:string) => {
 if(!p.startsWith('data/')||p.split('/').some(x=>!x||x==='..'||x==='.')||p.includes('\\'))throw new Error('invalid served path');
 return p.slice(5);
};
/** Host-only deterministic translation. It conveys declarations, never approval or claim authority. */
export function translateCardContract(publicContract:Json,files:ReadonlyMap<string,Buffer>):CardTranslation {
 try { return translate(publicContract,files); }
 catch(error) {return {ok:false,reason:error instanceof Refusal?error.message:'invalid served contract or bytes'};}
}
class Refusal extends Error {}
function translate(c:Json,files:ReadonlyMap<string,Buffer>):CardTranslation {
 if(!object(c)||c.schema_version!=='omb-oneshot-contract/v1'||!Array.isArray(c.namespaces)||!Array.isArray(c.tables))throw new Refusal('unsupported served contract');
 const namespaces=c.namespaces as unknown as Namespace[],tables=c.tables as unknown as ServedTable[];
 const nsKind=new Map(namespaces.map(n=>[n.id,n.kind]));
 if(nsKind.size!==namespaces.length||nsKind.has('population'))throw new Refusal('ambiguous namespace declarations');
 const check=(p:string,h:string)=>{const name=strip(p),bytes=files.get(name);if(!bytes||sha256(bytes)!==h)throw new Refusal('served sha256 mismatch');return name;};
 for(const n of namespaces)check(n.registry.path,n.registry.sha256);
 for(const t of tables)check(t.path,t.sha256);
 if(new Set(tables.map(t=>t.path)).size!==tables.length)throw new Refusal('duplicate table path');
 const ids=(t:ServedTable)=>t.columns.filter(col=>col.role==='id'&&!col.separator);
 const matrices=tables.filter(t=>t.layout==='matrix');
 const candidates=matrices.length?matrices.map(t=>t.matrix?.header_namespace).filter(n=>n&&nsKind.get(n)==='sample'):tables.filter(t=>t.layout==='records').map(t=>ids(t).find(col=>nsKind.get(col.namespace!)==='sample')?.namespace).filter(Boolean);
 const entities=[...new Set(candidates)];
 if(!entities.length)throw new Refusal('no unit namespace');
 if(entities.length!==1||matrices.some(t=>t.matrix?.header_namespace!==entities[0]))throw new Refusal('ambiguous entity namespace');
 const entity=entities[0]!;
 const parsed=new Map(tables.map(t=>[t.path,parseContractTable(strip(t.path),files.get(strip(t.path))!)]));
 const links=new Map<string,Map<string,string>>();
 for(const t of tables.filter(t=>t.layout==='records')) {
  const cols=ids(t),ec=cols.filter(col=>col.namespace===entity);
  if(!ec.length)continue;
  if(ec.length!==1)throw new Refusal('ambiguous entity column');
  const p=parsed.get(t.path)!,ei=p.header.indexOf(ec[0]!.name);
  for(const col of cols.filter(col=>col.namespace!==entity&&nsKind.get(col.namespace!)==='sample')) {
   const map=links.get(col.namespace!)??new Map<string,string>();links.set(col.namespace!,map);
   const ci=p.header.indexOf(col.name);
   for(const row of p.rows){const e=row[ei]!,u=row[ci]!;if(!e||!u||(map.has(e)&&map.get(e)!==u))throw new Refusal('conflicting coarser identity');map.set(e,u);}
  }
 }
 if(links.size>1)throw new Refusal('ambiguous coarser namespace');
 const coarser=[...links.keys()][0]??null,unitNs=[entity,...(coarser?[coarser]:[])];
 if(namespaces.some(n=>n.kind==='sample'&&!unitNs.includes(n.id)))throw new Refusal('unlinked unit namespace');
 const tokens=new Map<string,string[]>();
 for(const n of namespaces){
  const lines=files.get(strip(n.registry.path))!.toString('utf8').trimEnd().split('\n');
  if(lines.shift()!=='namespace\tencoding\toriginal\tcanonical\ttarget')throw new Refusal('invalid alias registry');
  const values=lines.map(line=>{const [ns,encoding,original,canonical,target]=line.split('\t');const raw:unknown=JSON.parse(original!);
   if(ns!==n.id||encoding!=='token'||typeof raw!=='string'||JSON.parse(canonical!)!==raw||JSON.parse(target!)!==raw)throw new Refusal('non-identity served registry');return raw;});
  if(values.length!==n.entries||new Set(values).size!==values.length)throw new Refusal('invalid registry entries');tokens.set(n.id,values);
 }
 const s:ContractStructure={dataset_id:'card_'+canonicalSha256(c).slice(0,16),dataset_type:'subject-level',source_files:[...files].sort(([a],[b])=>a.localeCompare(b)).map(([path,b])=>({path,sha256:sha256(b)})),namespaces:[],
 graph:{nodes:[{id:'population',kind:'target-population',level:'population',namespace:'population',original_id:'population'}],edges:[]},
 unit_hierarchy:[{id:entity,coarser_level:coarser??'population',minimum_independent:!coarser},...(coarser?[{id:coarser,coarser_level:'population',minimum_independent:true}]:[]),{id:'population',coarser_level:null,minimum_independent:false}],
 tables:[],aliases:[],alias_registries:[],collision_merges:[],joins:[],batch:[],time:[],dependence:[{id:'design',kind:'unknown',unit_level:coarser??entity,cluster_nodes:[],description:'Independence structure not declared by the served card contract'}],assignments:[],replicate_groups:[],partitions:[],forbidden_uses:[],survival:[],row_exclusions:[],transformations:[],summary_statistics:null,
 limitations:['Host translation of a served card; unit independence is assumed, not authenticated. Tables without an entity identifier are source files only.']};
 for(const n of namespaces){const unit=unitNs.includes(n.id);s.namespaces.push({id:n.id,entity_kind:unit?'unit':'feature',level:unit?n.id:null,preserve_originals:true,collision_policy:'merge-with-limitation',rules:[]});s.alias_registries.push({namespace:n.id,file:{path:strip(n.registry.path),sha256:n.registry.sha256},format:'omb-alias-registry-tsv/v1',entry_count:n.entries,coverage:'verify-against-data'});}
 s.namespaces.push({id:'population',entity_kind:'unit',level:'population',preserve_originals:true,collision_policy:'merge-with-limitation',rules:[]});
 for(const ns of unitNs)for(const tok of tokens.get(ns)!){if(!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(tok))throw new Refusal('invalid unit node token');s.graph.nodes.push({id:tok,kind:ns===entity?'specimen/sample':'donor/subject',level:ns,namespace:ns,original_id:tok});}
 if(coarser){
  for(const e of tokens.get(entity)!){const u=links.get(coarser)!.get(e);if(!u)throw new Refusal('incomplete coarser identity');s.graph.edges.push({from:e,to:u,relation:'sample-of'});}
  for(const u of tokens.get(coarser)!)s.graph.edges.push({from:u,to:'population',relation:'member-of-population'});
 }
 const assets=new Map<string,Buffer>(),recordSets=new Map<string,string>();
 for(const t of tables){
  const matrix=t.layout==='matrix',idCols=ids(t),entityCols=idCols.filter(col=>col.namespace===entity);
  if(!(matrix?t.matrix?.header_namespace===entity:entityCols.length===1))continue;
  if(!t.dataset||!Array.isArray(t.missing)||t.missing.some(x=>typeof x!=='string'))throw new Refusal('invalid table declarations');
  const file=strip(t.path),p=parsed.get(t.path)!,tid='t'+s.tables.length,declared=new Map(t.columns.map(col=>[col.name,col]));
  if(declared.size!==t.columns.length||t.columns.some(col=>!p.header.includes(col.name)))throw new Refusal('table declaration/header mismatch');
  const columns:Column[]=p.header.map((h,j)=>{
   const d=declared.get(h);
   if(d?.role==='id'&&!d.separator)return {name:h,storage:'string',structural_kind:!matrix&&d.namespace===entity?'unit':'identifier',namespace:d.namespace!,decimal_resolution:null,measurement:null,missingness_codes:[]};
   if(!d&&matrix||d?.role==='decimal'){
    let decimals=0;
    for(const row of p.rows){const value=row[j]!;if(t.missing.includes(value))continue;const [mantissa,exponent='0']=value.split(/[eE]/);const places=(mantissa!.split('.')[1]??'').length-Number(exponent);if(!Number.isSafeInteger(places)||Math.abs(places)>1024)throw new Refusal('decimal resolution out of bounds');decimals=Math.max(decimals,places);}
    return {name:h,storage:'decimal',structural_kind:'measurement',namespace:null,decimal_resolution:'1e-'+decimals,measurement:{type:'continuous',unit:'source-native',bounds:null,categories:[]},missingness_codes:t.missing};
   }
   if(!d)throw new Refusal('undeclared row column');
   return {name:h,storage:'string',structural_kind:'annotation',namespace:null,decimal_resolution:null,measurement:null,missingness_codes:t.missing};
  });
  const row_key=matrix?idCols.map(col=>col.name):[entityCols[0]!.name];
  const unit_derivation:ContractStructure['tables'][number]['unit_derivation']=matrix?(()=>{
   const bytes=Buffer.from(canonicalJson(Object.fromEntries(p.header.filter(h=>!row_key.includes(h)).map(h=>[canonicalJson([h]),h])))+'\n');
   const asset={path:`contract-assets/${tid}-units.json`,sha256:sha256(bytes)};
   if(files.has(asset.path))throw new Refusal('contract asset path collision');assets.set(asset.path,bytes);s.source_files.push(asset);
   return {kind:'sidecar',map:asset,key_encoding:'canonical-json-array',namespace:entity,level:entity} as const;
  })():{kind:'column-tuple',columns:row_key,encoding:'canonical-json-array',namespace:entity,level:entity};
  s.tables.push({id:tid,file:{path:file,sha256:t.sha256},row_key,columns,unit_derivation,orientation:{layout:matrix?'matrix':'records',unit_axis:matrix?'columns':'rows',row_entity:matrix?'features':'samples',header_namespace:matrix?entity:null},alias_coverage:{rows:'all',matrix_headers:'all',unresolved:'refuse',ambiguous_axis:'refuse'}});recordSets.set(file,t.dataset);
 }
 const bundle=contentHash(s.source_files),contract=buildContract({schema_version:'omb-data-contract/v3.1',structure:s,
 producers:[{id:'author',kind:'task-author',name:'One-shot harness served contract (Amani host translation)',version:'oneshot-v1→v3.1@1',model_family:null,source_bundle_hash:bundle,outcome_blind:true},{id:'stager',kind:'stager',name:'Amani host byte inventory',version:'1',model_family:null,source_bundle_hash:bundle,outcome_blind:true}],
 evidence:evidencePointers(s).map(pointer=>/\/(graph\/edges|unit_hierarchy|dependence)\//.test(pointer)?{pointer,status:'assumed',producer_ids:['author'],citations:[],note:'Independence structure not declared by the served card contract'}:{pointer,status:'author',producer_ids:pointer.startsWith('/structure/source_files/')?['author','stager']:['author'],citations:[],note:null})});
 return {ok:true,contract,assets,recordSets,entityNamespace:entity,coarserNamespace:coarser};
}
