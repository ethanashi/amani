import { contentFindings } from './identity.ts';
import { declaredStage, declaredEffectiveTable, type StageDeclarations } from './declared-stage.ts';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { effectiveTable, singleParseGates } from './stage-parser.ts';
import { GateAuthority } from './auth.ts';
import { g1FromGatesDocument, type GateResult } from '../../omb-gauntlet/src/index.ts';
export const PREPARE = '#!/bin/sh\nset -eu\nrm -rf data\nmkdir -p data\ncp -R RAW/. data/\n';
export interface StagedInputs {
  directory: string; inputManifestHash: string; effectiveManifestHash: string;
  groups: string[][]; units: string[]; declarations?: StageDeclarations; tableUnits?: Record<string,string[]>; gate: GateResult; elapsedMs: number; cacheHit: boolean;
  contractMode?:boolean;
  verifiedContract?:import('./contract-verifier.ts').VerifiedContract;
  contractAuthenticated?:boolean;
  /** Host memory only; never copied to the worker filesystem or environment. */
  contractUnitKey?:Uint8Array;
  contractHistory?:import('./contract-authority.ts').ContractHistory|null;
}
export function treeManifest(dir:string): Record<string,string> {
  const out:Record<string,string>={};
  const visit=(relative:string)=>{for(const name of readdirSync(path.join(dir,relative)).sort()){
    const key=relative?`${relative}/${name}`:name, file=path.join(dir,key), st=lstatSync(file);
    if(st.isSymbolicLink()||st.nlink>1&&!st.isDirectory())throw new Error('linked trusted input');
    if(st.isDirectory())visit(key);else if(st.isFile())out[key]=createHash('sha256').update(readFileSync(file)).digest('hex');else throw new Error('nonregular input');
  }};visit('');return out;
}
/** Cache must be host-owned and outside worker mounts; a cache hit is rehashed, never blindly
 * trusted. The source hash includes metadata and every file, so added/changed files invalidate it. */
export class Stager {
  readonly #cache=new Map<string,StagedInputs>();
  readonly cacheRoot:string; readonly now:()=>number; readonly authority:GateAuthority|undefined;
  constructor(cacheRoot:string, now:()=>number, authority?:GateAuthority){this.cacheRoot=cacheRoot;this.now=now;this.authority=authority;mkdirSync(cacheRoot,{recursive:true,mode:0o700});}
  stage(raw:string,onParse?:(file:string)=>void,declarations?:StageDeclarations,models:Readonly<Record<string,readonly string[]>>={}):StagedInputs {
    // Read the worker-inaccessible source once into a host snapshot. Hash exactly the buffers
    // published there; parsing and advertised-manifest validation use this same snapshot.
    const snapshot=mkdtempSync(path.join(this.cacheRoot,'snapshot-')),manifest:Record<string,string>={};
    try{
      for(const name of readdirSync(raw).sort()){
        const file=path.join(raw,name),st=lstatSync(file);
        if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw new Error('linked/nonregular raw input');
        const bytes=readFileSync(file);manifest[name]=createHash('sha256').update(bytes).digest('hex');
        writeFileSync(path.join(snapshot,name),bytes,{mode:0o400});
      }
      return this.stageSnapshot(snapshot,canonicalSha256(manifest),onParse,declarations,models);
    }finally{rmSync(snapshot,{recursive:true,force:true});}
  }
  private stageSnapshot(raw:string,inputManifestHash:string,onParse?:(file:string)=>void,declarations?:StageDeclarations,models:Readonly<Record<string,readonly string[]>>={}):StagedInputs {
    const start=this.now(), identity=canonicalSha256([inputManifestHash,declarations??null,models]), cached=this.#cache.get(identity);
    if(cached){if(canonicalSha256(treeManifest(cached.directory))!==cached.effectiveManifestHash)throw new Error('trusted staged inputs changed');return structuredClone({...cached,elapsedMs:this.now()-start,cacheHit:true});}
    const cacheBinding={planHash:canonicalSha256(['stage-v4',declarations??null,models]),inputManifestHash,frozenCodeHash:canonicalSha256([
      readFileSync(new URL('./stage.ts',import.meta.url),'utf8'),readFileSync(new URL('./declared-stage.ts',import.meta.url),'utf8'),readFileSync(new URL('./stage-parser.ts',import.meta.url),'utf8'),readFileSync(new URL('./identity.ts',import.meta.url),'utf8'),readFileSync(new URL('./casefold.ts',import.meta.url),'utf8'),readFileSync(new URL('../../bio-checks/src/validity/duplicates.ts',import.meta.url),'utf8'),readFileSync(new URL('../../bio-checks/src/evidence.ts',import.meta.url),'utf8')]),executionId:'stage-cache'};
    const cacheKey=canonicalSha256(cacheBinding), directory=path.join(this.cacheRoot,cacheKey), receiptFile=directory+'.json';
    if(this.authority && lstatExists(receiptFile)){
      const receipt=JSON.parse(readFileSync(receiptFile,'utf8')) as {staged:StagedInputs;signature:unknown};
      const checked=this.authority.verify(receipt.signature,cacheBinding);
      if(!checked||checked.evidence.cacheHash!==canonicalSha256(receipt.staged)||receipt.staged.directory!==directory||receipt.staged.inputManifestHash!==inputManifestHash
        ||canonicalSha256(treeManifest(directory))!==receipt.staged.effectiveManifestHash)throw new Error('trusted staging cache changed');
      this.#cache.set(identity,receipt.staged);return {...receipt.staged,cacheHit:true,elapsedMs:this.now()-start};
    }
    const advertised=path.join(raw,'manifest.json');
    if(lstatExists(advertised)){
      const manifest=JSON.parse(readFileSync(advertised,'utf8')) as {files?:{path:string;sha256:string;bytes?:number}[]};
      const actual=treeManifest(raw);delete actual['manifest.json'];
      if(!Array.isArray(manifest.files)||manifest.files.length!==Object.keys(actual).length||manifest.files.some(f=>actual[f.path]!==f.sha256
        ||f.bytes!==undefined&&lstatSync(path.join(raw,f.path)).size!==f.bytes))throw new Error('raw manifest mismatch');
    }
    const parsed=declarations?declaredStage(raw,declarations,onParse,models):singleParseGates(raw,onParse,models);
    const primary=parsed.tables.find(t=>t.axis==='columns')??parsed.tables.find(t=>!t.dictionary);
    let {gate}=g1FromGatesDocument(parsed.document,primary?.file);
    if(gate.outcome==='passed') {
      const sourceFacts=gate.evidence.facts as Record<string,number>,facts:Record<string,number>={},warnings:string[]=[];
      for(const [key,value] of Object.entries(sourceFacts))facts['raw.'+key]=value;
      const byId=new Map<string,string>();parsed.groups.forEach(g=>g.forEach(id=>byId.set(id,g[0]!)));
      const counts=(signatures:string[])=>{const groups=new Map<string,number>();for(const signature of signatures)groups.set(signature,(groups.get(signature)??0)+1);const duplicates=[...groups.values()].filter(n=>n>1);return {duplicate_groups:duplicates.length,duplicate_records:duplicates.reduce((s,n)=>s+n-1,0)};};
      for(const t of parsed.tables){
        const seen=new Set<string>(),kept=t.ids.flatMap((id,i)=>{const unit=byId.get(id)??id;if(!declarations&&seen.has(unit))return [];seen.add(unit);return [i];});
        const rawFacts={input_n:t.ids.length,effective_n:seen.size,...counts(t.signatures)};
        const effectiveFacts={input_n:kept.length,effective_n:seen.size,...counts(kept.map(i=>t.signatures[i]!))};
        for(const [key,value] of Object.entries(rawFacts)){facts[`raw.${t.file.toLowerCase()}.${key}`]=value;if(t===primary)facts['raw.'+key]=value;}
        for(const [key,value] of Object.entries(effectiveFacts)){
          facts[`${t.file.toLowerCase()}.${key}`]=value;facts[`effective.${t.file.toLowerCase()}.${key}`]=value;
          if(t===primary){facts[key]=value;facts['effective.'+key]=value;}
        }
        if(rawFacts.duplicate_records>0)warnings.push(`${t.file}: identical content observed; distinct identities retained unless full-profile corroboration permits collapse${declarations?' (locked acknowledgement present)':''}`);
      }
      gate={...gate,evidence:{...gate.evidence,facts,warnings,factTable:primary?.file??null,factView:`unqualified facts describe effective inputs of ${primary?.file??'unavailable'}; raw.* describes source`}};
    }
    if(gate.outcome!=='passed')throw new Error('staging validity unavailable');
    const integrityFindings=contentFindings(parsed.tables,models).filter(f=>!(declarations?.[f.table]?.acknowledgeContentDuplicates&&declarations?.[f.otherTable]?.acknowledgeContentDuplicates)&&!parsed.groups.some(g=>g.includes(f.left)&&g.includes(f.right)));
    const nonBiological=Object.entries(declarations??{}).flatMap(([table,d])=>(d.nonBiologicalColumns??[]).map(column=>({table,column})));
    gate={...gate,...(integrityFindings.length?{outcome:'failed' as const,summary:'unresolved content identity findings; unit counts are not verified'}:{}),evidence:{...gate.evidence,integrityFindings:integrityFindings.map(f=>({...f})),nonBiological,facts:{...gate.evidence.facts as Record<string,number>,...Object.fromEntries(parsed.tables.map(t=>[`${t.file.toLowerCase()}.suspected_duplicate_pairs`,integrityFindings.filter(f=>f.table===t.file||f.otherTable===t.file).length]))}}};
    const pending=directory+'.pending';
    if(lstatExists(directory))throw new Error('untrusted pre-existing staging cache entry');
    mkdirSync(pending,{mode:0o700});
    try{
      mkdirSync(path.join(pending,'RAW'));
      mkdirSync(path.join(pending,'SOURCE'));
      for(const name of readdirSync(raw))writeFileSync(path.join(pending,'SOURCE',name),readFileSync(path.join(raw,name)),{mode:0o400});
      for(const t of parsed.tables)writeFileSync(path.join(pending,'RAW',t.file),declarations?declaredEffectiveTable(t):effectiveTable(t,parsed.groups),{mode:0o400});
      for(const name of readdirSync(raw))if(name!=='manifest.json'&&!parsed.tables.some(t=>t.file===name))writeFileSync(path.join(pending,'RAW',name),readFileSync(path.join(raw,name)),{mode:0o400});
      // Matrix remains feature x sample in its original file. A companion map supplies the
      // neutral unit_id column without inventing an extra expression feature/sample.
      writeFileSync(path.join(pending,'RAW','units.tsv'),'sample_id\tunit_id\n'+parsed.groups.flatMap(g=>g.map(id=>`${id}\t${g[0]}`)).join('\n')+'\n',{mode:0o400});
      writeFileSync(path.join(pending,'prepare.sh'),PREPARE,{mode:0o500});
      renameSync(pending,directory);
    }finally{rmSync(pending,{recursive:true,force:true});}
    const staged:StagedInputs={directory,inputManifestHash,effectiveManifestHash:canonicalSha256(treeManifest(directory)),groups:parsed.groups,units:parsed.groups.map(g=>g[0]!),gate,elapsedMs:this.now()-start,cacheHit:false,...(declarations?{declarations,tableUnits:Object.fromEntries(parsed.tables.map(t=>[t.file,[...new Set(t.donor)]]))}:{})};
    if(this.authority)writeFileSync(receiptFile,JSON.stringify({staged,signature:this.authority.seal(cacheBinding,{...gate,evidence:{...gate.evidence,cacheHash:canonicalSha256(staged)}})}),{flag:'wx',mode:0o600});
    this.#cache.set(identity,structuredClone(staged));return staged;
  }
}
function lstatExists(file:string):boolean {try{lstatSync(file);return true;}catch{return false;}}
/** V5's only split seam receives collapsed groups; returning an assignment for raw IDs is
 * impossible here. Every duplicate inherits its representative's partition. */
export function splitEffective(staged:StagedInputs, assign:(units:readonly string[])=>ReadonlyMap<string,string>):Map<string,string>{
  const assignments=assign([...staged.units]);
  if(assignments.size!==staged.units.length||staged.units.some(u=>!assignments.get(u)))throw new Error('incomplete effective split');
  const out=new Map<string,string>();for(const group of staged.groups)for(const id of group)out.set(id,assignments.get(group[0]!)!);return out;
}
