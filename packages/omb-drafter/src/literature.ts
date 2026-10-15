import {canonicalSha256} from '../../bio-core/src/index.ts';
import {record} from '../../omb-report/src/common.ts';
/** Only text already frozen before the look; neither results nor model authority. */
export function literatureContext(index:unknown){
 const entries=record(index).entries;
 return (Array.isArray(entries)?entries:[]).map(record).map(q=>{
  const sentence=String(q.quote??'').replace(/[.!?]+$/u,'')+` [c:${q.key}].`;
  const hashes=Array.isArray(q.approvedSentenceHashes)?q.approvedSentenceHashes:[];
  return {key:q.key,title:q.title??record(q.bibliography).title??null,finding:q.quote,status:q.status,bibliography:q.bibliography??null,approvedSentences:hashes.includes(canonicalSha256(sentence))?[sentence]:[]};
 });
}
