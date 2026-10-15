import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {CodexAdapter,ClaudeAdapter,ApiAdapter,PINNED_CLAUDE_CLI,PINNED_CLAUDE_VERSION,keychainSecret,loadProviders,type Provider,type WorkerAdapter} from '../src/index.ts';
import {workerOutcome} from '../../omb-investigate/src/provider-runtime.ts';
const root=path.resolve('validation/providers/smokes');mkdirSync(root,{recursive:true,mode:0o700});
const pin=JSON.parse(readFileSync('packages/omb-adapters/opencode-pin.json','utf8'));
const rows:unknown[]=[];
const run=async(id:string,kind:Provider['kind'],model:string,adapter:WorkerAdapter)=>{
 const dir=path.join(root,id),work=path.join(dir,'work');mkdirSync(work,{recursive:true,mode:0o700});const prompt=path.join(dir,'prompt');writeFileSync(prompt,'Reply with exactly OMB_ECHO_OK. Do not use tools or access files.',{mode:0o600});
 const spec={jobId:'echo',kind:'plan' as const,harness:kind==='codex-cli'?'codex' as const:kind==='claude-code-cli'?'claude-code' as const:'opencode' as const,family:kind==='claude-code-cli'?'claude':'codex',model,effort:'low',workdir:work,mounts:[],promptFile:prompt,network:'model-api-only' as const,timeoutMs:90000,expect:[]};
 const start=Date.now(),r=await adapter.run(spec);let echo=false;try{echo=readFileSync(r.eventsPath,'utf8').includes('OMB_ECHO_OK');}catch{}
 const row={provider:id,kind,model,outcome:workerOutcome(r,spec).type,status:r.status,echo,containment:r.containment,canary:r.provenance.canary,version:r.provenance.cliVersion,durationMs:Date.now()-start,warnings:r.warnings};rows.push(row);process.stdout.write(JSON.stringify(row)+'\n');
};
const common=(id:string)=>({stateRoot:path.join(root,id,'state'),scratchRoot:path.join(root,id,'scratch'),now:Date.now});
try{const quota=execFileSync('/bin/bash',[process.env.AMANI_QUOTA_CHECK ?? (()=>{throw new Error('AMANI_QUOTA_CHECK required')})()],{encoding:'utf8'});process.stdout.write(quota);await run('codex','codex-cli','gpt-6-astra',new CodexAdapter({...common('codex'),cliPath:'/opt/homebrew/bin/codex',authFile:path.join(homedir(),'.codex/auth.json')}));}catch{rows.push({provider:'codex',status:'skipped: quota check did not permit call'});}
await run('claude','claude-code-cli','claude-sonnet-5',new ClaudeAdapter({...common('claude'),cliPath:PINNED_CLAUDE_CLI,cliVersion:PINNED_CLAUDE_VERSION,keychainDir:path.join(homedir(),'Library/Keychains')}));
const configured=loadProviders();
for(const [id,kind,ref,model] of [['openrouter','openrouter','openrouter','openai/gpt-6-astra'],['opencode','opencode','opencode-openrouter','openai/gpt-6-astra'],['anthropic','anthropic-api','anthropic','claude-sonnet-5'],['openai','openai-api','openai','gpt-6-astra']] as const){
 const p:Provider=configured.providers[id]??{kind,enabled:true,keyRef:`keychain:amani/${ref}`,...(kind==='opencode'?{opencodeProvider:'openrouter'}:{})};
 const key=p.keyRef?await keychainSecret(p.keyRef):null;
 if(!key){const row={provider:id,kind,status:'not configured'};rows.push(row);process.stdout.write(JSON.stringify(row)+'\n');continue;}
 const entry=Object.values(configured.roles).flatMap(r=>r.chain).find(e=>e.provider===id);
 await run(id,kind,entry?.model??model,new ApiAdapter({...common(id),provider:{...p,enabled:true},opencodeCli:path.resolve(pin.path),opencodeVersion:pin.version,opencodeSha256:pin.sha256}));
}
writeFileSync('validation/providers/live-smokes.json',JSON.stringify({at:new Date().toISOString(),rows},null,2)+'\n');
