import { canonicalSha256, canonicalJson } from '../../bio-core/src/index.ts';
import { POLICY } from './policy.ts';
import { assertIndex, citationKey, freezeIndex, verify, type FrozenIndex } from './verifier.ts';
import type { AuditRow, CitationInput, Resolver, Verdict } from './types.ts';
export function cslJson(row: AuditRow): Record<string, unknown> | null {
  if (!row.work) return null;
  const m = row.work.metadata;
  return { id: citationKey(row.input.citation), type: row.work.flags.includes('preprint') ? 'manuscript' : 'article-journal', title: m.title,
    author: m.authors.map(family => ({ family })), issued: { 'date-parts': [[m.year]] }, 'container-title': m.journal,
    ...(m.doi ? { DOI: m.doi } : {}), ...(m.pmid ? { PMID: m.pmid } : {}), ...(m.volume ? { volume: m.volume } : {}), ...(m.pages ? { page: m.pages } : {}),
    note: [row.status, ...row.flags].join('; ') };
}
export interface BlindForm {
  id: string;
  rows: Array<{ id: string; binding: string; sentence: string; citation: CitationInput['citation']; evidence: AuditRow['evidence']; checks: AuditRow['checks']; flags: string[] }>;
}
export function blindOwnerForm(rows: AuditRow[]): BlindForm {
  if (!rows.length || new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('empty or duplicate owner rows');
  const body = rows.map(row => {
    const { rowHash, ...payload } = row; if (canonicalSha256(payload) !== rowHash) throw new Error('audit row changed');
    return { id: row.id, binding: row.rowHash, sentence: row.input.sentence, citation: structuredClone(row.input.citation), evidence: structuredClone(row.evidence), checks: row.checks.filter(c => c.level !== 'L5a'), flags: [...row.flags] };
  });
  return { id: canonicalSha256(body), rows: body };
}
export interface OwnerSignoff {
  formId: string; owner: string; signedAt: number; previousHash: string | null;
  decisions: Array<{ id: string; binding: string; verdict: Verdict; note: string }>;
  hash: string;
}
/** Host must authenticate the human actor and append this record to its permanent store. */
export function ownerSignoff(form: BlindForm, args: { owner: string; now: () => number; decisions: Array<{ id: string; verdict: Verdict; note: string }>; previousHash?: string }): OwnerSignoff {
  if (canonicalSha256(form.rows) !== form.id || !args.owner.trim()) throw new Error('invalid owner form/actor');
  if (args.decisions.length !== form.rows.length || new Set(args.decisions.map(d => d.id)).size !== form.rows.length) throw new Error('every row needs exactly one owner verdict');
  const decisions = form.rows.map(row => {
    const d = args.decisions.find(d => d.id === row.id);
    if (!d || !['pass', 'block', 'needs-owner'].includes(d.verdict) || typeof d.note !== 'string') throw new Error('missing/invalid owner decision');
    return { ...d, binding: row.binding };
  });
  const body = { formId: form.id, owner: args.owner.trim(), signedAt: args.now(), previousHash: args.previousHash ?? null, decisions };
  if (!Number.isFinite(body.signedAt)) throw new Error('invalid sign-off clock');
  return { ...body, hash: canonicalSha256(body) };
}
function checkSignature(form: BlindForm, signoff: OwnerSignoff) {
  const { hash, ...body } = signoff;
  if (!signoff.owner.trim() || canonicalSha256(body) !== hash || signoff.formId !== form.id || signoff.decisions.length !== form.rows.length || new Set(signoff.decisions.map(d => d.id)).size !== form.rows.length) throw new Error('stale or changed owner sign-off');
  for (const row of form.rows) if (!signoff.decisions.some(d => d.id === row.id && d.binding === row.binding && ['pass', 'block', 'needs-owner'].includes(d.verdict))) throw new Error('unsigned row');
}
const escapeCell = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/[\r\n]/g, ' ');
export function paperBundle(rows: AuditRow[], signoff: OwnerSignoff | null) {
  const form = blindOwnerForm(rows); if (signoff) checkSignature(form, signoff);
  const references = new Map<string, Record<string, unknown>>();
  const disagreements: Array<{ id: string; software: Verdict; owner: Verdict }> = [];
  const concordance = rows.map(row => {
    const ref = cslJson(row); if (ref) references.set(String(ref.id), { ...ref, note: [...new Set([String(references.get(String(ref.id))?.note ?? ''), String(ref.note)].filter(Boolean))].join('; ') });
    const owner = signoff?.decisions.find(d => d.id === row.id)?.verdict ?? null;
    if (owner && owner !== row.verdict) disagreements.push({ id: row.id, software: row.verdict, owner });
    return { sentenceId: row.id, sentence: row.input.sentence, citation: citationKey(row.input.citation), status: row.status, verdict: row.verdict, flags: row.flags,
      evidence: row.evidence, owner, rowHash: row.rowHash,
      replay: row.work ? { doi: row.work.metadata.doi, cslJson: ref, retrievedAt: row.work.retrievedAt, textSha256: row.work.textSha256, receipts: row.work.receipts } : null };
  });
  const allowed = !!signoff && rows.every(r => r.verdict !== 'block' && !['unavailable', 'not-indexed'].includes(r.status)) && signoff.decisions.every(d => d.verdict === 'pass');
  const markdown = ['| Sentence | Citation | Status | Evidence span and context | Owner |', '| --- | --- | --- | --- | --- |', ...concordance.map(r => `| ${escapeCell(r.sentence)} | ${escapeCell(r.citation)} | ${r.status} | ${escapeCell(r.evidence.map(e => `[${e.section}] ${e.window}`).join(' / '))} | ${r.owner ?? 'unsigned'} |`)].join('\n');
  return { ready: false, ownerApproved: allowed, references: [...references.values()], concordance, concordanceMarkdown: markdown, ownerForm: form, signoff, disagreements, requiresFreshRecheck: true as const };
}
/** Fresh L1-L4 replay is mandatory before packaging. Changed evidence invalidates sign-off. */
export async function finalizeBundle(rows: AuditRow[], index: FrozenIndex, signoff: OwnerSignoff, resolver: Resolver, now: () => number) {
  const bundle = paperBundle(rows, signoff);
  if (!bundle.ownerApproved) throw new Error('citations blocked or unsigned');
  assertIndex(index);
  if (rows.some(row => row.indexId !== index.id)) throw new Error('audit/index mismatch');
  const current = new Map<string, Awaited<ReturnType<Resolver>>>();
  for (const row of rows) {
    const key = citationKey(row.input.citation);
    if (!current.has(key)) current.set(key, await resolver(row.input.citation, { fresh: true }));
  }
  const updated = freezeIndex([...current].map(([key, resolution]) => ({ key, resolution })), index.queries);
  const checks: Array<{ id: string; checkedAt: number; receipts: unknown }> = [];
  for (const row of rows) {
    const fresh = verify(row.input, updated);
    if (!fresh.work || !row.work || fresh.verdict === 'block' || fresh.status === 'unavailable') throw new Error('fresh verification failed');
    const semantic = (r: AuditRow) => ({ metadata: r.work!.metadata, textSha256: r.work!.textSha256, flags: r.flags, retracted: r.work!.retracted, status: r.status, evidence: r.evidence, verdict: r.verdict });
    if (canonicalJson(semantic(row)) !== canonicalJson(semantic(fresh))) throw new Error('source changed: owner must sign again');
    if (fresh.work.receipts.length === 0 || fresh.work.receipts.some(r => r.retrievedAt > now() || now() - r.retrievedAt >= POLICY.cacheMs)) throw new Error('fresh receipts missing/expired');
    checks.push({ id: row.id, checkedAt: now(), receipts: fresh.work.receipts });
  }
  return { ...bundle, ready: true, requiresFreshRecheck: false as const, packagingChecks: checks };
}
