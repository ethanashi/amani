import { HttpClient, Unavailable, sha256 } from './http.ts';
import { doi, fold } from './policy.ts';
import { abstractPassages, firstText, jatsPassages, nodes, parseXml, textOf } from './xml.ts';
import type { Citation, Metadata, Receipt, Resolution, Work } from './types.ts';
type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Obj : {};
const arr = (x: unknown): unknown[] => Array.isArray(x) ? x : [];
const str = (x: unknown): string => typeof x === 'string' ? x : '';
const one = (x: unknown): string => str(arr(x)[0]);
const nullable = (s: string): string | null => s || null;
const CR = 'https://api.crossref.org';
const EP = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
const PM = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
export function crossrefMetadata(raw: unknown): Metadata {
  const x = obj(raw);
  const dates = ['published', 'published-print', 'published-online', 'issued'].map(k => Number(arr(arr(obj(x[k])['date-parts'])[0])[0]));
  const m: Metadata = { doi: doi(str(x.DOI)), pmid: null, title: fold(one(x.title)), authors: arr(x.author).map(a => str(obj(a).family) || str(obj(a).name)), year: dates.find(y => Number.isInteger(y) && y > 1500) ?? 0,
    journal: one(x['container-title']), journalAbbrev: nullable(one(x['short-container-title'])), volume: nullable(str(x.volume)), pages: nullable(str(x.page) || str(x['article-number'])) };
  if (!m.doi || !m.title || !m.year || !m.authors.length || !m.journal) throw new Unavailable('incomplete Crossref metadata');
  return m;
}
export function crossrefFlags(work: Obj, notices: Obj[], target: string) {
  const flags = new Set<string>(); let retracted = false;
  const inspect = (type: string) => {
    const t = type.toLowerCase().replace(/[_ ]/g, '-');
    if (/retract|withdraw|remov/.test(t)) retracted = true;
    if (/correct|errat/.test(t)) flags.add('correction');
    if (/concern/.test(t)) flags.add('expression-of-concern');
  };
  for (const n of arr(work['updated-by'])) inspect(str(obj(n).type));
  // update-to describes what THIS record updates, not what happened to this record.
  // A retraction/correction notice is not itself a safe original research source.
  for (const n of arr(work['update-to'])) { inspect(str(obj(n).type)); flags.add('update-notice'); }
  for (const n of notices) for (const update of arr(n['update-to'])) {
    const u = obj(update); if (doi(str(u.DOI)) === target) inspect(str(u.type));
  }
  const relation = obj(work.relation);
  for (const key of Object.keys(relation)) {
    if (/is-retracted-by|is-corrected-by|has-expression-of-concern/.test(key)) inspect(key);
    if (/preprint/.test(key)) flags.add('preprint-version');
  }
  if (str(work.type) === 'posted-content' || str(work.subtype) === 'preprint' || relation['is-preprint-of']) flags.add('preprint');
  return { retracted, flags: [...flags].sort() };
}
export class ScholarlyResolver {
  private http: HttpClient; private now: () => number;
  constructor(http: HttpClient, now: () => number) { this.http = http; this.now = now; }
  resolve = async (citation: Citation, options: { fresh?: boolean } = {}): Promise<Resolution> => {
    const receipts: Receipt[] = []; const knownFlags = new Set<string>(); const fresh = options.fresh ?? false;
    const get = async (url: string) => { const r = await this.http.get(url, fresh); receipts.push(r.receipt); return r; };
    const json = async (url: string): Promise<Obj | null> => {
      const r = await get(url); if (r.status === 404) return null;
      try { const data: unknown = JSON.parse(r.body); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return obj(data); } catch { throw new Unavailable('malformed JSON response'); }
    };
    const europe = async (query: string): Promise<Obj | null> => {
      const r = await json(`${EP}/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=2`);
      if (!r || !Number.isInteger(Number(r.hitCount)) || r.hitCount === undefined || !Array.isArray(obj(r.resultList).result)) throw new Unavailable('malformed Europe PMC search');
      const count = Number(r.hitCount); if (!count) return null;
      if (count > 1) throw new Unavailable('ambiguous Europe PMC identifier');
      const result = obj(arr(obj(r.resultList).result)[0]); if (!result.id || !result.title) throw new Unavailable('incomplete Europe PMC record'); return result;
    };
    try {
      let id = doi(citation.doi), pmid = citation.pmid?.trim() || null;
      if (id && !/^10\.\d{4,9}\/\S+$/i.test(id)) return { state: 'not-found', reason: 'invalid DOI syntax', receipts };
      if (!id && (!pmid || !/^\d+$/.test(pmid))) return { state: 'not-found', reason: 'missing or invalid identifier', receipts };
      let pm: Metadata | null = null, pmAbstract = '', pmFlags: string[] = [], pmRetracted = false;
      if (!id && pmid) {
        const r = await get(`${PM}/efetch.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=xml`);
        if (r.status === 404) return { state: 'not-found', reason: 'PubMed HTTP 404', receipts };
        const root = parseXml(r.body);
        if (!nodes(root, 'PubmedArticleSet').length) throw new Unavailable('malformed PubMed response');
        const articles = nodes(root, 'PubmedArticle');
        if (!articles.length) {
          if (nodes(root, 'ERROR').length) throw new Unavailable('PubMed error');
          return { state: 'not-found', reason: 'PubMed returned no record', receipts };
        }
        const a = articles.find(a => firstText(a, 'PMID') === pmid); if (!a) throw new Unavailable('PubMed returned wrong identifier');
        id = doi(textOf(nodes(a, 'ArticleId').find(n => n.attrs.IdType === 'doi') ?? { name: '', attrs: {}, children: [] }));
        const journal = nodes(a, 'Journal')[0]; const yearText = firstText(a, 'PubDate');
        pm = { doi: id, pmid, title: firstText(a, 'ArticleTitle'), authors: nodes(a, 'Author').map(a => firstText(a, 'LastName') || firstText(a, 'CollectiveName')), year: Number(/\b(?:18|19|20)\d{2}\b/.exec(yearText)?.[0] ?? firstText(a, 'Year')),
          journal: journal ? firstText(journal, 'Title') : '', journalAbbrev: nullable(firstText(a, 'ISOAbbreviation')), volume: nullable(firstText(a, 'Volume')), pages: nullable(firstText(a, 'MedlinePgn')) };
        if (!pm.title || !pm.journal || !pm.authors.length || !pm.year) throw new Unavailable('incomplete PubMed metadata');
        pmAbstract = nodes(a, 'AbstractText').map(textOf).join(' ');
        const types = nodes(a, 'PublicationType').map(textOf).join(' ');
        const refs = nodes(a, 'CommentsCorrections').map(n => n.attrs.RefType ?? '').join(' ');
        pmRetracted = /Retracted Publication|RetractionIn|RetractionOf/i.test(types + ' ' + refs);
        if (/ErratumIn|ErratumFor|Published Erratum/i.test(refs + ' ' + types)) pmFlags.push('correction');
        if (/ExpressionOfConcern|Expression of Concern/i.test(refs + ' ' + types)) pmFlags.push('expression-of-concern');
        if (/Preprint/i.test(types)) pmFlags.push('preprint');
        for (const flag of pmFlags) knownFlags.add(flag);
      }
      let cr: Obj | null = null, ep: Obj | null = null, metadata: Metadata;
      if (id) {
        const r = await json(`${CR}/works/${encodeURIComponent(id)}`);
        if (r) { if (r.status !== 'ok' || !obj(r.message).DOI) throw new Unavailable('malformed Crossref work'); cr = obj(r.message); for (const flag of crossrefFlags(cr, [], id).flags) knownFlags.add(flag); }
        ep = await europe(`DOI:"${id}"`);
        if (!cr) {
          const agency = await get(`${CR}/works/${encodeURIComponent(id)}/agency`);
          if (agency.status !== 404 || ep || pm) throw new Unavailable('registered outside supported Crossref metadata coverage');
          const search = await json(`${PM}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(id + '[AID]')}&retmode=json&retmax=1`);
          const es = obj(search?.esearchresult);
          if (es.count !== '0' || !Array.isArray(es.idlist)) throw new Unavailable('DOI absence not corroborated');
          return { state: 'not-found', reason: 'Crossref work and agency 404; Europe PMC and PubMed empty', receipts };
        }
        if (!one(cr['container-title']) && str(cr.type) === 'posted-content') { const journal = obj(obj(ep?.journalInfo).journal); cr = { ...cr, 'container-title': [str(journal.title) || str(obj(arr(cr.institution)[0]).name)] }; }
        metadata = crossrefMetadata(cr); if (metadata.doi !== id) throw new Unavailable('Crossref identifier mismatch');
      } else { metadata = pm!; ep = await europe(`EXT_ID:${pmid} AND SRC:MED`); }
      if (ep) {
        if ((id && doi(str(ep.doi)) !== id) || (!id && str(ep.id) !== pmid)) throw new Unavailable('Europe PMC identifier mismatch');
        const journal = obj(obj(ep.journalInfo).journal);
        metadata.journalAbbrev = nullable(str(journal.medlineAbbreviation)) ?? metadata.journalAbbrev;
        metadata.pmid = nullable(str(ep.pmid) || (ep.source === 'MED' ? str(ep.id) : ''));
        const publicationTypes = arr(obj(ep.pubTypeList).pubType).map(str).join(' ');
        if (/retracted publication|retraction of publication/i.test(publicationTypes)) pmRetracted = true;
        if (/correct|errat/i.test(publicationTypes)) knownFlags.add('correction');
        if (/expression[ -]of[ -]concern/i.test(publicationTypes)) knownFlags.add('expression-of-concern');
        if (/preprint/i.test(publicationTypes) || ep.source === 'PPR') knownFlags.add('preprint');
      } else metadata.pmid = pm?.pmid ?? null;
      let status = { retracted: pmRetracted, flags: [...knownFlags].sort() };
      if (cr && id) {
        const updates = await json(`${CR}/works?filter=${encodeURIComponent('updates:' + id)}&rows=100`);
        const message = obj(updates?.message);
        if (!updates || updates.status !== 'ok' || !Array.isArray(message.items) || typeof message['total-results'] !== 'number' || message['total-results'] > 100) throw new Unavailable('incomplete Crossref updates');
        const cs = crossrefFlags(cr, arr(message.items).map(obj), id);
        for (const flag of cs.flags) knownFlags.add(flag);
        status = { retracted: cs.retracted || pmRetracted, flags: [...knownFlags].sort() };
      }
      let passages = abstractPassages(str(ep?.abstractText) || pmAbstract || str(cr?.abstract)); let fullText = false;
      const pmcid = str(ep?.pmcid);
      if (pmcid && ep?.isOpenAccess === 'Y') {
        if (!/^PMC\d+$/.test(pmcid)) throw new Unavailable('invalid PMCID');
        const r = await get(`${EP}/${pmcid}/fullTextXML`);
        if (r.status === 200) { const p = jatsPassages(r.body); if (!p.length) throw new Unavailable('empty JATS'); passages = p; fullText = true; }
      }
      // Absence of abstract/full text is a content outage, not evidence of a misquote.
      if (!passages.length && !status.retracted) throw new Unavailable('no readable source text');
      const work: Work = { metadata, passages, fullText, ...status, receipts, retrievedAt: Math.min(...receipts.map(r => r.retrievedAt), this.now()), textSha256: sha256(JSON.stringify(passages)) };
      return { state: 'found', work };
    } catch (e) { return { state: 'unavailable', reason: e instanceof Error ? e.message : 'source unavailable', receipts, flags: [...knownFlags].sort() }; }
  };
}
