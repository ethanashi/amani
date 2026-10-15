import { AcademicAccess, AcademicResponseError } from './academic.ts';
import { createHash } from 'node:crypto';

export type NetworkRole = 'analysis' | 'literature' | 'data-fetcher';
export type SearchMode = 'discovery' | 'als' | 'one-shot' | 'known-answer' | 'benchmark' | 'backtest';
export const searchEnabled = (mode: SearchMode): boolean => mode === 'discovery' || mode === 'als';
// Exact hosts, never suffix matching: a new mirror requires a reviewed policy change.
export const ACADEMIC_HOSTS: readonly string[] = Object.freeze([
  'pubmed.ncbi.nlm.nih.gov','pmc.ncbi.nlm.nih.gov','www.ncbi.nlm.nih.gov','eutils.ncbi.nlm.nih.gov',
  'www.ebi.ac.uk','europepmc.org','www.europepmc.org','www.ncbi.nlm.nih.gov',
  'api.crossref.org','api.openalex.org','api.semanticscholar.org','www.semanticscholar.org',
  'www.cochranelibrary.com','scholar.google.com','api.unpaywall.org',
  'api.biorxiv.org','www.biorxiv.org','www.medrxiv.org','export.arxiv.org','arxiv.org','www.researchsquare.com',
  'clinicaltrials.gov','trialsearch.who.int','www.clinicaltrialsregister.eu','euclinicaltrials.eu','www.isrctn.com',
  'www.fda.gov','api.fda.gov','www.accessdata.fda.gov','www.ema.europa.eu','dailymed.nlm.nih.gov',
  'www.ensembl.org','rest.ensembl.org','gnomad.broadinstitute.org','gtexportal.org','www.proteinatlas.org',
  'cellxgene.cziscience.com','api.cellxgene.cziscience.com','api.opengwas.io','www.finngen.fi','r13.finngen.fi',
  'pan.ukbb.broadinstitute.org','biobank.ndph.ox.ac.uk','platform.opentargets.org','api.platform.opentargets.org',
  'pubchem.ncbi.nlm.nih.gov','depmap.org','depmap.sanger.ac.uk','cellmodelpassports.sanger.ac.uk',
  'www.uniprot.org','rest.uniprot.org','www.rcsb.org','data.rcsb.org','reactome.org','string-db.org',
  'alsod.ac.uk','databrowser.projectmine.com','www.nygenome.org',
  'www.who.int','www.cdc.gov','wonder.cdc.gov','wwwn.cdc.gov','www.nice.org.uk',
  'go.drugbank.com','www.kegg.jp','rest.kegg.jp','www.omim.org','api.omim.org',
  'www.nature.com','www.science.org','www.cell.com','www.thelancet.com','www.nejm.org',
  'journals.plos.org','academic.oup.com','onlinelibrary.wiley.com','www.bmj.com','jamanetwork.com','link.springer.com',
]);
const TERMS = new Set(['go.drugbank.com','www.kegg.jp','rest.kegg.jp','www.omim.org','api.omim.org']);
export interface DownloadGrant { url: string; accession: string; sha256: string; bytes: number; licence: string; ownerApproved: boolean; controlled: boolean }
export interface NetworkPolicy { role: NetworkRole; mode: SearchMode; termsApprovedHosts?: readonly string[]; download?: DownloadGrant }
export function authorizeUrl(raw: string, policy: NetworkPolicy): URL {
  if (policy.role === 'analysis') throw new Error('non-model-egress: analysis has no network');
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) throw new Error('unsafe academic URL');
  if (policy.role === 'data-fetcher') {
    const g = policy.download;
    if (!g || raw !== g.url || !g.accession.trim() || !g.licence.trim() || !/^[a-f0-9]{64}$/.test(g.sha256) || !Number.isSafeInteger(g.bytes) || g.bytes <= 0 || ((g.bytes > 1_000_000_000 || g.controlled) && !g.ownerApproved)) throw new Error('trusted hash-pinned download grant required');
    // The grant is supplied by the trusted host; never by a worker.
    return u;
  }
  if (policy.role !== 'literature' || !searchEnabled(policy.mode)) throw new Error('search is off');
  if (!ACADEMIC_HOSTS.includes(u.hostname)) throw new Error('host outside academic allowlist');
  if (TERMS.has(u.hostname) && !policy.termsApprovedHosts?.includes(u.hostname)) throw new Error('source terms approval required');
  if (/\.(?:tar|gz|zip|h5|h5ad|fastq|bam|csv|tsv|parquet)(?:$|\/)/i.test(u.pathname) || /\/(?:dbgap|controlled|download)(?:\/|$)/i.test(u.pathname)) throw new Error('literature worker cannot download data');
  if (u.hostname.includes('arxiv.org') && !/q-bio|stat/.test(decodeURIComponent(u.pathname + u.search))) throw new Error('arXiv limited to q-bio/stat searches');
  return u;
}
export function scanSource(text: string): void {
  let decoded = '';
  try { const collect = (value: unknown): void => { if (typeof value === 'string') decoded += ' ' + value; else if (value && typeof value === 'object') Object.values(value).forEach(collect); }; collect(JSON.parse(text)); } catch { /* XML/HTML is scanned below. */ }
  const folded = (text + decoded).normalize('NFKC').replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex: string, decimal: string) => { const n = parseInt(hex || decimal, hex ? 16 : 10); return n <= 0x10ffff ? String.fromCodePoint(n) : ''; }).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  if (/(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions|prompts)|(?:system|assistant|developer)\s*:\s*(?:you must|ignore)|<\|(?:im_start|system)|(?:exfiltrat|reveal (?:your |the )?(?:secrets|credentials)|AI.generated summary)/i.test(folded)) throw new Error('source prompt-injection scan failed');
}
export interface RetrievedPage { url: string; body: string; sha256: string; retrievedAt: number; citable: boolean; flags: string[] }
/** Capability is fixed at construction. No method can change the role, mode or download grant. */
export class RoleNetwork {
  readonly #policy: NetworkPolicy;
  readonly #fetch: typeof fetch;
  constructor(policy: NetworkPolicy, private readonly now: () => number, transport: typeof fetch = fetch, private readonly access?: AcademicAccess) {
    this.#policy = structuredClone(policy); this.#fetch = transport;
  }
  async get(url: string): Promise<RetrievedPage> {
    const u = authorizeUrl(url, this.#policy);
    const page = this.#policy.role === 'literature' && this.access
      ? await this.access.get(url, (requestUrl, headers) => this.retrieve(requestUrl, headers))
      : await this.retrieve(url);
    if (this.#policy.role === 'literature') scanSource(page.body);
    return { ...page, citable: u.hostname !== 'scholar.google.com' && !/\/(?:news|press|blogs?)(?:\/|-|$)/i.test(u.pathname), flags: /biorxiv|medrxiv|arxiv|researchsquare/.test(u.hostname) ? ['not-peer-reviewed'] : [] };
  }
  private async retrieve(url: string, headers: Record<string, string> = {}): Promise<RetrievedPage> {
    const u = authorizeUrl(url, this.#policy);
    const response = await this.#fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json, application/xml, text/xml, text/html', ...headers } });
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('academic redirect refused'); }
    if (response.status !== 200) { await response.body?.cancel(); throw new AcademicResponseError(response.status, response.headers.get('retry-after')); }
    if (response.redirected || (response.url && response.url !== url)) { await response.body?.cancel(); throw new Error('academic response/redirect refused'); }
    const cap = this.#policy.role === 'data-fetcher' ? this.#policy.download!.bytes : 2_000_000;
    const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { if (reader) for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.byteLength; if (size > cap) { await reader.cancel(); throw new Error('response size cap'); } chunks.push(r.value); } }
    finally { reader?.releaseLock(); }
    const bytes = Buffer.concat(chunks), sha256 = createHash('sha256').update(bytes).digest('hex');
    if (this.#policy.role === 'data-fetcher' && (size !== cap || sha256 !== this.#policy.download!.sha256)) throw new Error('download hash/size mismatch');
    const body = bytes.toString('utf8');
    if (this.#policy.role === 'literature') scanSource(body);
    return { url, body, sha256, retrievedAt: this.now(), citable: u.hostname !== 'scholar.google.com' && !/\/(?:news|press|blogs?)(?:\/|-|$)/i.test(u.pathname), flags: /biorxiv|medrxiv|arxiv|researchsquare/.test(u.hostname) ? ['not-peer-reviewed'] : [] };
  }
  /** All PW4 resolver HTTP calls go through the same capability, scan and size limits. */
  asFetch(): typeof fetch {
    return (async (input: string | URL | Request) => { const page = await this.get(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url); return new Response(page.body, { status: 200 }); }) as typeof fetch;
  }
}
