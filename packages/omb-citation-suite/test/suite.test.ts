// Tests over the committed suite: every public row is schema-valid, the manifest agrees with the
// files, coverage meets PW4s acceptance, the hold-out is large enough for a useful held-out bound
// (finding 3), no surface cue gives a class away (finding 5), the reviewer's rows follow section 7
// (finding 1), and the new outcomes are represented (finding 8). With the sealing key present
// (OMB_CITATION_SUITE_KEY), the private rows are checked too.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../src/cli.ts";
import { clusterOf } from "../src/clusters.ts";
import { stripRetractionMarks, wordCount } from "../src/normalize.ts";
import { rowWorkKeys, validateSuite } from "../src/schema.ts";
import { rate } from "../src/scorer.ts";
import { defaultSealEnv, keyAvailable, type SealEnv } from "../src/seal.ts";
import { SYNTHETIC_FILE, publicInputFile, FINGERPRINT_FILE, loadPrivateRows, loadPublicRows, MANIFEST_FILE, PRIVATE_ENC, PUBLIC_FILE, readManifest, sha256, verifierInputs } from "../src/suite.ts";
import { DOMAINS, FAILURE_CLASSES, type SuiteRow } from "../src/types.ts";
import { tempDir } from "./helpers.ts";

const fullSuite = existsSync(PUBLIC_FILE);
const manifest = readManifest();
const publicRows = loadPublicRows();
const tmp = tempDir();
afterAll(() => tmp.cleanup());
const env: SealEnv = { ...defaultSealEnv(), gradingRoot: join(tmp.dir, "grading") };
const haveKey = keyAvailable(env);
const requireKey = process.env.OMB_CITATION_SUITE_REQUIRE_KEY === "1";
let privateCache: SuiteRow[] | null = null;
const privateRows = () => (privateCache ??= loadPrivateRows(env));
const byId = new Map(publicRows.map((r) => [r.id, r]));

function surfaceCues(rows: SuiteRow[]) {
  const fab = rows.filter((r) => r.class === "fabricated-doi" && r.input.citation.doi !== null);
  const real = rows.filter((r) => r.class !== "fabricated-doi" && r.input.citation.doi !== null);
  const noPmid = (xs: SuiteRow[]) => xs.filter((r) => r.input.citation.pmid === null).length / Math.max(1, xs.length);
  return { fabNoPmid: noPmid(fab), realNoPmid: noPmid(real), n: fab.length };
}

describe("committed suite files", () => {
  it.skipIf(!fullSuite)("hashes in the manifest match the public rows, fingerprints and sealed envelope", () => {
    expect(manifest.version).toBe(2);
    expect(sha256(readFileSync(PUBLIC_FILE, "utf8"))).toBe(manifest.publicSha256);
    expect(sha256(readFileSync(FINGERPRINT_FILE, "utf8"))).toBe(manifest.fingerprintsSha256);
    const enc = readFileSync(PRIVATE_ENC);
    expect(enc.subarray(0, 19).toString()).toBe("OMERTA-BIO-SEAL-v2\n");
    expect(sha256(enc)).toBe(manifest.privateEncSha256);
    expect(readFileSync(PRIVATE_ENC + ".sha256", "utf8").split(/\s+/)[0]).toBe(manifest.privateEncSha256);
    expect(JSON.parse(readFileSync(MANIFEST_FILE, "utf8")).suite).toBe("pw4s-citation");
  });

  it("every public row is schema-valid (dispositions recomputed from windows and flags) and marked public", () => {
    expect(validateSuite(publicRows)).toEqual([]);
    expect(publicRows.every((r) => r.split === "public")).toBe(true);
    if (fullSuite) expect(publicRows.length).toBe(manifest.rows.public);
    else expect(publicRows.length).toBe(15);
    for (const r of publicRows) {
      expect(wordCount(r.evidence.quote), r.id).toBeLessThanOrEqual(50);
      expect(r.source.url, r.id).toMatch(/^https:\/\//);
    }
  });

  it.skipIf(!fullSuite)("public counts per class, domain and work cluster match the manifest", () => {
    for (const cls of FAILURE_CLASSES) expect(publicRows.filter((r) => r.class === cls).length, cls).toBe(manifest.byClass[cls]!.public);
    for (const [d, c] of Object.entries(manifest.byDomain)) expect(publicRows.filter((r) => r.domain === d).length, d).toBe(c.public);
    const cl = clusterOf(publicRows);
    expect(new Set(publicRows.map((r) => cl.get(r.id))).size).toBe(manifest.clusters.public.all);
  });

  it.skipIf(!fullSuite)("coverage meets the PW4s acceptance", () => {
    expect(manifest.rows.total).toBeGreaterThanOrEqual(100);
    expect(manifest.rows.public + manifest.rows.private).toBe(manifest.rows.total);
    for (const cls of FAILURE_CLASSES) {
      const c = manifest.byClass[cls]!;
      expect(c.public + c.private, cls).toBeGreaterThanOrEqual(5);
      expect(c.private, `${cls} has hidden rows`).toBeGreaterThanOrEqual(1);
      expect(c.public, `${cls} has public examples`).toBeGreaterThanOrEqual(1);
    }
    const valid = manifest.byClass["correct-support"]!.public + manifest.byClass["correct-support"]!.private;
    expect(valid / manifest.rows.total).toBeGreaterThanOrEqual(0.2);
    const retracted = manifest.byClass["retracted"]!;
    expect(retracted.public + retracted.private).toBeGreaterThanOrEqual(5);
    for (const d of DOMAINS) expect(manifest.byDomain[d]!.public + manifest.byDomain[d]!.private, d).toBeGreaterThanOrEqual(8);
  });

  it.skipIf(!fullSuite)("finding 3: zero held-out failures would put the false-pass upper bound under 5%, by rows and by works", () => {
    const privInvalid = FAILURE_CLASSES.filter((c) => c !== "correct-support" && c !== "attributed-proposal").reduce((s, c) => s + manifest.byClass[c]!.private, 0);
    expect(rate(0, privInvalid).upper).toBeLessThanOrEqual(0.05);
    expect(rate(0, manifest.clusters.private.invalid).upper).toBeLessThanOrEqual(0.05);
  });

  it.skipIf(!fullSuite)("finding 1: the reviewer's rows follow section 7 (re-anchored, or owner routing accepted)", () => {
    const reanchored = byId.get("pw4s-02b682")!;
    expect(reanchored.adjudication.triggers).not.toContain("author-proposal");
    expect(reanchored.adjudication.windows.every((w) => w.section !== "discussion")).toBe(true);
    for (const id of ["pw4s-134e7b", "pw4s-64f085", "pw4s-6a6374", "pw4s-d4a1f9"]) {
      const r = byId.get(id)!;
      expect(r.adjudication.triggers, id).toContain("contrast-marker");
      expect(r.expected.acceptVerdicts.sort(), id).toEqual(["needs-owner", "pass"]);
      expect(r.adjudication.factual).toBe("supported");
    }
    for (const r of publicRows.filter((x) => x.class === "correct-support")) expect(r.adjudication.triggers.some((t) => t.startsWith("author-proposal")), r.id).toBe(false);
  });

  it("finding 5: identifiers and titles carry no class cue in the public rows", () => {
    for (const r of publicRows) {
      if (r.input.citation.doi) expect(r.input.citation.doi, r.id).toBe(r.input.citation.doi.toLowerCase());
      expect(stripRetractionMarks(r.input.citation.title), r.id).toBe(r.input.citation.title);
    }
    if (fullSuite) expect(publicRows.some((r) => r.class !== "fabricated-doi" && r.input.citation.pmid === null)).toBe(true);
  });

  it.skipIf(!fullSuite)("finding 8: author-proposal pairs and required flags are present in the public examples", () => {
    expect(publicRows.filter((r) => r.class === "attributed-proposal").length).toBeGreaterThanOrEqual(2);
    expect(publicRows.filter((r) => r.class === "proposal-as-finding").length).toBeGreaterThanOrEqual(2);
    expect(publicRows.some((r) => r.expected.requiredFlags.includes("correction"))).toBe(true);
  });

  it("verifier inputs carry only id, sentence, quote and the citation as written", () => {
    for (const v of verifierInputs(publicRows)) expect(Object.keys(v).sort()).toEqual(["citation", "id", "quote", "sentence"]);
  });

  it("the CLI scores the public split fail-closed and never admits it", () => {
    const res = join(tmp.dir, "results.jsonl");
    const lines = publicRows.map((r) => JSON.stringify({ id: r.id, verdict: r.expected.verdict, status: r.expected.status, flags: r.expected.requiredFlags }));
    lines.pop();
    writeFileSync(res, lines.join("\n"));
    const out: string[] = [];
    expect(main(["score", "--results", res, "--split", "public"], { env, log: (s) => out.push(s) })).toBe(1);
    expect(out.join("\n")).toMatch(/INCOMPLETE: 1 missing/);
    expect(out.join("\n")).toMatch(/ADMITTED: NO/);
    expect(main(["validate", "--split", "public"], { env, log: () => {} })).toBe(0);
    expect(main(["score", "--results", res, "--split", "private", "--verifier-id", "x"], { env: { ...env, keyPath: join(tmp.dir, "absent.key") }, log: () => {} })).toBe(2);
  });
});

describe.skipIf(!fullSuite || (!haveKey && !requireKey))("sealed private split (needs the sealing key)", () => {
  it("decrypts, validates and matches the manifest, including work clusters", () => {
    expect(haveKey).toBe(true);
    const priv = privateRows();
    expect(priv.length).toBe(manifest.rows.private);
    expect(priv.every((r) => r.split === "private")).toBe(true);
    expect(validateSuite([...publicRows, ...priv])).toEqual([]);
    for (const cls of FAILURE_CLASSES) expect(priv.filter((r) => r.class === cls).length, cls).toBe(manifest.byClass[cls]!.private);
    const cl = clusterOf(priv);
    expect(new Set(priv.filter((r) => !r.expected.valid).map((r) => cl.get(r.id))).size).toBe(manifest.clusters.private.invalid);
  });

  it("no work and no id is shared between the splits", () => {
    const pubKeys = new Set(publicRows.flatMap((r) => rowWorkKeys(r)));
    const pubIds = new Set(publicRows.map((r) => r.id));
    for (const r of privateRows()) {
      expect(pubIds.has(r.id)).toBe(false);
      for (const k of rowWorkKeys(r)) expect(pubKeys.has(k), `${r.id} ${k}`).toBe(false);
    }
  });

  it("finding 5 across all rows: no letter-case or missing-PMID shortcut to fabricated references", () => {
    const all = [...publicRows, ...privateRows()];
    for (const r of all) if (r.input.citation.doi) expect(r.input.citation.doi).toBe(r.input.citation.doi.toLowerCase());
    const cues = surfaceCues(all);
    expect(cues.n).toBeGreaterThanOrEqual(8);
    expect(Math.abs(cues.fabNoPmid - cues.realNoPmid)).toBeLessThanOrEqual(0.25);
    for (const r of all.filter((x) => x.class === "retracted")) expect(stripRetractionMarks(r.input.citation.title)).toBe(r.input.citation.title);
  });

  it("finding 8 across all rows: PMID-only references, preprints and expressions of concern are represented", () => {
    const all = [...publicRows, ...privateRows()];
    expect(all.filter((r) => r.input.citation.doi === null).length).toBeGreaterThanOrEqual(5);
    expect(all.some((r) => r.input.citation.doi === null && r.class === "fabricated-doi")).toBe(true);
    expect(all.some((r) => r.input.citation.doi === null && r.class === "wrong-metadata")).toBe(true);
    expect(all.some((r) => r.expected.requiredFlags.includes("preprint"))).toBe(true);
    expect(all.some((r) => r.expected.valid && r.expected.requiredFlags.includes("expression-of-concern"))).toBe(true);
  });

  it("finding 3: held-out scoring needs a frozen verifier id, records the look, and admits a perfect run", () => {
    const all = [...publicRows, ...privateRows()];
    const res = join(tmp.dir, "perfect.jsonl");
    writeFileSync(res, all.map((r) => JSON.stringify({ id: r.id, verdict: r.expected.verdict, status: r.expected.status, flags: r.expected.requiredFlags })).join("\n"));
    const out: string[] = [];
    const now = () => new Date("2026-10-11T12:00:00Z");
    expect(main(["score", "--results", res, "--split", "all", "--verifier-id", "perfect-oracle"], { env, log: (s) => out.push(s), now })).toBe(0);
    expect(out.join("\n")).toMatch(/ADMITTED: YES/);
    expect(out.join("\n")).toMatch(/held-out look #1/);
    writeFileSync(res, all.map((r) => JSON.stringify({ id: r.id, verdict: "block", status: "source-contradicts" })).join("\n"));
    expect(main(["score", "--results", res, "--split", "all", "--verifier-id", "perfect-oracle"], { env, log: () => {}, now })).toBe(2);
  });
});


describe("published synthetic fixture", () => {
  it("is schema valid and covers every failure class without claiming benchmark coverage", () => {
    const rows = loadPublicRows(SYNTHETIC_FILE);
    expect(validateSuite(rows)).toEqual([]);
    expect(rows).toHaveLength(15);
    expect(new Set(rows.map(r => r.class))).toEqual(new Set(FAILURE_CLASSES));
    expect(rows.every(r => r.adjudication.disposition === "synthetic")).toBe(true);
  });
  it("prefers the full file and falls back only when it is absent", () => {
    const full = join(tmp.dir, "full.jsonl");
    expect(publicInputFile(full, SYNTHETIC_FILE)).toBe(SYNTHETIC_FILE);
    writeFileSync(full, "invalid fixture");
    expect(publicInputFile(full, SYNTHETIC_FILE)).toBe(full);
    expect(() => loadPublicRows(publicInputFile(full, SYNTHETIC_FILE))).toThrow();
    expect(publicInputFile()).toBe(fullSuite ? PUBLIC_FILE : SYNTHETIC_FILE);
  });
});
