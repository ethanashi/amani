#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { GateAuthority, outside } from './auth.ts';
import { pinTaskEnvironment, taskExecutor, type TaskEnvironment } from '../../omb-adapters/src/environment.ts';
import { OfflineExecutor } from './execution.ts';
import { certifyDirectory, type ReproductionTarget } from './certify.ts';
import type { PlanLock } from '../../omb-gauntlet/src/index.ts';
/** Host mailbox is the only source of runtime grants; never read worker env.sh. */
export function cliExecutor(stateRoot:string,abortSignal:AbortSignal,environment?:TaskEnvironment):OfflineExecutor {
  if(environment)return taskExecutor(stateRoot,pinTaskEnvironment(environment),abortSignal);
  const nodeRoot=path.dirname(realpathSync(process.execPath));
  return new OfflineExecutor({scratchRoot:path.join(stateRoot,'scratch'),toolPath:`${nodeRoot}:/usr/bin:/bin`,runtimeRoots:[nodeRoot],timeoutMs:60_000,abortSignal});
}
/** Mailbox: host STATE/in/request.json contains lock + execution identity, never worker JSON.
 * Worker files remain WORKDIR/{plan.json,code/,run_all.sh,results.json,REPORT.md}.
 * STATE/out contains the software report, numbers, signed gates and rewritten statuses. */
async function certifyMain(argv:string[], abortSignal:AbortSignal, executorFactory?:(stateRoot:string,signal:AbortSignal)=>OfflineExecutor):Promise<number>{
  const args=[...argv];if(args.shift()!=='certify')throw new Error('usage: omb certify [adopt] WORKDIR --state HOST_STATE [--raw DATA]');
  const adopt=args[0]==='adopt';if(adopt)args.shift();const work=args.shift();if(!work)throw new Error('workdir required');
  const flags=new Map<string,string>();for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!key||!['--state','--raw'].includes(key)||!value||flags.has(key))throw new Error('invalid CLI arguments');flags.set(key,value);}
  const workdir=realpathSync(work),state=flags.get('--state');if(!state)throw new Error('--state must name a host directory outside worker scope');
  mkdirSync(state,{recursive:true,mode:0o700});const stateRoot=realpathSync(state);
  if(!outside(stateRoot,workdir)||!outside(workdir,stateRoot))throw new Error('host state and worker scope overlap');
  const key=path.join(stateRoot,'host.key');if(!existsSync(key))writeFileSync(key,randomBytes(32),{flag:'wx',mode:0o600});
  const authority=GateAuthority.fromFile(key,[workdir]);
  let request:{environment?:TaskEnvironment;lock?:PlanLock;executionId?:string;firstLookAt?:number;expectedInputHash?:string;expectedCodeHash?:string;maxPermutations?:number;simulations?:boolean;reproductionTargets?:Record<string,ReproductionTarget>}={};
  const mailbox=path.join(stateRoot,'in','request.json');
  if(existsSync(mailbox)){if(!lstatSync(mailbox).isFile()||lstatSync(mailbox).isSymbolicLink())throw new Error('host mailbox must be regular');request=JSON.parse(readFileSync(mailbox,'utf8')) as typeof request;}
  if(!adopt&&request.lock&&!flags.has('--raw'))throw new Error('--raw is required for locked certification');
  if(!adopt&&request.lock&&!request.expectedInputHash)throw new Error('expectedInputHash is required for locked certification');
  const executor=executorFactory?.(stateRoot,abortSignal)??cliExecutor(stateRoot,abortSignal,request.environment);
  const result=await certifyDirectory({workdir,rawDir:path.resolve(flags.get('--raw')??path.join(workdir,'data')),stateRoot,executionId:request.executionId??randomUUID(),lock:adopt?null:request.lock??null,
    firstLookAt:request.firstLookAt??null,...(request.maxPermutations===undefined?{}:{maxPermutations:request.maxPermutations}),...(request.simulations===undefined?{}:{simulations:request.simulations}),...(request.reproductionTargets===undefined?{}:{reproductionTargets:request.reproductionTargets}),adopt,now:()=>performance.now(),authority,executor,
    ...(request.expectedInputHash?{expectedInputHash:request.expectedInputHash}:{}),...(request.expectedCodeHash?{expectedCodeHash:request.expectedCodeHash}:{})});
  process.stdout.write(JSON.stringify({report:path.join(stateRoot,'out','report.md'),claims:result.certification.assessments.map(a=>({id:a.claimId,status:a.status}))})+'\n');return 0;
}
/** Drain the active sandbox before a host deadline exits the certifier. */
export async function main(argv:string[], executorFactory?:(stateRoot:string,signal:AbortSignal)=>OfflineExecutor):Promise<number>{
  const controller=new AbortController(),cancel=()=>controller.abort();
  process.on('SIGTERM',cancel);process.on('SIGINT',cancel);
  try{return await certifyMain(argv,controller.signal,executorFactory);}
  finally{process.removeListener('SIGTERM',cancel);process.removeListener('SIGINT',cancel);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname))main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=2;});
