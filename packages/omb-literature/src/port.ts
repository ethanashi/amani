import { LiteraturePayloadError, noveltyPage, noveltyVotes } from './validation.ts';
import type { AcademicAccess } from './academic.ts';
import { fixedQueries } from '../../omb-citations/src/verifier.ts';
import type { PlanLiteraturePort } from '../../omb-investigate/src/ports.ts';
import type { Journal } from '../../omb-investigate/src/journal.ts';
import { BriefLedger, LiteratureResearch, emptyBrief, type BriefDraft, type FrozenBrief, type QueryRecord, type SearchSource } from './brief.ts';
import { recordNovelty } from './ideas.ts';
import { searchEnabled } from './network.ts';
/** Host binds a dedicated model/tool session here. The only available tool is restricted search;
 * analysis mounts, model CLI web search, shell execution and data download are not capabilities. */
export interface ResearchWorkerPort {
  draft(context: { question: string; initialSearches: QueryRecord[]; search: (source: SearchSource, query: string) => Promise<QueryRecord> }): Promise<BriefDraft>;
}
export interface NoveltyVote { key: string; sameAssociation: boolean }
export interface NoveltyReviewPort {
  /** Family identity belongs to trusted host wiring, never to model output. */
  ai: readonly [{ family: 'codex' | 'claude'; review(context: { question: string; searches: QueryRecord[] }): Promise<NoveltyVote[]> }, { family: 'codex' | 'claude'; review(context: { question: string; searches: QueryRecord[] }): Promise<NoveltyVote[]> }];
  /** Reads recorded owner decisions. Research workers cannot manufacture this capability. */
  owner: { actor: string; review(context: { question: string; searches: QueryRecord[] }): Promise<NoveltyVote[]> };
}
export class PlanningResearch implements PlanLiteraturePort {
  constructor(private readonly options: { journal: Journal; now: () => number; worker: ResearchWorkerPort; noveltyReview?: NoveltyReviewPort; entityPairs: (question: string) => Array<[string,string]>; transport?: typeof fetch; access?: AcademicAccess }) {}
  async prepare(request: Parameters<PlanLiteraturePort['prepare']>[0]): Promise<FrozenBrief> {
    const ledger = new BriefLedger(this.options.journal, request.investigationId);
    const prior = ledger.frozen(); if (prior) { if (prior.mode !== request.mode) throw new Error('literature mode changed'); return prior; }
    if (!searchEnabled(request.mode)) return ledger.freeze(emptyBrief(request.investigationId, request.mode));
    const research = new LiteratureResearch(ledger, request.mode, this.options.now, this.options.transport, this.options.access);
    const pairs = this.options.entityPairs(request.question), initialSearches: QueryRecord[] = [];
    for (const query of fixedQueries(pairs)) initialSearches.push(await research.search('europe-pmc', query));
    initialSearches.push(await research.search('clinical-trials', request.question));
    const draft = await this.options.worker.draft({ question: request.question, initialSearches, search: (source, query) => research.search(source, query) });
    return research.freeze(draft, pairs);
  }
  async novelty(request: Parameters<PlanLiteraturePort['novelty']>[0]): Promise<void> {
    const ledger = new BriefLedger(this.options.journal, request.investigationId), brief = ledger.frozen();
    if (!brief || brief.sha256 !== request.briefHash) throw new Error('novelty brief mismatch');
    if (!searchEnabled(brief.mode)) throw new Error('search is off');
    if (ledger.events().some(e => e.type === 'novelty-checked')) return;
    const research = new LiteratureResearch(ledger, brief.mode, this.options.now, this.options.transport, this.options.access), searches: QueryRecord[] = [];
    for (const query of fixedQueries(this.options.entityPairs(request.question))) {
      let cursor: string | undefined, count = 0;
      const cursors = new Set<string>();
      for (let page = 0; page < 50; page++) {
        const result = await research.search('europe-pmc', query, 'novelty', cursor); searches.push(result);
        const body = noveltyPage(result.page.body);
        count += body.resultList.result.length;
        if (count === body.hitCount) break;
        if (count > body.hitCount || !body.nextCursorMark || cursors.has(body.nextCursorMark) || page === 49) throw new Error('novelty pagination incomplete');
        cursor = body.nextCursorMark; cursors.add(cursor);
      }
    }
    const reviewers = this.options.noveltyReview;
    if (!reviewers || reviewers.ai[0].family === reviewers.ai[1].family || !reviewers.owner.actor.trim()) throw new Error('two distinct host-wired model families and an owner review port required');
    const context = { question: request.question, searches };
    const results = await Promise.allSettled([
      reviewers.ai[0].review(structuredClone(context)), reviewers.ai[1].review(structuredClone(context)), reviewers.owner.review(structuredClone(context)),
    ]);
    const failed = results.find(r => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    const [first, second, owner] = results.map(r => (r as PromiseFulfilledResult<NoveltyVote[]>).value) as [NoveltyVote[], NoveltyVote[], NoveltyVote[]];
    for (const votes of [first, second, owner]) if (!noveltyVotes(votes)) throw new LiteraturePayloadError('invalid novelty judgments: expected unique string keys and boolean votes');
    if (first.length !== second.length || first.length !== owner.length || first.some(v => !second.some(w => w.key === v.key) || !owner.some(w => w.key === v.key))) throw new LiteraturePayloadError('novelty reviewers must judge the same records');
    recordNovelty(ledger, first.map(v => ({ key: v.key, ai: [
      { family: reviewers.ai[0].family, sameAssociation: v.sameAssociation },
      { family: reviewers.ai[1].family, sameAssociation: second.find(w => w.key === v.key)!.sameAssociation },
    ], owner: { actor: reviewers.owner.actor, sameAssociation: owner.find(w => w.key === v.key)!.sameAssociation } })));
  }
}
