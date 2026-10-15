// Builds the committed suite from an authoring file (kept in the gitignored .private/ directory or
// the grading root): keeps the id and split a row already has (a published public row never moves
// into the hold-out, a hidden row never becomes public), plans the split for new work clusters only
// (stratified by class, deterministic seed), writes the public rows, seals the private rows, and
// writes fingerprints and the manifest. Refuses on any schema problem or any leak hit (repository
// files and this package's git history).

import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { clusterOf } from "./clusters.ts";
import { buildFingerprints, repoScanSet, scanFingerprints, scanPlaintext } from "./leak.ts";
import { normalizeDoi } from "./normalize.ts";
import { CLASS_RULES, expectedFor, triggersFrom } from "./expectations.ts";
import { flagsFrom, ID_PATTERN, rowWorkKeys, validateSuite } from "./schema.ts";
import { PACKAGE_DIR, sealTo, type SealEnv } from "./seal.ts";
import { countBy, FINGERPRINT_FILE, MANIFEST_FILE, PRIVATE_ENC, PUBLIC_FILE, sha256, toJsonl, type Manifest } from "./suite.ts";
import { FAILURE_CLASSES, type Expected, type FailureClass, type Split, type SuiteRow, type Trigger } from "./types.ts";

/**
 * A row before the build. `id` and `split` are kept when present (rows carried over from an earlier
 * build). `expected`, `adjudication.triggers` and `adjudication.disposition` are derived here from the
 * recorded facts (class, source windows, open full text, update record), never typed by hand.
 */
export type AuthoringRow = Omit<SuiteRow, "id" | "split" | "expected" | "adjudication"> & {
  paperGroup?: string;
  id?: string;
  split?: Split;
  expected?: SuiteRow["expected"];
  adjudication: Omit<SuiteRow["adjudication"], "triggers" | "disposition"> & Partial<Pick<SuiteRow["adjudication"], "triggers" | "disposition">>;
};

/** One line explaining the disposition a row's facts imply. */
export function dispositionText(cls: FailureClass, triggers: readonly Trigger[], ex: Expected): string {
  const parts = [`${cls} (${CLASS_RULES[cls].layer})`];
  if (triggers.includes("contrast-marker")) {
    parts.push(`a section 7 contrast/hedging marker in the source window routes the row to the owner${ex.valid ? "; pass stays acceptable because the source supports the sentence" : ""}`);
  }
  if (triggers.includes("author-proposal")) parts.push("the anchor is an unmarked Discussion sentence (author-proposal)");
  if (triggers.includes("author-proposal-elsewhere")) parts.push("the anchor also occurs as an unmarked Discussion sentence (author-proposal accepted as a status)");
  parts.push(`expected ${ex.verdict}/${ex.status}; accepted verdicts ${ex.acceptVerdicts.join(", ")}`);
  if (ex.requiredFlags.length) parts.push(`must show: ${ex.requiredFlags.join(", ")}`);
  return parts.join("; ");
}

/** Fill the derived fields of an authoring row from its recorded facts. */
export function deriveRow<T extends AuthoringRow>(a: T): T & { expected: Expected; adjudication: SuiteRow["adjudication"] } {
  const triggers = triggersFrom(a.adjudication.windows);
  const expected = expectedFor(a.class, a.source.fullText, triggers, flagsFrom(a.verification));
  return { ...a, expected, adjudication: { ...a.adjudication, triggers, disposition: dispositionText(a.class, triggers, expected) } };
}

/** Canonical JSON: sorted object keys, no whitespace. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function rowId(row: AuthoringRow): string {
  const { paperGroup: _g, id: _i, split: _s, ...content } = row;
  return "pw4s-" + sha256(canonical(content)).slice(0, 6);
}

export interface SplitPlan {
  /** row index -> split */
  split: Split[];
  targets: Record<string, number>;
  achieved: Record<string, number>;
  /** clusters whose split was declared by their rows (carried over) */
  declaredClusters: number;
}

const tmpId = (i: number) => `row:${i}`;

/**
 * Deterministic, cluster-grouped split. A cluster whose rows declare a split keeps it (conflicting
 * declarations are refused). Undeclared clusters are assigned class-stratified towards `fraction`
 * private, counting declared private rows towards the targets; clusters in `forcePublic` stay public.
 */
export function planSplit(rows: AuthoringRow[], seed: string, fraction: number, forcePublic: Set<string>): SplitPlan {
  const withIds = rows.map((r, i) => ({ id: tmpId(i), input: r.input, truth: r.truth, relatedIds: [...(r.relatedIds ?? []), ...(r.paperGroup ? [r.paperGroup] : [])] }));
  const cluster = clusterOf(withIds);
  const members = new Map<string, number[]>();
  rows.forEach((_, i) => {
    const c = cluster.get(tmpId(i))!;
    members.set(c, [...(members.get(c) ?? []), i]);
  });
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.class] = (counts[r.class] ?? 0) + 1;
  const targets: Record<string, number> = {};
  for (const c of Object.keys(counts)) targets[c] = Math.round(fraction * counts[c]!);
  const achieved: Record<string, number> = Object.fromEntries(Object.keys(counts).map((c) => [c, 0]));
  const clusterSplit = new Map<string, Split>();
  let declaredClusters = 0;
  for (const [c, idx] of members) {
    const declared = [...new Set(idx.map((i) => rows[i]!.split).filter((s): s is Split => s !== undefined))];
    if (declared.length > 1) throw new Error(`work cluster ${c} has rows declared in both splits`);
    if (declared.length === 1) {
      clusterSplit.set(c, declared[0]!);
      declaredClusters++;
      if (declared[0] === "private") for (const i of idx) achieved[rows[i]!.class]! += 1;
    }
  }
  const forcedKeys = new Set([...forcePublic].map(normalizeDoi));
  const forced = new Set<string>();
  withIds.forEach((w, i) => {
    if (rowWorkKeys(w).some((k) => forcedKeys.has(k))) forced.add(cluster.get(tmpId(i))!);
  });
  const order = [...members.keys()].filter((c) => !clusterSplit.has(c)).sort((a, b) => sha256(seed + "\0" + a).localeCompare(sha256(seed + "\0" + b)));
  for (const c of order) {
    const idx = members.get(c)!;
    const cnt: Record<string, number> = {};
    for (const i of idx) cnt[rows[i]!.class] = (cnt[rows[i]!.class] ?? 0) + 1;
    const fits = Object.entries(cnt).every(([k, n]) => achieved[k]! + n <= targets[k]!);
    const helps = Object.keys(cnt).some((k) => achieved[k]! < targets[k]!);
    if (!forced.has(c) && fits && helps) {
      clusterSplit.set(c, "private");
      for (const [k, n] of Object.entries(cnt)) achieved[k]! += n;
    } else {
      clusterSplit.set(c, "public");
    }
  }
  return { split: rows.map((_, i) => clusterSplit.get(cluster.get(tmpId(i))!)!), targets, achieved, declaredClusters };
}

export interface BuildOptions {
  authoring: AuthoringRow[];
  builtAt: string;
  seed: string;
  privateFraction: number;
  env: SealEnv;
  /** Test hook: write into another directory instead of the package's suite/. */
  outDir?: string;
  /** Skip the whole-repo leak scan (tests building into temp dirs). */
  skipRepoScan?: boolean;
}

export interface BuildResult {
  rows: SuiteRow[];
  manifest: Manifest;
  plan: SplitPlan;
  forcedPublic: string[];
}

export function buildSuite(o: BuildOptions): BuildResult {
  const out = o.outDir ?? join(PACKAGE_DIR, "suite");
  const files = {
    pub: o.outDir ? join(out, "public.jsonl") : PUBLIC_FILE,
    enc: o.outDir ? join(out, "private.jsonl.enc") : PRIVATE_ENC,
    fp: o.outDir ? join(out, "private-fingerprints.json") : FINGERPRINT_FILE,
    man: o.outDir ? join(out, "manifest.json") : MANIFEST_FILE,
  };
  // Papers already named elsewhere in the repo stay public: a private DOI must not appear anywhere.
  const forcedPublic = new Set<string>();
  const scan = o.skipRepoScan ? null : repoScanSet(PACKAGE_DIR);
  if (scan) {
    const keys = new Set(o.authoring.flatMap((r) => [r.input.citation.doi, r.truth?.doi, ...(r.relatedIds ?? [])].filter((d): d is string => !!d && !d.startsWith("pmid:")).map(normalizeDoi)));
    for (const f of scan.files) {
      if (f.path.startsWith(scan.pkgRel + "/")) continue;
      for (const m of f.text.matchAll(/10\.\d{4,9}\/[^\s"'<>\\,;]+/g)) {
        const d = normalizeDoi(m[0].replace(/[.)\]]+$/, ""));
        if (keys.has(d)) forcedPublic.add(d);
      }
    }
  }
  const plan = planSplit(o.authoring, o.seed, o.privateFraction, forcedPublic);
  const rows: SuiteRow[] = o.authoring.map(deriveRow).map((a, i) => {
    const { paperGroup: _g, id, split: _s, ...rest } = a;
    if (id !== undefined && !ID_PATTERN.test(id)) throw new Error(`carried-over id ${id} is malformed`);
    return { id: id ?? rowId(a), split: plan.split[i]!, ...rest };
  });
  rows.sort((x, y) => x.id.localeCompare(y.id));
  const problems = validateSuite(rows);
  if (problems.length) throw new Error(`suite rows invalid:\n${problems.join("\n")}`);

  const pub = rows.filter((r) => r.split === "public");
  const priv = rows.filter((r) => r.split === "private");
  const publicText = toJsonl(pub);
  const privateText = toJsonl(priv);

  mkdirSync(out, { recursive: true });
  writeFileSync(files.pub, publicText);
  mkdirSync(o.env.gradingRoot, { recursive: true, mode: 0o700 });
  const stage = mkdtempSync(join(resolve(o.env.gradingRoot), "build."));
  try {
    const plainPath = join(stage, "private.jsonl");
    writeFileSync(plainPath, privateText, { mode: 0o600 });
    sealTo(o.env, plainPath, files.enc);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  const fp = buildFingerprints(priv, publicText, randomBytes(16).toString("hex"));
  const fpText = JSON.stringify(fp) + "\n";
  writeFileSync(files.fp, fpText);
  const manifest: Manifest = {
    version: 2,
    suite: "pw4s-citation",
    builtAt: o.builtAt,
    seed: o.seed,
    privateFraction: o.privateFraction,
    rows: { total: rows.length, public: pub.length, private: priv.length },
    byClass: Object.fromEntries(FAILURE_CLASSES.map((c: FailureClass) => [c, countBy(rows, (r) => r.class)[c] ?? { public: 0, private: 0 }])),
    byDomain: countBy(rows, (r) => r.domain),
    clusters: countClusters(rows),
    publicSha256: sha256(publicText),
    privateEncSha256: sha256(readFileSync(files.enc)),
    privatePlainSha256: sha256(privateText),
    fingerprintsSha256: sha256(fpText),
  };
  writeFileSync(files.man, JSON.stringify(manifest, null, 2) + "\n");

  if (scan) {
    // Rescan after writing (the new public file is part of the repo now) including package history.
    const now = repoScanSet(PACKAGE_DIR);
    const set = [...now.files, now.history];
    const hits = [...scanFingerprints(set, fp), ...scanPlaintext(set, priv, publicText)];
    if (hits.length) throw new Error(`leak scan failed after build: ${hits.map((h) => `${h.path} (${h.kind}: ${h.detail})`).join("; ")}`);
  }
  return { rows, manifest, plan, forcedPublic: [...forcedPublic].sort() };
}

/** Work clusters per split: all rows, and those with at least one invalid row (the false-pass trials). */
export function countClusters(rows: SuiteRow[]): Manifest["clusters"] {
  const cl = clusterOf(rows);
  const out: Manifest["clusters"] = { public: { all: 0, invalid: 0 }, private: { all: 0, invalid: 0 } };
  for (const split of ["public", "private"] as const) {
    const sub = rows.filter((r) => r.split === split);
    out[split].all = new Set(sub.map((r) => cl.get(r.id))).size;
    out[split].invalid = new Set(sub.filter((r) => !r.expected.valid).map((r) => cl.get(r.id))).size;
  }
  return out;
}
