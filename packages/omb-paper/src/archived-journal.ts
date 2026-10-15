import {canonicalSha256} from '../../bio-core/src/index.ts';
/** Validate old V7 phase chains, including explicit pre-look replans. The
 * physical event chain must first be checked by readInvestigationJournal.
 * A replan can rewind only to the staged input, never erase a spent look. */
export function archivePhaseOutputs(events:readonly Record<string,unknown>[]):Map<string,Record<string,any>> {
 let prior:unknown=null,lookSpent=false;const phases=new Map<string,Record<string,any>>();
 for(const e of events){const p=e.payload as Record<string,any>;
  if(e.type==='plan-replanned'){
   if(lookSpent||p.lookSpent!==false||p.previousOutputHash!==prior||!phases.has('stage'))throw Error('invalid archive replan');
   prior=phases.get('stage')!.outputHash;
   for(const key of [...phases.keys()])if(!['question','stage'].includes(key))phases.delete(key);
  }
  if(e.type!=='phase-completed')continue;
  if(p.prevOutputHash!==prior||p.outputHash!==canonicalSha256({output:p.output,prev:prior})||phases.has(p.phase))throw Error('invalid archive phase chain');
  prior=p.outputHash;phases.set(p.phase,{...p.output,outputHash:p.outputHash});
  if(p.phase==='look')lookSpent=true;
 }
 for(const phase of ['stage','plan','plan-lock','freeze','look','certify','deliverable'])if(!phases.has(phase))throw Error('archive phase missing: '+phase);
 return phases;
}
