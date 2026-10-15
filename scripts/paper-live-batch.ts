import {canonicalSha256} from '../packages/bio-core/src/index.ts';
/** Live, unreviewed tutorial previews. Never dispatch a Claude call. */
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {CodexAdapter} from '../packages/omb-adapters/src/codex.ts';
import {WORKER_SCHEMAS} from '../packages/omb-investigate/src/turns.ts';
import {DraftRuntime,DrafterSession,LIVE_BUDGET,BlindStore,blindProjection,validateBlind,enforceBlindProfile} from '../packages/omb-drafter/src/index.ts';
import {LIVE_CASES,liveFixture,liveModels,type LiveCase} from './paper-live-fixtures.ts';
const root=path.resolve(process.env.PAPER_LIVE_ROOT??'.bio-scratch/live-polish');mkdirSync(root,{recursive:true});
const selected=(process.env.LIVE_CASES??LIVE_CASES.join(',')).split(',') as LiveCase[];
const failed:string[]=[];
for(const name of selected){
 if(!LIVE_CASES.includes(name))throw Error('Unknown synthetic fixture');
 const dir=path.join(root,name);mkdirSync(dir);const start=Date.now();
 const quota=execFileSync('/bin/bash',[path.resolve('../_logs/codex-quota.sh')],{encoding:'utf8'});writeFileSync(path.join(dir,'quota.txt'),quota);console.log(quota.trim());
 const f=liveFixture(name),codex=new CodexAdapter({stateRoot:path.join(dir,'codex-state'),scratchRoot:path.join(dir,'codex-scratch'),cliPath:'/opt/homebrew/bin/codex',authFile:path.join(process.env.HOME!,'.codex/auth.json'),now:Date.now,schemas:WORKER_SCHEMAS});
 let checkpoint:any=null,blind:any;
 if(process.env.LIVE_BLIND_CHECKPOINT){
  const sourceDir=path.resolve(process.env.LIVE_BLIND_CHECKPOINT);checkpoint=JSON.parse(readFileSync(path.join(sourceDir,'result.json'),'utf8'));
  const turn=checkpoint.records.findLastIndex((r:any)=>['blind','blind-repair'].includes(r.phase))+1;if(!turn)throw Error('checkpoint has no blind draft');const last=checkpoint.records[turn-1],bytes=readFileSync(path.join(sourceDir,'turns',`turn-${turn}`,'response.json'),'utf8');
  if(last.outputHash!==canonicalSha256(bytes)||last.result.status!=='ok'||!checkpoint.records.every((r:any)=>r.result.usageComplete&&r.model.family==='codex'&&r.result.provenance.observedModels.every((m:string)=>m==='gpt-6-astra')))throw Error('unverified blind checkpoint');
  const prompt=readFileSync(path.join(sourceDir,'turns',`turn-${turn}`,'prompt.txt'),'utf8');if(canonicalSha256(prompt)!==last.promptHash)throw Error('checkpoint prompt hash changed');
  const supplied=JSON.parse(prompt.split('BEGIN_SOURCE_JSON\n')[1]!.split('\nEND_SOURCE_JSON')[0]!);const source=blindProjection(f.input.ctx.input);
  if(canonicalSha256(supplied.source??supplied)!==canonicalSha256(source))throw Error('blind checkpoint belongs to another plan/index');
  blind=new BlindStore(path.join(dir,'checkpoint-blind')).save(source,enforceBlindProfile(validateBlind(source,JSON.parse(bytes),f.input.registry),f.input.profile,f.input.registry));
  writeFileSync(path.join(dir,'checkpoint.json'),JSON.stringify({sourceDir,outputHash:last.outputHash,blindHash:blind.sha256,chargedUsage:checkpoint.usage},null,2));
 }
 if(process.env.LIVE_USAGE_CHECKPOINT){
  if(!checkpoint)throw Error('usage continuation requires a verified blind checkpoint');
  const continuation=JSON.parse(readFileSync(path.resolve(process.env.LIVE_USAGE_CHECKPOINT,'result.json'),'utf8'));
  if(continuation.fixture!==name||canonicalSha256(continuation.records.slice(0,checkpoint.records.length))!==canonicalSha256(checkpoint.records)||!continuation.records.every((r:any)=>r.result.usageComplete&&r.model.family==='codex'&&r.result.provenance.observedModels.every((m:string)=>m==='gpt-6-astra')))throw Error('usage continuation is not a verified extension');
  checkpoint=continuation;
 }
 const runtime=new DraftRuntime(path.join(dir,'turns'),{codex,claude:{schemas:WORKER_SCHEMAS,async run(){throw Error('Claude calls prohibited by owner');}}},{...LIVE_BUDGET,maxCalls:10-(checkpoint?.usage.calls??0),maxTokens:Number(process.env.DRAFT_TOKEN_BUDGET??LIVE_BUDGET.maxTokens)-(checkpoint?.usage.tokens??0),maxDurationMs:LIVE_BUDGET.maxDurationMs-(checkpoint?.elapsedMs??0)});
 const session=new DrafterSession(f.input,runtime,{...liveModels,maxProseRepairs:2},path.join(dir,'session'));
 let error:string|null=null;
 try{const doc=await session.preview(blind);writeFileSync(path.join(dir,'manuscript.json'),JSON.stringify(doc,null,2));writeFileSync(path.join(dir,'paper.md'),doc.markdown);}catch(e){error=String(e);}
 if(error)failed.push(name+': '+error);
 const usage=runtime.usage;if(checkpoint)for(const key of ['calls','tokens','cachedInputTokens','inputTokens','outputTokens','reportedTokens','elapsedMs'] as const)usage[key]+=checkpoint.usage[key];
 const report={fixture:name,error,elapsedMs:Date.now()-start+(checkpoint?.elapsedMs??0),usage,state:session.state,records:[...checkpoint?.records??[],...runtime.records]};writeFileSync(path.join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({fixture:name,error,elapsedMs:report.elapsedMs,usage}));
}

if(failed.length)throw Error(failed.join('\n'));
