import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { HttpClient, Unavailable } from './http.ts';
import { fixedQueries, freezeIndex } from './verifier.ts';
import { POLICY, doi } from './policy.ts';
import type { Citation, Receipt, Resolution, Resolver } from './types.ts';
export interface QueryPlan { planHash: string; queries: string[]; id: string }
export function lockQueries(entityPairs: Array<[string, string]>, planHash: string): QueryPlan {
  if (!planHash.trim() || !entityPairs.length) throw new Error('plan and entity pairs required');
  const body = { planHash, queries: [...new Set(fixedQueries(entityPairs))] }; return { ...body, id: canonicalSha256(body) };
}
/** Executes the locked, direction-neutral templates. No model query can replace them. */
export async function retrieveResearchIndex(plan: QueryPlan, client: HttpClient, resolver: Resolver, options: { fresh?: boolean; llmQueryLog?: string[] } = {}) {
  const { id, ...body } = plan; if (canonicalSha256(body) !== id) throw new Error('query plan changed');
  const records = new Map<string, Resolution>(), queries: Array<{ query: string; receipt: Receipt; count: number }> = [];
  for (const query of plan.queries) {
    const r = await client.get(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=${POLICY.maxSearchResults}`, options.fresh);
    if (r.status !== 200) throw new Unavailable('query unavailable');
    const data = JSON.parse(r.body) as { hitCount?: unknown; resultList?: { result?: Array<Record<string, unknown>> } };
    if (typeof data.hitCount !== 'number' || data.hitCount < 0 || data.hitCount > POLICY.maxSearchResults || !Array.isArray(data.resultList?.result) || data.resultList.result.length !== data.hitCount) throw new Unavailable('query incomplete; narrow entity pair before locking');
    queries.push({ query, receipt: r.receipt, count: data.hitCount });
    for (const hit of data.resultList.result) {
      const d = typeof hit.doi === 'string' ? doi(hit.doi) : null;
      const pmid = hit.source === 'MED' && typeof hit.id === 'string' ? hit.id : null;
      if (!d && !pmid) throw new Unavailable('search result has no supported identifier');
      const key = d ? `doi:${d}` : `pmid:${pmid}`;
      if (records.has(key)) continue;
      // Metadata here is not an AI claim; the resolver returns authoritative fields for the index.
      const c: Citation = { doi: d, pmid, authors: '', title: '', year: 0, journal: '' };
      records.set(key, await resolver(c, { fresh: options.fresh ?? false }));
    }
  }
  if (!records.size) throw new Unavailable('no indexed sources; empty search is not verification');
  return { index: freezeIndex([...records].map(([key, resolution]) => ({ key, resolution })), plan.queries), queryPlan: plan, queryReceipts: queries, llmQueryLog: [...(options.llmQueryLog ?? [])] };
}
