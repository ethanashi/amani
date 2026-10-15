import { describe, expect, it } from "vitest";
import { clopperPearson } from "../src/binomial.ts";
import { formatReport, parseResults, resultProblem, scoreSuite } from "../src/scorer.ts";
import type { Status, SuiteRow, Verdict, VerifierResult } from "../src/types.ts";
import { ALL_CLASSES, synthRow } from "./helpers.ts";

type Pick = { verdict: Verdict; status?: Status; flags?: string[] };
function results(rows: SuiteRow[], pick: (r: SuiteRow) => Pick) {
  return new Map<string, VerifierResult | "malformed">(rows.map((r) => {
    const p = pick(r);
    const status = p.status ?? (p.verdict === "pass" ? "fulltext-verified" : p.verdict === "block" ? "source-contradicts" : "needs-owner");
    return [r.id, { id: r.id, verdict: p.verdict, status, flags: p.flags ?? r.expected.requiredFlags }];
  }));
}
const ideal = (r: SuiteRow): Pick => ({ verdict: r.expected.verdict, status: r.expected.status });

// 15 classes; 4 rows per valid class, 2 per invalid class; alternate public/private.
function fixture(): SuiteRow[] {
  const rows: SuiteRow[] = [];
  for (const cls of ALL_CLASSES) {
    const n = cls === "correct-support" || cls === "attributed-proposal" ? 4 : 2;
    for (let i = 0; i < n; i++) rows.push(synthRow(cls, { split: i % 2 ? "private" : "public" }));
  }
  return rows;
}

describe("scoreSuite", () => {
  it("a perfect verifier: zero false passes and blocks; admission still needs enough held-out rows", () => {
    const rows = fixture();
    const rep = scoreSuite(rows, results(rows, ideal), { verifierId: "v1" });
    expect(rep.complete).toBe(true);
    expect(rep.pooled.falsePass).toMatchObject({ k: 0, n: 26 });
    expect(rep.pooled.falseBlock).toMatchObject({ k: 0, n: 8 });
    expect(rep.pooled.statusAgreement.k).toBe(34);
    expect(rep.heldOut!.falsePass).toMatchObject({ k: 0, n: 13 });
    // 0/13 held-out invalid rows: upper bound 24.7%, so the 5% target is not met.
    expect(rep.target.falsePassUpper).toBeCloseTo(1 - 0.025 ** (1 / 13), 12);
    expect(rep.target.met).toBe(false);
    expect(rep.target.admitted).toBe(false);
  });

  it("an always-pass verifier passes every invalid row; always-block blocks every valid row", () => {
    const rows = fixture();
    const pass = scoreSuite(rows, results(rows, () => ({ verdict: "pass", status: "fulltext-verified" })));
    expect(pass.pooled.falsePass).toMatchObject({ k: 26, n: 26, rate: 1 });
    expect(pass.byClass["retracted"]!.falsePass).toMatchObject({ k: 2, n: 2 });
    const block = scoreSuite(rows, results(rows, () => ({ verdict: "block", status: "source-contradicts" })));
    expect(block.pooled.falsePass.k).toBe(0);
    expect(block.pooled.falseBlock).toMatchObject({ k: 8, n: 8, rate: 1 });
    expect(block.target.gate.validHandledOk).toBe(false);
  });

  it("needs-owner on a valid row counts as handled only where section 7 routes it", () => {
    const plain = synthRow("correct-support", { split: "private" });
    const routed = synthRow("correct-support", {
      split: "private",
      adjudication: { ...synthRow("correct-support").adjudication, windows: [{ section: "results", citationMarker: false, markers: [{ marker: "did not", position: "after" }] }] },
    });
    const rep = scoreSuite([plain, routed], results([plain, routed], () => ({ verdict: "needs-owner", status: "fulltext-verified" })));
    expect(rep.pooled.falseBlock.k).toBe(0);
    expect(rep.pooled.ownerRouted).toMatchObject({ k: 2, n: 2 });
    expect(rep.pooled.validHandled).toMatchObject({ k: 1, n: 2 });
  });

  it("an abstract-supported pass on an abstract-only direction claim is a flagged pass, not a false pass", () => {
    const rows = [synthRow("abstract-only-direction"), synthRow("abstract-only-direction")];
    const rep = scoreSuite(rows, results(rows, (r) => ({ verdict: "pass", status: r === rows[0] ? "abstract-supported" : "fulltext-verified" })));
    expect(rep.pooled.flaggedPasses).toBe(1);
    expect(rep.pooled.falsePass).toMatchObject({ k: 1, n: 2 });
  });

  it("missing and malformed outputs count as the worst outcome and mark the run incomplete", () => {
    const rows = fixture();
    const res = results(rows, ideal);
    const invalidRow = rows.find((r) => r.class === "retracted")!;
    const validRow = rows.find((r) => r.class === "correct-support")!;
    res.delete(invalidRow.id);
    res.set(validRow.id, "malformed");
    res.set("pw4s-ffffff", { id: "pw4s-ffffff", verdict: "pass", status: "fulltext-verified", flags: [] });
    const rep = scoreSuite(rows, res, { verifierId: "v1" });
    expect(rep.complete).toBe(false);
    expect([rep.missing, rep.malformed]).toEqual([1, 1]);
    expect(rep.pooled.falsePass.k).toBe(1);
    expect(rep.pooled.falseBlock.k).toBe(1);
    expect(rep.unexpectedIds).toEqual(["pw4s-ffffff"]);
    expect(rep.target.admitted).toBe(false);
  });

  it("per-class rates carry Clopper-Pearson intervals; private failures are counted, not listed", () => {
    const rows = fixture();
    const negs = rows.filter((r) => r.class === "negation");
    const pick = (r: SuiteRow): Pick => (r.class === "negation" ? { verdict: "pass" } : ideal(r));
    const rep = scoreSuite(rows, results(rows, pick));
    const g = rep.byClass["negation"]!;
    expect(g.falsePass).toMatchObject({ k: 2, n: 2, rate: 1 });
    expect([g.falsePass.lower, g.falsePass.upper]).toEqual(clopperPearson(2, 2));
    expect(rep.failures.map((f) => f.id)).toEqual(negs.filter((r) => r.split === "public").map((r) => r.id));
    expect(rep.privateFailureCount).toBe(1);
    expect(scoreSuite(rows, results(rows, pick), { revealPrivateRows: true }).failures).toHaveLength(2);
    expect(formatReport(rep)).toContain("1 private failures counted only");
  });
});

describe("finding 3: admission is decided on held-out rows, per row and per work cluster", () => {
  // 80 private invalid rows from 80 distinct works and 20 valid private rows; public rows on top.
  function heldOutSuite() {
    const priv = [
      ...Array.from({ length: 80 }, () => synthRow("direction-flip", { split: "private" })),
      ...Array.from({ length: 20 }, () => synthRow("correct-support", { split: "private" })),
    ];
    const pub = [...Array.from({ length: 33 }, () => synthRow("correct-support")), ...Array.from({ length: 20 }, () => synthRow("negation"))];
    return { priv, pub, all: [...pub, ...priv] };
  }

  it("a perfect frozen verifier on enough unseen works is admitted; without a verifier id it is not", () => {
    const { all } = heldOutSuite();
    const rep = scoreSuite(all, results(all, ideal), { verifierId: "commit-abc" });
    expect(rep.heldOut!.falsePass).toMatchObject({ k: 0, n: 80 });
    expect(rep.heldOut!.clusterFalsePass).toMatchObject({ k: 0, n: 80 });
    expect(rep.target.admitted).toBe(true);
    expect(scoreSuite(all, results(all, ideal)).target.reasons).toContain("no frozen verifier id");
  });

  it("the reviewer's case: perfect on public rows, poor on private positives, everything else routed -> not admitted", () => {
    const { all } = heldOutSuite();
    let privPos = 0;
    const rep = scoreSuite(all, results(all, (r) => {
      if (r.split === "public") return ideal(r);
      if (r.expected.valid) return privPos++ < 5 ? { verdict: "pass" } : { verdict: "needs-owner", status: "needs-owner" };
      return { verdict: "needs-owner", status: "needs-owner" };
    }), { verifierId: "v" });
    expect(rep.pooled.validHandled.rate).toBeGreaterThan(0.6); // the pooled view looks acceptable
    expect(rep.heldOut!.validHandled).toMatchObject({ k: 5, n: 20 });
    expect(rep.target.admitted).toBe(false);
    expect(rep.target.reasons.join()).toMatch(/valid rows handled below gate/);
  });

  it("scoring only the public split never admits", () => {
    const { pub } = heldOutSuite();
    const rep = scoreSuite(pub, results(pub, ideal), { verifierId: "v" });
    expect(rep.heldOut).toBeNull();
    expect(rep.target.admitted).toBe(false);
    expect(rep.target.reasons.join()).toMatch(/no held-out rows/);
  });

  it("rows from one work are one cluster: many failing rows of one paper cannot hide behind row counts", () => {
    const shared = synthRow("direction-flip", { split: "private" });
    const sameWork = Array.from({ length: 5 }, () => {
      const r = synthRow("negation", { split: "private" });
      return { ...r, input: { ...r.input, citation: { ...shared.input.citation } }, truth: { ...shared.truth! } } as SuiteRow;
    });
    const others = Array.from({ length: 9 }, () => synthRow("wrong-numeric", { split: "private" }));
    const rows = [shared, ...sameWork, ...others];
    const rep = scoreSuite(rows, results(rows, (r) => (r === shared || sameWork.includes(r) ? { verdict: "pass" } : ideal(r))));
    expect(rep.heldOut!.falsePass).toMatchObject({ k: 6, n: 15 });
    expect(rep.heldOut!.clusterFalsePass).toMatchObject({ k: 1, n: 10 });
  });

  it("the target is judged on upper bounds: 0/80 meets 5%, 1/80 does not", () => {
    const { all, priv } = heldOutSuite();
    const one = results(all, ideal);
    const victim = priv[0]!;
    one.set(victim.id, { id: victim.id, verdict: "pass", status: "fulltext-verified", flags: [] });
    const rep = scoreSuite(all, one, { verifierId: "v" });
    expect(rep.heldOut!.falsePass.k).toBe(1);
    expect(rep.target.met).toBe(false);
    expect(scoreSuite(all, one, { verifierId: "v", maxFalsePassRate: 0.07 }).target.met).toBe(true);
  });
});

describe("finding 4: statuses must be present and coherent with the verdict", () => {
  it("contradictory or absent statuses are malformed", () => {
    expect(resultProblem("pass", "retracted")).toMatch(/contradicts/);
    expect(resultProblem("block", "fulltext-verified")).toMatch(/contradicts/);
    expect(resultProblem("pass", null)).toMatch(/missing status/);
    expect(resultProblem("block", "mystery")).toMatch(/unknown status/);
    expect(resultProblem("needs-owner", "retracted")).toBeNull();
    expect(resultProblem("pass", "author-proposal")).toBeNull();
  });

  it("the reviewer's attack (expected verdicts, status retracted on valid rows, null elsewhere) is not admitted", () => {
    const rows = [
      ...Array.from({ length: 80 }, () => synthRow("direction-flip", { split: "private" })),
      ...Array.from({ length: 20 }, () => synthRow("correct-support", { split: "private" })),
    ];
    const text = rows.map((r) => JSON.stringify({ id: r.id, verdict: r.expected.verdict, status: r.expected.valid ? "retracted" : null })).join("\n");
    const { results: res, errors } = parseResults(text);
    expect(errors).toHaveLength(100);
    const rep = scoreSuite(rows, res, { verifierId: "v" });
    expect(rep.malformed).toBe(100);
    expect(rep.target.admitted).toBe(false);
    // Coherent verdicts with wrong reasons also fail the status gate.
    const wrongReasons = new Map(rows.map((r) => [r.id, { id: r.id, verdict: r.expected.verdict, status: (r.expected.valid ? "abstract-supported" : "secondary-citation") as Status, flags: [] } as VerifierResult]));
    const rep2 = scoreSuite(rows, wrongReasons, { verifierId: "v" });
    expect(rep2.complete).toBe(true);
    expect(rep2.target.gate.statusAgreementOk).toBe(false);
    expect(rep2.target.admitted).toBe(false);
  });
});

describe("finding 8: required section 7 flags are measured", () => {
  it("flag recall counts rows whose required flags were all shown", () => {
    const flagged = (id: number) =>
      synthRow("correct-support", {
        split: "private",
        verification: { ...synthRow("correct-support").verification, updates: [{ doi: `10.5555/c${id}`, type: "expression_of_concern", source: "rw", date: null }] },
      });
    const rows = [flagged(1), flagged(2), synthRow("correct-support", { split: "private" })];
    const rep = scoreSuite(rows, results(rows, (r) => ({ verdict: "pass", flags: r === rows[0] ? ["expression-of-concern"] : [] })));
    expect(rep.heldOut!.flagRecall).toMatchObject({ k: 1, n: 2 });
    expect(rep.target.gate.flagRecallOk).toBe(false);
  });

  it("flags must be an array of strings", () => {
    const { results: res } = parseResults('{"id":"x","verdict":"pass","status":"fulltext-verified","flags":"preprint"}');
    expect(res.get("x")).toBe("malformed");
  });
});

describe("parseResults", () => {
  it("accepts JSON arrays and JSONL and normalises case", () => {
    const a = parseResults('[{"id":"x","verdict":"PASS","status":"Fulltext-Verified","flags":["Preprint"]},{"id":"y","verdict":"maybe","status":"needs-owner"}]');
    expect(a.results.get("x")).toEqual({ id: "x", verdict: "pass", status: "fulltext-verified", flags: ["preprint"] });
    expect(a.results.get("y")).toBe("malformed");
    const b = parseResults('{"id":"x","verdict":"block","status":"retracted"}\n\nnot json\n{"verdict":"pass"}\n');
    expect(b.results.get("x")).toEqual({ id: "x", verdict: "block", status: "retracted", flags: [] });
    expect(b.errors).toHaveLength(2);
  });

  it("refuses duplicate ids and broken JSON arrays", () => {
    expect(() => parseResults('{"id":"x","verdict":"pass","status":"fulltext-verified"}\n{"id":"x","verdict":"block","status":"retracted"}')).toThrow(/duplicate/);
    expect(() => parseResults("[{")).toThrow(/not valid JSON/);
  });
});
