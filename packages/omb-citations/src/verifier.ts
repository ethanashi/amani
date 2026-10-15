import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { doi, fold, POLICY, words } from './policy.ts';
import type { AuditRow, Check, Citation, CitationInput, Evidence, Metadata, Resolution, Verdict, Status, Work } from './types.ts';
export interface FrozenIndex { version: 1; queries: string[]; records: Array<{ key: string; resolution: Resolution }>; id: string }
export function citationKey(c: Citation): string { return doi(c.doi) ? `doi:${doi(c.doi)}` : `pmid:${c.pmid?.trim() ?? ''}`; }
export function fixedQueries(entityPairs: Array<[string, string]>): string[] {
  return entityPairs.map(pair => pair.map(s => { if (!/^[\p{L}\p{N} _.-]+$/u.test(s) || !s.trim()) throw new Error('invalid query entity'); return `"${fold(s)}"`; }).sort().join(' AND ')).sort();
}
export function freezeIndex(records: FrozenIndex['records'], queries: string[] = []): FrozenIndex {
  if (!records.length || new Set(records.map(r => r.key)).size !== records.length) throw new Error('empty or duplicate index');
  const body = { version: 1 as const, queries: [...queries].sort(), records: structuredClone(records).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) };
  return { ...body, id: canonicalSha256(body) };
}
export function assertIndex(index: FrozenIndex) {
  const { id, ...body } = index; if (canonicalSha256(body) !== id) throw new Error('frozen index changed');
}
const comparable = (s: string) => words(s).join(' ');
function titleScore(a: string, b: string): number {
  const x = new Set(words(a)), y = new Set(words(b)); if (!x.size || !y.size) return 0;
  return 2 * [...x].filter(w => y.has(w)).length / (x.size + y.size);
}
function journalMatches(a: string, m: Metadata) {
  const x = comparable(a), y = comparable(m.journal), abbrev = comparable(m.journalAbbrev ?? '');
  if (x && (x === y || x === abbrev)) return true;
  const xs = words(a), ys = words(m.journal).filter(w => !['of', 'the', 'and'].includes(w));
  return xs.length >= 2 && xs.length === ys.length && xs.every((w, i) => w.length >= 2 && ys[i]!.startsWith(w));
}
const page = (s: string) => fold(s).toLowerCase().replace(/\s/g, '').replace(/^(\d+)-(\d+)$/, (_, a: string, b: string) => a + '-' + (b.length < a.length ? a.slice(0, a.length - b.length) + b : b));
export function metadataMismatch(c: Citation, m: Metadata): string[] {
  const errors: string[] = [];
  if (doi(c.doi) && doi(c.doi) !== m.doi) errors.push('doi');
  if (c.pmid && c.pmid.trim() !== m.pmid) errors.push('pmid');
  if (titleScore(c.title, m.title) < POLICY.titleSimilarity) errors.push('title');
  const citedAuthors = c.authors.split(/[,;]/).map(comparable).filter(a => a && !/^et al\b/.test(a));
  if (!citedAuthors.length || citedAuthors.some((a, i) => { const family = comparable(m.authors[i] ?? ''); const bare = a.replace(/^(?:(?:van|von|de|der|den|del|da|di|le|la) )+/, ''); const bareFamily = family.replace(/^(?:(?:van|von|de|der|den|del|da|di|le|la) )+/, ''); return !family || !(a === family || a.startsWith(family + ' ') || bare === bareFamily || bare.startsWith(bareFamily + ' ')); })) errors.push('authors');
  if (!Number.isInteger(c.year) || Math.abs(c.year - m.year) > POLICY.yearTolerance) errors.push('year');
  if (!journalMatches(c.journal, m)) errors.push('journal');
  if (c.volume && comparable(c.volume) !== comparable(m.volume ?? '')) errors.push('volume');
  if (c.pages && page(c.pages) !== page(m.pages ?? '')) errors.push('pages');
  return errors;
}
interface Span { start: number; end: number; text: string }
export function sentenceSpans(text: string): Span[] {
  const out: Span[] = []; let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!/[.!?]/.test(text[i]!)) continue;
    if (text[i] === '.' && /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '')) continue;
    if (text[i] === '.' && /(?:\b(?:al|et|vs|Fig|Figs|Dr|Mr|Mrs|Prof|St|No|e\.g|i\.e)|\b[A-Z])$/i.test(text.slice(start, i))) continue;
    let end = i + 1; while (/['"”’)]/.test(text[end] ?? '\0')) end++;
    if (end < text.length && !/\s/.test(text[end]!)) continue;
    out.push({ start, end, text: text.slice(start, end).trim() }); start = end; while (/\s/.test(text[start] ?? '\0')) start++; i = start - 1;
  }
  if (start < text.length) out.push({ start, end: text.length, text: text.slice(start).trim() }); return out;
}
export function findEvidence(work: Work, quote: string): Evidence[] {
  const q = fold(quote); if (q.split(/\s+/).length < POLICY.minQuoteWords) return [];
  const found: Evidence[] = [];
  for (const [pi, p] of work.passages.entries()) {
    const sentences = sentenceSpans(p.text);
    let searchable = ''; const offsets: number[] = [];
    for (let k = 0; k < p.text.length; k++) if (!p.citationRanges.some(([a, b]) => k >= a && k < b)) { searchable += p.text[k]; offsets.push(k); }
    const candidates: Array<[number, number]> = [];
    for (let k = p.text.indexOf(q); k >= 0; k = p.text.indexOf(q, k + 1)) candidates.push([k, k + q.length]);
    for (let k = searchable.indexOf(q); k >= 0; k = searchable.indexOf(q, k + 1)) { const pair: [number, number] = [offsets[k]!, offsets[k + q.length - 1]! + 1]; if (!candidates.some(([a, b]) => a === pair[0] && b === pair[1])) candidates.push(pair); }
    for (const [start, end] of candidates) {

      // Never match the middle of a word.
      if (!/[\p{L}\p{N}]/u.test(p.text[start - 1] ?? '') && !/[\p{L}\p{N}]/u.test(p.text[end] ?? '')) {
        const lo = sentences.findIndex(s => s.end > start), hi = sentences.findIndex(s => s.end >= end);
        if (lo >= 0 && hi >= lo) {
          const anchorSentence = p.text.slice(sentences[lo]!.start, sentences[hi]!.end);
          const previous = work.passages[pi - 1], next = work.passages[pi + 1];
          const before = sentences[lo - 1]?.text ?? (previous?.section === p.section ? sentenceSpans(previous.text).at(-1)?.text ?? '' : '');
          const after = sentences[hi + 1]?.text ?? (next?.section === p.section ? sentenceSpans(next.text)[0]?.text ?? '' : '');
          found.push({ section: p.section, quote: p.text.slice(start, end), anchorSentence, before, after, window: [before, anchorSentence, after].filter(Boolean).join(' '), start, end, passage: pi,
            quoteCitationMarker: p.citationRanges.some(([a, b]) => a < end && b > start) || /\[\d{1,3}(?:[,;]\s*\d{1,3})*\]/.test(p.text.slice(start, end)),
            citationMarker: p.citationRanges.some(([a, b]) => a < sentences[hi]!.end && b > sentences[lo]!.start) || /\[(?:\d{1,3}(?:[,;]\s*\d{1,3})*)\]|\([A-Z][A-Za-z '-]+(?:et al\.?,? )?\d{4}\)/.test(anchorSentence) });
        }
      }

    }
  }
  return found;
}
const HEDGES = /\b(however|but|whereas|although|despite|contrary to|did not|does not|do not|was not|were not|no evidence|failed to|not supported|no significant|non-significant|nonsignificant|may|might|could|speculat\w*|hypothes\w*|uncertain|suggest\w*)\b/i;
const NEGATION = /\b(no (?:significant |clear )?(?:effect|association|difference|evidence)|(?:did|does|was|were|is) not|not (?:associated|supported|significant|distinguishable)|no longer distinguishable|failed to|non-significant|nonsignificant)\b/i;
const UP = /\b(increas\w*|higher|elevat\w*|positive(?:ly)?|greater|worse|worsen\w*)\b/i;
const DOWN = /\b(decreas\w*|lower\w*|reduc\w*|protect\w*|negative(?:ly)?|improv\w*|less)\b/i;
function direction(s: string): number { return UP.test(s) === DOWN.test(s) ? 0 : UP.test(s) ? 1 : -1; }
function cleanSentence(s: string): string { return fold(s).replace(/\[(?:c:|l:|claim:)[^\]]*\]|\[\d+(?:[, -]\d+)*\]/g, ''); }
export function numbers(s: string): string[] {
  const clean = cleanSentence(s).replace(/(?<=\d)·(?=\d)/g, '.').replace(/(?<=\d),(?=\d{3}\b)/g, '').replace(/\btype\s+[12]\s+diabetes\b/gi, 'diabetes');
  const spelled: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', twenty: '20', hundred: '100', thousand: '1000', million: '1000000', half: '0.5', quarter: '0.25', twice: '2', double: '2', doubled: '2', triple: '3', tripled: '3' };
  const verbal = [...clean.toLowerCase().matchAll(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|hundred|thousand|million|half|quarter|twice|double|doubled|triple|tripled)(?:fold)?\b/g)].map(m => spelled[m[1]!]!);
  return [...verbal, ...[...clean.matchAll(/(?<![\p{L}\p{N}])[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?%?(?![\p{L}\p{N}])/giu)].map(m => String(Number(m[0].replace(/%$/, ''))))];
}
export function deterministicSupport(sentence: string, evidence: Evidence): { conflicts: string[]; uncertain: string[] } {
  const claim = cleanSentence(sentence), source = evidence.window, anchor = evidence.anchorSentence;
  const compound = /[,;]|\b(?:but|whereas|although|however|despite)\b/i.test(anchor);
  const conflicts: string[] = [], uncertain: string[] = [];
  if (NEGATION.test(claim) !== NEGATION.test(anchor) && (NEGATION.test(claim) || NEGATION.test(anchor))) (compound ? uncertain : conflicts).push(compound ? 'negation-scope-needs-review' : 'negation-conflict');
  const a = direction(claim), b = direction(anchor); if (a && b && a !== b) { if (compound || /\bthan\b/i.test(anchor + ' ' + claim)) uncertain.push('comparative-direction-needs-review'); else conflicts.push('direction-conflict'); }
  if ((UP.test(anchor) && DOWN.test(anchor)) || (UP.test(claim) && DOWN.test(claim))) uncertain.push('multiple-direction-clauses');
  const entities = [...claim.matchAll(/\b[A-Z][A-Z0-9-]*\d[A-Z0-9-]*\b/g)].map(m => m[0]);
  if (entities.some(e => !new RegExp('\\b' + e + '\\b').test(anchor))) uncertain.push('claim-entity-outside-anchor');
  const animal = /\b(mice|mouse|murine|rats?|rodents?|zebrafish|drosophila|cell lines?|ipsc|cultured|in vitro)\b/i;
  const human = /\b(patients?|humans?|people|adults?|participants?)\b/i;
  if (human.test(claim) && !animal.test(claim) && animal.test(source) && !/\b(?:patients|participants)\s+(?:were|received|enrolled)\b/i.test(source)) (animal.test(anchor) ? conflicts : uncertain).push(animal.test(anchor) ? 'species-or-model-conflict' : 'model-only-in-neighbour');
  for (const [restricted, stated] of [
    [/\b(women|female|postmenopausal)\b/i, /\b(women|female|postmenopausal)\b/i],
    [/\b(men|male)\b/i, /\b(men|male)\b/i],
    [/\b(children|pediatric|paediatric)\b/i, /\b(children|pediatric|paediatric)\b/i],
    [/\b(European ancestry|European descent|white British)\b/i, /\b(European|white British)\b/i],
  ] as const) if (restricted.test(source) && !(/\b(?:women|female)\b/i.test(source) && /\b(?:men|male)\b/i.test(source)) && !stated.test(claim) && /\b(all|general|adults?|patients?|populations?|people|universally)\b/i.test(claim)) (restricted.test(anchor) ? conflicts : uncertain).push(restricted.test(anchor) ? 'population-scope-conflict' : 'population-only-in-neighbour');
  const available = new Set(numbers(source));
  if (numbers(claim).some(n => !available.has(n))) {
    // A missing quantity is not contrary evidence. Only a same-wording substitution
    // within the anchor establishes a deterministic numeric contradiction.
    const skeleton = (text: string) => cleanSentence(text).toLowerCase().replace(/(?<=\d)·(?=\d)/g, '.')
      .replace(/(?<![\p{L}\p{N}])[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?%?(?![\p{L}\p{N}])/giu, '#').replace(/[^\p{L}\p{N}#]+/gu, ' ').trim();
    if (numbers(anchor).length && skeleton(claim) === skeleton(anchor)) conflicts.push('numeric-conflict-in-anchor');
    else uncertain.push('number-not-established-in-window');
  }
  // Equal digits do not establish equal units. Require owner review for a changed unit.
  const units = (text: string) => [...cleanSentence(text).matchAll(/\b(\d+(?:[.·]\d+)?)\s*(mg|kg|g|ml|l|mm|cm|m|days?|weeks?|months?|years?|%)(?![\p{L}])/giu)].map(m => `${Number(m[1]!.replace('·', '.'))}:${m[2]!.toLowerCase()}`);
  const sourceUnits = new Set(units(source));
  if (units(claim).some(unit => !sourceUnits.has(unit))) uncertain.push('quantity-unit-needs-review');
  if (HEDGES.test(source)) uncertain.push('contrast-or-hedge-in-window');
  // A lexical quote match cannot establish unrestricted paraphrase entailment.
  // Unmatched content words request owner review, rather than silently treating the anchor as proof.
  const stop = new Set('a an the of in on for to and or with by from that this these those is was were are has have had be been as at it its their our we they study studies found showed reported demonstrated authors et al'.split(' '));
  const content = words(claim).filter(w => w.length > 2 && !stop.has(w) && !/^\d+$/.test(w));
  const vocabulary = new Set(words(source));
  const coverage = content.length ? content.filter(w => vocabulary.has(w) || [...vocabulary].some(v => v.length > 4 && w.length > 4 && v.slice(0, -2) === w.slice(0, -2))).length / content.length : 0;
  if (coverage < 0.65 || (!a && /effect|associat|caus|predict/i.test(claim) && !/effect|associat|caus|predict/i.test(source))) uncertain.push('paraphrase-needs-semantic-review');
  return { conflicts: [...new Set(conflicts)], uncertain };
}
/** The frozen index is trusted software input, never an AI-supplied object. */
export function verify(input: CitationInput, index: FrozenIndex): AuditRow {
  assertIndex(index);
  const checks: Check[] = [], flags: string[] = []; let evidence: Evidence[] = [], work: Work | null = null;
  const finish = (verdict: Verdict, status: Status, reasons: string[]): AuditRow => {
    const body = { id: input.id, input: structuredClone(input), verdict, status, flags: [...new Set(flags)].sort(), reasons, checks, evidence, work, indexId: index.id };
    return { ...body, rowHash: canonicalSha256(body) };
  };
  const check = (level: Check['level'], outcome: Check['outcome'], reasons: string[] = []) => checks.push({ level, outcome, reasons });
  if (!input.id || !input.sentence.trim() || input.sentence.length + input.quote.length > POLICY.maxInputChars) { check('L0', 'failed'); return finish('needs-owner', 'needs-owner', ['invalid input']); }
  const entry = index.records.find(r => r.key === citationKey(input.citation));
  if (!entry) { check('L0', 'failed'); return finish('block', 'not-indexed', ['identifier outside frozen index']); }
  check('L0', 'passed');
  if (entry.resolution.state !== 'found') { flags.push(...(entry.resolution.flags ?? [])); const absent = entry.resolution.state === 'not-found'; check('L1', absent ? 'failed' : 'unavailable', [entry.resolution.reason]); return finish(absent ? 'block' : 'needs-owner', absent ? 'not-found' : 'unavailable', [entry.resolution.reason]); }
  work = structuredClone(entry.resolution.work); check('L1', 'passed'); flags.push(...work.flags);
  const mismatch = metadataMismatch(input.citation, work.metadata);
  check('L2', mismatch.length ? 'failed' : 'passed', mismatch);
  check('L3', work.retracted ? 'failed' : 'passed', work.retracted ? ['retraction'] : []);
  if (work.retracted) return finish('block', 'retracted', ['source retracted']);
  if (mismatch.length) return finish('block', 'metadata-mismatch', mismatch);
  if (!work.passages.length) { check('L4', 'unavailable'); return finish('needs-owner', 'unavailable', ['no readable source text']); }
  evidence = findEvidence(work, input.quote);
  if (!evidence.length) { check('L4', 'failed'); return finish('block', 'misquoted', ['anchor absent or fewer than eight words']); }
  // Inspect every occurrence. Repetition in an abstract cannot launder a qualified body occurrence.
  const ambiguousAttribution = (e: Evidence) => e.section === 'results' && e.quoteCitationMarker && /^As previously (?:described|reported)(?=\d|\b)/i.test(e.anchorSentence);
  const secondary = evidence.some(e => !ambiguousAttribution(e) && (e.quoteCitationMarker ||
    (e.section === 'introduction' && (e.citationMarker || /\b(?:previous|prior|earlier) (?:studies|trials|reports)\b|\bet al\b/i.test(e.anchorSentence)))));
  const proposal = evidence.some(e => e.section === 'discussion');
  const attributed = /\b(?:authors?|[\p{Lu}][\p{L}'-]+(?: et al\.?| and colleagues)?)\s+(?:have\s+)?(?:propos\w*|hypothesiz\w*|hypothesis\w*|speculat\w*|suggest\w*|posit\w*)\b/u.test(input.sentence);
  if (secondary) { check('L4', 'failed', ['secondary source']); return finish('block', 'secondary-citation', ['cite primary source']); }
  if (proposal && (!attributed || /\[l:/.test(input.sentence))) { check('L4', 'failed', ['unattributed proposal']); return finish('block', 'author-proposal', ['Discussion text requires author attribution and cannot supply literature facts']); }
  const status = proposal ? 'author-proposal' : work.fullText ? 'fulltext-verified' : 'abstract-supported';
  check('L4', 'passed');
  if (!work.fullText && (UP.test(input.sentence) || DOWN.test(input.sentence) || numbers(input.sentence).length)) flags.push('abstract-only-direction-or-effect-size');
  const support = evidence.map(e => deterministicSupport(input.sentence, e));
  const conflicts = [...new Set(support.flatMap(s => s.conflicts))], uncertain = [...new Set(support.flatMap(s => s.uncertain))];
  if (conflicts.length) { check('L5a', 'failed', conflicts); return finish('block', 'source-contradicts', conflicts); }
  if (evidence.some(ambiguousAttribution)) uncertain.push('primary-versus-secondary-attribution-needs-review');
  if (evidence.some(e => e.section === 'other')) uncertain.push('unknown source section');
  if (evidence.some(e => e.citationMarker && !e.quoteCitationMarker)) uncertain.push('citation-marker-outside-quote');
  if (uncertain.length) { check('L5a', 'needs-owner', uncertain); return finish('needs-owner', status === 'author-proposal' || status === 'abstract-supported' ? status : 'needs-owner', uncertain); }
  check('L5a', 'passed'); return finish('pass', status, []);
}
/** Suite lacks unavailable/not-indexed statuses; preserve causes in flags and route, never pass. */
export function suiteResult(row: AuditRow) {
  return { id: row.id, verdict: row.status === 'not-indexed' ? 'needs-owner' as const : row.verdict,
    status: ['unavailable', 'not-indexed'].includes(row.status) ? 'needs-owner' : row.status,
    flags: [...new Set([...row.flags, ...(['unavailable', 'not-indexed'].includes(row.status) ? [row.status] : [])])].sort() };
}
