import { declaredNonEstimability } from '../../omb-procedures/src/numerical-validity.ts';
import { assertSourcePolicy, CodePolicyError, refusalRecord, type RefusalRecord } from './source-policy.ts';
import { createHash } from 'node:crypto';
import { runProcess } from '../../omb-adapters/src/process.ts';
import { statfsSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, readdirSync, lstatSync, writeFileSync, realpathSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { canonicalSha256, HostSandbox, machOLibraryRoots, type SandboxAdapter } from '../../bio-core/src/index.ts';
import { IssueLog, parseLenientJson, snapshotOutputs, type OutputSnapshot } from '../../omb-gauntlet/src/index.ts';
import { sandboxReaper } from './reaper.ts';
import { normalizeRunInputs } from './run-inputs.ts';
import { treeManifest, PREPARE, type StagedInputs } from './stage.ts';
const libraryCache=new Map<string,string[]>();
function runtimeLibraries():string[]{let libs=libraryCache.get(process.execPath);if(!libs){libs=process.platform==='darwin'?machOLibraryRoots(process.execPath):[];libraryCache.set(process.execPath,libs);}return libs;}
export interface FrozenCode { directory:string; hash:string; /** Separate byte binding preserves existing code-based procedure seeds. */ planHash?:string; }
function frozenCodeIntact(frozen:FrozenCode):boolean {
  const files=treeManifest(frozen.directory);
  if(frozen.planHash!==undefined){if(files['plan.json']!==frozen.planHash)return false;delete files['plan.json'];}
  return canonicalSha256(files)===frozen.hash;
}
export type ExecutionKind='timeout'|'exit-nonzero'|'output-cap'|'bad-json'|'missing-output'|'output-link'|'survivor'|'copy-denied'|'census-fault'|'sandbox-unavailable'|'cancelled'|'host-fault'|'data-unreadable';
export interface Execution { kind?:ExecutionKind; exitCode?:number|null; workerStarted?:boolean; warnings?:string[]; cleanReceipt?:boolean; refusal?:RefusalRecord; status:'ok'|'not-run'|'failed'; reason:string; files:Record<string,string>; binaryFiles?:Record<string,Buffer>; snapshot:OutputSnapshot|null; effectiveInputsVerified:boolean; syntheticStderr?:string; /** Host-only fault detail, never an analysis stderr channel. */ internalReason?:string; trustedChange?:boolean; }
/** Explicit file inventory: never copy worker outputs, home, env links or gate JSON. */
export function freezeCode(worker:string,destination:string,lockedPlan?:string):FrozenCode {
  mkdirSync(destination,{recursive:false,mode:0o700});
  for(const entry of ['code','run_all.sh','run_primary.sh']){
    const source=path.join(worker,entry);let st;try{st=lstatSync(source);}catch{if(entry==='run_all.sh')throw new CodePolicyError(entry,'required source file missing');continue;}
    if(st.isSymbolicLink())throw new CodePolicyError(entry,'linked code refused');
    const validateTree=(file:string,relative:string):void=>{
      const info=lstatSync(file);
      if(info.isDirectory()&&!info.isSymbolicLink()){for(const name of readdirSync(file).sort())validateTree(path.join(file,name),`${relative}/${name}`);}
      else validateSource(file,relative);
    };
    validateTree(source,entry);
    cpSync(source,path.join(destination,entry),{recursive:true,dereference:false});
  }
  const files=treeManifest(destination);if(Object.keys(files).length>128)throw new CodePolicyError('code/','source inventory size cap');
  let total=0;for(const name of Object.keys(files)){const file=path.join(destination,name);validateSource(file,name);assertSourcePolicy(name,readFileSync(file,'utf8'));total+=lstatSync(file).size;}
  if(total>1_000_000)throw new CodePolicyError('code/','source inventory size cap');
  // V7 supplies bytes from its host-owned locked-plan snapshot, never the worker plan.
  // Legacy callers' plan bytes remain bound by the separate digest and independent plan-lock gate.
  const plan=lockedPlan??(existsSync(path.join(worker,'plan.json'))?readFileSync(path.join(worker,'plan.json'),'utf8'):undefined);
  if(plan!==undefined)writeFileSync(path.join(destination,'plan.json'),plan,{mode:0o400});
  return {directory:destination,hash:canonicalSha256(files),...(plan===undefined?{}:{planHash:createHash('sha256').update(plan).digest('hex')})};
}
const SOURCE_EXTENSIONS=new Set(['.sh','.bash','.awk','.py','.r','.js','.mjs','.cjs','.ts','.mts','.json','.yaml','.yml','.toml','.cfg','.csv','.tsv']);
export function validateSource(file:string,relative=path.basename(file)):void {
  const st=lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw new CodePolicyError(relative,'linked or non-regular source refused');
  if(!SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()))throw new CodePolicyError(relative,'not a source/config file (.sh .bash .awk .py .r .js .mjs .cjs .ts .mts .json .yaml .yml .toml .cfg .csv .tsv); refused');
  if(st.size>256_000)throw new CodePolicyError(relative,'source file size cap exceeded');
  const bytes=readFileSync(file);
  if(bytes.includes(0)||Buffer.from(bytes.toString('utf8')).compare(bytes)!==0)throw new CodePolicyError(relative,'binary source refused');
}
export interface ExecutorOptions {
  scratchRoot:string; toolPath:string; runtimeRoots:string[]; timeoutMs:number;
  /** Monotonic host clock; tests advance it at the process boundary. */
  now?:()=>number;
  /** Host-pinned activation, never taken from frozen worker deliverables. */
  activation?:{script:string;sha256:string};
  abortSignal?:AbortSignal;
  /** Trusted process dependency: tests inject exact-boundary deadlines. */
  runner?:typeof runProcess;
  reaperFactory?:()=>ReturnType<typeof sandboxReaper>;
  sandbox?:SandboxAdapter; faultAt?:(point:'copied'|'before-spawn'|'after-exit',directory:string)=>void;
}
/** A host-only executor. Runtime roots must be trusted immutable runtimes, never a worker
 * workdir/authority parent. Sandbox refuses network, and only this execution's copy is writable. */
export class OfflineExecutor {
  readonly options:ExecutorOptions;
  constructor(options:ExecutorOptions){this.options=options;mkdirSync(options.scratchRoot,{recursive:true,mode:0o700});}
  /** Trusted pre-look probe; executes no worker code or scientific data. */
  async health():Promise<void>{
    const disk=statfsSync(this.options.scratchRoot);if(disk.bavail*disk.bsize<256_000_000)throw new Error('disk-floor');
    const dir=mkdtempSync(path.join(this.options.scratchRoot,'health-'));let reap:ReturnType<typeof sandboxReaper>|undefined;
    try{
      const prepared=(this.options.sandbox??new HostSandbox()).prepare({profile:'proof',command:'/usr/bin/true',args:[],cwd:dir,readableRoots:[dir],writableRoots:[dir],artifactRoot:dir,toolPath:this.options.toolPath,toolchainReadRoots:[...this.options.runtimeRoots,...runtimeLibraries()],allowLoopback:false,timeoutMs:2000,maxOutputBytes:4096});
      if(!prepared.spec)throw new Error('sandbox-unavailable');
      const spec={...prepared.spec,args:[...prepared.spec.args]};
      if(prepared.sandboxClass==='seatbelt'){
        reap=this.options.reaperFactory?.()??sandboxReaper(path.dirname(this.options.scratchRoot));
        const p=spec.args.indexOf('-p');if(p<0)throw new Error('sandbox-unavailable');
        spec.args[p+1]=withoutSharedIPC(spec.args[p+1]!)+`(allow mach-lookup (global-name ${JSON.stringify(reap.allow)}))\n(deny mach-lookup (global-name ${JSON.stringify(reap.deny)}))\n`;
      }
      const out=await (this.options.runner??runProcess)({command:reap?.command??spec.command,args:reap?[...reap.args,spec.command,...spec.args]:spec.args,cwd:spec.cwd,env:spec.env??{},timeoutMs:2000,maxOutputBytes:4096});
      if(out.exitCode!==0||out.timedOut||out.cleanupFailed)throw new Error('sandbox health probe failed');
      if(reap){const receipt=reap.outcome();if(receipt?.exitCode!==0||receipt.census!==0||receipt.survivors!==0||!reap.reap())throw new Error('census-fault');reap.complete();}
    }finally{try{reap?.reap();}finally{reap?.close();rmSync(dir,{recursive:true,force:true});}}
  }
  async run(frozen:FrozenCode,staged:StagedInputs,mode:'all'|'primary'='all', transform?:(data:string)=>void,softwareSeeds:Readonly<Record<string,string>>={},diagnostics:'redacted'|'synthetic'='redacted'):Promise<Execution>{
    // No job-level ancestor metadata: each run has a fresh parent under shared /tmp.
    let root:string|undefined;
    let reaper:ReturnType<typeof sandboxReaper>|undefined,exitCode:number|null=null;
    let faultKind:ExecutionKind='host-fault',outputContext='outputs';
    const warnings:string[]=[];let workerStarted=false,readOnlyCopies=false;
    const empty=(status:Execution['status'],reason:string,trustedChange=false,kind:ExecutionKind=status==='not-run'?'host-fault':reason.startsWith('write-outside-outputs:')?'copy-denied':reason.includes('deadline')?'timeout':'exit-nonzero'):Execution=>({status,reason,kind,exitCode,workerStarted,warnings,files:{},snapshot:null,effectiveInputsVerified:false,trustedChange,refusal:refusalRecord(trustedChange?'trusted-path-changed':reason.startsWith('write-outside-outputs:')?'write-outside-outputs':reason.includes('deadline')?'timeout':status==='not-run'?'infra':'execution',reason,diagnostics==='synthetic'?'pre-look':'post-look',!trustedChange&&['sandbox-unavailable','census-fault','host-fault','cancelled','data-unreadable'].includes(kind)?'guard-error':'denied')});
    try{
      if(this.options.abortSignal?.aborted)return empty('not-run','execution cancelled',false,'cancelled');
      root=mkdtempSync(path.join(realpathSync('/tmp'),'omb-run-'));
      const dir=mkdtempSync(path.join(root,'run-'));
      if(!frozenCodeIntact(frozen)||canonicalSha256(treeManifest(staged.directory))!==staged.effectiveManifestHash)return empty('failed','trusted path changed',true);
      cpSync(frozen.directory,dir,{recursive:true});
      if(existsSync(path.join(dir,'plan.json')))chmodSync(path.join(dir,'plan.json'),0o400);
      cpSync(path.join(staged.directory,'RAW'),path.join(dir,'RAW'),{recursive:true});
      writeFileSync(path.join(dir,'prepare.sh'),PREPARE,{mode:0o500});
      const activation=this.options.activation;
      if(activation&&createHash('sha256').update(activation.script).digest('hex')!==activation.sha256)throw new Error('activation pin mismatch');
      const envScript=activation?.script??'#!/bin/sh\n# Software runtime configuration: PATH is inherited from the host sandbox.\n';
      writeFileSync(path.join(dir,'env.sh'),envScript,{mode:0o400});
      mkdirSync(path.join(dir,'outputs'));
      if(transform)transform(path.join(dir,'RAW'));
      faultKind='data-unreadable';
      if(!staged.contractMode)normalizeRunInputs(path.join(dir,'RAW'),staged.declarations);
      // Prepare is always software-run, even if the submitted script forgets to invoke it.
      cpSync(path.join(dir,'RAW'),path.join(dir,'data'),{recursive:true});
      faultKind='host-fault';
      const sourceHash=canonicalSha256(treeManifest(path.join(dir,'RAW')));
      const frozenFiles=treeManifest(frozen.directory);
      const frozenDirectories=[...new Set(Object.keys(frozenFiles).flatMap(name=>{const dirs:string[]=[];for(let parent=path.dirname(name);parent!=='.';parent=path.dirname(parent))dirs.push(path.join(dir,parent));return dirs;}))];
      const copiedCodeIntact=()=>Object.entries({...frozenFiles,'env.sh':createHash('sha256').update(envScript).digest('hex')}).every(([name,hash])=>{try{const st=lstatSync(path.join(dir,name));return st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&createHash('sha256').update(readFileSync(path.join(dir,name))).digest('hex')===hash;}catch{return false;}});
      this.options.faultAt?.('copied',dir);
      const sandbox=this.options.sandbox??new HostSandbox();
      const invocation=sandbox.prepare({profile:'proof',command:'/bin/sh',args:['run_all.sh'],cwd:dir,
        readableRoots:[dir],writableRoots:[dir],artifactRoot:dir,toolPath:this.options.toolPath,
        toolchainReadRoots:[...this.options.runtimeRoots,...runtimeLibraries()],allowLoopback:false,timeoutMs:this.options.timeoutMs,maxOutputBytes:1_000_000});
      if(!invocation.spec)return empty('not-run','offline sandbox unavailable',false,'sandbox-unavailable');
      this.options.faultAt?.('before-spawn',dir);
      if(!copiedCodeIntact())return empty('failed','trusted frozen copy changed',true);
      const spec={...invocation.spec,args:[...invocation.spec.args],env:{...invocation.spec.env,TMPDIR:path.join(dir,'tmp'),PYTHONDONTWRITEBYTECODE:'1',OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1',MKL_NUM_THREADS:'1',LOKY_MAX_CPU_COUNT:'1',OMB_SOFTWARE_SEEDS:JSON.stringify(softwareSeeds)}};
      mkdirSync(spec.env.TMPDIR,{recursive:true});
      if(invocation.sandboxClass==='seatbelt'){
        const profile=spec.args.indexOf('-p');if(profile<0||!spec.args[profile+1])throw new Error('uninspectable Seatbelt profile');
        reaper=this.options.reaperFactory?.()??sandboxReaper(path.dirname(this.options.scratchRoot));
        // Remove inherited IPC allows: a specific allow can override a blanket deny.
        const protectedPaths=[path.join(dir,'RAW'),...Object.keys(frozenFiles).map(name=>path.join(dir,name)),path.join(dir,'env.sh')];
        spec.args[profile+1]=withoutSharedIPC(spec.args[profile+1]!)+frozenDirectories.map(file=>`(deny file-write* (subpath ${JSON.stringify(file)}))\n`).join('')+`(allow file-read* (literal "/private/var/select/sh"))\n`+protectedPaths.map((file,i)=>`(deny file-write* (${i===0?'subpath':'literal'} ${JSON.stringify(file)}))\n`).join('')+`(allow mach-lookup (global-name ${JSON.stringify(reaper.allow)}))\n(deny mach-lookup (global-name ${JSON.stringify(reaper.deny)}))\n`;
        readOnlyCopies=true;
      }else if(invocation.sandboxClass==='bwrap'){
        const remount=spec.args.indexOf('--remount-ro');if(remount<0)throw new Error('uninspectable bubblewrap invocation');
        for(const file of [path.join(dir,'RAW'),...frozenDirectories,...Object.keys(frozenFiles).map(name=>path.join(dir,name)),path.join(dir,'env.sh')])spec.args.splice(remount,0,'--ro-bind',file,file);
        readOnlyCopies=true;
      }
      workerStarted=true;
      const now=this.options.now??(()=>performance.now()),startedAt=now();
      const outcome=await (this.options.runner??runProcess)({command:reaper?.command??spec.command,
        args:reaper?[...reaper.args,spec.command,...spec.args]:spec.args,cwd:spec.cwd,env:spec.env??{},
        timeoutMs:this.options.timeoutMs,maxOutputBytes:1_000_000,...{overflow:'drain' as const},...(this.options.abortSignal?{abortSignal:this.options.abortSignal}:{}),...(reaper?{timeoutSignal:'SIGTERM' as const}:{})});
      const elapsedMs=Math.max(0,Math.round(now()-startedAt));
      const supervisorExit=outcome.exitCode;
      let receipt:ReturnType<NonNullable<typeof reaper>['outcome']>|null=null,cleanFollowup=!outcome.cleanupFailed;
      if(reaper){try{receipt=reaper.outcome();}catch{/* unavailable receipt */}
        if(receipt?.census===0&&supervisorExit!==null&&[0,80,90,124].includes(supervisorExit))reaper.complete();
        cleanFollowup=false;
        for(let census=0;census<3&&!cleanFollowup;census++){try{cleanFollowup=reaper.reap();}catch{/* retry census only */}}
      }
      exitCode=receipt?.exitCode??supervisorExit;
      const cleanReceipt=!!receipt&&receipt.exitCode===0&&!receipt.signal&&receipt.survivors===0&&cleanFollowup;
      const cleanupFailed=!cleanFollowup;
      if(outcome.truncated)warnings.push('console-truncated: first and last 64 KB retained');
      const exit=cleanupFailed?'failed':outcome.timedOut?'timeout':exitCode===0&&!outcome.signal?'ok':'failed';
      this.options.faultAt?.('after-exit',dir);
      if(!frozenCodeIntact(frozen)||canonicalSha256(treeManifest(staged.directory))!==staged.effectiveManifestHash)return empty('failed','host trusted path changed',true);
      if(!copiedCodeIntact()){const name=Object.keys(frozenFiles).find(name=>{try{return createHash('sha256').update(readFileSync(path.join(dir,name))).digest('hex')!==frozenFiles[name];}catch{return true;}})??'env.sh';if(!existsSync(path.join(dir,name)))return empty('failed',`write-outside-outputs: missing or moved ${name}; write only to ./outputs or $TMPDIR`);return readOnlyCopies?empty('failed',`trusted frozen copy changed: ${name}`,true):empty('failed',`write-outside-outputs: ${name}; write only to ./outputs or $TMPDIR`);}
      if(canonicalSha256(treeManifest(path.join(dir,'RAW')))!==sourceHash)return readOnlyCopies?empty('failed','trusted RAW copy changed despite sandbox deny',true):empty('failed',`write-outside-outputs: RAW/${Object.keys(treeManifest(path.join(dir,'RAW')))[0]??''}; write only to ./outputs or $TMPDIR`);
      if(!frozenCodeIntact(frozen)||canonicalSha256(treeManifest(staged.directory))!==staged.effectiveManifestHash)return empty('failed','host trusted path changed',true);
      if(reaper&&supervisorExit!==null&&[5,7].includes(supervisorExit))return empty('not-run',`infrastructure supervisor failure (exit ${supervisorExit}); retry`,false,'host-fault');
      if(reaper&&supervisorExit!==null&&[3,18].includes(supervisorExit)){
        if(cleanReceipt)warnings.push('audit-unavailable: clean follow-up census; worker exit 0');
        else return empty('not-run',`infrastructure census unavailable (exit ${supervisorExit}); retry census`,false,'census-fault');
      }else if(reaper&&supervisorExit!==null&&![0,80,90,124].includes(supervisorExit))return empty('not-run',`infrastructure supervisor failure (exit ${supervisorExit}); retry`,false,'host-fault');
      if(reaper&&supervisorExit===90){
        warnings.push('sweep-survivor: leave no background processes; n_jobs=1');
        if(!cleanFollowup)return empty('not-run','follow-up census unavailable after survivor sweep',false,'census-fault');
      }
      if(exit!=='ok')return {...empty('failed',exit==='timeout'?`worker deadline exceeded: limit ${this.options.timeoutMs} ms; elapsed ${elapsedMs} ms`:`analysis command failed (exit ${exitCode})${warnings.length?'\n'+warnings.join('\n'):''}`),...(diagnostics==='synthetic'?{syntheticStderr:syntheticStderr(outcome.stderr+'\nRAW and frozen code are read-only; write only to ./outputs or $TMPDIR.',dir)}:{})};
      faultKind='missing-output';
      const outputsRoot=path.join(dir,'outputs'),outputsStat=lstatSync(outputsRoot);
      if(outputsStat.isSymbolicLink()||!outputsStat.isDirectory()||!realpathSync(outputsRoot).startsWith(dir+path.sep))return empty('failed','output-link: outputs must be a real directory inside the run',false,'output-link');
      faultKind='exit-nonzero';
      if((outputsStat.mode&0o700)!==0o700)return empty('failed','worker output permissions: outputs must remain readable, writable and searchable',false,'exit-nonzero');
      const outputFiles:string[]=[];
      const linked=(relative:string):string|null=>{for(const name of readdirSync(path.join(dir,'outputs',relative))){const rel=relative?relative+'/'+name:name;outputContext='outputs/'+rel;const st=lstatSync(path.join(dir,'outputs',rel));if(st.isSymbolicLink()||!st.isDirectory()&&(!st.isFile()||st.nlink!==1))return rel;if(st.isDirectory()){if((st.mode&0o700)!==0o700)throw Object.assign(new Error('worker directory permissions'),{code:'EACCES'});const found=linked(rel);if(found)return found;}else outputFiles.push(rel);}return null;};
      const bad=linked('');if(bad)return empty('failed',`output-link: outputs/${bad} must be a regular file`,false,'output-link');
      const files:Record<string,string>={},binaryFiles:Record<string,Buffer>={}, json:Record<string,unknown>={}, hashes:Record<string,string>={};
      for(const name of outputFiles){
        outputContext='outputs/'+name;faultKind=name.endsWith('.json')?'bad-json':'exit-nonzero';
        const file=path.join(dir,'outputs',name);if(lstatSync(file).size>50_000_000)return empty('failed',`output size cap exceeded (50000000 bytes per file)${diagnostics==='synthetic'?`: outputs/${name}`:''}`,false,'output-cap');
        const bytes=readFileSync(file);hashes[name]=createHash('sha256').update(bytes).digest('hex');
        if(name.endsWith('.json')){
          const text=bytes.toString('utf8');let parsed:unknown;
          try{parsed=JSON.parse(text);files[name]=text;}catch(error){
            const lenient=parseLenientJson(text,new IssueLog());
            if(!lenient.ok)return empty('failed',`invalid worker JSON output: outputs/${name}: parse position ${jsonFaultPosition(text)}`,false,'bad-json');
            parsed=lenient.value;files[name]=JSON.stringify(parsed);warnings.push(`lenient-parse: outputs/${name}; nonfinite numbers become null`);
          }
          json[name]=parsed;delete hashes[name];
          const shape=inspectOutputJson(parsed);
          if(shape.tooDeep)return empty('failed',`invalid worker JSON output: outputs/${name}: nesting exceeds 256`,false,'bad-json');
          if(name==='primary.json'&&shape.missingEstimate)return {
            ...empty('failed','nan-metric: outputs/primary.json has a missing or nonfinite primary estimate',false,'missing-output'),
            ...(diagnostics==='synthetic'&&shape.diagnostic?{syntheticStderr:syntheticStderr(`Primary output diagnostic (untrusted; validation remains failed): ${shape.diagnostic}`,dir)}:{}),
          };
        }else binaryFiles[name]=bytes;
      }
      if(!Object.keys(files).length&&!Object.keys(binaryFiles).length)return empty('failed','no outputs; outputs/primary.json required',false,'missing-output');
      if(!files['primary.json'])return empty('failed',`missing primary output: outputs/primary.json; wrote ${[...Object.keys(files),...Object.keys(binaryFiles)].join(', ')||'(nothing)'}`,false,'missing-output');
      // Source-only frozen inventory plus exclusive effective input mount. Actual data dependence
      // is checked separately by changed-truth runs; this flag does not assert a read trace.
      return {status:'ok',exitCode,workerStarted,warnings,cleanReceipt,reason:'software offline execution',files,binaryFiles,snapshot:snapshotOutputs(json,hashes),effectiveInputsVerified:true};
    }catch(error){const detail=error instanceof Error?error.message:'execution unavailable';return {...empty(workerStarted?'failed':'not-run',workerStarted&&faultKind!=='host-fault'?`worker output unavailable: ${outputContext} (${(error as {code?:string}).code??faultKind})`:workerStarted?'worker output unavailable':detail,false,faultKind),internalReason:detail};}
    finally{try{reaper?.reap();}catch{/* failed cleanup already prevents a successful execution */}finally{try{reaper?.close();}catch{warnings.push('cleanup-warning: reaper close failed');}if(root){try{restoreOwnedPermissions(root);rmSync(root,{recursive:true,force:true});}catch{warnings.push('cleanup-warning: owned scratch removal failed; execution result retained');}}}}
  }
}

/** Only the freshly allocated run tree, after reaping. Never traverse links or chmod
 * multiply-linked files, which may alias bytes outside this owned tree. */
function restoreOwnedPermissions(root:string):void {
 const visit=(file:string):void=>{
  const st=lstatSync(file);if(st.isSymbolicLink())return;
  if(st.isDirectory()){chmodSync(file,st.mode|0o700);for(const name of readdirSync(file))visit(path.join(file,name));}
  else if(st.isFile()&&st.nlink===1)chmodSync(file,st.mode|0o600|((st.mode&0o111)?0o100:0));
 };visit(root);
}

/** Remove whole top-level IPC allow rules; a more-specific allow can override a broad deny. */
export function withoutSharedIPC(policy:string):string {
  let out='',start=0,depth=0,quoted=false,escaped=false,comment=false;
  for(let i=0;i<policy.length;i++){
    const c=policy[i]!;
    if(comment){if(c==='\n')comment=false;continue;}
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c===';'){comment=true;continue;}if(c==='"'){quoted=true;continue;}
    if(c==='('){if(depth===0){out+=policy.slice(start,i);start=i;}depth++;}
    if(c===')'&&--depth===0){const rule=policy.slice(start,i+1);if(!/^\(allow\s[^)]*\bipc-posix-(?:sem|shm)/s.test(rule))out+=rule;start=i+1;}
  }
  if(depth!==0||quoted)throw new Error('malformed Seatbelt policy');
  return out+policy.slice(start)+'\n(deny ipc-posix-sem)\n(deny ipc-posix-shm-read-data ipc-posix-shm-write-create ipc-posix-shm-write-unlink)\n';
}

/** Synthetic-only diagnostics; host absolute paths never cross the worker boundary. */
export function syntheticStderr(stderr:string,runDir:string):string {
  const redacted=stderr.replaceAll(runDir+'/', './').replaceAll(runDir,'.').replace(/(?<![\w.])\/(?:[^\s\"'<>:]+\/)*[^\s\"'<>:]*/g,'[host-path]');
  const bytes=Buffer.from(redacted);let start=Math.max(0,bytes.length-8192);
  while(start<bytes.length&&(bytes[start]!&0xc0)===0x80)start++;
  return bytes.length<=12288?bytes.toString('utf8'):bytes.subarray(0,4096).toString('utf8')+'\n[console middle omitted]\n'+bytes.subarray(start).toString('utf8');
}

/** Locate the first strict-JSON syntax fault even when V8 omits its byte/column position. */
function jsonFaultPosition(text:string):number {
 let i=0,depth=0;const ws=()=>{while(/\s/.test(text[i]??'')&&i<text.length)i++;};
 const fail=():never=>{throw i;};
 const string=()=>{if(text[i++]!=='"')fail();for(;i<text.length;i++){const c=text[i];if(c==='"'){i++;return;}if(c==='\\'){i++;if(text[i]==='u'){if(!/^[0-9a-f]{4}$/i.test(text.slice(i+1,i+5)))fail();i+=4;}else if(!'"\\/bfnrt'.includes(text[i]??'!'))fail();}else if(c!.charCodeAt(0)<32)fail();}fail();};
 const value=():void=>{ws();if(++depth>256)fail();const c=text[i];
  if(c==='"')string();else if(c==='{'||c==='['){const object=c==='{',end=object?'}':']';i++;ws();if(text[i]===end)i++;else for(;;){if(object){string();ws();if(text[i++]!==':'){i--;fail();}}value();ws();if(text[i]===end){i++;break;}if(text[i++]!==','){i--;fail();}ws();}}
  else{const match=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));if(!match)fail();i+=match![0].length;}depth--;};
 try{value();ws();if(i!==text.length)fail();return i;}catch{return i;}
}

function inspectOutputJson(value:unknown):{tooDeep:boolean;missingEstimate:boolean;diagnostic?:string} {
 const stack:{value:unknown;depth:number}[]=[{value,depth:0}];let missingEstimate=false,diagnostic:string|undefined;
 while(stack.length){
  const {value,depth}=stack.pop()!;if(depth>256)return {tooDeep:true,missingEstimate};
  if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){
   if(key==='estimate'&&child===null&&!declaredNonEstimability(value)){
    missingEstimate=true;
    if(!diagnostic){
     const record=value as Record<string,unknown>;
     const fields=Object.fromEntries(['status','reason_code','reason','detail'].flatMap(name=>typeof record[name]==='string'?[[name,record[name].slice(0,4096)]]:[]));
     if(Object.keys(fields).length)diagnostic=JSON.stringify(fields);
    }
   }
   stack.push({value:child,depth:depth+1});
  }
 }
 return {tooDeep:false,missingEstimate,...(diagnostic?{diagnostic}:{})};
}
