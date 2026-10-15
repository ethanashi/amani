import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { canonicalSha256, canonicalJson } from '../../bio-core/src/index.ts';
import { validateDataContract, hydrateRegistries, IdentityResolver, decimalParts, compareDecimals, parseStrictJson, isStrictDecimal, validatePartitionArtifact,
  type FieldEvidence, type PartitionArtifact, type Partition,
  type DataContract, type ContractStructure, type Table, type ValidationContext } from '../../omb-contract/src/index.ts';
import { delimited } from '../../bio-pipeline/src/validity.ts';

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export interface VerifiedTable {
  definition: Table; header: string[]; rows: string[][]; keys: string[][];
  /** Canonical resolver identities, one per row or matrix entity header. HOST ONLY. */
  units: string[]; entityHeaders: string[];
}
export interface Converter {
  implementationHash: string;
  /** Pure deterministic host implementation; all inputs are detached pinned bytes. */
  run(input: { transformation: ContractStructure['transformations'][number]; files: ReadonlyMap<string, Buffer>; structure: ContractStructure }): ReadonlyMap<string, Uint8Array>;
}
export interface ContractVerificationOptions {
  expectedContractHash: string;
  /** Required when a private layer is present; never inferred from the contract itself. */
  expectedPrivateContractHash?: string | null;
  requirePrivate?: boolean;
  partitionArtifact?:PartitionArtifact; expectedPartitionHash?:string;
  /** Immutable antecedent L1 contracts for embedded snapshots, indexed by their public pins. */
  antecedents?:ReadonlyMap<string,DataContract>;
  registry?: { version: string; converters: Readonly<Record<string, Converter>> };
}
export interface VerifiedContract {
  contract: DataContract; structure: ContractStructure; resolver: IdentityResolver; layer: 'public' | 'private';
  tables: Map<string, VerifiedTable>; files: Map<string, Buffer>; manifestHash: string;
  partitionEvidence: PartitionArtifact['content']['evidence'];
  limitations: string[]; partitions:Partition[]; partitionHash:string;
}
export type ContractVerification = {ok:true; value:VerifiedContract} | {ok:false; code:string};

/** Snapshot regular files only, refusing links in every path component. Hash/parse uses these
 * same buffers. The host must provide OS isolation; this is not a substitute for a trusted UID. */
export function snapshotContractFiles(directory: string): Map<string, Buffer> {
  if(lstatSync(directory).isSymbolicLink())throw new Error('linked data root');
  const files=new Map<string,Buffer>(); let total=0;
  const visit=(relative:string):void=>{
    for(const entry of readdirSync(path.join(directory,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      const name=relative?relative+'/'+entry.name:entry.name, full=path.join(directory,name);
      if(entry.isSymbolicLink())throw new Error('linked input');
      if(entry.isDirectory()){visit(name);continue;}
      const fd=openSync(full,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1)throw new Error('nonregular input');
        total+=stat.size;if(total>1_000_000_000||files.size>=100_000)throw new Error('input resource limit');
        const bytes=readFileSync(fd);if(bytes.length!==stat.size)throw new Error('input changed');files.set(name,bytes);
      }finally{closeSync(fd);}
    }
  };visit('');return files;
}
export function parseContractTable(file:string,bytes:Uint8Array):{header:string[];rows:string[][]}{
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  let records:string[][];
  if(file.endsWith('.json')){
    const items:unknown=parseStrictJson(text);
    if(!Array.isArray(items)||!items.length||items.some(v=>!v||typeof v!=='object'||Array.isArray(v)))throw new Error('table format');
    const header=Object.keys(items[0] as object);
    records=[header,...items.map(item=>{if(canonicalJson(Object.keys(item).sort())!==canonicalJson([...header].sort()))throw new Error('ragged table');return header.map(k=>{const v=(item as Record<string,unknown>)[k];if(typeof v!=='string'&&typeof v!=='number'&&typeof v!=='boolean')throw new Error('table scalar');return String(v);});})];
  }else if(/\.(csv|tsv)$/.test(file)){const separator=file.endsWith('.csv')?',':'\t';records=text.includes('"')?delimited(text,separator):text.replace(/\r?\n$/,'').split(/\r?\n/).map(line=>line.split(separator));}
  else throw new Error('unsupported table format');
  const header=records.shift();
  if(!header?.length||!records.length||new Set(header).size!==header.length||header.some(h=>!h)||records.some(r=>r.length!==header.length))throw new Error('empty/ragged table');
  return {header,rows:records};
}
function refs(value:unknown,out:Map<string,string>):void{
  if(!value||typeof value!=='object')return;
  const obj=value as Record<string,unknown>;
  if(typeof obj.path==='string'&&typeof obj.sha256==='string'){
    if(out.has(obj.path)&&out.get(obj.path)!==obj.sha256)throw new Error('conflicting hash');out.set(obj.path,obj.sha256);
  }
  for(const child of Object.values(obj))refs(child,out);
}
const quantumCache=new Map<string,ReturnType<typeof decimalParts>>();
function lattice(value:string,quantum:string):boolean{
  let b=quantumCache.get(quantum);if(!b){b=decimalParts(quantum);if(quantumCache.size<128)quantumCache.set(quantum,b);}
  if(b.coefficient===1n&&b.exponent<=0n&&isStrictDecimal(value)&&!/[eE]/.test(value))return BigInt((value.split('.')[1]??'').replace(/0+$/,'').length)<=-b.exponent;
  const a=decimalParts(value);if(a.coefficient===0n)return true;
  const power=a.exponent-b.exponent;if(power<0n)return false;
  // Modular exponentiation bounds hostile exponent strings, without allocating 10^exponent.
  let base=10n,result=1n,k=power,mod=b.coefficient;if(mod<=0n)return false;
  while(k){if(k&1n)result=result*base%mod;base=base*base%mod;k>>=1n;}
  return a.coefficient*result%mod===0n;
}
function validateCells(t:VerifiedTable):void{
  for(const [i,c] of t.definition.columns.entries())for(const row of t.rows){
    const v=row[i]!;
    if(c.missingness_codes.includes(v)){
      if(c.measurement&&(c.measurement.categories.includes(v)||c.storage==='decimal'&&/^[-0-9]/.test(v)))throw new Error('ambiguous missingness code');
      continue;
    }
    if(c.storage==='decimal'&&!lattice(v,c.decimal_resolution!))throw new Error('decimal lattice');
    if(c.storage==='boolean'&&!['true','false','0','1'].includes(v))throw new Error('boolean value');
    const m=c.measurement;if(!m)continue;
    if(m.categories.length&&!m.categories.includes(v))throw new Error('measurement category');
    if(m.bounds&&(compareDecimals(v,m.bounds.lower)<0||compareDecimals(v,m.bounds.upper)>0))throw new Error('measurement bounds');
    if(m.type==='positive-concentration'&&compareDecimals(v,'0')<=0)throw new Error('nonpositive concentration');
    if(m.type==='count'&&(!lattice(v,'1')||compareDecimals(v,'0')<0))throw new Error('count value');
    if(m.type==='binary'&&!m.categories.length&&!['0','1'].includes(v))throw new Error('binary value');
  }
}
function verifyJoins(s:ContractStructure,tables:Map<string,VerifiedTable>,resolve:(ns:string,raw:string,encoding:'token'|'canonical-json-array')=>string):void{
  for(const join of s.joins){
    const a=tables.get(join.from_table)!,b=tables.get(join.to_table)!;
    const group=(t:VerifiedTable,columns:string[])=>{const map=new Map<string,number[]>();t.rows.forEach((row,i)=>{const k=JSON.stringify(columns.map(c=>{const col=t.definition.columns.find(x=>x.name===c)!;return resolve(col.namespace!,row[t.header.indexOf(c)]!,'token');}));const ids=map.get(k)??[];ids.push(i);map.set(k,ids);});return map;};
    const left=group(a,join.from_columns),right=group(b,join.to_columns);
    if(['one-to-one','one-to-many'].includes(join.cardinality)&&[...left.values()].some(g=>g.length>1)||['one-to-one','many-to-one'].includes(join.cardinality)&&[...right.values()].some(g=>g.length>1))throw new Error('join cardinality');
    for(const [t,source,target,other] of [[a,left,right,b],[b,right,left,a]] as const)for(const [key,indices] of source){
      const matches=target.get(key);
      if(!matches){if(t===b)continue;if(join.unmatched!=='exclude-with-lineage'||indices.some(i=>!s.row_exclusions.some(e=>e.row.table===t.definition.id&&canonicalJson(e.row.key)===canonicalJson(t.keys[i]))))throw new Error('unmatched join');}
      else if(indices.some(i=>matches.some(j=>t.units[i]!==other.units[j])))throw new Error('cross-table unit mismatch');
    }
  }
}
function verifyLineage(s:ContractStructure,tables:Map<string,VerifiedTable>,files:Map<string,Buffer>,options:ContractVerificationOptions):void{
  for(const tr of s.transformations){
    const converter=options.registry?.converters[tr.operation];if(!converter||converter.implementationHash!==tr.implementation_hash)throw new Error('converter unavailable');
    const outputs=converter.run({transformation:structuredClone(tr),structure:structuredClone(s),files:new Map([...files].map(([k,v])=>[k,Buffer.from(v)]))});
    const output=tables.get(tr.output_table)!,expected=[output.definition.file,...tr.output_files];
    if(outputs.size!==expected.length||expected.some(f=>!outputs.has(f.path)||sha256(outputs.get(f.path)!)!==f.sha256))throw new Error('converter output mismatch');
    const lineage:unknown=parseStrictJson(files.get(tr.row_lineage.path)!.toString('utf8'));
    if(!Array.isArray(lineage)||lineage.length!==output.rows.length)throw new Error('lineage output coverage');
    const outputKeys=new Set(output.keys.map(k=>canonicalJson(k))),seen=new Set<string>(),used=new Set<string>();
    for(const item of lineage){
      if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).sort().join()!=='inputs,output'||!Array.isArray(item.output)||item.output.some((v:unknown)=>typeof v!=='string')||!Array.isArray(item.inputs)||!item.inputs.length)throw new Error('lineage record');
      const key=canonicalJson(item.output);if(!outputKeys.has(key)||seen.has(key))throw new Error('lineage output key');seen.add(key);
      const local=new Set<string>(),sources=new Set<string>();
      for(const source of item.inputs){
        if(!source||Object.keys(source).sort().join()!=='key,table'||!Array.isArray(source.key)||source.key.some((v:unknown)=>typeof v!=='string')||!tr.input_tables.includes(source.table))throw new Error('lineage input');
        const input=tables.get(source.table)!,idx=input.keys.findIndex(k=>canonicalJson(k)===canonicalJson(source.key));if(idx<0)throw new Error('unknown lineage input');
        const token=canonicalJson(source);if(local.has(token))throw new Error('duplicate lineage input');local.add(token);used.add(token);sources.add(source.table);
        const outIdx=output.keys.findIndex(k=>canonicalJson(k)===key);if(input.units[idx]!==output.units[outIdx])throw new Error('lineage changes identity');
      }
      if(tr.operation==='join'&&sources.size!==tr.input_tables.length)throw new Error('join lineage omits input');
    }
    const excluded=new Set(s.row_exclusions.filter(e=>e.lineage_id===tr.id).map(e=>canonicalJson(e.row)));
    for(const table of tr.input_tables)for(const key of tables.get(table)!.keys){const token=canonicalJson({table,key});if(used.has(token)===excluded.has(token))throw new Error('lineage input/exclusion coverage');}
    for(const token of excluded){const row=JSON.parse(token) as {table:string;key:string[]};if(!tr.input_tables.includes(row.table)||!tables.get(row.table)!.keys.some(k=>canonicalJson(k)===canonicalJson(row.key)))throw new Error('unknown exclusion');}
  }
}

/** Byte verification is necessary, not provenance authentication or permission to Confirm.
 * Errors are deliberately generic: private identifiers never escape through a failure. */
export function verifyContractBytes(contract:unknown,files:ReadonlyMap<string,Uint8Array>,options:ContractVerificationOptions):ContractVerification{
  try{
    const context:ValidationContext=options.registry?{derivationRegistry:{version:options.registry.version,implementations:Object.fromEntries(Object.entries(options.registry.converters).map(([k,v])=>[k,v.implementationHash]))}}:{};
    const validation=validateDataContract(contract,context);if(!validation.ok)return {ok:false,code:'contract-structure-invalid'};
    const c=validation.value;
    if(c.public.hash!==options.expectedContractHash||(c.sealed_private?.hash??null)!==(options.expectedPrivateContractHash??null)||options.requirePrivate&&!c.sealed_private)return {ok:false,code:'contract-pin-mismatch'};
    const snapshot=new Map([...files].map(([k,v])=>[k,Buffer.from(v)]));
    const pinned=new Map<string,string>();refs(c,pinned);
    for(const [name,hash] of pinned)if(!snapshot.has(name)||sha256(snapshot.get(name)!)!==hash)throw new Error('file hash');
    // Extra metadata is allowed, but never available to contract-selected analysis or converters.
    const data=new Map([...pinned.keys()].map(k=>[k,snapshot.get(k)!]));
    if(!citationBytesVerified([c.public.content,...(c.sealed_private?[c.sealed_private.content]:[])].flatMap(l=>l.evidence),data))throw new Error('citation span');
    const snapshots:[Partition,'public'|'private'][]=[...c.public.content.structure.partitions.map(p=>[p,'public'] as [Partition,'public']),...(c.sealed_private?.content.structure.partitions??[]).map(p=>[p,'private'] as [Partition,'private'])];
    for(const [partition] of snapshots){
      const antecedent=options.antecedents?.get(partition.seed_provenance.contract_hash);
      if(!antecedent||antecedent.public.hash!==partition.seed_provenance.contract_hash||!validateDataContract(antecedent,context).ok||antecedent.public.content.structure.dataset_id!==c.public.content.structure.dataset_id)throw new Error('partition antecedent unavailable');
      // No historical bytes may be replaced by a declaration. This version supports source-stable
      // antecedents; changed-source histories require the host to provide a separate verifier pass.
      const pins=new Map<string,string>();refs(antecedent,pins);for(const [name,hash] of pins)if(!snapshot.has(name)||sha256(snapshot.get(name)!)!==hash)throw new Error('partition antecedent bytes unavailable');
      const historical=new IdentityResolver(antecedent.public.content.structure,c.public.content.structure);
      if(historical.errors.length||historical.partitionErrors([...antecedent.public.content.structure.partitions.map(p=>({layer:'public' as const,partition:p})),...c.public.content.structure.partitions.map(p=>({layer:'private' as const,partition:p}))]).length)throw new Error('partition history contradiction');
    }
    if(options.partitionArtifact){
      if(options.partitionArtifact.hash!==options.expectedPartitionHash||!validatePartitionArtifact(c,options.partitionArtifact,{...context,expectedPrivateContractHash:options.expectedPrivateContractHash??null}).ok)throw new Error('partition artifact unverified');
      if(!citationBytesVerified(options.partitionArtifact.content.evidence,data))throw new Error('partition citation span');
      snapshots.push(...options.partitionArtifact.content.partitions.map(p=>[p,'public'] as [Partition,'public']));
    }else if(options.expectedPartitionHash!==undefined)throw new Error('partition artifact missing');
    const pub=hydrateRegistries(c.public.content.structure,k=>data.get(k)!);
    const priv=c.sealed_private?hydrateRegistries(c.sealed_private.content.structure,k=>data.get(k)!):undefined;
    const resolver=new IdentityResolver(pub.structure,priv?.structure);if(resolver.errors.length||resolver.partitionErrors(snapshots.map(([partition,layer])=>({partition,layer}))).length)throw new Error('registry identity closure');
    const checkedLayers:[ContractStructure,Map<string,Map<string,string>>,'public'|'private'][]=[[pub.structure,pub.entities,'public'],...(priv?[[priv.structure,priv.entities,'private'] as [ContractStructure,Map<string,Map<string,string>>,'private']]:[])];
    let tables=new Map<string,VerifiedTable>();
    const parsedCache=new Map<string,ReturnType<typeof parseContractTable>>(),cellChecks=new Set<string>();
    for(const [s,registries,layer] of checkedLayers){
      tables=new Map();const resolve=(ns:string,raw:string,encoding:'token'|'canonical-json-array')=>resolver.resolveEntity(layer,ns,raw,encoding,registries);
      for(const definition of s.tables){
        let parsed=parsedCache.get(definition.file.path);if(!parsed){parsed=parseContractTable(definition.file.path,data.get(definition.file.path)!);parsedCache.set(definition.file.path,parsed);}
        if(canonicalJson(parsed.header)!==canonicalJson(definition.columns.map(col=>col.name)))throw new Error('table header mismatch');
        const keys=parsed.rows.map(row=>definition.row_key.map(k=>row[parsed.header.indexOf(k)]!));
        if(new Set(keys.map(k=>canonicalJson(k))).size!==keys.length)throw new Error('duplicate row key');
        for(const key of keys)key.forEach((value,i)=>resolve(definition.columns.find(col=>col.name===definition.row_key[i])!.namespace!,value,'token'));
        const d=definition.unit_derivation, axis=definition.orientation.unit_axis;
        const entityHeaders=definition.orientation.layout==='matrix'?parsed.header.filter(h=>!definition.row_key.includes(h)&&(axis==='columns'||['feature','measurement'].includes(definition.columns.find(c=>c.name===h)!.structural_kind))):[];
        const map=d.kind==='sidecar'?parseStrictJson(data.get(d.map.path)!.toString('utf8')) as Record<string,unknown>:null;
        if(map&&(!map||typeof map!=='object'||Array.isArray(map)))throw new Error('sidecar format');
        const unitKeys=axis==='columns'?entityHeaders.map(h=>[h]):keys;
        if(map&&(Object.keys(map).length!==unitKeys.length||unitKeys.some(k=>!Object.hasOwn(map,canonicalJson(k)))))throw new Error('sidecar coverage');
        const units=unitKeys.map((key,i)=>{
          let unit:string;
          if(d.kind==='column-tuple')unit=resolve(d.namespace,canonicalJson(d.columns.map(col=>parsed.rows[i]![parsed.header.indexOf(col)]!)),'canonical-json-array');
          else if(d.kind==='row-key-regex'){
            const input=key[0]!;if(input.length>512||/[^\x00-\x7f]/.test(input))throw new Error('regex input bound');
            const match=new RegExp(d.pattern).exec(input);if(!match||match[0]!==input||!match[1])throw new Error('regex derivation');unit=resolve(d.namespace,match[1],'token');
          }else{const token=map![canonicalJson(key)];if(typeof token!=='string')throw new Error('sidecar target');unit=resolve(d.namespace,token,'token');}
          return resolver.atLevel(layer,unit,resolver.hierarchy.floor!);
        });
        for(const [i,h] of entityHeaders.entries()){
          const entity=resolve(definition.orientation.header_namespace!,h,'token');
          const ns=s.namespaces.find(n=>n.id===definition.orientation.header_namespace)!;
          if(axis==='columns'&&(ns.entity_kind!=='unit'||resolver.atLevel(layer,entity,resolver.hierarchy.floor!)!==units[i]))throw new Error('matrix unit mismatch');
          if(axis==='rows'&&ns.entity_kind==='unit')throw new Error('ambiguous matrix axis');
        }
        if(axis==='rows'&&['units','samples'].includes(definition.orientation.row_entity))keys.forEach((key,i)=>key.forEach((value,j)=>{
          const ns=definition.columns.find(col=>col.name===definition.row_key[j])!.namespace!;
          if(s.namespaces.find(n=>n.id===ns)?.entity_kind==='unit'&&resolver.atLevel(layer,resolve(ns,value,'token'),resolver.hierarchy.floor!)!==units[i])throw new Error('row key/unit contradiction');
        }));
        const t={definition,...parsed,keys,units,entityHeaders},cellKey=canonicalSha256([definition.file,definition.columns]);if(!cellChecks.has(cellKey)){validateCells(t);cellChecks.add(cellKey);}tables.set(definition.id,t);
      }
      verifyJoins(s,tables,resolve);verifyLineage(s,tables,data,options);
      for(const endpoint of s.survival){
        const t=tables.get(endpoint.event.table)!,ec=t.header.indexOf(endpoint.event.column),tc=t.header.indexOf(endpoint.time.column);
        for(const row of t.rows){if(!endpoint.event_codes.some(c=>c.code===row[ec]))throw new Error('unmapped event');if(compareDecimals(row[tc]!,'0')<0)throw new Error('negative event time');if(endpoint.entry_time&&compareDecimals(row[t.header.indexOf(endpoint.entry_time.column)]!,row[tc]!)>0)throw new Error('entry after event');}
      }
    }
    return {ok:true,value:{contract:structuredClone(c),structure:priv?.structure??pub.structure,resolver,layer:priv?'private':'public',tables,files:data,partitionEvidence:structuredClone(options.partitionArtifact?.content.evidence??[]),manifestHash:canonicalSha256(Object.fromEntries([...snapshot].map(([k,v])=>[k,sha256(v)]))),limitations:[...pub.structure.collision_merges.map(m=>m.limitation)],partitions:[...new Map(snapshots.map(([p])=>[p.id,p])).values()],partitionHash:options.partitionArtifact?.hash??canonicalSha256(snapshots.map(([p])=>p))}};
  }catch(error){const category=error instanceof Error&&['duplicate row key','table header mismatch','sidecar coverage','decimal lattice','row key/unit contradiction','registry graph coverage','unresolved registry entity','unresolved unit identity','registry normalization','registry format','registry order/duplicate','lineage input/exclusion coverage'].includes(error.message)?error.message.replaceAll(' ','-'):'bytes-unverified';return {ok:false,code:'contract-'+category};}
}

/** Shared with history authentication: shape-only L2 validation is never byte proof. */
export function citationBytesVerified(evidence:readonly FieldEvidence[],files:ReadonlyMap<string,Buffer>):boolean{
  const byHash=new Map([...files.values()].map(bytes=>[sha256(bytes),bytes]));
  return evidence.every(e=>e.citations.every(cite=>{
    const bytes=byHash.get(cite.file_sha256);
    return !!bytes&&Number.isSafeInteger(cite.byte_start)&&Number.isSafeInteger(cite.byte_end)&&cite.byte_start>=0&&cite.byte_end>cite.byte_start&&cite.byte_end<=bytes.length&&bytes.subarray(cite.byte_start,cite.byte_end).includes(Buffer.from(cite.quote));
  }));
}
