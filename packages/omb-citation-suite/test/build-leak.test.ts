import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSuite, deriveRow, planSplit, type AuthoringRow } from "../src/build.ts";
import { buildFingerprints, scanFingerprints, scanPlaintext, shingleFingerprints } from "../src/leak.ts";
import { decodeEscapes, tokens } from "../src/normalize.ts";
import type { SealEnv } from "../src/seal.ts";
import { loadPrivateRows, parseJsonl, sha256, toJsonl, type Manifest } from "../src/suite.ts";
import type { SuiteRow } from "../src/types.ts";
import { ALL_CLASSES, synthRow, tempDir } from "./helpers.ts";

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});

function toAuthoring(r: SuiteRow, keep = false): AuthoringRow {
  const { id, split, expected: _e, adjudication, ...rest } = r;
  const { triggers: _t, disposition: _d, ...adj } = adjudication;
  return { ...rest, adjudication: adj, ...(keep ? { id, split } : {}) };
}

function authoring(perClass = 4): AuthoringRow[] {
  return ALL_CLASSES.flatMap((cls) => Array.from({ length: perClass }, () => toAuthoring(synthRow(cls))));
}

function setup() {
  const t = tempDir();
  cleanups.push(t.cleanup);
  const env: SealEnv = { keyPath: join(t.dir, "k", "suite.key"), gradingRoot: join(t.dir, "grading") };
  return { dir: t.dir, env, out: join(t.dir, "suite") };
}

describe("buildSuite", () => {
  it("derives dispositions, splits by work cluster, seals the private rows and records hashes, counts and clusters", () => {
    const { env, out } = setup();
    const rows = authoring();
    const res = buildSuite({ authoring: rows, builtAt: "2026-10-11", seed: "s1", privateFraction: 0.3, env, outDir: out, skipRepoScan: true });
    const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as Manifest;
    expect(m.version).toBe(2);
    expect(m.rows.total).toBe(rows.length);
    for (const cls of ALL_CLASSES) expect(m.byClass[cls]!.private).toBe(1); // round(0.3 * 4)
    expect(m.clusters.private.all).toBe(m.rows.private);
    const pubText = readFileSync(join(out, "public.jsonl"), "utf8");
    expect(m.publicSha256).toBe(sha256(pubText));
    expect(m.privateEncSha256).toBe(sha256(readFileSync(join(out, "private.jsonl.enc"))));
    const priv = loadPrivateRows(env, join(out, "private.jsonl.enc"), m);
    expect(priv.map((r) => r.id).sort()).toEqual(res.rows.filter((r) => r.split === "private").map((r) => r.id).sort());
    expect(sha256(toJsonl(priv))).toBe(m.privatePlainSha256);
    for (const r of res.rows) expect(r.adjudication.disposition.length).toBeGreaterThan(10);
    const outputs = readdirSync(out).filter((f) => !f.includes(".enc")).map((f) => ({ path: f, text: readFileSync(join(out, f), "utf8") }));
    expect(scanPlaintext(outputs, priv, pubText)).toEqual([]);
    expect(readdirSync(env.gradingRoot).filter((f) => f.startsWith("build.") || f.startsWith("stage."))).toEqual([]);
  });

  it("keeps carried-over ids and splits (a published row never moves) and plans only new clusters", () => {
    const { env, out } = setup();
    const carried = [synthRow("negation", { split: "private" }), synthRow("correct-support", { split: "public" })].map((r) => toAuthoring(r, true));
    const fresh = authoring(2);
    const res = buildSuite({ authoring: [...carried, ...fresh], builtAt: "2026-10-11", seed: "s", privateFraction: 0.3, env, outDir: out, skipRepoScan: true });
    for (const c of carried) expect(res.rows.find((r) => r.id === c.id)!.split).toBe(c.split);
    const conflict: AuthoringRow[] = [{ ...carried[0]!, split: "public", id: "pw4s-0000aa" }, carried[0]!];
    expect(() => planSplit(conflict, "s", 0.3, new Set())).toThrow(/both splits/);
  });

  it("is deterministic for a seed; a tampered plaintext hash is refused on load; invalid rows refuse the build", () => {
    const a = setup();
    const b = setup();
    const rows = authoring();
    buildSuite({ authoring: rows, builtAt: "2026-10-11", seed: "s1", privateFraction: 0.3, env: a.env, outDir: a.out, skipRepoScan: true });
    buildSuite({ authoring: rows, builtAt: "2026-10-11", seed: "s1", privateFraction: 0.3, env: b.env, outDir: b.out, skipRepoScan: true });
    expect(readFileSync(join(a.out, "public.jsonl"), "utf8")).toBe(readFileSync(join(b.out, "public.jsonl"), "utf8"));
    const m = JSON.parse(readFileSync(join(a.out, "manifest.json"), "utf8")) as Manifest;
    expect(() => loadPrivateRows(a.env, join(a.out, "private.jsonl.enc"), { ...m, privatePlainSha256: "0".repeat(64) })).toThrow(/does not match/);
    const bad = authoring(1);
    bad[0]!.evidence.quote = "";
    expect(() => buildSuite({ authoring: bad, builtAt: "2026-10-11", seed: "s", privateFraction: 0.3, env: a.env, outDir: join(a.dir, "x"), skipRepoScan: true })).toThrow(/invalid/);
  });

  it("planSplit keeps forced-public works public and groups related identifiers (DOI swaps, PMIDs)", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      const rows = authoring(6);
      const target = rows.find((r) => r.class === "correct-support")!;
      const swap = rows.find((r) => r.class === "wrong-metadata")!;
      swap.relatedIds = [target.truth!.doi!];
      const byPmid = rows.find((r) => r.class === "negation")!;
      byPmid.relatedIds = [`pmid:${target.truth!.pmid}`];
      const forced = rows.find((r) => r.class === "misquote")!;
      const plan = planSplit(rows, seed, 0.3, new Set([forced.truth!.doi!]));
      const at = (r: AuthoringRow) => plan.split[rows.indexOf(r)];
      expect(at(swap), seed).toBe(at(target));
      expect(at(byPmid), seed).toBe(at(target));
      expect(at(forced)).toBe("public");
    }
  });

  it("deriveRow recomputes the expectation from facts and ignores a hand-typed one", () => {
    const a = toAuthoring(synthRow("correct-support"));
    a.adjudication.windows = [{ section: "results", citationMarker: false, markers: [{ marker: "however", position: "after" }] }];
    const d = deriveRow({ ...a, expected: synthRow("negation").expected });
    expect(d.expected.verdict).toBe("needs-owner");
    expect(d.expected.valid).toBe(true);
  });
});

describe("leak scan", () => {
  const base = synthRow("negation");
  const priv: SuiteRow[] = [synthRow("negation", { split: "private", input: { ...base.input, sentence: "Plasma zentrolin concentrations were unrelated to motor decline in the Aldane registry [1]." } })];

  it("keyless fingerprints find a pasted private sentence, even re-cased and JSON-escaped", () => {
    const fp = buildFingerprints(priv, "", "salt-1");
    expect(fp.fingerprints.length).toBeGreaterThan(0);
    const leaked = { path: "notes.md", text: 'see "PLASMA zentrolin concentrations were unrelated to motor decline in the aldane registry"' };
    const clean = { path: "ok.md", text: "Plasma zentrolin concentrations were related to something else entirely in another registry." };
    expect(scanFingerprints([leaked, clean], fp).map((h) => h.path)).toEqual(["notes.md"]);
    expect(scanFingerprints([{ path: "j.json", text: JSON.stringify({ s: priv[0]!.input.sentence }) }], fp)).toHaveLength(1);
  });

  it("finding 7: text hidden behind \\u, \\x, HTML or double escapes is decoded before scanning", () => {
    const s = priv[0]!.input.sentence;
    const variants = [
      s.replace(/e/g, "\\u0065"),
      s.replace(/e/g, "\\\\u0065"),
      s.replace(/a/g, "\\x61"),
      s.replace(/o/g, "&#111;").replace(/t/g, "&#x74;"),
      JSON.stringify(JSON.stringify(s)),
    ];
    const fp = buildFingerprints(priv, "", "salt-2");
    for (const v of variants) {
      expect(decodeEscapes(v)).toContain("zentrolin");
      expect(scanFingerprints([{ path: "v", text: v }], fp), v.slice(0, 40)).toHaveLength(1);
      expect(scanPlaintext([{ path: "v", text: v }], priv).map((h) => h.kind), v.slice(0, 40)).toContain("text");
    }
    expect(tokens("caf\\u00e9 \\u{1F600}x")).toEqual(["café", "x"]);
    expect(tokens("Plain ASCII, with-punct 42!")).toEqual(["plain", "ascii", "with", "punct", "42"]);
    expect(tokens("Ünïcode ﬁne 4²")).toEqual(["ünïcode", "fine", "42"]);
    const doiEscaped = priv[0]!.input.citation.doi!.replace(/\//g, "\\/");
    expect(scanPlaintext([{ path: "d", text: doiEscaped }], priv).map((h) => h.kind)).toContain("doi");
  });

  it("fingerprints are salted and exclude shingles shared with public text", () => {
    expect(buildFingerprints(priv, "", "salt-1").fingerprints).not.toEqual(buildFingerprints(priv, "", "salt-2").fingerprints);
    expect(buildFingerprints(priv, priv[0]!.input.sentence, "salt-1").fingerprints).toEqual([]);
    expect(shingleFingerprints("one two three", "s").size).toBe(1);
  });

  it("keyed scan finds ids, DOIs and quoted text and reports field names, not content", () => {
    const row = priv[0]!;
    const files = [
      { path: "a.txt", text: `row ${row.id} is hidden` },
      { path: "b.txt", text: `https://doi.org/${row.input.citation.doi!.toUpperCase()}.` },
      { path: "c.txt", text: row.evidence.quote },
      { path: "d.txt", text: "unrelated text about something else entirely, with no private content in it at all" },
    ];
    const hits = scanPlaintext(files, priv);
    expect(hits.map((h) => `${h.path}:${h.kind}`).sort()).toEqual(["a.txt:id", "b.txt:doi", "c.txt:text"]);
    for (const h of hits) expect(h.detail).not.toContain("zentrolin");
  });

  it("parseJsonl rejects a broken line", () => {
    expect(() => parseJsonl('{"a":1}\n{oops')).toThrow(/line 2/);
  });
});
