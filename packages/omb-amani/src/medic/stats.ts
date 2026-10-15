import { assertDevelopmentAuthorization } from '../medic-authorization.ts';
import { statsDirectory, records, type StabilityRecord } from '../medic-history.ts';
export { statsDirectory, records, summarize, medicStats, type StabilityRecord } from '../medic-history.ts';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { atomicJson } from './checkpoint.ts';
import { git } from './guards.ts';

export function record(repo:string,entry:Omit<StabilityRecord,'schema'|'id'|'at'>):StabilityRecord {
  const value:StabilityRecord={schema:'omb-amani/medic-stability@1',id:randomUUID(),at:Date.now(),...entry};
  atomicJson(path.join(statsDirectory(repo),'records',`${value.at}-${value.id}.json`),value);return value;
}
/** Owner records normal review only AFTER the permanent fix is merged into this checkout. */
export function resolveFix(repo:string,invocation:string,commit:string,reviewReference:string) {
  assertDevelopmentAuthorization();
  if(!reviewReference.trim())throw new Error('normal review reference required');
  const rows=records(repo),item=rows.find(r=>r.kind==='healed'&&r.invocation===invocation);
  if(!item?.commit)throw new Error('unknown successful heal');
  const full=git(repo,['rev-parse','--verify',`${commit}^{commit}`]).trim();
  git(repo,['merge-base','--is-ancestor',full,'HEAD']);
  // Require the exact patch or an equivalent reviewed cherry-pick, not an unrelated ancestor.
  const patchId=(c:string)=>git(repo,['show','--format=','--no-ext-diff',c]);
  if(patchId(full)!==patchId(item.commit))throw new Error('merged commit is not the healed patch');
  return record(repo,{kind:'resolved',run:item.run,invocation,commit:full,reviewReference});
}
