import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expectedFor, triggersFrom } from "../src/expectations.ts";
import { flagsFrom } from "../src/schema.ts";
import { PACKAGE_DIR } from "../src/seal.ts";
import { CLASS_RULES } from "../src/expectations.ts";
import type { FailureClass, SourceWindow, SuiteRow } from "../src/types.ts";

/** Temp dirs live in the package's gitignored test/.tmp-* (seal.py needs a grading root under $HOME). */
export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(PACKAGE_DIR, "test", ".tmp-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let counter = 0;

/** Recompute the derived fields (triggers, expectation, disposition) after editing a synthetic row. */
export function rederive(r: SuiteRow): SuiteRow {
  const triggers = triggersFrom(r.adjudication.windows);
  return {
    ...r,
    expected: expectedFor(r.class, r.source.fullText, triggers, flagsFrom(r.verification)),
    adjudication: { ...r.adjudication, triggers, disposition: r.adjudication.disposition || "synthetic" },
  };
}

/** A synthetic, schema-valid row of the given class (fictional content, never a real suite row). */
export function synthRow(cls: FailureClass, over: Partial<SuiteRow> = {}): SuiteRow {
  counter++;
  const id = "pw4s-" + (0xa00000 + counter).toString(16);
  const doi = `10.5555/synthetic.${counter}`;
  const truth = {
    doi,
    pmid: String(1000 + counter),
    pmcid: "PMC9" + counter,
    firstAuthor: "Example",
    year: 2020,
    title: `Synthetic study number ${counter} of a fictional biomarker`,
    journal: "Journal of Synthetic Results",
    journalAbbrev: "J Synth Res",
    volume: "1",
    pages: "1-10",
  };
  const citation = {
    doi,
    pmid: truth.pmid,
    authors: "Example A, Sample B, et al.",
    year: 2020,
    title: truth.title,
    journal: truth.journal,
    volume: "1",
    issue: "1",
    pages: "1-10",
  };
  const evidenceSentence = `The fictional biomarker ${counter} was higher in synthetic cases than in synthetic controls in this cohort.`;
  const fullText = cls !== "abstract-only-direction";
  const proposal = cls === "attributed-proposal" || cls === "proposal-as-finding";
  const window: SourceWindow = { section: proposal ? "discussion" : fullText ? "results" : "abstract", citationMarker: false, markers: [] };
  const base: SuiteRow = {
    id,
    split: "public",
    class: cls,
    domain: "als",
    difficulty: "medium",
    input: {
      sentence: `The fictional biomarker ${counter} is higher in synthetic cases than in synthetic controls [1].`,
      quote: evidenceSentence,
      citation,
    },
    expected: expectedFor(cls, fullText),
    adjudication: { factual: CLASS_RULES[cls].factual, windows: [window], windowSha256: "0".repeat(64), triggers: [], disposition: "synthetic" },
    evidence: { section: window.section as SuiteRow["evidence"]["section"], quote: evidenceSentence },
    evidenceText: null,
    plant: cls === "correct-support" || cls === "attributed-proposal" ? "" : "synthetic plant",
    truth,
    relatedIds: [],
    source: { url: `https://example.org/${counter}`, license: "cc by", openAccess: fullText, fullText },
    verification: {
      checkedAt: "2026-10-11",
      methods: ["crossref", "europepmc-fulltext"],
      registry: "registered",
      retraction: { retracted: false, notices: [] },
      updates: [],
      workType: "journal-article",
      evidenceFoundIn: [window.section],
      anchorFoundIn: [window.section],
      metadataMismatch: [],
      notes: "",
    },
  };
  switch (cls) {
    case "fabricated-doi":
      base.truth = null;
      base.evidence = { section: "registry", quote: "agency(DOI) = None" };
      base.verification.registry = "not-registered";
      base.verification.evidenceFoundIn = [];
      base.verification.anchorFoundIn = [];
      base.verification.workType = null;
      base.adjudication = { ...base.adjudication, windows: [], windowSha256: null };
      break;
    case "wrong-metadata":
      base.input.citation = { ...citation, year: 2017 };
      base.evidence = { section: "metadata", quote: "Crossref: year 2020" };
      base.verification.metadataMismatch = ["year"];
      break;
    case "retracted":
      base.evidence = { section: "retraction-notice", quote: "10.5555/notice, type retraction, source retraction-watch" };
      base.evidenceText = { section: "results", quote: evidenceSentence };
      base.verification.retraction = { retracted: true, notices: [{ doi: "10.5555/notice", type: "retraction", source: "retraction-watch", date: "2021-01-01" }] };
      break;
    case "misquote":
      base.input.quote = `The fictional biomarker ${counter} caused disease in synthetic cases in this cohort.`;
      base.verification.anchorFoundIn = [];
      break;
    case "quote-cut-qualifier":
      base.input.quote = `The fictional biomarker ${counter} was higher in synthetic cases than in synthetic controls`;
      base.evidence = { section: "results", quote: `The fictional biomarker ${counter} was higher in synthetic cases than in synthetic controls, but this was not supported by our data.` };
      base.adjudication.windows = [{ ...window, markers: [{ marker: "but", position: "anchor" }, { marker: "not supported", position: "anchor" }] }];
      break;
    case "secondary-citation":
      base.relatedIds = [`10.5555/primary.${counter}`];
      break;
    case "attributed-proposal":
      base.input.sentence = `Example and colleagues proposed that the fictional biomarker ${counter} is higher in synthetic cases [1].`;
      break;
    default:
      break;
  }
  return rederive({ ...base, ...over });
}

export const ALL_CLASSES: FailureClass[] = [
  "correct-support",
  "attributed-proposal",
  "direction-flip",
  "negation",
  "wrong-species",
  "fabricated-doi",
  "wrong-metadata",
  "retracted",
  "misquote",
  "quote-cut-qualifier",
  "secondary-citation",
  "abstract-only-direction",
  "wrong-numeric",
  "overgeneralised-population",
  "proposal-as-finding",
];
