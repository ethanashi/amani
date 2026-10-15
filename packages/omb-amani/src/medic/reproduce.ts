import { assertDevelopmentAuthorization } from '../medic-authorization.ts';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { persistCheckpoint } from '../transport/checkpoint-io.ts';
import { FaultInjector } from '../dev-faults.ts';
/** Registered synthetic reproduction of the exact host checkpoint callback. No official
 * journal, data, output, cassette or path is opened. The injection remains enabled after repair. */
export function replayCheckpointFault(inject:string):{passed:boolean;detail:string} {
  assertDevelopmentAuthorization();
  if(inject!=='write:disk-full')throw new Error('unregistered medic reproduction');
  const dir=mkdtempSync(path.join(tmpdir(),'medic-replay-'));
  try {
    const file=path.join(dir,'checkpoint.json'),injector=new FaultInjector(inject);
    try {persistCheckpoint(()=>{injector.checkpoint('phase:dry-run:started');writeFileSync(file,'{"synthetic":true}',{flush:true});});}
    catch(e){if((e as {code?:unknown}).code==='ENOSPC'&&injector.evidence.length===1)return{passed:false,detail:'expected-fault'};throw e;}
    return{passed:readFileSync(file,'utf8')==='{"synthetic":true}'&&injector.evidence.length===1,detail:'replayed-injected-checkpoint'};
  } finally {rmSync(dir,{recursive:true,force:true});}
}
if(import.meta.main){const r=replayCheckpointFault(process.argv[2]??'');process.stdout.write(JSON.stringify(r)+'\n');process.exitCode=r.passed?0:3;}
