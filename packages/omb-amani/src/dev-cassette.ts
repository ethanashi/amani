import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WorkerAdapter, WorkerResult, WorkerSpec } from '../../omb-adapters/src/index.ts';
import { hashOf } from '../../omb-investigate/src/machine.ts';
import { remap } from './dev-fork.ts';

export type Files = Record<string,{bytes:string; executable:boolean}>;
export interface TurnInput { phase:string; job:string; family:string; model:string; effort:string; harness:string; network:string; prompt:string; resume:string|null; expect:WorkerSpec['expect']; mounts:{path:string;hash:string}[]; work:Record<string,string> }
export interface CassetteEntry { version:1; recordedAt?:number; turn:number; inputHash:string; input:TurnInput; files:Files; result:WorkerResult; outputHash:string }
const safe = (n:string) => n && !path.isAbsolute(n) && !n.split(/[\\/]/).some(p=>p==='..'||p==='.'||!p);
export function snapshot(dir:string):Files {
 const files:Files={};let bytes=0;
 const walk=(rel:string)=>{for(const n of readdirSync(path.join(dir,rel)).sort()){
  const r=rel?`${rel}/${n}`:n,p=path.join(dir,r),st=lstatSync(p);
  if(st.isSymbolicLink()||!st.isDirectory()&&!st.isFile())throw new Error(`cassette refuses linked/nonregular file: ${r}`);
  if(st.isDirectory())walk(r);else {bytes+=st.size;if(bytes>64*1024*1024)throw new Error('cassette work snapshot exceeds 64 MiB');files[r]={bytes:readFileSync(p).toString('base64'),executable:!!(st.mode&0o111)};}
 }};if(existsSync(dir))walk('');return files;
}
export function restore(dir:string,files:Files):void {
 for(const [n,v]of Object.entries(files))if(!safe(n)||typeof v.bytes!=='string')throw new Error('unsafe cassette output path');
 // dir is host-owned; do not follow a substituted workdir link.
 if(existsSync(dir)&&lstatSync(dir).isSymbolicLink())throw new Error('linked cassette workdir');
 rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true,mode:0o700});
 for(const [n,v]of Object.entries(files)){const f=path.join(dir,n);mkdirSync(path.dirname(f),{recursive:true,mode:0o700});writeFileSync(f,Buffer.from(v.bytes,'base64'),{mode:v.executable?0o700:0o600});}
}
function mountHash(root:string):string {
 const files:Record<string,string>={};const base=realpathSync(root);
 const walk=(p:string,rel:string,ancestors:Set<string>)=>{
  const st=lstatSync(p);
  if(st.isSymbolicLink()){
   const target=realpathSync(p);if(target!==base&&!target.startsWith(base+'/'))throw new Error(`mount link escapes its root: ${rel}`);
   files[rel+'@link']=readlinkSync(p);if(ancestors.has(target))return;walk(target,rel,new Set([...ancestors,target]));
  }else if(st.isDirectory())for(const n of readdirSync(p).sort())walk(path.join(p,n),rel?`${rel}/${n}`:n,new Set([...ancestors,p]));
  else if(st.isFile())files[rel]=createHash('sha256').update(readFileSync(p)).update(String(st.mode&0o111)).digest('hex');
  else throw new Error('nonregular mounted input');
 };walk(base,'',new Set());return hashOf(files);
}
export function turnInput(s:WorkerSpec,roots:[string,string][],history:Map<string,string>=new Map()):TurnInput {
 const normalize=(v:string)=>remap(v,roots),prompt=normalize(s.resume?.message??readFileSync(s.promptFile,'utf8'));
 const files=mapFiles(snapshot(s.workdir),roots);delete files['amani-prompt.txt'];
 return {phase:/^OMB-PHASE: (\S+)/m.exec(prompt)?.[1]??s.kind,job:s.jobId,family:s.family,model:s.model,effort:s.effort,harness:s.harness,network:s.network,prompt,
  resume:s.resume?history.get(s.resume.sessionToken)??hashOf({legacySession:s.resume.sessionToken}):null,expect:s.expect,
  mounts:s.mounts.map(m=>({path:normalize(m.path),hash:mountHash(m.path)})),
  work:Object.fromEntries(Object.entries(files).map(([n,f])=>[n,hashOf(f)]))};
}
export class Divergence extends Error {
 constructor(readonly turn:number,readonly input:TurnInput,readonly reason:string){super(`diverged at turn ${turn} (${input.phase}, ${input.job}): input changed because ${reason}`);this.name='Divergence';}
}
function mapFiles(files:Files,roots:[string,string][]):Files {
 return Object.fromEntries(Object.entries(files).map(([n,f])=>{const bytes=Buffer.from(f.bytes,'base64'),text=bytes.toString('utf8');return[n,{...f,bytes:Buffer.from(text).equals(bytes)?Buffer.from(remap(text,roots)).toString('base64'):f.bytes}];}));
}
export class TurnCassette {
 readonly entries:CassetteEntry[]=[];readonly history=new Map<string,string>();
 readonly stats={hits:0,modelCalls:0,divergences:[] as string[]}; live=false; sequence=0;
 constructor(readonly options:{root:string;source?:string;roots:[string,string][];mode:'record'|'stop'|'live';seedBefore?:number;beforeLive?:()=>void}){
  if(options.source&&existsSync(options.source))for(const n of readdirSync(options.source).filter(n=>n.endsWith('.json')).sort()){
   const e=JSON.parse(readFileSync(path.join(options.source,n),'utf8')) as CassetteEntry;
   if(e.version!==1||hashOf(e.input)!==e.inputHash||hashOf({files:e.files,result:e.result})!==e.outputHash)throw new Error('corrupt turn cassette');
   this.entries.push(e);if(e.result.sessionToken&&e.recordedAt!==undefined&&e.recordedAt<=(options.seedBefore??-Infinity))this.history.set(e.result.sessionToken,hashOf({input:e.inputHash,output:e.outputHash}));
  }
 }
 wrap(worker:WorkerAdapter):WorkerAdapter{return{run:async s=>{
  const input=turnInput(s,this.options.roots,this.history),inputHash=hashOf(input),turn=++this.sequence;
  const hit=!this.live&&this.options.mode!=='record'?this.entries.find(e=>e.inputHash===inputHash):undefined;
  if(hit){restore(s.workdir,mapFiles(hit.files,this.options.roots.map(([a,b])=>[b,a])));this.save({...hit,turn,recordedAt:Date.now()});this.stats.hits++;if(hit.result.sessionToken)this.history.set(hit.result.sessionToken,hashOf({input:hit.inputHash,output:hit.outputHash}));return structuredClone(hit.result);}
  if(!this.live&&this.options.mode!=='record'){
   const candidate=this.entries.find(e=>e.input.phase===input.phase&&e.input.job===input.job);
   const changed=candidate?Object.keys(input).filter(k=>hashOf(input[k as keyof TurnInput])!==hashOf(candidate.input[k as keyof TurnInput])).join(', '):'no complete recorded input/output exists for this phase/job';
   const error=new Divergence(turn,input,changed);this.stats.divergences.push(error.message);
   if(this.options.mode==='stop')throw error;try{this.options.beforeLive?.();}catch(e){throw new Divergence(turn,input,`live fallback unavailable: ${String(e)}`);}this.live=true;
  }
  this.stats.modelCalls++;
  // Saved adapter sessions are not copied into a fork. Start fresh on first live use
  // of an imported token; subsequent real tokens belong to this new adapter instance.
  const {resume,...fresh}=s;
  const useFresh=this.options.mode!=='record'&&resume&&!this.liveSessions.has(resume.sessionToken);
  if(useFresh)writeFileSync(s.promptFile,resume.message,{mode:0o600});
  const result=await worker.run(useFresh?fresh:s);
  if(result.sessionToken)this.liveSessions.add(result.sessionToken);
  const files=mapFiles(snapshot(s.workdir),this.options.roots),outputHash=hashOf({files,result}),entry:CassetteEntry={version:1,recordedAt:Date.now(),turn,inputHash,input,files,result,outputHash};
  this.save(entry);
  if(result.sessionToken)this.history.set(result.sessionToken,hashOf({input:inputHash,output:outputHash}));return result;
 }};}
 private save(entry:CassetteEntry):void {mkdirSync(this.options.root,{recursive:true,mode:0o700});writeFileSync(path.join(this.options.root,`${String(entry.turn).padStart(6,'0')}-${entry.inputHash}.json`),JSON.stringify(entry)+'\n',{flag:'wx',mode:0o600});}
 private liveSessions=new Set<string>();
}
