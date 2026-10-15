import { canonicalJson, canonicalSha256 } from '../../bio-core/src/index.ts';
import type { OmbStore } from '../../omb-store/src/index.ts';
import type { Journal } from './journal.ts';

/** Host-only terminal checkpoint. Workers must not have the V5 authority key/store. */
export function anchorInvestigation(journal: Journal, store: OmbStore, investigationId: string): string {
  const stream = `inv:${investigationId}`;
  if (!journal.verify(stream).valid) throw new Error('cannot anchor an invalid investigation journal');
  const events = journal.read(stream), head = events.at(-1);
  const payload = head?.payload as Record<string, any> | undefined;
  if (!head || head.type !== 'phase-completed' || payload?.phase !== 'deliverable') throw new Error('cannot anchor an incomplete investigation');
  const passes: Record<string,string> = {certify:'certify','certify-g7':'replicate','route-n-certify':'route-n'};
  const steps = events.flatMap(e => {
    const p=e.payload as Record<string,any>;
    return e.type==='step-completed' && passes[p.name] && p.output != null ? [{pass:passes[p.name]!, reportHash:canonicalSha256(p.output.report)}] : [];
  });
  const certifications = steps.length ? steps : events.flatMap(e => {
    const p=e.payload as Record<string,any>;
    return e.type==='phase-completed' && ['certify','replicate'].includes(p.phase) && p.output?.certification != null ? [{pass:String(p.phase),reportHash:canonicalSha256(p.output.certification.report)}] : [];
  });
  const record = {domain:'omb-investigate/terminal-anchor@1', investigationId, headSequence:head.seq, headEventHash:head.hash, certifications};
  for (const e of store.events().filter(e=>e.kind==='artifact')) {
    let prior:any;try{prior=JSON.parse(store.artifact(String((e.payload as any).hash)).toString('utf8'));}catch{continue;}
    if(prior?.record?.domain===record.domain && prior.record.investigationId===investigationId) {
      if(!store.verifyAuthority(prior.record,prior.receipt) || canonicalJson(prior.record)!==canonicalJson(record)) throw new Error('terminal investigation anchor conflicts with persisted receipt');
      return String((e.payload as any).hash);
    }
  }
  return store.putArtifact(Buffer.from(canonicalJson({record,receipt:store.authorityReceipt(record)})));
}
