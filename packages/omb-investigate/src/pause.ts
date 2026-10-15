import type {PhaseId} from './types.ts';
import type {Investigation,DeliverableOut} from './investigation.ts';
export type PauseKind='needs-you'|'infra'|'provider'|'quota'|'family-unavailable'|'system-bug';
export class InvestigationPaused extends Error {
 constructor(readonly kind:PauseKind,readonly reason:string,readonly phase:PhaseId,readonly retryAfterMs=60_000){super(reason);this.name='InvestigationPaused';}
}
export class StagerRefusal extends Error {constructor(message:string){super(message);this.name='StagerRefusal';}}
export interface SettleOptions {now:()=>number;waitUntil:(at:number)=>Promise<void>;health:(pause:InvestigationPaused)=>Promise<boolean>;backoffMs?:number;maxBackoffMs?:number;maxPausedMs?:number}
/** Resume the same state machine and ledger. Time and health are injected; a cap is a pause. */
export async function runUntilSettled(inv:Investigation,o:SettleOptions):Promise<DeliverableOut>{
 let out=await inv.run();const max=o.maxPausedMs??12*60*60_000;
 const progress=()=>inv.machine.completed().length;
 const prior=inv.machine.notes('pause-window').at(-1);
 let completed=progress(),wait=prior?.progress===completed?Number(prior.attempt??0):0;
 let spent=prior?.progress===completed?Number(prior.waitedMs??0):0;
 while(out.status==='paused'){
  const n=inv.machine.notes('paused').at(-1)!;
  if(n.kind==='needs-you')return out;
  const p=new InvestigationPaused(n.kind as PauseKind,String(n.reason),n.phase as PhaseId,Number(n.retryAfterMs));
  const remaining=max-spent;if(remaining<=0)return out;
  const delay=Math.min(remaining,Math.max(p.retryAfterMs,Math.min(o.maxBackoffMs??30*60_000,(o.backoffMs??60_000)*2**Math.min(wait++,20))));
  const before=o.now();await o.waitUntil(before+delay);spent+=Math.max(0,o.now()-before);
  inv.machine.note('pause-window',{progress:completed,waitedMs:spent,attempt:wait});
  if(spent>=max)return out;
  if(await o.health(p)){
   out=await inv.run();
   if(progress()!==completed){completed=progress();spent=0;wait=0;if(out.status==='paused')inv.machine.note('pause-window',{progress:completed,waitedMs:0,attempt:0});}
  }
 }
 return out;
}

/** Node SQLite exposes a generic JS code plus the numeric SQLite result code.
 * Mask extended result bits, and never depend on localized diagnostic text. */
export function transientStorageFault(error:unknown):boolean {
 if(!error||typeof error!=='object')return false;
 const e=error as {code?:unknown;errcode?:unknown;message?:unknown};
 if(e.code==='ERR_SQLITE_ERROR')return typeof e.errcode==='number'&&[5,6,10,13].includes(e.errcode&255);
 if(typeof e.code==='string')return ['SQLITE_BUSY','SQLITE_LOCKED','SQLITE_FULL','SQLITE_IOERR','ENOSPC','EAGAIN','EIO'].includes(e.code);
 // Compatibility with legacy ports that only supplied a symbolic code as their message.
 return typeof e.message==='string'&&['SQLITE_BUSY','SQLITE_LOCKED','SQLITE_FULL','ENOSPC','EAGAIN','EIO'].includes(e.message);
}
