import type { PaperInput } from '../../omb-paper/src/index.ts';
import type { ModelProvenance, Submission } from './types.ts';
import { assert, canonicalSha256 } from './common.ts';
/** Explicit PW7 → PW0 metadata adapter. PW0 authenticates runMetadata; drafter fields
 * cannot create or override model identities. Missing journal-derived records refuse. */
export function modelsFromProvenance(input:PaperInput):ModelProvenance[]{
  const records=(input.runMetadata as Record<string,unknown>).modelUsage;
  assert(Array.isArray(records)&&records.length>0,'journaled model-usage provenance missing');
  return records.map(r=>{
    assert(r&&typeof r==='object'&&!Array.isArray(r),'malformed model provenance');
    const m=r as Omit<ModelProvenance,'sourceHash'>;
    const keys=['provider','system','modelId','version','stage','date','software','humanRole','trainingCutoff','originalPublicationDate','recallProbe'];
    assert(Object.keys(r).length===keys.length&&keys.every(k=>Object.hasOwn(r,k)),'model provenance fields differ from the host adapter');
    return {...m,sourceHash:canonicalSha256(m)};
  });
}
export function checkProvenance(s:Submission):void{
  assert(canonicalSha256(s.models)===canonicalSha256(modelsFromProvenance(s.input)),'model cards differ from journaled provenance');
  assert(canonicalSha256((s.input.runMetadata as Record<string,unknown>).framework)===canonicalSha256(s.framework),'framework version differs from run provenance');
}
/** Software inventory/citation data is generated from pinned conda URLs, never authored
 * by the drafter. Upstream package DOIs are not guessed from package names. */
export function softwareCitations(s:Submission):{name:string;version:string;distribution:string;source:string}[]{
  const lock=s.reproduction.files.find(f=>f.path==='environment/pixi.lock');assert(lock,'environment lock missing');
  const urls=[...Buffer.from(lock.bytes).toString('utf8').matchAll(/(?:conda:|url:)\s+(https:\/\/conda\.anaconda\.org\/[^\s]+\.(?:conda|tar\.bz2))/g)].map(m=>m[1]!);
  const records=urls.map(source=>{const file=source.split('/').at(-1)!.replace(/\.(conda|tar\.bz2)$/,'');const parts=file.split('-');const distribution=parts.pop()!,version=parts.pop()!,name=parts.join('-');return {name,version,distribution,source};});
  assert(records.length>0,'unsupported environment lock: conda software inventory missing');
  return [...new Map(records.map(r=>[r.source,r])).values()].sort((a,b)=>a.source.localeCompare(b.source));
}
