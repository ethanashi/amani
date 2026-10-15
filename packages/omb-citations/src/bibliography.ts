/** Query → select → API-only CSL. This supplies metadata, never evidence of sentence support:
 * selected citations still require the existing L4–L6 workflow before publication. */
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { HttpClient } from './http.ts';
import { retrieveApiMetadata, parseIdentifier, type MetadataApi } from './api-metadata.ts';
import { assertIndex, verify, citationKey, type FrozenIndex } from './verifier.ts';
import type { Receipt, CitationInput, Verdict, Status } from './types.ts';
export interface CitationQuery { readonly indexId:string; readonly need:string; readonly keys:readonly string[] }
export interface CitationSelection { readonly indexId:string; readonly key:string; readonly sentenceId:string; readonly sentence:string; readonly verificationHash:string; readonly verdict:Exclude<Verdict,'block'>; readonly status:Status }
export interface ApiCslRecord extends CitationSelection {
  readonly key:string; readonly indexId:string; readonly api:MetadataApi; readonly retrievedAt:number;
  readonly receipt:Receipt; readonly cslJson:Record<string,unknown>; readonly sha256:string;
}
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function immutable<T>(value:T):T {
  if(value && typeof value==='object') {
    for(const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
export class FrozenBibliography {
  readonly #index:FrozenIndex;
  readonly #client:HttpClient;
  readonly #queries=new WeakSet<object>();
  readonly #selections=new WeakSet<object>();
  constructor(index:FrozenIndex,client:HttpClient) {
    assertIndex(index);this.#index=structuredClone(index);this.#client=client;
  }
  query(need:string):CitationQuery {
    if(typeof need!=='string'||!need.trim()||need.length>1000) throw new Error('citation need required');
    const terms=[...new Set(normalize(need).split(' ').filter(t=>t.length>0 && !['a','the','for','of','in','and','background','association','evidence'].includes(t)))];
    if(!terms.length) throw new Error('citation query has no searchable terms');
    // At least half the distinct content terms must match title words. Repeating
    // terms changes neither the score nor the required overlap.
    const keys=this.#index.records.filter(r=>r.resolution.state==='found'&&!r.resolution.work.retracted&&!r.resolution.work.flags.includes('expression-of-concern'))
      .map(r=> {const m=r.resolution.state==='found'?r.resolution.work.metadata:null;const text=normalize(m?m.title:'');return {key:r.key,score:terms.filter(t=>text.split(' ').includes(t)).length};})
      .filter(r=>r.score>=Math.ceil(terms.length/2)).sort((a,b)=>b.score-a.score||(a.key<b.key?-1:a.key>b.key?1:0)).map(r=>r.key);
    const query=Object.freeze({indexId:this.#index.id,need,keys:Object.freeze(keys)});this.#queries.add(query);return query;
  }
  select(query:CitationQuery,key:string,input?:CitationInput):CitationSelection {
    if(!query||!this.#queries.has(query)||typeof key!=='string'||!query.keys.includes(key)) throw new Error('selection must name a returned key; typed bib entries are forbidden');
    parseIdentifier(key);
    if(!input || !input.id || !input.sentence.trim() || citationKey(input.citation)!==key) throw new Error('verified sentence/key binding required');
    const row=verify(structuredClone(input),this.#index);
    if(row.verdict!=='pass' && row.verdict!=='needs-owner') throw new Error('sentence verification refused citation');
    const selection=Object.freeze({indexId:this.#index.id,key,sentenceId:input.id,sentence:input.sentence,verificationHash:row.rowHash,verdict:row.verdict,status:row.status});this.#selections.add(selection);return selection;
  }
  async build(selection:CitationSelection,api?:MetadataApi):Promise<ApiCslRecord> {
    if(!selection||!this.#selections.has(selection)) throw new Error('unissued selection or LLM-typed bibliography refused');
    const entry=this.#index.records.find(r=>r.key===selection.key)!;
    if(entry.resolution.state!=='found') throw new Error('selected source unavailable');
    const retrieved=await retrieveApiMetadata(this.#client,selection.key,api,true),m=retrieved.metadata, frozen=entry.resolution.work.metadata;
    if(retrieved.retracted || retrieved.flags.includes('expression-of-concern')) throw new Error('fresh API retraction or expression of concern');
    // Publication metadata must remain the frozen work. A newer year needs an explicit re-index.
    if(m.year!==frozen.year || normalize(m.title)!==normalize(frozen.title) || normalize(m.journal)!==normalize(frozen.journal) || JSON.stringify(m.authors.map(normalize))!==JSON.stringify(frozen.authors.map(normalize))) throw new Error('API metadata differs from frozen index');
    const cslJson={id:selection.key,type:'article-journal',title:m.title,author:m.authors.map(family=>({family})),issued:{'date-parts':[[m.year]]},'container-title':m.journal,
      ...(m.doi?{DOI:m.doi}:{}),...(m.pmid?{PMID:m.pmid}:{}),...(m.volume?{volume:m.volume}:{}),...(m.pages?{page:m.pages}:{})};
    const body={verdict:selection.verdict,status:selection.status,sentenceId:selection.sentenceId,sentence:selection.sentence,verificationHash:selection.verificationHash,key:selection.key,indexId:this.#index.id,api:retrieved.api,retrievedAt:retrieved.receipt.retrievedAt,receipt:retrieved.receipt,statusReceipts:retrieved.statusReceipts,cslJson};
    return immutable({...body,sha256:canonicalSha256(body)});
  }
}
