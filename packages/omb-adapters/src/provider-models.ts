import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {runProcess} from './process.ts';
import {sha256,regular} from './files.ts';
import type {ProviderConfig} from './providers.ts';
/** Suggestions never constrain model IDs. Failure returns configured suggestions. No key is sent. */
export async function providerModels(id:string,config:ProviderConfig,repoRoot:string):Promise<string[]>{
 const p=config.providers[id];if(!p)throw new Error('Unknown provider');const configured=Object.values(config.roles).flatMap(r=>r.chain.filter(e=>e.provider===id).map(e=>e.model));
 try{
  if(p.kind==='openrouter'){const response=await fetch('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(10000),redirect:'error'});if(!response.ok)throw 0;const json=await response.json() as {data:{id:string}[]};return [...new Set([...configured,...json.data.map(m=>m.id)])];}
  if(p.kind==='opencode'){
   const pinFile=path.join(repoRoot,'packages/omb-adapters/opencode-pin.json');if(!existsSync(pinFile))return configured;const pin=JSON.parse(readFileSync(pinFile,'utf8')),cli=path.resolve(repoRoot,pin.path);if(sha256(regular(cli,300_000_000))!==pin.sha256)throw 0;
   const r=await runProcess({command:cli,args:['models',p.opencodeProvider!],cwd:repoRoot,env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',OPENCODE_DISABLE_AUTOUPDATE:'true'},timeoutMs:10000});if(r.exitCode!==0||r.timedOut||r.truncated)throw 0;return [...new Set([...configured,...r.stdout.split('\n').filter(x=>x.startsWith(p.opencodeProvider+'/')).map(x=>x.slice(p.opencodeProvider!.length+1))])];
  }
 }catch{/* Advisory inventory unavailable. */}
 return [...new Set([...configured,...(p.kind==='codex-cli'?['gpt-6-astra']:p.kind==='claude-code-cli'?['claude-opus-5-5','claude-sonnet-5']:[])])];
}
