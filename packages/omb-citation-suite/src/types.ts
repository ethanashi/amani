// PW4s row model. One row = one manuscript sentence + one citation + the expected verdict.
// Statuses follow internal design notes (not published) section 7. L1-L3 outcomes have no names in section 7,
// so this suite names them `not-found` (L1), `metadata-mismatch` (L2) and `retracted` (L3).
//
// v2 separates two things the v1 rows conflated:
//   * factual support (`adjudication.factual`): what the cited source says relative to the sentence;
//   * policy disposition (`expected`): what a section-7 verifier must do, which also depends on the
//     anchor's source window (contrast/hedging markers route to the owner; an unmarked Discussion
//     anchor is an `author-proposal`). Software recomputes the disposition from the recorded window.

export const FAILURE_CLASSES = [
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
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

/** Classes whose citation is acceptable: a plain `pass` is a correct outcome. */
export const VALID_CLASSES: readonly FailureClass[] = ["correct-support", "attributed-proposal"];

export const DOMAINS = ["als", "neurology", "cancer", "cardiometabolic", "genetics-mr", "ml-prediction"] as const;
export type Domain = (typeof DOMAINS)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Verifier verdicts. `needs-owner` = routed to the owner (L5 contrast/hedge marker or judge disagreement). */
export const VERDICTS = ["pass", "needs-owner", "block"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const STATUSES = [
  // L1 existence, L2 metadata, L3 status (suite names; section 7 says these layers block)
  "not-found",
  "metadata-mismatch",
  "retracted",
  // L4 quote anchor (section 7 names)
  "fulltext-verified",
  "abstract-supported",
  "misquoted",
  "source-contradicts",
  "secondary-citation",
  "author-proposal",
  // L5 routing
  "needs-owner",
] as const;
export type Status = (typeof STATUSES)[number];

/** Section 7 L3: corrections, expressions of concern and preprint versions are shown (not blocking). */
export const FLAGS = ["correction", "expression-of-concern", "preprint"] as const;
export type Flag = (typeof FLAGS)[number];

/** Section 7 L5a contrast and hedging markers (exact list). Any one in the window routes to the owner. */
export const CONTRAST_MARKERS = ["however", "but", "contrary to", "did not", "no evidence", "failed to", "not supported"] as const;

/** Section 7 policy triggers recorded per row. */
export const TRIGGERS = ["contrast-marker", "author-proposal", "author-proposal-elsewhere"] as const;
export type Trigger = (typeof TRIGGERS)[number];

/** What the cited source says relative to the sentence, independent of section 7 routing. */
export const FACTUAL = [
  "supported", // the source establishes the sentence (or, for attributed proposals, the authors did propose it)
  "contradicted", // direction, negation, number or wording conflicts with the source
  "exceeds-source", // species or population broader than the source
  "qualified", // the full source sentence qualifies or withdraws the quoted fragment
  "speculative", // the source only proposes it, the sentence states it as a finding
  "secondary", // the source reports someone else's finding
  "abstract-only", // matches the abstract; full text not openly readable
  "defective-reference", // text may support it, but the reference as written is wrong
  "retracted-source", // the source is retracted
  "no-source", // the reference does not exist
] as const;
export type Factual = (typeof FACTUAL)[number];

export const SPLITS = ["public", "private"] as const;
export type Split = (typeof SPLITS)[number];

/** Where the deciding evidence lives. Text sections come from JATS full text or the abstract. */
export const EVIDENCE_SECTIONS = [
  "abstract",
  "introduction",
  "methods",
  "results",
  "discussion",
  "other",
  "title",
  "registry",
  "metadata",
  "retraction-notice",
] as const;
export type EvidenceSection = (typeof EVIDENCE_SECTIONS)[number];
export const TEXT_SECTIONS: readonly EvidenceSection[] = ["abstract", "introduction", "methods", "results", "discussion", "other", "title"];

export interface CitationAsWritten {
  /** Lower case. Null for a PMID-only reference. At least one of doi and pmid is set. */
  doi: string | null;
  pmid: string | null;
  authors: string;
  year: number;
  title: string;
  journal: string;
  volume: string | null;
  issue: string | null;
  pages: string | null;
}

/** What the verifier under test receives for each row. Nothing else. */
export interface VerifierInput {
  id: string;
  sentence: string;
  /** The anchor span the drafter offers from the cited work (at least 8 words). */
  quote: string;
  citation: CitationAsWritten;
}

export interface Expected {
  /** True when a plain `pass` is an acceptable outcome (pass is in acceptVerdicts). */
  valid: boolean;
  verdict: Verdict;
  acceptVerdicts: Verdict[];
  status: Status;
  acceptStatuses: Status[];
  /** Invalid rows only: a `pass` carrying one of these statuses is a flagged pass, not a false pass. */
  safePassStatuses: Status[];
  /** Section 7 L3 flags the verifier must show for this citation. */
  requiredFlags: Flag[];
}

export interface Evidence {
  section: EvidenceSection;
  /** At most 50 words. Verbatim source text for text sections; a registry statement otherwise. */
  quote: string;
}

export interface TruthRecord {
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  firstAuthor: string;
  year: number;
  title: string;
  journal: string;
  /** NLM/ISO abbreviation; a citation may use either form. */
  journalAbbrev: string | null;
  volume: string | null;
  pages: string | null;
}

export interface SourceInfo {
  url: string;
  license: string;
  openAccess: boolean;
  fullText: boolean;
}

export interface RetractionNotice {
  doi: string;
  type: string;
  source: string;
  date: string | null;
}

export interface WindowMarker {
  marker: (typeof CONTRAST_MARKERS)[number];
  position: "before" | "anchor" | "after";
}

/** One place the anchor occurs: the sentence before, the anchor's whole sentence(s), the sentence after. */
export interface SourceWindow {
  section: string;
  /** A citation marker (reference number or author-year xref) inside the anchor's sentence(s). */
  citationMarker: boolean;
  markers: WindowMarker[];
}

export interface Adjudication {
  factual: Factual;
  /** Every location of the anchor in the source (empty for fabricated references). */
  windows: SourceWindow[];
  /** sha256 of the folded window texts; a re-check detects a changed source. */
  windowSha256: string | null;
  /** Section 7 policy triggers derived from `windows` (recomputed by the schema). */
  triggers: Trigger[];
  /** One line: why the expected disposition follows. */
  disposition: string;
}

export interface Verification {
  /** ISO date the row was checked against the live APIs. */
  checkedAt: string;
  /** APIs consulted, e.g. crossref, crossref-agency, europepmc-record, europepmc-fulltext, pubmed. */
  methods: string[];
  registry: "registered" | "not-registered";
  /** Retraction, withdrawal and removal notices only. */
  retraction: { retracted: boolean; notices: RetractionNotice[] };
  /** Every other Crossref update to the work (corrections, errata, expressions of concern). */
  updates: RetractionNotice[];
  /** Crossref work type (journal-article, posted-content for preprints, ...); null for PMID-only works without a DOI. */
  workType: string | null;
  /** Section kinds where evidence.quote was found verbatim (after NFKC/dash/whitespace folding). */
  evidenceFoundIn: string[];
  /** Section kinds where the anchor quote was found verbatim; empty for misquote and fabricated rows. */
  anchorFoundIn: string[];
  /** wrong-metadata rows: citation fields that differ from the registered record. */
  metadataMismatch: string[];
  notes: string;
}

export interface SuiteRow {
  id: string;
  split: Split;
  class: FailureClass;
  domain: Domain;
  difficulty: Difficulty;
  input: Omit<VerifierInput, "id">;
  expected: Expected;
  adjudication: Adjudication;
  evidence: Evidence;
  /** retracted rows: the passage the sentence paraphrases. */
  evidenceText: Evidence | null;
  plant: string;
  truth: TruthRecord | null;
  /** Other works the row involves (DOIs or "pmid:N"): a swapped identifier's intended paper, a review's primary study. */
  relatedIds: string[];
  source: SourceInfo;
  verification: Verification;
}

export interface VerifierResult {
  id: string;
  verdict: Verdict;
  status: Status;
  flags: string[];
}
