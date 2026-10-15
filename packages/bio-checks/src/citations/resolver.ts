import type { CitationResolver, ResolvedCitation } from "./types.ts";
import { combineRetraction, crossrefWork, europePmcRecord, europePmcRetractionStatus, retractionStatus } from "./metadata.ts";
import { isRecord, nonempty, normalizeDoi, normalizePmid } from "./validation.ts";
import { abstractText, xmlText } from "./xml-text.ts";

export const CITATION_USER_AGENT = "omerta-bio/0.0.1 (scientific citation verification; low-volume requests)";
const unknown = (): ResolvedCitation => ({ exists: null, title: null, retracted: null });
const absent = (): ResolvedCitation => ({ exists: false, title: null, retracted: null });
const REST = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const MAX_BYTES = 8 * 1024 * 1024;

/** Bounded HTTP reader; redirects and every non-404 failure remain unknown. */
async function get(url: string, signal: AbortSignal, readNotFound = false): Promise<string | null> {
  const response = await fetch(url, {
    headers: { "User-Agent": CITATION_USER_AGENT, Accept: "application/json, application/xml;q=0.9" },
    redirect: "error", signal,
  });
  if (response.status === 404 && !readNotFound) { await response.body?.cancel(); return null; }
  if ((!response.ok && !(readNotFound && response.status === 404)) || !response.body) {
    await response.body?.cancel(); throw new Error("Remote service unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("Response too large");
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    await reader.cancel(); reader.releaseLock();
  }
}

async function search(kind: "doi" | "pmid", id: string, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({
    query: kind === "doi" ? `DOI:"${id.replace(/["\\]/g, "\\$&")}"` : `EXT_ID:${id} AND SRC:MED`,
    format: "json", resultType: "core", pageSize: "2",
  });
  const body = await get(`${REST}/search?${params}`, signal);
  if (body === null) throw new Error("Search endpoint unavailable");
  return europePmcRecord(JSON.parse(body), kind, id);
}

async function withText(work: ResolvedCitation, record: Record<string, unknown> | null, signal: AbortSignal): Promise<ResolvedCitation> {
  if (!record) return work;
  work = { ...work, retracted: combineRetraction(work.retracted, europePmcRetractionStatus(record)) };
  // Known retraction evidence must survive unavailable or malformed text.
  if (work.retracted !== false) return work;
  let abstract: string | undefined;
  let fullText: string | undefined;
  if (record.abstractText !== undefined) {
    try {
      if (typeof record.abstractText === "string") abstract = abstractText(record.abstractText);
    } catch { /* An unusable abstract cannot discard independently available full text. */ }
  }
  if (record.isOpenAccess === "Y") {
    if (typeof record.pmcid !== "string" || !/^PMC[1-9]\d*$/.test(record.pmcid)) throw new Error("Missing full-text identity");
    const xml = await get(`${REST}/${record.pmcid}/fullTextXML`, signal);
    if (!xml) throw new Error("Full text unavailable");
    fullText = xmlText(xml, true);
    if (!fullText) throw new Error("Empty full text");
  } else if (record.isOpenAccess !== "N") {
    throw new Error("Unknown full-text availability");
  }
  return { ...work, ...(abstract ? { abstract } : {}), ...(fullText ? { fullText } : {}) };
}

/** Live resolver; orchestration tests stub HTTP and deadlines, never use the network. */
export function createCitationResolver(options: { timeoutMs?: number } = {}): CitationResolver {
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error("Invalid resolver timeout");

  async function doiMetadata(doi: string, signal: AbortSignal): Promise<ResolvedCitation> {
    const body = await get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, signal);
    if (body === null) {
      // Crossref is one registration agency, not the global DOI registry.
      // Handle error responses carry structured codes even on HTTP 404.
      const handleBody = await get(`https://doi.org/api/handles/${encodeURIComponent(doi)}`, signal, true);
      const handle: unknown = handleBody === null ? null : JSON.parse(handleBody);
      return isRecord(handle) && normalizeDoi(handle.handle) === doi && handle.responseCode === 100
        ? absent() : unknown();
    }
    const work = crossrefWork(JSON.parse(body), doi);
    return { exists: true, title: (work.title as string[])[0]!, retracted: retractionStatus(work) };
  }

  return {
    async resolveDoi(value) {
      const doi = normalizeDoi(value);
      if (!doi) return unknown();
      try {
        const signal = AbortSignal.timeout(timeoutMs);
        const work = await doiMetadata(doi, signal);
        if (work.exists !== true || work.retracted === true) return work;
        return await withText(work, await search("doi", doi, signal), signal);
      } catch { return unknown(); }
    },
    async resolvePmid(value) {
      const pmid = normalizePmid(value);
      if (!pmid) return unknown();
      try {
        const signal = AbortSignal.timeout(timeoutMs);
        const record = await search("pmid", pmid, signal);
        if (!record) return absent();
        if (europePmcRetractionStatus(record) === true) {
          return { exists: true, title: nonempty(record.title) ? record.title : null, retracted: true };
        }
        const doi = normalizeDoi(record.doi);
        // No DOI means Crossref cannot establish a retraction status for this PMID.
        if (!doi || !nonempty(record.title)) return unknown();
        const work = await doiMetadata(doi, signal);
        // An existing PMID with a missing DOI record is unknown, not fabricated.
        if (work.exists !== true) return unknown();
        if (work.retracted === true) return work;
        return await withText(work, record, signal);
      } catch { return unknown(); }
    },
  };
}
