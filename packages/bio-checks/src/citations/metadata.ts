import { isRecord, nonempty, normalizeDoi } from "./validation.ts";

/** Crossref omits empty update fields. Unknown update types remain unverified. */
export function retractionStatus(work: Record<string, unknown>): boolean | null {
  if (Array.isArray(work.title) && work.title.some(retractedTitle)) return true;
  let unknown = false;
  const values: unknown[] = [work["update-to"], work["updated-by"]];
  if (work.relation !== undefined) {
    if (!isRecord(work.relation)) unknown = true;
    else values.push(work.relation["update-to"], work.relation["updated-by"]);
  }
  for (const value of values) {
    if (value === undefined) continue;
    if (!Array.isArray(value)) { unknown = true; continue; }
    for (const update of value) {
      if (!isRecord(update) || !nonempty(update.type)) { unknown = true; continue; }
      const type = update.type.toLowerCase();
      // Conservatively also reject retraction/withdrawal notices themselves.
      if (["retraction", "withdrawal", "partial_retraction", "partial-retraction"].includes(type)) return true;
      if (!["correction", "erratum", "corrigendum", "addendum", "new_edition", "new_version", "clarification"].includes(type)) unknown = true;
    }
  }
  return unknown ? null : false;
}

export function crossrefWork(payload: unknown, doi: string): Record<string, unknown> {
  if (!isRecord(payload) || payload.status !== "ok" || !isRecord(payload.message) ||
      normalizeDoi(payload.message.DOI) !== doi || !Array.isArray(payload.message.title) ||
      !nonempty(payload.message.title[0])) throw new Error("Invalid Crossref record");
  return payload.message;
}

export function europePmcRecord(payload: unknown, kind: "doi" | "pmid", id: string): Record<string, unknown> | null {
  if (!isRecord(payload) || !Number.isSafeInteger(payload.hitCount) || (payload.hitCount as number) < 0 ||
      !isRecord(payload.resultList) || !Array.isArray(payload.resultList.result)) throw new Error("Invalid Europe PMC response");
  if (payload.hitCount === 0 && payload.resultList.result.length === 0) return null;
  // Ambiguous results are not an identity match. No picking the first search hit.
  if (payload.hitCount !== 1 || payload.resultList.result.length !== 1) throw new Error("Ambiguous Europe PMC identity");
  const record: unknown = payload.resultList.result[0];
  if (!isRecord(record) || (kind === "doi" ? normalizeDoi(record.doi) !== id : record.id !== id || record.source !== "MED")) {
    throw new Error("Europe PMC identity mismatch");
  }
  return record;
}

function retractedTitle(value: unknown): boolean {
  return typeof value === "string" && /^\s*RETRACTED\b/i.test(value);
}

/** Optional list absence means no reported flag; malformed supplied lists remain unknown. */
export function europePmcRetractionStatus(record: Record<string, unknown>): boolean | null {
  if (retractedTitle(record.title)) return true;
  let unknown = false;
  for (const [container, key] of [["pubTypeList", "pubType"], ["commentCorrectionList", "commentCorrection"]] as const) {
    const value = record[container];
    if (value === undefined) continue;
    if (!isRecord(value) || !Array.isArray(value[key])) { unknown = true; continue; }
    for (const entry of value[key]) {
      const type: unknown = key === "pubType" ? entry : isRecord(entry) ? entry.type : undefined;
      if (!nonempty(type)) { unknown = true; continue; }
      const normalized = type.trim().toLowerCase();
      if (["retracted publication", "retraction of publication", "retraction in", "retraction of"].includes(normalized)) return true;
    }
  }
  return unknown ? null : false;
}

/** Positive evidence wins; a negative requires every consulted source to be clear. */
export function combineRetraction(...statuses: (boolean | null)[]): boolean | null {
  return statuses.includes(true) ? true : statuses.every(value => value === false) ? false : null;
}
