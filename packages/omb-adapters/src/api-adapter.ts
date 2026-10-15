import {scanForCanaries} from '../../omb-investigate/src/mounts.ts';
import {streamCanary} from './stream-canary.ts';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,realpathSync,lstatSync,existsSync,openSync,closeSync,fstatSync,ftruncateSync,writeSync,constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import type {Launch,ProcessRunner,SandboxBackend,WorkerAdapter,WorkerResult,WorkerSpec} from './contracts.ts';
import {providerEndpoint,type Provider} from './providers.ts';
import {classifyProvider,type ProviderOutcome} from './provider-error.ts';
import {keychainSecret,redactSecrets,type SecretReader} from './provider-secrets.ts';
import {credentialBroker} from './provider-broker.ts';
import {SeatbeltBackend,seatbeltProfile} from './sandbox.ts';
import {sandboxReaper} from './reaper.ts';
import {superviseOutcome,finalCensus} from './supervision.ts';
import {regular,sha256,inside,removeScratch,fileUnder} from './files.ts';
import {runProcess} from './process.ts';
import {ProgressWatchdog,progressFingerprint} from './provider-policy.ts';
export interface ProviderWorkerResult extends WorkerResult {providerOutcome:ProviderOutcome; text:string}
export interface ApiAdapterOptions {provider:Provider;stateRoot:string;scratchRoot:string;now:()=>number;runner?:ProcessRunner;backend?:SandboxBackend;secretReader?:SecretReader;fetch?:typeof fetch;schemas?:Readonly<Record<string,(text:string)=>boolean>>;opencodeCli?:string;opencodeSha256?:string;opencodeVersion?:string;stallMs?:number;toolPath?:string;}
export function emptyProviderResult():ProviderWorkerResult{return {status:'infra_error',providerOutcome:{type:'transport'},text:'',resetAt:null,sessionToken:null,files:{},warnings:[],usage:null,usageComplete:false,containment:'unavailable',supervisor:null,eventsPath:'',quota:null,rateLimit:{terminal:false,signals:[],resetHint:null},provenance:{cliVersion:null,cliSha256:null,initInventory:[],observedModels:[],observedEfforts:[],identitySource:'unavailable',profileSha256:null,configSha256:null,canary:'unavailable'}};}
/** Host materialization never follows paths created by an earlier worker. */
function writeTextArtifact(root:string,name:string,text:string):void {
 const file=fileUnder(root,name);let parent=root;
 for(const part of path.relative(root,path.dirname(file)).split(path.sep).filter(Boolean)){parent=path.join(parent,part);if(!existsSync(parent))mkdirSync(parent,{mode:0o700});const st=lstatSync(parent);if(!st.isDirectory()||st.isSymbolicLink()||realpathSync(parent)!==parent)throw new Error('Unsafe artifact parent');}
 const fd=openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
 try{const st=fstatSync(fd);if(!st.isFile()||st.nlink!==1)throw new Error('Unsafe artifact');ftruncateSync(fd,0);const bytes=Buffer.from(text);let offset=0;while(offset<bytes.length)offset+=writeSync(fd,bytes,offset,bytes.length-offset);}finally{closeSync(fd);}
}
export class ApiAdapter implements WorkerAdapter {
 constructor(readonly options:ApiAdapterOptions){}
 async run(input:WorkerSpec):Promise<ProviderWorkerResult>{
  const o=this.options,spec=structuredClone(input),result=emptyProviderResult(),runner=o.runner??runProcess,backend=o.backend??new SeatbeltBackend();
  let scratch:string|undefined,reaper:ReturnType<typeof sandboxReaper>|undefined,broker:Awaited<ReturnType<typeof credentialBroker>>|undefined,started=false,key='';
  try{
   const agent=o.provider.kind==='opencode';
   if(!agent&&(spec.requiresTools===true||spec.requiresTools===undefined&&['code','replicate','explore'].includes(spec.kind)))throw new Error('API-only backend cannot execute tools');
   if(!o.provider.enabled)throw new Error('Disabled provider');
   if(o.provider.keyRef)key=await (o.secretReader??keychainSecret)(o.provider.keyRef)??'';
   else if(agent){
    // OpenCode's existing owner auth is read by the host, never mounted in the worker.
    const auth=path.join(process.env.HOME??'','.local/share/opencode/auth.json');
    if(existsSync(auth)){const v=JSON.parse(regular(auth,1_000_000).toString());key=v[o.provider.opencodeProvider??'']?.key??'';}
   }
   if(!key){result.providerOutcome={type:'auth',text:'Provider credential not configured'};result.status='provider-error';return result;}
   const prompt=regular(spec.promptFile,16_000_000).toString();if(redactSecrets(prompt,[key])!==prompt)throw new Error('Secret in model input refused');
   mkdirSync(o.stateRoot,{recursive:true,mode:0o700});mkdirSync(o.scratchRoot,{recursive:true,mode:0o700});
   const state=realpathSync(o.stateRoot),scratchRoot=realpathSync(o.scratchRoot);spec.workdir=realpathSync(spec.workdir);
   const mounts=spec.mounts.map(m=>{if(m.mode!=='ro')throw new Error('Read-only mounts required');return realpathSync(m.path);});
   const scopes=[state,scratchRoot,spec.workdir];for(const a of scopes)for(const b of scopes)if(a!==b&&(inside(a,b)||inside(b,a)))throw new Error('Overlapping authority scopes');if(new Set(scopes).size!==3)throw new Error('Overlapping authority scopes');
   for(const m of mounts)if(scopes.some(s=>inside(m,s)||inside(s,m)))throw new Error('Mount overlaps authority');
   scratch=mkdtempSync(path.join(scratchRoot,'provider-'));const home=path.join(scratch,'home');mkdirSync(home);
   const evidence=path.join(state,'runs',randomUUID());mkdirSync(evidence,{recursive:true,mode:0o700});result.eventsPath=path.join(evidence,'events.jsonl');
   const anthropic=o.provider.kind==='anthropic-api'||agent&&o.provider.opencodeProvider==='anthropic';
   const baseUrl=providerEndpoint(o.provider);
   broker=await credentialBroker({model:spec.model,baseUrl,anthropic,env:{OMB_PROVIDER_KEY:key},timeoutMs:spec.timeoutMs,...(o.fetch?{fetch:o.fetch}:{})});
   const cli=realpathSync(agent?(o.opencodeCli??'node_modules/.bin/opencode'):process.execPath),client=fileURLToPath(new URL('./api-client.mjs',import.meta.url));
   result.provenance.cliSha256=sha256(regular(cli,300_000_000));if(agent&&(!o.opencodeSha256||result.provenance.cliSha256!==o.opencodeSha256))throw new Error('OpenCode CLI pin mismatch');
   if(backend.name==='darwin-seatbelt')reaper=sandboxReaper(state);
   const canary=randomBytes(24).toString('hex'),canaryFile=path.join(evidence,'canary');writeFileSync(canaryFile,canary,{mode:0o400});
   const profilePath=path.join(evidence,'worker.sb'),profile=seatbeltProfile({writeRoots:[spec.workdir,scratch],readRoots:mounts.filter(m=>lstatSync(m).isDirectory()),readFiles:[cli,client,...mounts.filter(m=>lstatSync(m).isFile())],protectedPaths:mounts,deniedPaths:[state],proxyPort:broker.port})+(reaper?`(allow mach-lookup (global-name ${JSON.stringify(reaper.allow)}))\n(deny mach-lookup (global-name ${JSON.stringify(reaper.deny)}))\n`:'');
   writeFileSync(profilePath,profile,{mode:0o400});result.provenance.profileSha256=sha256(profile);
   const env:NodeJS.ProcessEnv={HOME:home,TMPDIR:scratch,PATH:o.toolPath??'/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',XDG_CONFIG_HOME:path.join(home,'.config'),XDG_DATA_HOME:path.join(home,'.local/share'),XDG_CACHE_HOME:path.join(home,'.cache')};
   const base={cwd:spec.workdir,env,timeoutMs:spec.timeoutMs};
   const probe=await runner(backend.wrap(profilePath,{...base,command:process.execPath,args:['-e',`try{require('fs').readFileSync(process.argv[1]);process.exit(1)}catch(e){process.exit(e.code==='EPERM'||e.code==='EACCES'?0:2)}`,canaryFile]}));
   if(probe.exitCode!==0||probe.timedOut||probe.truncated)throw new Error('Sandbox canary denial unavailable');result.provenance.canary='denied';
   let launch:Launch;
   if(agent){
    const version=await runner(backend.wrap(profilePath,{...base,command:cli,args:['--version']}));if(version.exitCode!==0||version.timedOut||version.truncated||version.stdout.trim()!==o.opencodeVersion)throw new Error('OpenCode version pin mismatch');result.provenance.cliVersion=version.stdout.trim();
    const provider=o.provider.opencodeProvider!;
    env.OPENCODE_DISABLE_AUTOUPDATE='true';env.OPENCODE_DISABLE_DEFAULT_PLUGINS='true';env.OPENCODE_DISABLE_PROJECT_CONFIG='true';
    env.OPENCODE_CONFIG_CONTENT=JSON.stringify({$schema:'https://opencode.ai/config.json',enabled_providers:[provider],small_model:`${provider}/${spec.model}`,permission:{'*':'allow',external_directory:'deny'},provider:{[provider]:{npm:anthropic?'@ai-sdk/anthropic':'@ai-sdk/openai-compatible',name:provider,options:{baseURL:`http://127.0.0.1:${broker.port}/v1`,apiKey:broker.token,headers:{Authorization:`Bearer ${broker.token}`} },models:{[spec.model]:{name:spec.model}}}}});
    launch={...base,command:cli,args:['run','--format','json','--model',`${provider}/${spec.model}`,...(spec.effort?['--variant',spec.effort]:[])],stdin:prompt};
   }else launch={...base,env:{...env,OMB_BROKER_TOKEN:broker.token},command:cli,args:[client],stdin:JSON.stringify({port:broker.port,anthropic,model:spec.model,prompt,...(spec.effort?{effort:spec.effort}:{})})};
   if(sha256(regular(cli,300_000_000))!==result.provenance.cliSha256||sha256(regular(profilePath))!==result.provenance.profileSha256)throw new Error('Trusted launch input changed');
   const canaryStream=streamCanary(line=>line.includes(canary),canary);
   let buffer='',stopType:'stall'|'loop'|null=null;const abort=new AbortController(),watch=new ProgressWatchdog(o.now,o.stallMs??20*60_000);const timer=setInterval(()=>{if(watch.stalled()){stopType='stall';abort.abort();}},Math.min(1000,o.stallMs??1000));
   const observeStdout=(chunk:Buffer)=>{canaryStream.push(chunk);buffer+=chunk.toString();if(buffer.length>1_000_000)buffer=buffer.slice(-1_000_000);for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const e=JSON.parse(line);if(e.type&&watch.event(progressFingerprint(e))==='loop'){stopType='loop';abort.abort();}}catch{}}};
   started=true;
   let outcome;
   try{const wrapped=backend.wrap(profilePath,{...launch,observeStdout,abortSignal:abort.signal});outcome=await runner(reaper?{...wrapped,timeoutSignal:'SIGTERM',command:reaper.command,args:[...reaper.args,wrapped.command,...wrapped.args]}:wrapped);}finally{clearInterval(timer);}
   if(reaper){const supervised=superviseOutcome(reaper,outcome,result);outcome=supervised.outcome;if(supervised.supervisorFailure)throw new Error('Sandbox supervision failed');}
   const stdout=redactSecrets(outcome.stdout,[key]),stderr=redactSecrets(outcome.stderr,[key]);
   writeFileSync(result.eventsPath,stdout,{mode:0o600});
   let explicitError=false;let text='',status:number|undefined,stopReason:string|undefined,resetAt:number|undefined;
   for(const line of stdout.split('\n'))try{const e=JSON.parse(line);if(e.type==='api-result'){
    status=e.status;const d=e.data;explicitError=!!d.error;const choice=d.choices?.[0];text=d.error?.message??choice?.message?.refusal??choice?.message?.content??d.content?.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n')??'';
    stopReason=choice?.message?.refusal?'refusal':choice?.finish_reason??d.stop_reason;
    if(e.retryAfter){const seconds=Number(e.retryAfter);resetAt=Number.isFinite(seconds)?o.now()+seconds*1000:Date.parse(e.retryAfter);}
    const u=d.usage;if(u){const inputTokens=u.input_tokens??u.prompt_tokens??0,outputTokens=u.output_tokens??u.completion_tokens??0;result.usage={inputTokens,outputTokens,cachedInputTokens:0,totalTokens:inputTokens+outputTokens};result.usageComplete=true;}
   }else if(e.type==='text')text+=e.part?.text??'';else if(['error','turn.failed'].includes(e.type)){explicitError=true;text+=JSON.stringify(e.error??{});}else if(e.type==='step_finish'&&e.part?.tokens){const t=e.part.tokens;const prior=result.usage??{inputTokens:0,outputTokens:0,cachedInputTokens:0,totalTokens:0};result.usage={inputTokens:prior.inputTokens+(t.input??0),outputTokens:prior.outputTokens+(t.output??0),cachedInputTokens:prior.cachedInputTokens+(t.cache?.read??0),totalTokens:prior.totalTokens+(t.input??0)+(t.output??0)};result.usageComplete=true;}}catch{}
   if(broker.usage.known){const u=broker.usage;result.usage={inputTokens:u.input,outputTokens:u.output,cachedInputTokens:0,totalTokens:u.input+u.output};result.usageComplete=true;}
   result.provenance.observedModels=[...broker.models];
   result.text=text;
   result.providerOutcome=classifyProvider({text:text||stderr,error:explicitError,exitCode:outcome.exitCode,...(status?{status}:{}),...(stopReason?{stopReason}:{}),timedOut:outcome.timedOut,progress:watch.lastAction!==''});
   if(outcome.signal&&!outcome.timedOut)result.providerOutcome={type:'transport',text:'Provider process ended by signal'};
   if(stopType)result.providerOutcome={type:stopType,text:'Provider stopped after progress watchdog expired'};
   if(resetAt!==undefined&&Number.isFinite(resetAt))result.providerOutcome.resetAt=resetAt;
   if(result.usage)result.providerOutcome.tokens={input:result.usage.inputTokens,output:result.usage.outputTokens};
   if(outcome.truncated||outcome.cleanupFailed)result.providerOutcome={type:'transport',text:'Provider output or cleanup incomplete'};
   // Text-only callers may request exactly one output; host schema validation owns acceptance.
   if(!agent&&result.providerOutcome.type==='ok'&&spec.expect.length===1){const e=spec.expect[0]!;writeTextArtifact(spec.workdir,e.file,text);}
   const missing:string[]=[];for(const e of spec.expect){try{const bytes=regular(fileUnder(spec.workdir,e.file),16_000_000).toString();if(redactSecrets(bytes,[key])!==bytes)throw new Error('secret output');result.files[e.file]=o.schemas?.[e.schema]?.(bytes)?'valid':'invalid';}catch{result.files[e.file]='missing';}if(e.required&&result.files[e.file]!=='valid')missing.push(e.file);}
   if(result.providerOutcome.type==='ok'&&missing.length)result.providerOutcome={type:'non-compliance',missing,text:'Required artifacts missing or invalid'};
   result.status=result.providerOutcome.type==='ok'?'ok':result.providerOutcome.type==='refusal'?'refused-prework':result.providerOutcome.type==='rate-limit'?'rate_limited':result.providerOutcome.type==='non-compliance'?'agent_error':'provider-error';
   if(result.provenance.canary!=='denied')result.status='containment_failure';
   if(canaryStream.finish(outcome.stdout)||scanForCanaries(spec.workdir,[canary]).length){result.status='violation';result.violation={kind:'canary-exposed',evidence:'Host canary matched in worker output'};}
   if(sha256(regular(profilePath))!==result.provenance.profileSha256||sha256(regular(cli,300_000_000))!==result.provenance.cliSha256){result.status='violation';result.violation={kind:'trusted-path-changed',evidence:'Pinned adapter input hash changed'};}

  }catch{result.status='infra_error';result.warnings=['Provider launch unavailable; sandbox, credential or CLI preflight failed'];result.providerOutcome={type:'transport',text:result.warnings[0]!};}
  finally{finalCensus(reaper,started,result);if(result.status==='containment_failure'||result.containment==='survivor-killed')result.providerOutcome={type:'transport',text:'Provider containment failed'};await broker?.close();if(scratch)removeScratch(scratch);}
  return result;
 }
}
export class OpenCodeAdapter extends ApiAdapter {}
export class OpenRouterAdapter extends ApiAdapter {}
export class AnthropicApiAdapter extends ApiAdapter {}
export class OpenAiApiAdapter extends ApiAdapter {}
