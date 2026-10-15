import { LiteraturePayloadError, object, text } from './validation.ts';
import type { AcademicAccess } from './academic.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { assertIndex, citationKey, fixedQueries, freezeIndex, verify, type FrozenIndex } from '../../omb-citations/src/verifier.ts';
import { HttpClient } from '../../omb-citations/src/http.ts';
import { ScholarlyResolver } from '../../omb-citations/src/sources.ts';
import type { AuditRow, CitationInput, Section } from '../../omb-citations/src/types.ts';
import type { Journal, JournalEvent } from '../../omb-investigate/src/journal.ts';
import type { Json } from '../../omb-investigate/src/types.ts';
import { RoleNetwork, searchEnabled, type SearchMode, type RetrievedPage } from './network.ts';

export const BRIEF_SECTIONS = ['known','failed','contradictions','datasets','trials','recent'] as const;
export type BriefSection = typeof BRIEF_SECTIONS[number];
export interface PublicDataset { accession: string; portal: string; licence: string; availability: 'public' | 'registration' | 'controlled'; description: string }
export interface BriefDraft { sections: Record<BriefSection, CitationInput[]>; datasets: PublicDataset[] }
export function assertDraft(value: unknown): asserts value is BriefDraft {
  if (!object(value) || !object(value.sections) || !Array.isArray(value.datasets)) throw new LiteraturePayloadError('invalid literature draft: sections and datasets required');
  const sections = value.sections;
  for (const section of BRIEF_SECTIONS) {
    const rows = sections[section];
    if (!Array.isArray(rows)) throw new LiteraturePayloadError(`brief section missing: ${section}`);
    for (const row of rows) {
      if (!object(row) || !text(row.id) || !text(row.sentence) || !text(row.quote) || !object(row.citation)) throw new LiteraturePayloadError(`invalid brief citation in ${section}`);
      const c = row.citation;
      if (!['authors','title','journal'].every(k => typeof c[k] === 'string') || !Number.isInteger(c.year) || !['doi','pmid','volume','issue','pages'].every(k => c[k] === undefined || c[k] === null || typeof c[k] === 'string')) throw new LiteraturePayloadError(`invalid brief citation metadata in ${section}`);
    }
  }
  for (const d of value.datasets) if (!object(d) || !['accession','portal','licence','description'].every(k => text(d[k])) || typeof d.availability !== 'string' || !['public','registration','controlled'].includes(d.availability)) throw new LiteraturePayloadError('dataset availability/licence required');
}
export interface LiteratureCitation { key: string; cslJson: Record<string, unknown>; sourceSections: Section[]; audit: AuditRow; flags: string[]; usage: 'literature-context-only' }
export interface QueryRecord { source: SearchSource; query: string; purpose: 'before-plan' | 'novelty'; page: RetrievedPage }
export interface FrozenBrief {
  schema: 'omb/literature-brief@1'; investigationId: string; mode: SearchMode; search: 'on' | 'off';
  sections: Record<BriefSection, CitationInput[]>; datasets: PublicDataset[]; citations: LiteratureCitation[];
  index: FrozenIndex | null; queries: QueryRecord[]; sha256: string;
}
export function assertBrief(brief: FrozenBrief): void {
  const { sha256, ...body } = brief;
  if (brief.schema !== 'omb/literature-brief@1' || canonicalSha256(body) !== sha256) throw new Error('frozen literature brief changed');
  if (brief.search !== (searchEnabled(brief.mode) ? 'on' : 'off')) throw new Error('brief search mode mismatch');
  const inputs = BRIEF_SECTIONS.flatMap(s => { if (!Array.isArray(brief.sections[s])) throw new Error('brief section missing'); return brief.sections[s]; });
  if (brief.search === 'off') {
    if (inputs.length || brief.citations.length || brief.datasets.length || brief.queries.length || brief.index !== null) throw new Error('search-off brief must be empty');
  } else {
    if (!brief.index || !inputs.length || inputs.length !== brief.citations.length) throw new Error('verified brief citations missing');
    assertIndex(brief.index);
    for (const input of inputs) {
      const row = verify(input, brief.index), citation = brief.citations.find(c => c.audit.id === input.id);
      if (row.verdict !== 'pass' || !row.work || !citation || citation.usage !== 'literature-context-only' || canonicalSha256(citation.audit) !== canonicalSha256(row) || canonicalSha256(citation.cslJson) !== canonicalSha256(cslFor(row)) || canonicalSha256(citation.sourceSections) !== canonicalSha256([...new Set(row.evidence.map(e => e.section))])) throw new Error('brief citation verification changed');
    }
  }
}
function cslFor(audit: AuditRow): Record<string, unknown> {
  const m = audit.work!.metadata;
  return { id: citationKey(audit.input.citation), type: 'article-journal', title: m.title, author: m.authors.map(family => ({ family })), issued: { 'date-parts': [[m.year]] }, 'container-title': m.journal, DOI: m.doi, PMID: m.pmid, volume: m.volume, page: m.pages };
}
export function emptyBrief(investigationId: string, mode: SearchMode): FrozenBrief {
  if (searchEnabled(mode)) throw new Error('research brief required for discovery/ALS');
  const body = { schema: 'omb/literature-brief@1' as const, investigationId, mode, search: 'off' as const,
    sections: Object.fromEntries(BRIEF_SECTIONS.map(s => [s, []])) as unknown as BriefDraft['sections'], datasets: [], citations: [], index: null, queries: [] };
  return { ...body, sha256: canonicalSha256(body) };
}
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
/** Same durable ledger stream as plan locks and looks. All methods re-read; restart is not a reset. */
export class BriefLedger {
  constructor(readonly journal: Journal, readonly investigationId: string, readonly stream = 'ledger') {}
  events(): JournalEvent[] {
    if (!this.journal.verify(this.stream).valid) throw new Error('literature ledger chain changed');
    return this.journal.read(this.stream).filter(e => (e.payload as { investigationId?: string }).investigationId === this.investigationId);
  }
  frozen(): FrozenBrief | null {
    const event = this.events().find(e => e.type === 'literature-frozen');
    if (!event) return null;
    const brief = structuredClone((event.payload as unknown as { brief: FrozenBrief }).brief); assertBrief(brief); return brief;
  }
  assertBeforePlan(allowAuthorizedReplan = false): void {
    const events = this.events();
    const amendment = allowAuthorizedReplan ? events.filter(e => e.type === 'plan-replan-authorized').at(-1)?.seq ?? 0 : 0;
    if (events.some(e => ['look-recorded','literature-look-started','code-frozen'].includes(e.type) || e.seq > amendment && ['plan-locked','literature-plan-bound'].includes(e.type))) throw new Error('literature must freeze before plan lock and data look');
  }
  append(type: string, data: object, expected = this.journal.read(this.stream).length): JournalEvent {
    return this.journal.append(this.stream, type, json({ ...data, investigationId: this.investigationId }), expected);
  }
  appendBeforePlan(type: string, data: object, forbidFrozen = false, allowAuthorizedReplan = false): JournalEvent {
    const head = this.journal.read(this.stream).length;
    this.assertBeforePlan(allowAuthorizedReplan); if (forbidFrozen && this.frozen()) throw new Error('brief already frozen');
    return this.append(type, data, head);
  }
  freeze(brief: FrozenBrief): FrozenBrief {
    const head = this.journal.read(this.stream).length;
    assertBrief(brief);
    if (brief.investigationId !== this.investigationId) throw new Error('brief investigation mismatch');
    const prior = this.frozen();
    if (prior) { if (prior.sha256 !== brief.sha256) throw new Error('frozen literature brief is immutable'); return prior; }
    this.assertBeforePlan(); this.append('literature-frozen', { brief, briefHash: brief.sha256 }, head); return structuredClone(brief);
  }
  bindPlan(planHash: string): FrozenBrief {
    const head = this.journal.read(this.stream).length;
    const brief = this.frozen(); if (!brief) throw new Error('literature not frozen');
    const events = this.events();
    const amendment = events.filter(e => e.type === 'plan-replan-authorized').at(-1)?.seq ?? 0;
    const prior = events.find(e => e.seq > amendment && e.type === 'literature-plan-bound');
    if (prior) { if ((prior.payload as { planHash: string }).planHash !== planHash) throw new Error('literature bound to another plan'); return brief; }
    this.assertBeforePlan(true);
    this.append('literature-plan-bound', { planHash, briefHash: brief.sha256 }, head); return brief;
  }
  markLook(planHash: string, executionId: string): void {
    this.assertLook(planHash);
    if (!this.events().some(e => e.type === 'literature-look-started' && (e.payload as { executionId: string }).executionId === executionId)) this.append('literature-look-started', { planHash, executionId });
  }
  assertLook(planHash: string): void {
    const brief = this.frozen();
    const events = this.events(), amendment = events.filter(e => e.type === 'plan-replan-authorized').at(-1)?.seq ?? 0;
    if (!brief || !events.some(e => e.seq > amendment && e.type === 'literature-plan-bound' && (e.payload as { planHash: string; briefHash: string }).planHash === planHash && (e.payload as { briefHash: string }).briefHash === brief.sha256)) throw new Error('look requires plan-bound frozen literature');
  }
}
export type SearchSource = 'europe-pmc' | 'pubmed' | 'crossref' | 'openalex' | 'clinical-trials' | 'biorxiv' | 'medrxiv';
export function searchUrl(source: SearchSource, query: string): string {
  const q = encodeURIComponent(query);
  switch (source) {
    case 'europe-pmc': return `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${q}&format=json&resultType=core&pageSize=100`;
    case 'pubmed': return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${q}&retmode=json&retmax=100`;
    case 'crossref': return `https://api.crossref.org/works?query=${q}&rows=100`;
    case 'openalex': return `https://api.openalex.org/works?search=${q}&per-page=100`;
    case 'clinical-trials': return `https://clinicaltrials.gov/api/v2/studies?query.term=${q}&pageSize=100&format=json`;
    // bioRxiv API does not implement keyword search. Accept an explicit date interval.
    case 'biorxiv': case 'medrxiv':
      if (!/^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/.test(query)) throw new Error('preprint API requires date interval');
      return `https://api.biorxiv.org/details/${source}/${query}/0/json`;
    default: throw new Error('unknown search source');
  }
}
export class LiteratureResearch {
  readonly #network: RoleNetwork;
  constructor(private readonly ledger: BriefLedger, private readonly mode: SearchMode, private readonly now: () => number, transport?: typeof fetch, access?: AcademicAccess) {
    this.#network = new RoleNetwork({ role: 'literature', mode }, now, transport, access);
  }
  async search(source: SearchSource, query: string, purpose: QueryRecord['purpose'] = 'before-plan', cursor?: string): Promise<QueryRecord> {
    if (!searchEnabled(this.mode)) throw new Error('search is off');
    if (purpose !== 'before-plan' && purpose !== 'novelty') throw new Error('invalid search purpose');
    if (purpose === 'before-plan') { this.ledger.assertBeforePlan(); if (this.ledger.frozen()) throw new Error('brief already frozen; only novelty search allowed'); }
    else if (!this.ledger.events().some(e => ['look-recorded','literature-look-started'].includes(e.type))) throw new Error('novelty check runs after the look');
    if (cursor && source !== 'europe-pmc') throw new Error('cursor only supported for Europe PMC');
    const url = searchUrl(source, query) + (cursor ? `&cursorMark=${encodeURIComponent(cursor)}` : '');
    const prior = this.ledger.events().filter(e => e.type === 'literature-query').map(e => (e.payload as unknown as { record: QueryRecord }).record).find(r => r.purpose === purpose && r.page.url === url);
    if (prior) return structuredClone(prior);
    const page = await this.#network.get(url);
    // Recheck after the asynchronous request; no race can add pre-plan material after a lock.
    if (purpose === 'before-plan') { this.ledger.assertBeforePlan(); if (this.ledger.frozen()) throw new Error('brief already frozen'); }
    const record = { source, query, purpose, page };
    if (purpose === 'before-plan') this.ledger.appendBeforePlan('literature-query', { record }, true); else this.ledger.append('literature-query', { record });
    return structuredClone(record);
  }
  async freeze(draft: BriefDraft, entityPairs: Array<[string, string]>): Promise<FrozenBrief> {
    if (!searchEnabled(this.mode)) throw new Error('search is off');
    this.ledger.assertBeforePlan();
    assertDraft(draft);
    const snapshot = structuredClone(draft);
    for (const section of BRIEF_SECTIONS) if (!Array.isArray(snapshot.sections[section])) throw new Error(`brief section missing: ${section}`);
    for (const d of snapshot.datasets) if (!d.accession?.trim() || !d.licence?.trim() || !d.description?.trim() || !['public','registration','controlled'].includes(d.availability)) throw new Error('dataset availability/licence required');
    const queries = this.ledger.events().filter(e => e.type === 'literature-query').map(e => (e.payload as unknown as { record: QueryRecord }).record).filter(q => q.purpose === 'before-plan');
    const required = fixedQueries(entityPairs);
    if (!required.length || required.some(q => !queries.some(r => r.query === q))) throw new Error('fixed entity-pair searches missing');
    const inputs = BRIEF_SECTIONS.flatMap(s => snapshot.sections[s]);
    if (!inputs.length || new Set(inputs.map(i => i.id)).size !== inputs.length) throw new Error('brief needs unique cited statements');
    const resolver = new ScholarlyResolver(new HttpClient({ now: this.now, fetch: this.#network.asFetch(), retry: { attempts: 1 } }), this.now);
    const records: FrozenIndex['records'] = [];
    for (const input of inputs) if (!records.some(r => r.key === citationKey(input.citation))) records.push({ key: citationKey(input.citation), resolution: await resolver.resolve(input.citation) });
    const index = freezeIndex(records, queries.map(q => q.query));
    const citations = inputs.map(input => {
      const audit = verify(input, index);
      // L6 publication sign-off remains in PW4. A needs-owner row cannot enter the planning brief.
      if (audit.verdict !== 'pass' || !audit.work) throw new Error(`PW4 brief citation refused: ${input.id}: ${audit.status}`);
      const flags = audit.work.flags.some(f => /preprint/.test(f)) ? ['not-peer-reviewed'] : [];
      const cslJson = cslFor(audit);
      return { key: citationKey(input.citation), cslJson, sourceSections: [...new Set(audit.evidence.map(e => e.section))], audit, flags, usage: 'literature-context-only' as const };
    });
    const body = { schema: 'omb/literature-brief@1' as const, investigationId: this.ledger.investigationId, mode: this.mode, search: 'on' as const, ...snapshot, citations, index, queries };
    return this.ledger.freeze({ ...body, sha256: canonicalSha256(body) });
  }
}
/** Stage-1 projection has no metrics, results, novelty queries or post-look index. */
export function stage1Context(lockedPlan: unknown, brief: FrozenBrief): { lockedPlan: unknown; brief: FrozenBrief; briefHash: string } {
  assertBrief(brief); return { lockedPlan: structuredClone(lockedPlan), brief: structuredClone(brief), briefHash: brief.sha256 };
}
