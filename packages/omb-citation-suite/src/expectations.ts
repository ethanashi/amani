// Expected verifier outcome per class, from internal design notes (not published) section 7 (layers L1-L5) and
// section 13 acceptance item 5 ("caught or sent to the owner"). The disposition is a function of
// (class, open full text, section-7 triggers found in the anchor's source window, required flags);
// schema validation recomputes it, so every row's copy must equal this function's output.
//
// Section 7 policy applied here:
//   * L5a: any contrast or hedging marker in the three-sentence window routes the row to the owner.
//     For a valid row that makes `needs-owner` the ideal verdict, with `pass` still acceptable (the
//     source does support the sentence; routing costs owner time, not correctness).
//   * L4: an unmarked Discussion anchor is `author-proposal`: it may back an attributed sentence
//     ("X proposed that ...") but never a finding.

import { FAILURE_CLASSES, VALID_CLASSES, type Expected, type Factual, type FailureClass, type Flag, type SourceWindow, type Status, type Trigger, type Verdict } from "./types.ts";

const CAUGHT: Verdict[] = ["block", "needs-owner"];

interface ClassRule {
  verdict: Verdict;
  status: Status;
  acceptStatuses: Status[];
  safePassStatuses?: Status[];
  factual: Factual;
  layer: string;
  description: string;
}

export const CLASS_RULES: Record<FailureClass, ClassRule> = {
  "correct-support": {
    verdict: "pass",
    status: "fulltext-verified",
    acceptStatuses: ["fulltext-verified", "abstract-supported"],
    factual: "supported",
    layer: "L4 pass",
    description: "The cited work supports the sentence (same direction, species, population and numbers).",
  },
  "attributed-proposal": {
    verdict: "pass",
    status: "author-proposal",
    acceptStatuses: ["author-proposal"],
    factual: "supported",
    layer: "L4 author-proposal",
    description: "An unmarked Discussion proposal backs a sentence that attributes it (\"X proposed that ...\").",
  },
  "proposal-as-finding": {
    verdict: "block",
    status: "author-proposal",
    acceptStatuses: ["author-proposal", "source-contradicts", "needs-owner"],
    factual: "speculative",
    layer: "L4 author-proposal",
    description: "An unmarked Discussion proposal is cited for a sentence that states it as a finding.",
  },
  "direction-flip": {
    verdict: "block",
    status: "source-contradicts",
    acceptStatuses: ["source-contradicts", "needs-owner"],
    factual: "contradicted",
    layer: "L5a direction words",
    description: "The sentence reverses the direction reported by the source.",
  },
  negation: {
    verdict: "block",
    status: "source-contradicts",
    acceptStatuses: ["source-contradicts", "needs-owner"],
    factual: "contradicted",
    layer: "L5a negation",
    description: "The sentence negates the source's finding, or asserts an effect where the source found none.",
  },
  "wrong-species": {
    verdict: "block",
    status: "source-contradicts",
    acceptStatuses: ["source-contradicts", "needs-owner"],
    factual: "exceeds-source",
    layer: "L5a species",
    description: "An animal or cell-model result is cited as a finding in humans or patients.",
  },
  "fabricated-doi": {
    verdict: "block",
    status: "not-found",
    // Some invented references carry a real but unrelated PMID; reporting that as a metadata
    // mismatch is a coherent reason to block, so it counts as agreeing.
    acceptStatuses: ["not-found", "metadata-mismatch"],
    factual: "no-source",
    layer: "L1 existence",
    description: "The identifier (DOI, or PMID for a PMID-only reference) does not resolve.",
  },
  "wrong-metadata": {
    verdict: "block",
    status: "metadata-mismatch",
    acceptStatuses: ["metadata-mismatch"],
    factual: "defective-reference",
    layer: "L2 metadata",
    description: "Year (beyond +/-1), journal, first author, title or volume/pages do not match the identifier's record, or the identifier belongs to another paper.",
  },
  retracted: {
    verdict: "block",
    status: "retracted",
    acceptStatuses: ["retracted"],
    factual: "retracted-source",
    layer: "L3 status",
    description: "The cited work has been retracted (Crossref updated-by / Retraction Watch).",
  },
  misquote: {
    verdict: "block",
    status: "misquoted",
    acceptStatuses: ["misquoted", "source-contradicts", "needs-owner"],
    factual: "contradicted",
    layer: "L4 quote anchor",
    description: "The quoted wording does not occur in the source and shifts its meaning.",
  },
  "quote-cut-qualifier": {
    verdict: "needs-owner",
    status: "needs-owner",
    acceptStatuses: ["needs-owner", "source-contradicts", "misquoted"],
    factual: "qualified",
    layer: "L4 whole-sentence extension + L5a contrast marker",
    description: "A verbatim fragment whose full source sentence continues with a qualifier that undermines it.",
  },
  "secondary-citation": {
    verdict: "block",
    status: "secondary-citation",
    acceptStatuses: ["secondary-citation"],
    factual: "secondary",
    layer: "L4 source section / citation marker",
    description: "A primary finding is cited to a review or to another paper's introduction that cites the primary work.",
  },
  "abstract-only-direction": {
    verdict: "needs-owner",
    status: "abstract-supported",
    acceptStatuses: ["abstract-supported", "needs-owner"],
    safePassStatuses: ["abstract-supported"],
    factual: "abstract-only",
    layer: "L4 abstract-supported marking",
    description: "A direction or effect-size claim backed only by an abstract (no open full text); must be marked or routed.",
  },
  "wrong-numeric": {
    verdict: "block",
    status: "source-contradicts",
    acceptStatuses: ["source-contradicts", "needs-owner"],
    factual: "contradicted",
    layer: "L5a / [l:] literature facts",
    description: "A number in the sentence differs from the source.",
  },
  "overgeneralised-population": {
    verdict: "block",
    status: "source-contradicts",
    acceptStatuses: ["source-contradicts", "needs-owner"],
    factual: "exceeds-source",
    layer: "L5a population",
    description: "A result from a restricted population is generalised beyond it.",
  },
};

// Keep CLASS_RULES and FAILURE_CLASSES in lock step.
for (const c of FAILURE_CLASSES) if (!CLASS_RULES[c]) throw new Error(`no class rule for ${c}`);

/** Verdict/status combinations a section-7 verifier can coherently emit. Anything else is malformed. */
export const COMPATIBLE_STATUSES: Record<Verdict, readonly Status[]> = {
  pass: ["fulltext-verified", "abstract-supported", "author-proposal"],
  block: ["not-found", "metadata-mismatch", "retracted", "misquoted", "source-contradicts", "secondary-citation", "author-proposal"],
  "needs-owner": [
    "not-found",
    "metadata-mismatch",
    "retracted",
    "fulltext-verified",
    "abstract-supported",
    "misquoted",
    "source-contradicts",
    "secondary-citation",
    "author-proposal",
    "needs-owner",
  ],
};

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

/**
 * The expectation a row must carry. `triggers` come from the anchor's source windows; `requiredFlags`
 * from the work's Crossref update record (corrections, expressions of concern) and type (preprint).
 */
export function expectedFor(cls: FailureClass, fullText: boolean, triggers: readonly Trigger[] = [], requiredFlags: readonly Flag[] = []): Expected {
  const rule = CLASS_RULES[cls];
  const isValid = VALID_CLASSES.includes(cls);
  let verdict = rule.verdict;
  let acceptVerdicts: Verdict[] = isValid ? ["pass"] : [...CAUGHT];
  const status: Status = cls === "correct-support" && !fullText ? "abstract-supported" : rule.status;
  let acceptStatuses: Status[] = [...rule.acceptStatuses];
  if (isValid && !fullText) {
    // Section 7: abstract-supported passes but is marked; acceptance item 5 lets a direction claim
    // backed only by an abstract be sent to the owner. Both are acceptable for a valid row.
    acceptVerdicts = uniq([...acceptVerdicts, "needs-owner"]);
    acceptStatuses = uniq([...acceptStatuses, "needs-owner"]);
  }
  if (triggers.includes("contrast-marker")) {
    // L5a: a marker routes to the owner. For a valid row that is the ideal; pass stays acceptable.
    if (isValid) verdict = "needs-owner";
    acceptVerdicts = uniq([...acceptVerdicts, "needs-owner"]);
    acceptStatuses = uniq([...acceptStatuses, "needs-owner"]);
  }
  if (!isValid && (triggers.includes("author-proposal") || triggers.includes("author-proposal-elsewhere"))) {
    acceptStatuses = uniq([...acceptStatuses, "author-proposal"]);
  }
  return {
    valid: acceptVerdicts.includes("pass"),
    verdict,
    acceptVerdicts,
    status,
    acceptStatuses,
    safePassStatuses: [...(rule.safePassStatuses ?? [])],
    requiredFlags: [...requiredFlags].sort(),
  };
}

/** Section 7 triggers from the anchor's recorded source windows. */
export function triggersFrom(windows: readonly SourceWindow[]): Trigger[] {
  const out: Trigger[] = [];
  if (windows.some((w) => w.markers.length > 0)) out.push("contrast-marker");
  const proposals = windows.filter((w) => w.section === "discussion" && !w.citationMarker);
  if (proposals.length > 0) out.push(proposals.length === windows.length ? "author-proposal" : "author-proposal-elsewhere");
  return out;
}
