// `citations`: bio-checks `citations.checkCitations` with an offline resolver over a local index.
// No network: the only knowledge source is the index file the user names.

import { readFileSync } from "node:fs";
import path from "node:path";
import { citations as cite } from "../../../bio-checks/src/index.ts";
import { normalizeDoi, normalizePmid } from "../../../bio-checks/src/citations/validation.ts";
import { InputError, noRest, onePositional, parseArgs, required } from "../args.ts";
import { result, type ToolResult } from "../io.ts";

interface IndexRecord { title: unknown; retracted: unknown; abstract: unknown; fullText: unknown }

/** JSON array, {"records": [...]}, or JSON Lines; one record per work, each with a DOI and/or PMID. */
function readIndex(file: string): { byDoi: Map<string, IndexRecord>; byPmid: Map<string, IndexRecord>; records: number } {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { throw new InputError(`cannot read index ${file}`); }
  let records: unknown[];
  const trimmed = text.trim();
  try {
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) records = parsed;
        else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown }).records)) records = (parsed as { records: unknown[] }).records;
        else throw new Error("index JSON must be an array or {\"records\": [...]}");
      } catch (error) {
        if (!trimmed.startsWith("{")) throw error;
        records = trimmed.split(/\r?\n/).filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as unknown);
      }
    } else throw new Error("index must be JSON or JSON Lines");
  } catch (error) {
    throw new InputError(`index ${file}: ${error instanceof Error ? error.message : "unparseable"}`);
  }
  if (records.length === 0) throw new InputError(`index ${file} has no records`);
  const byDoi = new Map<string, IndexRecord>();
  const byPmid = new Map<string, IndexRecord>();
  records.forEach((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InputError(`index record ${i} is not an object`);
    const r = raw as Record<string, unknown>;
    const record: IndexRecord = { title: r.title, retracted: r.retracted, abstract: r.abstract, fullText: r.fullText ?? r.full_text };
    const doi = r.doi === undefined || r.doi === null || r.doi === "" ? null : normalizeDoi(r.doi);
    const pmid = r.pmid === undefined || r.pmid === null || r.pmid === "" ? null : normalizePmid(typeof r.pmid === "number" ? String(r.pmid) : r.pmid);
    if (r.doi !== undefined && r.doi !== null && r.doi !== "" && !doi) throw new InputError(`index record ${i} has an invalid DOI`);
    if (r.pmid !== undefined && r.pmid !== null && r.pmid !== "" && !pmid) throw new InputError(`index record ${i} has an invalid PMID`);
    if (!doi && !pmid) throw new InputError(`index record ${i} has neither a DOI nor a PMID`);
    if (doi) { if (byDoi.has(doi)) throw new InputError(`index lists DOI ${doi} twice`); byDoi.set(doi, record); }
    if (pmid) { if (byPmid.has(pmid)) throw new InputError(`index lists PMID ${pmid} twice`); byPmid.set(pmid, record); }
  });
  return { byDoi, byPmid, records: records.length };
}

/** `complete` declares the index a complete snapshot: an absent identifier does not exist and a
 * record without `retracted: true` is not retracted. Otherwise both stay unknown. */
function offlineResolver(index: ReturnType<typeof readIndex>, complete: boolean): cite.CitationResolver {
  const resolve = (record: IndexRecord | undefined): cite.ResolvedCitation => {
    if (!record) return complete ? { exists: false, title: null, retracted: null } : { exists: null, title: null, retracted: null };
    const retracted = typeof record.retracted === "boolean" ? record.retracted : complete && record.retracted === undefined ? false : null;
    return {
      exists: true,
      title: typeof record.title === "string" ? record.title : null,
      retracted,
      ...(typeof record.abstract === "string" ? { abstract: record.abstract } : {}),
      ...(typeof record.fullText === "string" ? { fullText: record.fullText } : {}),
    };
  };
  return {
    async resolveDoi(doi) { return resolve(index.byDoi.get(doi)); },
    async resolvePmid(pmid) { return resolve(index.byPmid.get(pmid)); },
  };
}

export async function citationsCommand(argv: readonly string[], cwd: string): Promise<ToolResult> {
  const args = parseArgs(argv, { index: "string", "index-complete": "boolean", "json-out": "string" });
  noRest(args);
  const refsFile = path.resolve(cwd, onePositional(args, "references JSON file"));
  const indexFile = path.resolve(cwd, required(args, "index"));
  let refs: unknown;
  try { refs = JSON.parse(readFileSync(refsFile, "utf8")); } catch { throw new InputError("cannot read references JSON"); }
  if (!refs || typeof refs !== "object" || Array.isArray(refs) || !Array.isArray((refs as Record<string, unknown>).claims) ||
      !Array.isArray((refs as Record<string, unknown>).citations)) {
    throw new InputError("references JSON must be {\"claims\": [...], \"citations\": [...]}");
  }
  const { claims, citations } = refs as { claims: cite.CitationClaim[]; citations: cite.Citation[] };
  if (claims.length === 0) throw new InputError("references JSON has no claims");
  const index = readIndex(indexFile);
  const complete = args.booleans.has("index-complete");
  const check = await cite.checkCitations({ claims, citations, resolver: offlineResolver(index, complete) });
  const findings = check.claims.flatMap((c) => c.citations).filter((f) => f.status !== "verified");
  const flagged = [...new Map(findings.map((f) => [f.citationId, f])).values()];
  const summary = check.passed
    ? `all ${check.claims.length} claim(s) verified against full text in the index`
    : `${check.status}: ${check.claims.filter((c) => !c.passed).length} of ${check.claims.length} claim(s) not verified; citation findings: ${flagged.map((f) => `${f.citationId}=${f.status}`).join(", ") || "none"}`;
  return result(check.passed ? 0 : 1, check.status, summary, {
    index: { records: index.records, complete, semantics: complete
      ? "complete snapshot: absent identifiers resolve as non-existent; records without retracted:true are not retracted"
      : "partial index: absent identifiers and missing retraction status stay unknown" },
    check,
  });
}
