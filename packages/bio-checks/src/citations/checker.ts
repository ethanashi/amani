import type {
  CitationCheckInput, CitationCheckResult, CitationFinding, CitationResolver,
  CheckStatus, ClaimCitationResult,
} from "./types.ts";
import { isRecord, nonempty, normalizeDoi, normalizePmid } from "./validation.ts";

function normalized(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();
}

function aggregate(statuses: readonly CheckStatus[]): CheckStatus {
  if (!statuses.length) return "unverified";
  for (const status of ["refused", "failed", "unverified", "abstract-only"] as const) {
    if (statuses.includes(status)) return status;
  }
  return "verified";
}

async function checkOne(id: string, citation: unknown, resolver: CitationResolver): Promise<CitationFinding> {
  const base = { citationId: id, source: null, title: null } as const;
  const unknown = (reason: string): CitationFinding => ({ ...base, status: "unverified", reason });
  if (!isRecord(citation) || !nonempty(citation.quote)) return unknown("Missing or empty citation quote");
  const doi = normalizeDoi(citation.doi);
  const pmid = normalizePmid(citation.pmid);
  if ((citation.doi !== undefined) === (citation.pmid !== undefined) || (!doi && !pmid)) {
    return unknown("Provide exactly one valid DOI or PMID");
  }
  try {
    const resolved: unknown = doi
      ? await resolver.resolveDoi(doi)
      : await resolver.resolvePmid?.(pmid!);
    if (!isRecord(resolved)) return unknown("Resolver unavailable or returned invalid data");
    if (resolved.exists === false) return { ...base, status: "fabricated", reason: "Identifier does not resolve" };
    if (resolved.exists !== true) return unknown("Existence is unknown");
    const title = nonempty(resolved.title) ? resolved.title : null;
    if (resolved.retracted === true) return { ...base, title, status: "retracted", reason: "Retracted work" };
    if (resolved.retracted !== false || !title) return unknown("Title or retraction status is unknown");
    for (const field of ["fullText", "abstract"] as const) {
      if (resolved[field] !== undefined && typeof resolved[field] !== "string") {
        return unknown("Resolver returned invalid text");
      }
    }
    const full = nonempty(resolved.fullText) ? normalized(resolved.fullText) : "";
    const abstract = nonempty(resolved.abstract) ? normalized(resolved.abstract) : "";
    const quote = normalized(citation.quote);
    if (full.includes(quote) && full) return {
      citationId: id, title, source: "full-text", status: "verified", reason: "Verbatim quote found in full text",
    };
    if (abstract.includes(quote) && abstract) return {
      citationId: id, title, source: "abstract", status: "abstract-only", reason: "abstract-only support",
    };
    if (!full && !abstract) return unknown("No text available for quote verification");
    return { ...base, title, status: "quote-not-found", reason: "Quote absent from available text after whitespace/case normalization" };
  } catch {
    return unknown("Resolver failed");
  }
}

/** Literal provenance check, not an assessment of whether the quote entails the claim. */
export async function checkCitations(input: CitationCheckInput): Promise<CitationCheckResult> {
  if (!isRecord(input) || !Array.isArray(input.claims) || !Array.isArray(input.citations)) {
    return { passed: false, status: "unverified", reason: "Invalid input", claims: [] };
  }
  const byId = new Map<string, unknown>();
  let invalidCatalog = false;
  for (const citation of input.citations as readonly unknown[]) {
    if (!isRecord(citation) || !nonempty(citation.id)) { invalidCatalog = true; continue; }
    if (byId.has(citation.id)) { invalidCatalog = true; byId.set(citation.id, null); }
    else byId.set(citation.id, citation);
  }
  const claimIds = new Set<string>();
  const claims: ClaimCitationResult[] = [];
  // Memoize per citation, not per DOI: different quoted spans must each be checked.
  const findings = new Map<string, CitationFinding>();
  for (const raw of input.claims as readonly unknown[]) {
    const id = isRecord(raw) && nonempty(raw.id) ? raw.id : "";
    const reject = (status: CheckStatus, reason: string): void => {
      claims.push({ claimId: id, passed: false, status, reason, citations: [] });
    };
    if (!isRecord(raw) || !id || claimIds.has(id) || !nonempty(raw.text)) {
      reject("unverified", "Invalid or duplicate claim"); continue;
    }
    claimIds.add(id);
    if (raw.citationIds == null || (Array.isArray(raw.citationIds) && !raw.citationIds.length)) {
      reject("refused", "Uncited claim"); continue;
    }
    if (!Array.isArray(raw.citationIds) || !raw.citationIds.every(nonempty)) {
      reject("unverified", "Invalid citation references"); continue;
    }
    const citations: CitationFinding[] = [];
    for (const citationId of new Set<string>(raw.citationIds)) {
      let finding = findings.get(citationId);
      if (!finding) {
        finding = await checkOne(citationId, byId.get(citationId), input.resolver);
        findings.set(citationId, finding);
      }
      citations.push(finding);
    }
    const status = aggregate(citations.map(c =>
      c.status === "fabricated" || c.status === "retracted" || c.status === "quote-not-found" ? "failed" : c.status));
    claims.push({ claimId: id, passed: status === "verified", status, reason: status === "abstract-only" ? "abstract-only support" : "See citation findings", citations });
  }
  const status = aggregate([...claims.map(c => c.status), ...(invalidCatalog ? ["unverified" as const] : [])]);
  return { status, passed: status === "verified", reason: invalidCatalog ? "Invalid or duplicate citation catalog entries" : status === "abstract-only" ? "abstract-only support" : "See claim findings", claims };
}
