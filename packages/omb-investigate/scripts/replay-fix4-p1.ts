/** Read-only diagnosis of the saved p1 failure; all recomputation uses disposable scratch. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ContractAuthority, stageWithContract } from '../../omb-certify/src/index.ts';
import { claimData } from '../../omb-certify/src/producers.ts';
import { linearEntry } from '../../omb-certify/src/linear.ts';
import { resolveRegisteredProcedure } from '../../omb-certify/src/procedure-registry.ts';
import { parsePlan } from '../../omb-gauntlet/src/index.ts';
import { hostContractInput } from '../src/kernel.ts';
import { checkPlan, contractRules } from '../src/plan-check.ts';
import { contractDesign, loadPinnedContract } from '../src/contracts.ts';
import type { ContractPin } from '../src/ports.ts';

const source=process.argv[2]??path.join(process.env.HOME!,'.omerta-bio/v7-smoke/20261012194702');
const scratch=mkdtempSync(path.resolve('packages/omb-investigate/.fix4-p1-'));
const db=new DatabaseSync(path.join(source,'journal.sqlite'),{readOnly:true});
try {
  const events=db.prepare('select event_type,payload_json from kernel_events where stream_id=?').all('inv:smoke-p1-esr1-20261012194702').map(r=>({type:r.event_type,p:JSON.parse(String(r.payload_json)).data}));
  const stage=events.find(e=>e.type==='phase-completed'&&e.p.phase==='stage')!.p.output;
  const pin=stage.contract as ContractPin,rawDir=stage.staged.contractInput.dir;
  const {host}=hostContractInput({contract:pin,rawDir},new ContractAuthority(Buffer.alloc(32,7)));
  const staged=stageWithContract(rawDir,path.join(scratch,'stage'),{contract:host.contract!,expectedContractHash:host.expectedContractHash!,...host.contractVerification});
  const text=readFileSync(path.join(source,'host/smoke-p1-esr1-20261012194702/locked/plan.json'),'utf8');
  const original=parsePlan(text).plan!,claim=original.claims.find(c=>c.id==='primary')!;
  let error='';try {claimData(staged,claim);}catch(e){error=String((e as Error).message);}
  const fixed={...claim,exposure:'exposure',outcome:'expression'};
  const data=claimData(staged,fixed),entry=linearEntry(fixed,data),procedure=resolveRegisteredProcedure(fixed,data);
  const structure=(loadPinnedContract(pin)!.public.content as {structure:unknown}).structure;
  const check=checkPlan(text,contractRules(contractDesign(structure)));
  const store=new DatabaseSync(path.join(source,'store/store.sqlite'),{readOnly:true});
  let ledger: {artifactHash:string;type:string;payload:unknown}[]=[];
  try {
    ledger=store.prepare('select hash,bytes from artifacts').all().flatMap(r=>{
      const artifact=JSON.parse(Buffer.from(r.bytes as Uint8Array).toString());
      const event=artifact.event;
      return event?.payload?.investigationId==='smoke-p1-esr1-20261012194702'
        ?[{artifactHash:String(r.hash),type:event.type,payload:event.payload}]:[];
    });
  } finally {store.close();}
  const certified=events.find(e=>e.type==='step-completed'&&e.p.name==='certify-g7')!.p.output;
  const originalCertification={warnings:certified.warnings,metricKeys:Object.keys(certified.metrics),gates:certified.gates,
    primary:certified.claims.find((c:{claimId:string})=>c.claimId==='primary').reasons};
  const result={source,ledger,originalCertification,original:{exposure:claim.exposure,outcome:claim.outcome,error,prelockStatus:check.status,issues:check.issues},
    corrected:{exposure:fixed.exposure,outcome:fixed.outcome,authenticated:staged.contractAuthenticated,independentUnits:entry.nUnits,finiteEstimate:entry.estimate!==null&&Number.isFinite(entry.estimate),finiteInterval:entry.ci?.every(Number.isFinite)??false,significant:entry.p!==null&&entry.p<.05,procedure},
    scope:'Trusted claim-data and linear recomputation replay only; no new look and no certification label is asserted.'};
  writeFileSync('packages/omb-investigate/integration/fix4-p1-replay.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({originalError:error,repair:check.status,authenticated:staged.contractAuthenticated,independentUnits:entry.nUnits,evaluable:entry.estimate!==null&&entry.p!==null,procedure:procedure?.procedureId}));
  if(error!=='outcome measurement metadata unavailable'||check.status!=='repair'||!staged.contractAuthenticated||!(entry.p!==null&&entry.p<.05))process.exitCode=1;
} finally {db.close();rmSync(scratch,{recursive:true,force:true});}
