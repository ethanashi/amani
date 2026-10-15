import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, linkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { constants } from 'node:os';
const SOURCE=new URL('./native/reap-sandbox.c',import.meta.url);
const COMPILER='/usr/bin/cc',FLAGS=Object.freeze(['-O2']);
/** Build identity: compiler, flags and the exact source bytes that are compiled. */
export function supervisorBuildKey(source:Buffer):string{
  return createHash('sha256').update(JSON.stringify({compiler:COMPILER,flags:FLAGS})).update('\0').update(source).digest('hex');
}
let native:{key:string;bytes:Buffer}|undefined;
export interface SupervisorOutcome{exitCode:number|null;signal:NodeJS.Signals|null;survivors:number|null;census:number|null; matched?: {pid:number;startSeconds:number;startMicros:number;executable:string}[]; matchedTruncated?: boolean}
export interface SandboxReaper{
  allow:string;deny:string;command:string;args:string[];
  /** sourceSha256 binds the binary to the current source and flags; compiled is true when this call rebuilt it. */
  build:{sourceSha256:string;binarySha256:string;compiled:boolean};
  outcome:()=>SupervisorOutcome;complete:()=>void;reap:()=>boolean;close:()=>void;
}
/** Helpers are host-only siblings of execution scratch, never frozen worker code or readable mounts.
 * Every call re-reads the supervisor source: the in-process build is reused only while the source
 * bytes, compiler and flags are unchanged, so a long-lived host never keeps running a supervisor
 * compiled from older source. The binary is cached hash-verified in host state to avoid repeated
 * macOS executable validation. Per-run census files are removed. Missing compiler/SPI fails closed.
 * `options.source` is a trusted host/test seam, never worker input. */
export function sandboxReaper(parent:string,options:{source?:string|URL}={}):SandboxReaper{
  const root=mkdtempSync(path.join(parent,'reaper-')),allow='omb.cleanup.'+randomUUID()+'.allow',deny=allow+'.deny';
  try{
    const sourceBytes=readFileSync(options.source??SOURCE),key=supervisorBuildKey(sourceBytes);
    let compiled=false;
    if(native?.key!==key){
      const build=path.join(root,'reap'),source=path.join(root,'reap.c');writeFileSync(source,sourceBytes);
      mkdirSync(path.join(root,'tmp'));
      execFileSync(COMPILER,[...FLAGS,source,'-o',build],{timeout:10_000,env:{PATH:'/usr/bin:/bin',TMPDIR:path.join(root,'tmp')},stdio:'pipe'});
      native={key,bytes:readFileSync(build)};compiled=true;
    }
    const bytes=native.bytes;
    const cache=path.join(process.env.BIO_GRADING_ROOT??parent,'native-supervisors');mkdirSync(cache,{recursive:true,mode:0o700});
    const hash=createHash('sha256').update(bytes).digest('hex'),bin=path.join(cache,hash);
    if(!existsSync(bin)){const candidate=path.join(root,'publish');writeFileSync(candidate,bytes,{mode:0o500,flag:'wx'});try{linkSync(candidate,bin);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}finally{rmSync(candidate,{force:true});}}
    if(createHash('sha256').update(readFileSync(bin)).digest('hex')!==hash)throw new Error('trusted supervisor changed');
    const snapshot=path.join(root,'before');
    let resultCache:boolean|undefined;
    const integer=(v:unknown)=>Number.isInteger(v)?v as number:null;
    return {allow,deny,command:bin,args:['--run',allow,deny,snapshot],build:{sourceSha256:key,binarySha256:hash,compiled},outcome:()=>{
      const receipt=JSON.parse(readFileSync(snapshot+'.outcome','utf8')) as {exitCode:number;signal:number;survivors?:unknown;census?:unknown;matched?:unknown;matchedTruncated?:unknown};
      if(!Number.isInteger(receipt.exitCode)||!Number.isInteger(receipt.signal))throw new Error('supervisor outcome unavailable');
      return {exitCode:receipt.exitCode<0?null:receipt.exitCode,signal:(Object.entries(constants.signals).find(([,n])=>n===receipt.signal)?.[0] as NodeJS.Signals|undefined)??null,
        survivors:integer(receipt.survivors),census:integer(receipt.census),
        ...(Array.isArray(receipt.matched)?{matched:receipt.matched.slice(0,32).filter((v):v is NonNullable<SupervisorOutcome['matched']>[number]=>!!v&&Number.isSafeInteger(v.pid)&&v.pid>0&&Number.isSafeInteger(v.startSeconds)&&v.startSeconds>0&&Number.isSafeInteger(v.startMicros)&&v.startMicros>=0&&v.startMicros<1000000&&typeof v.executable==='string'&&/^[a-zA-Z0-9._+-]{0,96}$/.test(v.executable)).map(v=>({pid:v.pid,startSeconds:v.startSeconds,startMicros:v.startMicros,executable:v.executable})),matchedTruncated:receipt.matchedTruncated===true||receipt.matched.length>32}:{})};
    },complete:()=>{resultCache=true;},reap:()=>{
      if(resultCache!==undefined)return resultCache;
      const result=execFileSync(bin,['--reap',allow,deny,snapshot],{timeout:10_500,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
      // "0": two clean passes. A positive count: survivors were observed (and killed). Anything else is unproven.
      if(!/^(?:0|[1-9]\d*)$/.test(result))throw new Error('sandbox cleanup unproven');if(result==='0')resultCache=true;return result==='0';
    },close:()=>rmSync(root,{recursive:true,force:true})};
  }catch(e){rmSync(root,{recursive:true,force:true});throw e;}
}
