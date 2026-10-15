import path from 'node:path';
import {homedir} from 'node:os';
import {existsSync,readFileSync} from 'node:fs';
import {CodexAdapter,ClaudeAdapter,ApiAdapter,loadProviders,PINNED_CLAUDE_CLI,PINNED_CLAUDE_VERSION,type WorkerAdapter,type ProviderConfig} from '../../omb-adapters/src/index.ts';
import {providerRuntime} from './provider-runtime.ts';
import {progressRunner} from './liveness.ts';
import {WORKER_SCHEMAS} from './turns.ts';
export function configuredProviders(o:{root:string;repoRoot:string;config?:ProviderConfig;now?:()=>number;toolPath?:string;codexCli?:string;claudeCli?:string;wrap?:(worker:WorkerAdapter)=>WorkerAdapter}){
 const config=o.config??loadProviders(),now=o.now??Date.now,adapters:Record<string,WorkerAdapter>={};
 const pinFile=path.join(o.repoRoot,'packages/omb-adapters/opencode-pin.json');
 const pin=existsSync(pinFile)?JSON.parse(readFileSync(pinFile,'utf8')) as {path:string;version:string;sha256:string}:null;
 for(const [id,provider] of Object.entries(config.providers)){
  if(!provider.enabled)continue;
  const common={stateRoot:path.join(o.root,`${id}-state`),scratchRoot:path.join(o.root,`${id}-scratch`),now,schemas:WORKER_SCHEMAS,...(o.toolPath?{toolPath:o.toolPath}:{})};
  const runner=progressRunner({now,structuredEvents:true,silenceMs:config.policy.stallMinutes*60_000});
  const adapter:WorkerAdapter=provider.kind==='codex-cli'?new CodexAdapter({...common,runner,cliPath:o.codexCli??'/opt/homebrew/bin/codex',authFile:path.join(homedir(),'.codex/auth.json')}):provider.kind==='claude-code-cli'?new ClaudeAdapter({...common,runner,cliPath:o.claudeCli??PINNED_CLAUDE_CLI,cliVersion:PINNED_CLAUDE_VERSION,keychainDir:path.join(homedir(),'Library/Keychains')}):new ApiAdapter({...common,provider,stallMs:config.policy.stallMinutes*60_000,...(pin?{opencodeCli:path.resolve(o.repoRoot,pin.path),opencodeVersion:pin.version,opencodeSha256:pin.sha256}:{})});
  adapters[id]=o.wrap?o.wrap(adapter):adapter;
 }
 return providerRuntime(config,adapters);
}
