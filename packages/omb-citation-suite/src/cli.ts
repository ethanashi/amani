#!/usr/bin/env node
// omb-citation-suite CLI.
//   validate [--split public|private|all]            schema-check rows (private needs the key)
//   stats                                             counts by class, domain, split and work cluster (manifest)
//   export-inputs --split public --out FILE           verifier inputs (id, sentence, quote, citation)
//   export-inputs --split private|all --out FILE      only into the grading root (exclusive, no symlinks)
//   export-rows --split S --out FILE                  full rows (private/all only into the grading root)
//   score --results FILE --split public               tuning report (never admits)
//   score --results FILE --split private|all --verifier-id ID
//                                                     held-out report for a FROZEN verifier; records the look
//         [--json] [--reveal-private] [--max-false-pass 0.05]
//   leak-scan                                         repo files + package history; keyed when the key is present
//   build --from AUTHORING.jsonl --date YYYY-MM-DD [--seed S] [--private-fraction 0.3]
//   reseal --to-key PATH                              re-seal the private split under another key
// Exit codes: 0 ok (score: complete and ADMITTED on the held-out rows), 1 check failed / not
// admitted, 2 usage or environment error.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSuite, type AuthoringRow } from "./build.ts";
import { repoScanSet, scanFingerprints, scanPlaintext } from "./leak.ts";
import { insideRealRoot, recordLook, writePrivateFile } from "./private-io.ts";
import { validateSuite } from "./schema.ts";
import { formatReport, parseResults, scoreSuite } from "./scorer.ts";
import { defaultSealEnv, keyAvailable, PACKAGE_DIR, sealTo, type SealEnv } from "./seal.ts";
import { loadPrivateRows, loadPublicRows, MANIFEST_FILE, parseJsonl, PRIVATE_ENC, PUBLIC_FILE, readFingerprints, readManifest, sha256, toJsonl, verifierInputs } from "./suite.ts";
import type { SuiteRow } from "./types.ts";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function rowsFor(split: string, env: SealEnv): SuiteRow[] {
  if (split === "public") return loadPublicRows();
  if (!keyAvailable(env)) throw new Error(`the ${split} split needs the sealing key (set OMB_CITATION_SUITE_KEY); refusing to fall back to public rows`);
  const priv = loadPrivateRows(env);
  return split === "private" ? priv : [...loadPublicRows(), ...priv];
}

export interface CliDeps {
  env?: SealEnv;
  log?: (s: string) => void;
  /** Injected clock (look-ledger timestamps). */
  now?: () => Date;
}

export function main(argv: string[], deps: CliDeps = {}): number {
  const env = deps.env ?? defaultSealEnv();
  const log = deps.log ?? ((s: string) => console.log(s));
  const now = deps.now ?? (() => new Date());
  try {
    return run(argv, env, log, now);
  } catch (e) {
    log(`error: ${(e as Error).message}`);
    return 2;
  }
}

function exportTo(env: SealEnv, split: string, out: string, data: string, log: (s: string) => void): number {
  if (split === "public") writeFileSync(out, data);
  else writePrivateFile(env.gradingRoot, out, data);
  log(`wrote ${out}`);
  return 0;
}

function run(argv: string[], env: SealEnv, log: (s: string) => void, now: () => Date): number {
  const [cmd, ...args] = argv;
  const split = flag(args, "--split") ?? "public";
  if (!["public", "private", "all"].includes(split)) {
    log("--split must be public, private or all");
    return 2;
  }
  switch (cmd) {
    case "validate": {
      const rows = rowsFor(split, env);
      const problems = validateSuite(rows);
      log(problems.length ? problems.join("\n") : `${rows.length} ${split} rows valid`);
      return problems.length ? 1 : 0;
    }
    case "stats": {
      const m = readManifest();
      log(JSON.stringify({ rows: m.rows, clusters: m.clusters, byClass: m.byClass, byDomain: m.byDomain }, null, 2));
      return 0;
    }
    case "export-inputs":
    case "export-rows": {
      const out = flag(args, "--out");
      if (!out) {
        log(`${cmd} needs --out FILE`);
        return 2;
      }
      if (split !== "public") {
        const where = insideRealRoot(env.gradingRoot, out); // checked before anything is decrypted
        if (!where.ok) {
          log(where.reason);
          return 2;
        }
      }
      const rows = rowsFor(split, env);
      return exportTo(env, split, out, toJsonl(cmd === "export-inputs" ? verifierInputs(rows) : rows), log);
    }
    case "score": {
      const file = flag(args, "--results");
      if (!file || !existsSync(file)) {
        log("score needs --results FILE (JSON array or JSONL of {id, verdict, status, flags})");
        return 2;
      }
      const verifierId = flag(args, "--verifier-id") ?? null;
      if (split !== "public" && !verifierId) {
        log("scoring the hold-out needs --verifier-id ID (the frozen verifier build, e.g. a commit); the look is recorded");
        return 2;
      }
      const text = readFileSync(file, "utf8");
      const rows = rowsFor(split, env);
      const { results, errors } = parseResults(text);
      const look =
        split !== "public" && verifierId
          ? recordLook(env.gradingRoot, { suite: readManifest().privatePlainSha256, verifierId, resultsSha256: sha256(text) }, now)
          : null;
      const max = flag(args, "--max-false-pass");
      const report = scoreSuite(rows, results, {
        revealPrivateRows: args.includes("--reveal-private"),
        verifierId,
        look,
        ...(max ? { maxFalsePassRate: Number(max) } : {}),
      });
      if (errors.length) log(`result problems: ${errors.length} (affected rows count as failures)`);
      log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
      return report.target.admitted ? 0 : 1;
    }
    case "leak-scan": {
      const scan = repoScanSet(PACKAGE_DIR);
      const set = [...scan.files, scan.history];
      const hits = scanFingerprints(set, readFingerprints());
      let mode = "keyless";
      if (keyAvailable(env)) {
        hits.push(...scanPlaintext(set, loadPrivateRows(env), readFileSync(PUBLIC_FILE, "utf8")));
        mode = "keyless+keyed";
      }
      log(hits.length ? hits.map((h) => `${h.path}: ${h.kind} ${h.detail}`).join("\n") : `no leak (${mode}, ${scan.files.length} files + package history)`);
      return hits.length ? 1 : 0;
    }
    case "build": {
      const from = flag(args, "--from");
      const date = flag(args, "--date");
      if (!from || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        log("build needs --from AUTHORING.jsonl and --date YYYY-MM-DD");
        return 2;
      }
      const res = buildSuite({
        authoring: parseJsonl<AuthoringRow>(readFileSync(from, "utf8")),
        builtAt: date,
        seed: flag(args, "--seed") ?? "pw4s-2026-10-11",
        privateFraction: Number(flag(args, "--private-fraction") ?? "0.3"),
        env,
      });
      log(JSON.stringify({ rows: res.manifest.rows, clusters: res.manifest.clusters, byClass: res.manifest.byClass, forcedPublic: res.forcedPublic }, null, 2));
      return 0;
    }
    case "reseal": {
      const to = flag(args, "--to-key");
      if (!to) {
        log("reseal needs --to-key PATH");
        return 2;
      }
      const tmp = resolve(env.gradingRoot, `reseal.${process.pid}.jsonl`);
      writePrivateFile(env.gradingRoot, tmp, toJsonl(loadPrivateRows(env)));
      try {
        sealTo({ ...env, keyPath: to }, tmp, PRIVATE_ENC);
      } finally {
        rmSync(tmp, { force: true });
      }
      const m = readManifest();
      m.privateEncSha256 = sha256(readFileSync(PRIVATE_ENC));
      writeFileSync(MANIFEST_FILE, JSON.stringify(m, null, 2) + "\n");
      log(`resealed ${PRIVATE_ENC} under ${to}; manifest updated`);
      return 0;
    }
    default:
      log("usage: cli.ts validate|stats|export-inputs|export-rows|score|leak-scan|build|reseal (see file header)");
      return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(PACKAGE_DIR, "src", "cli.ts")) {
  process.exitCode = main(process.argv.slice(2));
}
