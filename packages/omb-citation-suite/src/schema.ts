// Fail-closed schema validation for suite rows. Every rule here is a property the suite promises
// its users: evidence is short and present, the expected disposition is recomputed from the class,
// the anchor's recorded source windows (section 7 triggers) and the work's update record (flags);
// registry and retraction facts agree with the class; wrong-metadata rows really differ beyond L2
// tolerance; and no surface cue (identifier case, retraction marks in titles) gives a class away.

import { CLASS_RULES, expectedFor, triggersFrom } from "./expectations.ts";
import { foldText, normalizeDoi, normalizeId, stripRetractionMarks, wordCount, workKeys } from "./normalize.ts";
import {
  CONTRAST_MARKERS,
  DIFFICULTIES,
  DOMAINS,
  EVIDENCE_SECTIONS,
  FACTUAL,
  FAILURE_CLASSES,
  FLAGS,
  SPLITS,
  STATUSES,
  TEXT_SECTIONS,
  TRIGGERS,
  VERDICTS,
  type EvidenceSection,
  type Flag,
  type SuiteRow,
  type Verification,
} from "./types.ts";

export const MAX_EVIDENCE_WORDS = 50;
export const MIN_ANCHOR_WORDS = 8;
export const ID_PATTERN = /^pw4s-[0-9a-f]{6}$/;
const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/;
const PMID_PATTERN = /^\d{1,9}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const METADATA_FIELDS = ["year", "journal", "firstAuthor", "title", "volume", "pages", "doi", "pmid"] as const;
/** Section 7: an author-proposal may back only a sentence framed with an attribution verb. */
export const ATTRIBUTION_VERBS = /\b(proposed|suggested|speculated|hypothesi[sz]ed|postulated|conjectured|argued|put forward)\b/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const nonEmpty = (v: unknown): v is string => isStr(v) && v.trim() !== "";
const strOrNull = (v: unknown) => v === null || isStr(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => isStr(v) && (list as readonly string[]).includes(v);

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
}

function firstAuthorOf(authors: string): string {
  const first = authors.split(",")[0] ?? "";
  return foldText(first).replace(/\s+[A-Z]{1,4}$/, "").toLowerCase();
}

function titleKey(t: string): string {
  return foldText(stripRetractionMarks(t)).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Section 7 L3 flags implied by the work's update record and type. */
export function flagsFrom(v: Pick<Verification, "retraction" | "updates" | "workType">): Flag[] {
  const retractionNotices = new Set(v.retraction.notices.map((n) => n.doi));
  const out = new Set<Flag>();
  for (const u of v.updates) {
    if (/correction|erratum|corrigendum/i.test(u.type) && !retractionNotices.has(u.doi)) out.add("correction");
    if (/expression.of.concern/i.test(u.type)) out.add("expression-of-concern");
  }
  if (v.workType === "posted-content") out.add("preprint");
  return [...out].sort();
}

function checkEvidence(e: unknown, where: string, errors: string[]): e is { section: EvidenceSection; quote: string } {
  if (!isObj(e)) {
    errors.push(`${where} must be an object`);
    return false;
  }
  if (!oneOf(EVIDENCE_SECTIONS, e.section)) errors.push(`${where}.section invalid: ${String(e.section)}`);
  if (!nonEmpty(e.quote)) errors.push(`${where}.quote must be non-empty`);
  else if (wordCount(e.quote) > MAX_EVIDENCE_WORDS) errors.push(`${where}.quote has ${wordCount(e.quote)} words (> ${MAX_EVIDENCE_WORDS})`);
  return true;
}

function checkNotices(v: unknown, where: string, err: (m: string) => void) {
  if (!Array.isArray(v) || !v.every((n) => isObj(n) && isStr(n.doi) && isStr(n.type) && isStr(n.source) && strOrNull(n.date))) err(`${where} must be [{doi,type,source,date}]`);
}

/** Returns a list of problems; an empty list means the row is valid. */
export function validateRow(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(raw)) return ["row must be an object"];
  const r = raw;
  const id = isStr(r.id) ? r.id : "?";
  const err = (m: string) => errors.push(`${id}: ${m}`);

  if (!isStr(r.id) || !ID_PATTERN.test(r.id)) err(`id must match ${ID_PATTERN}`);
  if (!oneOf(SPLITS, r.split)) err(`split invalid: ${String(r.split)}`);
  if (!oneOf(FAILURE_CLASSES, r.class)) err(`class invalid: ${String(r.class)}`);
  if (!oneOf(DOMAINS, r.domain)) err(`domain invalid: ${String(r.domain)}`);
  if (!oneOf(DIFFICULTIES, r.difficulty)) err(`difficulty invalid: ${String(r.difficulty)}`);
  if (!isStr(r.plant)) err("plant must be a string");

  // ---- verifier input
  const input = r.input;
  if (!isObj(input)) {
    err("input must be an object");
    return errors;
  }
  if (!nonEmpty(input.sentence)) err("input.sentence must be non-empty");
  else if (!/\[\d+\]/.test(input.sentence)) err("input.sentence must carry a numbered citation marker like [1]");
  if (!nonEmpty(input.quote)) err("input.quote must be non-empty");
  else if (wordCount(input.quote) < MIN_ANCHOR_WORDS) err(`input.quote must have at least ${MIN_ANCHOR_WORDS} words`);
  const c = input.citation;
  if (!isObj(c)) {
    err("input.citation must be an object");
    return errors;
  }
  if (c.doi !== null && (!isStr(c.doi) || !DOI_PATTERN.test(c.doi))) err(`citation.doi malformed: ${String(c.doi)}`);
  if (isStr(c.doi) && c.doi !== c.doi.toLowerCase()) err("citation.doi must be lower case (uniform identifier case: no class cue)");
  if (!strOrNull(c.pmid) || (isStr(c.pmid) && !PMID_PATTERN.test(c.pmid))) err("citation.pmid must be digits or null");
  if (c.doi === null && c.pmid === null) err("citation needs a DOI or a PMID");
  if (!nonEmpty(c.authors)) err("citation.authors must be non-empty");
  if (!Number.isInteger(c.year) || (c.year as number) < 1900 || (c.year as number) > 2027) err("citation.year must be an integer year");
  if (!nonEmpty(c.title)) err("citation.title must be non-empty");
  else if (stripRetractionMarks(c.title) !== c.title) err("citation.title must be the original title, without retraction marks");
  if (!nonEmpty(c.journal)) err("citation.journal must be non-empty");
  for (const f of ["volume", "issue", "pages"] as const) if (!strOrNull(c[f])) err(`citation.${f} must be string or null`);

  const src = r.source;
  if (!isObj(src) || !nonEmpty(src.url) || !nonEmpty(src.license) || typeof src.openAccess !== "boolean" || typeof src.fullText !== "boolean") {
    err("source must have url, license (non-empty), openAccess and fullText (booleans)");
  }

  // ---- verification record (needed to recompute flags)
  const v = r.verification;
  if (!isObj(v)) {
    err("verification must be an object");
    return errors;
  }
  if (!isStr(v.checkedAt) || !DATE_PATTERN.test(v.checkedAt)) err("verification.checkedAt must be YYYY-MM-DD");
  if (!Array.isArray(v.methods) || v.methods.length === 0 || !v.methods.every(nonEmpty)) err("verification.methods must list the APIs used");
  if (!oneOf(["registered", "not-registered"] as const, v.registry)) err("verification.registry invalid");
  const ret = v.retraction;
  if (!isObj(ret) || typeof ret.retracted !== "boolean") err("verification.retraction malformed");
  else checkNotices(ret.notices, "verification.retraction.notices", err);
  checkNotices(v.updates, "verification.updates", err);
  if (!strOrNull(v.workType)) err("verification.workType must be string or null");
  for (const k of ["evidenceFoundIn", "anchorFoundIn", "metadataMismatch"] as const) {
    if (!Array.isArray(v[k]) || !(v[k] as unknown[]).every(isStr)) err(`verification.${k} must be a string array`);
  }
  if (!isStr(v.notes)) err("verification.notes must be a string");

  // ---- adjudication: factual support and the recorded source windows
  const adj = r.adjudication;
  let triggers: string[] = [];
  if (!isObj(adj)) err("adjudication must be an object");
  else {
    if (!oneOf(FACTUAL, adj.factual)) err(`adjudication.factual invalid: ${String(adj.factual)}`);
    else if (oneOf(FAILURE_CLASSES, r.class) && adj.factual !== CLASS_RULES[r.class].factual) err(`adjudication.factual must be ${CLASS_RULES[r.class].factual} for ${r.class}`);
    const wins = adj.windows;
    const winOk =
      Array.isArray(wins) &&
      wins.every(
        (w) =>
          isObj(w) &&
          isStr(w.section) &&
          typeof w.citationMarker === "boolean" &&
          Array.isArray(w.markers) &&
          w.markers.every((m) => isObj(m) && oneOf(CONTRAST_MARKERS, m.marker) && oneOf(["before", "anchor", "after"] as const, m.position)),
      );
    if (!winOk) err("adjudication.windows malformed");
    else {
      triggers = triggersFrom(wins as never);
      if (!Array.isArray(adj.triggers) || !adj.triggers.every((t) => oneOf(TRIGGERS, t)) || !sameSet(adj.triggers as string[], triggers)) {
        err(`adjudication.triggers must be [${triggers.join(", ")}] (recomputed from windows)`);
      }
      if ((wins.length === 0) !== (adj.windowSha256 === null)) err("adjudication.windowSha256 must be null exactly when there are no windows");
      if (adj.windowSha256 !== null && !(isStr(adj.windowSha256) && /^[0-9a-f]{64}$/.test(adj.windowSha256))) err("adjudication.windowSha256 must be a sha256 hex digest");
      if (r.class === "fabricated-doi" ? wins.length !== 0 : wins.length === 0) err(r.class === "fabricated-doi" ? "fabricated rows have no source window" : "rows citing a real work need at least one source window");
    }
    if (!nonEmpty(adj.disposition)) err("adjudication.disposition must explain the disposition");
  }

  // ---- expectation must equal the policy function
  const ex = r.expected;
  if (!isObj(ex)) err("expected must be an object");
  else if (oneOf(FAILURE_CLASSES, r.class) && isObj(v) && isObj(ret) && Array.isArray(v.updates)) {
    const flags = flagsFrom(v as unknown as Verification);
    const want = expectedFor(r.class, isObj(src) && src.fullText === true, triggers as never, flags);
    if (ex.valid !== want.valid) err(`expected.valid must be ${want.valid}`);
    if (ex.verdict !== want.verdict) err(`expected.verdict must be ${want.verdict}`);
    if (ex.status !== want.status) err(`expected.status must be ${want.status}`);
    for (const k of ["acceptVerdicts", "acceptStatuses", "safePassStatuses", "requiredFlags"] as const) {
      const val = ex[k];
      if (!Array.isArray(val) || !val.every(isStr) || !sameSet(val as string[], want[k])) err(`expected.${k} must be [${want[k].join(", ")}]`);
    }
    if (!oneOf(VERDICTS, ex.verdict)) err("expected.verdict unknown");
    if (!oneOf(STATUSES, ex.status)) err("expected.status unknown");
    if (Array.isArray(ex.requiredFlags) && !ex.requiredFlags.every((f) => oneOf(FLAGS, f))) err("expected.requiredFlags has an unknown flag");
  }

  // ---- class-specific policy shape
  if (r.class === "correct-support" && (triggers.includes("author-proposal") || triggers.includes("author-proposal-elsewhere"))) {
    err("correct-support anchor occurs as an unmarked Discussion sentence (section 7: author-proposal); anchor it in Results or the Abstract");
  }
  if ((r.class === "attributed-proposal" || r.class === "proposal-as-finding") && !triggers.includes("author-proposal")) {
    err(`${r.class} needs an anchor that occurs only as an unmarked Discussion sentence`);
  }
  if (nonEmpty(input.sentence)) {
    if (r.class === "attributed-proposal" && !ATTRIBUTION_VERBS.test(input.sentence)) err("attributed-proposal sentence must attribute the idea (proposed, suggested, hypothesised ...)");
    if (r.class === "proposal-as-finding" && ATTRIBUTION_VERBS.test(input.sentence)) err("proposal-as-finding sentence must state the idea as a finding, without an attribution verb");
  }

  // ---- evidence
  if (checkEvidence(r.evidence, "evidence", errors) && oneOf(FAILURE_CLASSES, r.class)) {
    const sec = (r.evidence as { section: EvidenceSection }).section;
    const want: Partial<Record<string, EvidenceSection[]>> = {
      "fabricated-doi": ["registry"],
      "wrong-metadata": ["metadata"],
      retracted: ["retraction-notice"],
      "abstract-only-direction": ["abstract"],
      "attributed-proposal": ["discussion"],
      "proposal-as-finding": ["discussion"],
    };
    const allowed = want[r.class] ?? [...TEXT_SECTIONS];
    if (!allowed.includes(sec)) err(`evidence.section ${sec} not allowed for ${r.class} (allowed: ${allowed.join(", ")})`);
  }
  if (r.class === "retracted") {
    if (r.evidenceText === null || !checkEvidence(r.evidenceText, "evidenceText", errors)) err("retracted rows need evidenceText");
  } else if (r.evidenceText !== null) {
    err("evidenceText must be null except for retracted rows");
  }

  // ---- truth record and related identifiers
  const t = r.truth;
  if (r.class === "fabricated-doi") {
    if (t !== null) err("fabricated-doi rows must have truth = null");
  } else if (!isObj(t)) {
    err("truth must be an object");
  } else {
    if (t.doi !== null && (!isStr(t.doi) || !DOI_PATTERN.test(t.doi) || t.doi !== t.doi.toLowerCase())) err("truth.doi must be a lower-case DOI or null");
    if (t.pmid !== null && (!isStr(t.pmid) || !PMID_PATTERN.test(t.pmid))) err("truth.pmid must be digits or null");
    if (t.doi === null && t.pmid === null) err("truth needs a DOI or a PMID");
    if (!nonEmpty(t.firstAuthor) || !nonEmpty(t.title) || !nonEmpty(t.journal) || !Number.isInteger(t.year)) err("truth needs firstAuthor, title, journal and integer year");
    for (const f of ["pmcid", "journalAbbrev", "volume", "pages"] as const) if (!strOrNull(t[f])) err(`truth.${f} must be string or null`);
  }
  if (!Array.isArray(r.relatedIds) || !r.relatedIds.every((d) => isStr(d) && (DOI_PATTERN.test(d) || /^pmid:\d+$/.test(d)))) err("relatedIds must be DOIs or pmid:N");
  if (r.class === "secondary-citation" && Array.isArray(r.relatedIds) && r.relatedIds.length === 0) err("secondary-citation rows must name the primary study in relatedIds");
  if (errors.length) return errors;

  // ---- class-specific facts (only reached when the shape is valid)
  const row = r as unknown as SuiteRow;
  const cls = row.class;
  const ver = row.verification;
  if (cls === "fabricated-doi") {
    if (ver.registry !== "not-registered") err("fabricated-doi must be verified not-registered");
  } else if (ver.registry !== "registered") {
    err("non-fabricated rows must cite a registered identifier");
  }
  if (cls === "retracted") {
    if (!ver.retraction.retracted || !ver.retraction.notices.some((n) => /retraction|withdrawal|removal/i.test(n.type))) err("retracted rows need a verified retraction notice");
  } else if (ver.retraction.retracted) {
    err("only retracted rows may cite a retracted work");
  }
  if (TEXT_SECTIONS.includes(row.evidence.section) && ver.evidenceFoundIn.length === 0) err("evidence quote was not found in the source");
  if (row.evidenceText && ver.evidenceFoundIn.length === 0) err("retracted evidenceText was not found in the source");
  const anchorMustBeVerbatim = cls !== "misquote" && cls !== "fabricated-doi";
  if (anchorMustBeVerbatim && ver.anchorFoundIn.length === 0) err("anchor quote was not found verbatim in the source");
  if (cls === "misquote" && ver.anchorFoundIn.length !== 0) err("misquote anchor must NOT occur verbatim in the source");
  if (cls === "quote-cut-qualifier") {
    const a = foldText(row.input.quote);
    const e = foldText(row.evidence.quote);
    if (!e.includes(a) || e.length <= a.length) err("quote-cut-qualifier: the anchor must be a strict fragment of the evidence sentence");
  }
  if (cls === "abstract-only-direction" && row.source.fullText) err("abstract-only-direction rows must cite a work without open full text");
  if (["wrong-species", "overgeneralised-population", "wrong-numeric", "direction-flip", "negation", "proposal-as-finding"].includes(cls) && row.plant.trim() === "") {
    err(`${cls} rows must describe the plant`);
  }
  if ((cls === "correct-support" || cls === "attributed-proposal") && row.plant.trim() !== "") err(`${cls} rows must have an empty plant`);

  // ---- citation as written vs the registered record of its identifier
  if (row.truth) {
    const tr = row.truth;
    const cw = row.input.citation;
    const diffs: string[] = [];
    if (Math.abs(cw.year - tr.year) > 1) diffs.push("year");
    if (titleKey(cw.journal) !== titleKey(tr.journal) && (tr.journalAbbrev === null || titleKey(cw.journal) !== titleKey(tr.journalAbbrev))) diffs.push("journal");
    if (firstAuthorOf(cw.authors) !== foldText(tr.firstAuthor).toLowerCase()) diffs.push("firstAuthor");
    if (titleKey(cw.title) !== titleKey(tr.title)) diffs.push("title");
    if (cw.volume !== null && tr.volume !== null && cw.volume !== tr.volume) diffs.push("volume");
    if (cw.pages !== null && tr.pages !== null && cw.pages !== tr.pages) diffs.push("pages");
    if (cw.doi !== null && tr.doi !== null && normalizeDoi(cw.doi) !== normalizeDoi(tr.doi)) diffs.push("doi");
    if (cw.pmid !== null && tr.pmid !== null && cw.pmid !== tr.pmid) diffs.push("pmid");
    if (cls === "wrong-metadata") {
      if (diffs.length === 0) err("wrong-metadata row does not differ from the registered record beyond L2 tolerance");
      if (!sameSet(diffs, ver.metadataMismatch)) err(`metadataMismatch [${ver.metadataMismatch.join(",")}] must equal computed [${diffs.join(",")}]`);
      if (!ver.metadataMismatch.every((f) => (METADATA_FIELDS as readonly string[]).includes(f))) err("metadataMismatch has an unknown field");
    } else if (diffs.length) {
      err(`citation as written differs from the registered record (${diffs.join(", ")}) but class is ${cls}`);
    }
  }
  return errors;
}

/** Identity keys of every work a row touches (cited identifiers, truth identifiers, related ids). */
export function rowWorkKeys(r: Pick<SuiteRow, "input" | "truth" | "relatedIds">): string[] {
  return [
    ...new Set([
      ...workKeys(r.input?.citation?.doi, r.input?.citation?.pmid),
      ...workKeys(r.truth?.doi, r.truth?.pmid),
      ...(Array.isArray(r.relatedIds) ? r.relatedIds.filter(isStr).map(normalizeId) : []),
    ]),
  ];
}

/** Whole-suite rules: unique ids; a source work never straddles the public/private split. */
export function validateSuite(rows: unknown[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const workSplit = new Map<string, string>();
  for (const raw of rows) {
    errors.push(...validateRow(raw));
    const r = raw as SuiteRow;
    if (isStr(r?.id)) {
      if (ids.has(r.id)) errors.push(`${r.id}: duplicate id`);
      ids.add(r.id);
    }
    if (isStr(r?.split) && isObj(r?.input)) {
      for (const key of rowWorkKeys(r)) {
        const prev = workSplit.get(key);
        if (prev && prev !== r.split) errors.push(`${r.id}: source ${key} appears in both splits`);
        workSplit.set(key, r.split);
      }
    }
  }
  return errors;
}
