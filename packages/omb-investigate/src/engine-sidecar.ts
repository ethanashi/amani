#!/usr/bin/env -S node --experimental-transform-types --no-warnings
import {mkdirSync,existsSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadavg} from 'node:os';
import {spawnSync} from 'node:child_process';
import {EngineService,serveStdio} from './engine-service.ts';
import {SqliteJournal} from './journal.ts';
import {Scheduler,osResourceProbe} from '../../omb-sched/src/index.ts';
import {OmbStore} from '../../omb-store/src/index.ts';
import {StoreLedger,StoreRegistry,StoreJournal,SqliteSchedStore} from './store-adapter.ts';
import {Fleet} from './fleet.ts';
import {configuredProviders} from './provider-factory.ts';
import {TabularStager} from './tabular.ts';
import {KernelExecutor} from './kernel.ts';
import {ThreadKernelCertifier} from './thread-certifier.ts';
import type {OSAttestationPort} from './ports.ts';
import {LauncherAttestation} from './os-attestation.ts';
import {loadProviders} from '../../omb-adapters/src/providers.ts';
import {providerModels} from '../../omb-adapters/src/provider-models.ts';
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export function createEngine(root:string, configFile?:string, options:{attestation?:OSAttestationPort}={}){
root=path.resolve(root);
mkdirSync(root,{recursive:true,mode:0o700});
const dir=(name:string)=>{const d=path.join(root,name);mkdirSync(d,{recursive:true,mode:0o700});return d;};
const keyFile=path.join(root,'host-signing.key');if(!existsSync(keyFile))writeFileSync(keyFile,randomBytes(32),{mode:0o600,flag:'wx'});const key=readFileSync(keyFile);
const now=Date.now,journal=new SqliteJournal(path.join(root,'journal.sqlite'),now),schedStore=new SqliteSchedStore(path.join(root,'scheduler.sqlite'));
const store=new OmbStore({root:dir('store'),hostKey:key,now,separation:'single-user'});
const sched=Scheduler.open({now,store:schedStore,quota:{read:()=>null},resources:osResourceProbe({loadavg,vmStat:()=>spawnSync('vm_stat',{encoding:'utf8'}).stdout,pressureLevel:()=>spawnSync('sysctl',['-n','kern.memorystatus_vm_pressure_level'],{encoding:'utf8'}).stdout.trim()})});
const fleet=new Fleet({sched,now,waitUntil:at=>new Promise(r=>setTimeout(r,Math.max(0,at-now())))});
// Recovered unowned jobs cannot hold a scheduler slot. Owner explicitly resumes investigations.
fleet.retireUnowned(()=>false,'Sidecar restarted; awaiting owner resume');
const location=path.join(repoRoot,'packages/bio-baseline/runtime-location.json');
const pixi=existsSync(location)?JSON.parse(readFileSync(location,'utf8')).analysisRuntime:path.join(repoRoot,'packages/bio-baseline/.pixi/envs/default'),nodeRoot=path.dirname(realpathSync(process.execPath));
const toolPath=`${pixi}/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
const exec={toolPath:`${pixi}/bin:${nodeRoot}:/usr/bin:/bin`,runtimeRoots:[...(existsSync(pixi)?[realpathSync(pixi)]:[]),nodeRoot],timeoutMs:900000};
const attestation=options.attestation??new LauncherAttestation();
const service=new EngineService({root,journal,...(configFile?{configFile:path.resolve(configFile)}:{}),status:()=>attestation.attest(),schedulerStatus:()=>({active:sched.jobs().filter(j=>j.state==='running').length,queued:sched.jobs().filter(j=>j.state==='queued').length,limit:2}),
 adapters:config=>configuredProviders({root:dir('adapters'),repoRoot,config,now,toolPath}).adapters,
 models:(id,config)=>providerModels(id,config,repoRoot),
 deps:(_spec,events,approval)=>{const providers=configuredProviders({root:dir('adapters'),repoRoot,config:loadProviders(configFile),now,toolPath});const unavailable={run:async()=>{throw new Error('Unconfigured scheduler transport');}};return {
  journal:events,fleet,providers,workers:{codex:providers.adapters.codex??unavailable,claude:providers.adapters.claude??unavailable},approval,
  stager:new TabularStager({hostRoot:dir('host'),shareRoot:dir('share')}),executor:new KernelExecutor({...exec,scratchRoot:dir('exec'),now}),
  certifier:new ThreadKernelCertifier({stateRoot:dir('certify'),hostKey:key,executor:{...exec,scratchRoot:dir('certify-exec')}}),
  ledger:new StoreLedger(store,new StoreJournal(store,now)),registry:new StoreRegistry(store),host:{osUserSeparation:false,sandboxBackend:'seatbelt'},attestation,
  runtimeMounts:existsSync(pixi)?[realpathSync(pixi)]:[],
  paths:{hostRoot:dir('host'),shareRoot:dir('share'),workRoot:dir('work')},now,
 };},
});
return service;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))serveStdio(createEngine(process.argv[2]??path.join(repoRoot,'.engine-state'),process.argv[3]));
