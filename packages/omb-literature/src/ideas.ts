import { LiteraturePayloadError, object, text, strings, noveltyPage } from './validation.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { assertBrief, type FrozenBrief, type PublicDataset, type BriefLedger } from './brief.ts';
export const ANGLES = ['biological-mechanism','alternative-mechanism','confounding-artifact','data-integrity','clinical-translational','contrarian-null'] as const;
export type Angle = typeof ANGLES[number];
export interface Candidate { id: string; question: string; angle: Angle; rationale: string; citationKeys: string[]; datasetAccessions: string[]; impact: number; testability: number }
export interface PriorKnowledge { knownResults: string; dataPreviouslySeen: string; hypothesesPreviouslyTested: string; source: 'owner' | 'lead' }
export interface LateralSuggestion { id: string; suggestion: string }
export interface LateralDecision { id: string; disposition: 'claim' | 'exploratory' | 'rejected'; reason: string }
export interface Ideation { candidates: Candidate[]; priorKnowledge: PriorKnowledge }
export function ideationIssues(value: unknown): string[] {
  if (!object(value)) return ['ideation-required'];
  const i = value as unknown as Ideation, errors: string[] = [];
  if (!Array.isArray(i.candidates) || i.candidates.length < 6) return ['ideation-breadth'];
  if (new Set(i.candidates.map(c => c?.angle)).size < 4) errors.push('ideation-angles');
  if (new Set(i.candidates.map(c => c?.id)).size !== i.candidates.length || new Set(i.candidates.map(c => typeof c?.question === 'string' ? c.question.normalize('NFKC').trim().toLowerCase() : '')).size !== i.candidates.length) errors.push('ideation-duplicate');
  for (const c of i.candidates) if (!object(c) || !text(c.id) || !text(c.question) || !text(c.rationale) || !ANGLES.includes(c.angle) || !strings(c.citationKeys) || !strings(c.datasetAccessions) || ![c.impact,c.testability].every(n => Number.isInteger(n) && n >= 0 && n <= 5)) errors.push('ideation-candidate');
  const p = i.priorKnowledge;
  if (!p || ![p.knownResults,p.dataPreviouslySeen,p.hypothesesPreviouslyTested].every(s => typeof s === 'string' && s.trim()) || !['owner','lead'].includes(p.source)) errors.push('prior-knowledge-required');
  return [...new Set(errors)];
}
export function scoreIdeas(ideation: Ideation, brief: FrozenBrief, availability: readonly PublicDataset[]) {
  assertBrief(brief); const errors = ideationIssues(ideation); if (errors.length) throw new LiteraturePayloadError(errors.join(', '));
  const keys = new Set(brief.citations.map(c => c.key));
  return ideation.candidates.map(c => {
    if (brief.search === 'on' && !c.citationKeys.length && !c.datasetAccessions.length) throw new LiteraturePayloadError('candidate needs frozen-brief or public-data provenance');
    if (c.citationKeys.some(k => !keys.has(k))) throw new LiteraturePayloadError('candidate cites outside frozen brief');
    if (c.datasetAccessions.some(a => !availability.some(d => d.accession === a))) throw new LiteraturePayloadError('candidate dataset outside public availability');
    const publicData = c.datasetAccessions.some(a => availability.some(d => d.accession === a && d.availability === 'public' && d.licence.trim()));
    // Model ratings remain explicit subjective inputs; the deterministic score does not certify novelty.
    return { ...structuredClone(c), score: c.impact + c.testability + (publicData ? 5 : 0), publicData, rung: 'exploratory' as const };
  }).sort((a,b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function recordIdeation(ledger: BriefLedger, ideation: Ideation, availability: readonly PublicDataset[], review: { family: string; leadFamily: string; sameFamilyReason: string | null; suggestions: LateralSuggestion[]; decisions: LateralDecision[] }) {
  ledger.assertBeforePlan(true); const brief = ledger.frozen(); if (!brief) throw new Error('ideation requires frozen brief');
  if (!review.family || (review.family === review.leadFamily && !text(review.sameFamilyReason))) throw new LiteraturePayloadError('independent lateral reviewer or unavailability reason required');
  if (!Array.isArray(review.suggestions) || !Array.isArray(review.decisions) || new Set(review.suggestions.map(s => s?.id)).size !== review.suggestions.length || new Set(review.decisions.map(d => d?.id)).size !== review.decisions.length || review.decisions.length !== review.suggestions.length || review.suggestions.some(s => !object(s) || !text(s.id) || !text(s.suggestion) || !review.decisions.some(d => object(d) && d.id === s.id && ['exploratory','rejected'].includes(d.disposition) && text(d.reason)))) throw new LiteraturePayloadError('each lateral suggestion needs a reasoned disposition; unplanned claims forbidden');
  const record = { briefHash: brief.sha256, candidates: scoreIdeas(ideation, brief, availability), priorKnowledge: structuredClone(ideation.priorKnowledge), review: structuredClone(review) };
  ledger.appendBeforePlan('ideation-reviewed', record, false, true); return record;
}
export interface IdeaCard { idea: string; angle: Angle; evidenceSeen: string[]; runId: string; dataNeeded: string[]; priority: number; rung: 'exploratory'; scope: 'held-out' | 'public' }
export function recordIdea(ledger: BriefLedger, input: Omit<IdeaCard,'rung'|'runId'|'scope'>, heldOut: boolean): IdeaCard {
  if (!object(input) || !text(input.idea) || !ANGLES.includes(input.angle) || !Number.isInteger(input.priority) || input.priority < 0 || input.priority > 5 || !strings(input.dataNeeded) || !input.dataNeeded.length) throw new LiteraturePayloadError('invalid exploratory idea card: expected idea, registered angle, priority 0..5 and dataNeeded strings');
  if (!Array.isArray(input.evidenceSeen) || !input.evidenceSeen.every(s => typeof s === 'string') || !Array.isArray(input.dataNeeded) || !input.dataNeeded.every(s => typeof s === 'string' && s.trim())) throw new LiteraturePayloadError('invalid idea evidence/data requirements');
  const card: IdeaCard = { idea: input.idea, angle: input.angle, evidenceSeen: [...input.evidenceSeen], dataNeeded: [...input.dataNeeded], priority: input.priority, runId: ledger.investigationId, rung: 'exploratory', scope: heldOut ? 'held-out' : 'public' };
  const hash = canonicalSha256(card);
  if (!ledger.events().some(e => e.type === 'exploratory-idea' && (e.payload as { hash: string }).hash === hash)) ledger.append('exploratory-idea', { card, hash });
  return card;
}
/** Queue export reads authoritative ledger cards, never caller-edited objects or held-out files. */
export function publicQueue(ledger: BriefLedger): IdeaCard[] {
  return ledger.events().filter(e => e.type === 'exploratory-idea').map(e => {
    const record = e.payload as unknown as { card: IdeaCard; hash: string };
    if (canonicalSha256(record.card) !== record.hash || record.card.rung !== 'exploratory') throw new Error('idea card changed');
    return structuredClone(record.card);
  }).filter(c => c.scope === 'public' && c.rung === 'exploratory');
}
export interface NoveltyJudgment { key: string; ai: [{ family: string; sameAssociation: boolean }, { family: string; sameAssociation: boolean }]; owner: { actor: string; sameAssociation: boolean } }
export function recordNovelty(ledger: BriefLedger, judgments: NoveltyJudgment[]) {
  const queries = ledger.events().filter(e => e.type === 'literature-query').map(e => (e.payload as unknown as { record: import('./brief.ts').QueryRecord }).record).filter(q => q.purpose === 'novelty');
  if (!queries.length) throw new Error('novelty search missing (search-off runs cannot claim novelty)');
  // Final fixed queries use Europe PMC. Refuse an unparsed source instead of inventing hit counts.
  const hits = new Set<string>(), groups = new Map<string, { total: number; keys: Set<string> }>(); let returnedRecords = 0;
  for (const query of queries) {
    if (query.source !== 'europe-pmc') throw new Error('novelty source needs a hit parser');
    const response = noveltyPage(query.page.body);
    const group = groups.get(query.query) ?? { total: response.hitCount, keys: new Set<string>() };
    if (group.total !== response.hitCount) throw new Error('novelty result count changed during pagination');
    groups.set(query.query, group);
    returnedRecords += response.resultList.result.length;
    for (const hit of response.resultList.result) {
      const key = hit.doi ? `doi:${hit.doi.toLowerCase()}` : hit.id ? `${hit.source === 'MED' ? 'pmid' : 'epmc'}:${hit.id}` : null;
      if (!key) throw new Error('novelty hit identifier missing'); hits.add(key); group.keys.add(key);
    }
  }
  if ([...groups.values()].some(g => g.keys.size !== g.total)) throw new Error('novelty search requires all pages');
  if (!Array.isArray(judgments) || judgments.some(j => !object(j) || !text(j.key) || !Array.isArray(j.ai) || j.ai.length !== 2 || !j.ai.every(a => object(a) && text(a.family) && typeof a.sameAssociation === 'boolean') || !object(j.owner) || !text(j.owner.actor) || typeof j.owner.sameAssociation !== 'boolean')) throw new LiteraturePayloadError('novelty requires two model families and owner judgments');
  if (judgments.length !== hits.size || judgments.some(j => !hits.has(j.key))) throw new Error('every returned novelty hit needs a judgment');
  if (new Set(judgments.map(j => j.key)).size !== judgments.length || judgments.some(j => !j.key || j.ai.length !== 2 || j.ai[0].family === j.ai[1].family || !j.ai.every(a => a.family && typeof a.sameAssociation === 'boolean') || !j.owner.actor || typeof j.owner.sameAssociation !== 'boolean')) throw new Error('novelty requires two model families and owner judgments');
  const record = { queries, returnedRecords, uniqueRecords: hits.size, judgments: structuredClone(judgments), sameAssociation: judgments.filter(j => j.owner.sameAssociation && j.ai.every(a => a.sameAssociation)).length, caveat: 'The search may have missed relevant work.', usage: 'discussion-only' };
  const nQueries = new Set(queries.map(q => `${q.source}:${q.query}`)).size;
  const date = new Date(Math.max(...queries.map(q => q.page.retrievedAt))).toISOString().slice(0,10);
  const sentence = `A search of Europe PMC on ${date} using ${nQueries} queries returned ${hits.size} unique records; ${record.sameAssociation} were judged by two AI systems and the author to report the same association. The search may have missed relevant work.`;
  const result = { ...record, sentence };
  ledger.append('novelty-checked', result); return result;
}
