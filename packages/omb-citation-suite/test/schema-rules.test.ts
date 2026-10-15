import { describe, expect, it } from "vitest";
import { expectedFor, triggersFrom } from "../src/expectations.ts";
import { validateRow, validateSuite } from "../src/schema.ts";
import type { SuiteRow } from "../src/types.ts";
import { ALL_CLASSES, rederive, synthRow } from "./helpers.ts";

const clone = (r: SuiteRow): SuiteRow => structuredClone(r);

describe("row schema rules", () => {
  it("a synthetic row of every class validates", () => {
    for (const cls of ALL_CLASSES) expect(validateRow(synthRow(cls)), cls).toEqual([]);
  });

  it("expectations must equal the policy function: no invalid row may accept a pass", () => {
    const r = clone(synthRow("negation"));
    r.expected.acceptVerdicts = ["block", "needs-owner", "pass"];
    expect(validateRow(r).join()).toMatch(/acceptVerdicts/);
    const v = clone(synthRow("correct-support"));
    v.expected = expectedFor("negation", true);
    expect(validateRow(v).join()).toMatch(/expected\.valid/);
  });

  it("evidence longer than 50 words or an anchor shorter than 8 words is refused", () => {
    const r = clone(synthRow("correct-support"));
    r.evidence.quote = Array.from({ length: 51 }, (_, i) => `w${i}`).join(" ");
    expect(validateRow(r).join()).toMatch(/51 words/);
    const s = clone(synthRow("correct-support"));
    s.input.quote = "too short to anchor";
    expect(validateRow(s).join()).toMatch(/at least 8 words/);
  });

  it("registry and retraction facts must agree with the class", () => {
    const f = clone(synthRow("fabricated-doi"));
    f.verification.registry = "registered";
    expect(validateRow(f).join()).toMatch(/not-registered/);
    const t = clone(synthRow("retracted"));
    t.verification.retraction = { retracted: false, notices: [] };
    expect(validateRow(t).join()).toMatch(/retraction notice/);
    const c = clone(synthRow("correct-support"));
    c.verification.retraction = { retracted: true, notices: [{ doi: "10.1/x", type: "retraction", source: "publisher", date: null }] };
    expect(validateRow(c).join()).toMatch(/only retracted rows/);
  });

  it("wrong-metadata rows must differ beyond L2 tolerance (year +/-1 is tolerated); abbreviations are not mismatches", () => {
    const m = clone(synthRow("wrong-metadata"));
    m.input.citation.year = 2021;
    expect(validateRow(m).join()).toMatch(/does not differ/);
    const other = clone(synthRow("negation"));
    other.input.citation.journal = "Another Journal";
    expect(validateRow(other).join()).toMatch(/differs from the registered record \(journal\)/);
    const ab = clone(synthRow("correct-support"));
    ab.input.citation.journal = "J Synth Res";
    expect(validateRow(ab)).toEqual([]);
  });

  it("anchor rules: verbatim except misquote; quote-cut anchor must be a strict fragment of the evidence", () => {
    const a = clone(synthRow("direction-flip"));
    a.verification.anchorFoundIn = [];
    expect(validateRow(a).join()).toMatch(/not found verbatim/);
    const m = clone(synthRow("misquote"));
    m.verification.anchorFoundIn = ["results"];
    expect(validateRow(m).join()).toMatch(/must NOT occur/);
    const q = clone(synthRow("quote-cut-qualifier"));
    q.input.quote = "a sentence that is not part of the evidence passage at all";
    expect(validateRow(q).join()).toMatch(/strict fragment/);
  });

  it("suite rules: unique ids; a work (DOI, PMID or related id) never straddles the split", () => {
    const a = synthRow("correct-support");
    const b = synthRow("direction-flip", { split: "private" });
    b.input.citation = { ...a.input.citation };
    b.truth = { ...a.truth! };
    expect(validateSuite([a, b]).join()).toMatch(/both splits/);
    expect(validateSuite([a, clone(a)]).join()).toMatch(/duplicate id/);
    const swap = synthRow("wrong-metadata", { split: "private", relatedIds: [a.truth!.doi!] });
    expect(validateSuite([a, swap]).join()).toMatch(/both splits/);
    const byPmid = synthRow("negation", { split: "private", relatedIds: [`pmid:${a.truth!.pmid}`] });
    expect(validateSuite([a, byPmid]).join()).toMatch(/pmid:/);
    expect(validateSuite([a, synthRow("negation")])).toEqual([]);
  });

  it("non-objects and missing blocks fail closed", () => {
    expect(validateRow(null)).toEqual(["row must be an object"]);
    const r = clone(synthRow("correct-support")) as unknown as Record<string, unknown>;
    delete r.verification;
    expect(validateRow(r).join()).toMatch(/verification must be an object/);
  });
});

describe("finding 1: section 7 policy is recomputed from the source window", () => {
  it("a contrast marker in a valid row's window makes needs-owner ideal and keeps pass acceptable", () => {
    const r = synthRow("correct-support", {
      adjudication: { ...synthRow("correct-support").adjudication, windows: [{ section: "results", citationMarker: false, markers: [{ marker: "but", position: "anchor" }] }] },
    });
    expect(r.adjudication.triggers).toEqual(["contrast-marker"]);
    expect(r.expected.verdict).toBe("needs-owner");
    expect(r.expected.acceptVerdicts.sort()).toEqual(["needs-owner", "pass"]);
    expect(r.expected.valid).toBe(true);
    expect(r.expected.acceptStatuses).toContain("needs-owner");
    expect(validateRow(r)).toEqual([]);
  });

  it("a valid row without open full text may be passed (abstract-supported) or routed to the owner", () => {
    const r = synthRow("correct-support", { source: { url: "https://example.org/a", license: "not open access; abstract only used", openAccess: false, fullText: false } });
    expect(r.expected).toMatchObject({ verdict: "pass", status: "abstract-supported", valid: true });
    expect(r.expected.acceptVerdicts.sort()).toEqual(["needs-owner", "pass"]);
    expect(validateRow(r)).toEqual([]);
  });

  it("recorded triggers or expectations that disagree with the windows are refused", () => {
    const r = clone(synthRow("correct-support"));
    r.adjudication.windows = [{ section: "results", citationMarker: false, markers: [{ marker: "however", position: "after" }] }];
    expect(validateRow(r).join()).toMatch(/triggers must be \[contrast-marker\]/);
    r.adjudication.triggers = ["contrast-marker"];
    expect(validateRow(r).join()).toMatch(/expected\.verdict must be needs-owner/);
  });

  it("a correct-support row anchored in an unmarked Discussion sentence is refused (author-proposal)", () => {
    const r = clone(synthRow("correct-support"));
    r.adjudication.windows = [{ section: "discussion", citationMarker: false, markers: [] }];
    const fixed = rederive(r);
    expect(validateRow(fixed).join()).toMatch(/author-proposal/);
    const marked = rederive({ ...clone(r), adjudication: { ...r.adjudication, windows: [{ section: "discussion", citationMarker: true, markers: [] }] } });
    expect(validateRow(marked)).toEqual([]);
  });

  it("triggersFrom distinguishes an only-Discussion anchor from one that also occurs elsewhere", () => {
    expect(triggersFrom([{ section: "discussion", citationMarker: false, markers: [] }])).toEqual(["author-proposal"]);
    expect(triggersFrom([{ section: "discussion", citationMarker: false, markers: [] }, { section: "abstract", citationMarker: false, markers: [] }])).toEqual(["author-proposal-elsewhere"]);
    const inv = synthRow("direction-flip", { adjudication: { ...synthRow("direction-flip").adjudication, windows: [{ section: "discussion", citationMarker: false, markers: [] }] } });
    expect(inv.expected.acceptStatuses).toContain("author-proposal");
  });
});

describe("finding 5: no identifier or title cue gives the class away", () => {
  it("upper-case DOIs are refused in citations and truth records", () => {
    const r = clone(synthRow("correct-support"));
    r.input.citation.doi = "10.5555/SYNTHETIC.UPPER";
    expect(validateRow(r).join()).toMatch(/lower case/);
    const f = clone(synthRow("fabricated-doi"));
    f.input.citation.doi = "10.1056/NEJMoa9999999";
    expect(validateRow(f).join()).toMatch(/lower case/);
  });

  it("a retracted work is cited by its original title, never with a RETRACTED mark", () => {
    const r = clone(synthRow("retracted"));
    r.input.citation.title = "RETRACTED: " + r.input.citation.title;
    expect(validateRow(r).join()).toMatch(/without retraction marks/);
    const ok = clone(synthRow("retracted"));
    ok.truth = { ...ok.truth!, title: "RETRACTED: " + ok.truth!.title }; // the publisher's current title
    expect(validateRow(ok)).toEqual([]);
  });

  it("a real reference without a PMID is valid (missing-PMID control)", () => {
    const r = clone(synthRow("correct-support"));
    r.input.citation.pmid = null;
    expect(validateRow(r)).toEqual([]);
  });
});

describe("finding 8: author proposals, flags and PMID-only references are expressible", () => {
  it("attributed-proposal needs an attribution verb; proposal-as-finding must not have one", () => {
    expect(synthRow("attributed-proposal").expected).toMatchObject({ verdict: "pass", status: "author-proposal", valid: true });
    expect(synthRow("proposal-as-finding").expected).toMatchObject({ verdict: "block", status: "author-proposal", valid: false });
    const a = clone(synthRow("attributed-proposal"));
    a.input.sentence = "The fictional biomarker is higher in synthetic cases [1].";
    expect(validateRow(a).join()).toMatch(/must attribute/);
    const p = clone(synthRow("proposal-as-finding"));
    p.input.sentence = "Example and colleagues suggested that the biomarker is higher [1].";
    expect(validateRow(p).join()).toMatch(/without an attribution verb/);
    const notDiscussion = rederive({ ...clone(synthRow("attributed-proposal")), adjudication: { ...synthRow("attributed-proposal").adjudication, windows: [{ section: "results", citationMarker: false, markers: [] }] } });
    expect(validateRow(notDiscussion).join()).toMatch(/only as an unmarked Discussion sentence/);
  });

  it("corrections, expressions of concern and preprints become required flags", () => {
    const r = synthRow("correct-support", {
      verification: {
        ...synthRow("correct-support").verification,
        updates: [
          { doi: "10.5555/c", type: "correction", source: "publisher", date: null },
          { doi: "10.5555/e", type: "expression_of_concern", source: "retraction-watch", date: null },
        ],
        workType: "posted-content",
      },
    });
    expect(r.expected.requiredFlags).toEqual(["correction", "expression-of-concern", "preprint"]);
    expect(validateRow(r)).toEqual([]);
    const tampered = clone(r);
    tampered.expected.requiredFlags = [];
    expect(validateRow(tampered).join()).toMatch(/requiredFlags/);
    // A "correction" event that is the retraction notice itself is not a separate correction flag.
    const ret = synthRow("retracted", {
      verification: { ...synthRow("retracted").verification, updates: [{ doi: "10.5555/notice", type: "correction", source: "publisher", date: null }] },
    });
    expect(ret.expected.requiredFlags).toEqual([]);
  });

  it("PMID-only references validate for real and fabricated works; a reference needs some identifier", () => {
    const r = clone(synthRow("correct-support"));
    r.input.citation.doi = null;
    expect(validateRow(r)).toEqual([]);
    const f = clone(synthRow("fabricated-doi"));
    f.input.citation = { ...f.input.citation, doi: null, pmid: "99999999" };
    expect(validateRow(f)).toEqual([]);
    const none = clone(synthRow("correct-support"));
    none.input.citation = { ...none.input.citation, doi: null, pmid: null };
    expect(validateRow(none).join()).toMatch(/needs a DOI or a PMID/);
    const swap = clone(synthRow("wrong-metadata"));
    swap.input.citation = { ...swap.input.citation, doi: null, year: 2020, pmid: "424242" };
    swap.verification.metadataMismatch = ["pmid"];
    expect(validateRow(swap)).toEqual([]);
  });
});
