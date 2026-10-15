// Deterministic tool pack bundle. The bundle is the exact import closure of the omb-check CLI
// (bio-toolpack, bio-checks, bio-pipeline validity/inference, bio-core), copied byte-for-byte
// with the repository-relative layout preserved (checks prunes only citation export/dispatch
// lines), plus fixed wrapper scripts, a PROFILE marker, the pinned prompt sentence, the
// profile's TOOLS.md and (profile `full`) the omb-sim Python sources. Nothing is transpiled: the pinned
// Node 24 strips the TypeScript types at run time, so the shipped code is the reviewed code.
//
// Tree hash: sha256 over the sorted lines "<octal mode> <sha256> <relative path>\n" of every
// regular file. scripts/verify_toolpack.py computes the same hash independently.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isProfile, PROFILES, type Profile } from "./profile.ts";

export { isProfile, PROFILES, type Profile };
export const NODE_BIN = "/opt/homebrew/opt/node@24/bin/node";
export const LOCK_SCHEMA = "omerta-bio/toolpack-lock@1";

export const PACKAGE_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const REPO_ROOT = path.resolve(PACKAGE_DIR, "../..");
export const LOCK_FILE = path.join(PACKAGE_DIR, "toolpack.lock.json");
const ENTRY = "packages/bio-toolpack/src/cli.ts";

const OMB_CHECK = `#!/bin/sh
# omb-check: Omerta Bio deterministic checks (tool pack entry point; see TOOLS.md).
# Runs the pinned Node 24 on the bundled, unmodified Omerta Bio sources. Offline.
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P) || exit 2
exec ${NODE_BIN} --disable-warning=ExperimentalWarning "$here/src/${ENTRY}" "$@"
`;

const OMB_SIM = `#!/bin/sh
# omb-sim: design and simulation tools (tool pack entry point; see TOOLS.md).
# Runs numpy/scipy/statsmodels from the analysis environment's Python (OMB_PYTHON). Offline.
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P) || exit 2
py=\${OMB_PYTHON:-python3}
exec "$py" -I -B "$here/sim/omb_sim.py" "$@"
`;

export interface BundleFile { bytes: Buffer; mode: number }
export type Bundle = Map<string, BundleFile>;

const SPECIFIERS = [
  /\bfrom\s+["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /^\s*import\s+["']([^"']+)["']/gm,
];

/** Profile pruning removes unused exports/dispatch entries and the unused gradient checker.
 * Retained checker implementations are copied verbatim; source files are never edited. Fail on drift. */
function moduleBytes(root: string, rel: string, profile: Profile): Buffer {
  let text = readFileSync(path.join(root, rel), "utf8");
  if (profile === "checks") {
    const removals: Record<string, string[]> = {
      "packages/bio-checks/src/index.ts": [
        'export * as citations from "./citations/index.ts";\n',
        'export { checkCalibration, type CalibrationInput, type CalibrationResult, type CalibrationStatus } from "./calibration.ts";\n',
      ],
      "packages/bio-checks/src/validity/index.ts": [
        'export { checkCalibration as calibrateTask } from "../calibration.ts";\n',
        'export type { CalibrationRunner, RunnerCalibrationInput as CalibrationInput, RunnerCalibrationResult as CalibrationResult } from "../calibration.ts";\n',
        'export type CalibrationStatus = import("../calibration.ts").RunnerCalibrationResult["status"];\n',
      ],
      "packages/bio-toolpack/src/main.ts": [
        'import { citationsCommand } from "./commands/citations.ts";\n',
        '  citations: (argv, io) => citationsCommand(argv, io.cwd),\n',
      ],
    };
    if (rel === "packages/bio-checks/src/validity/index.ts") {
      const boundary = "export interface ClusterVsGradientOptions {";
      if (text.split(boundary).length !== 2) throw new Error("gradient pruning source drift");
      text = text.slice(0, text.indexOf(boundary));
    }
    for (const line of removals[rel] ?? []) {
      if (text.split(line).length !== 2) throw new Error(`profile pruning source drift: ${rel}`);
      text = text.replace(line, "");
    }
  }
  return Buffer.from(text);
}

/** Repository-relative paths of every module reachable from ENTRY through relative imports. */
export function importClosure(root = REPO_ROOT, entry = ENTRY, profile: Profile = "checks"): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const rel = queue.pop()!;
    if (seen.has(rel)) continue;
    if (!/^packages\/[a-z0-9-]+\/src\/[A-Za-z0-9_./-]+\.ts$/.test(rel)) throw new Error(`bundle module outside packages/*/src: ${rel}`);
    const abs = path.join(root, rel);
    if (!existsSync(abs) || !lstatSync(abs).isFile()) throw new Error(`bundle module missing: ${rel}`);
    seen.add(rel);
    const text = moduleBytes(root, rel, profile).toString();
    for (const pattern of SPECIFIERS) {
      for (const match of text.matchAll(pattern)) {
        const spec = match[1]!;
        if (spec.startsWith("node:")) continue;
        if (!spec.startsWith("./") && !spec.startsWith("../")) throw new Error(`bundle cannot include the package dependency "${spec}" (imported by ${rel})`);
        if (!spec.endsWith(".ts")) throw new Error(`bundle import without .ts extension: "${spec}" in ${rel}`);
        queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
      }
    }
  }
  return [...seen].sort();
}

function simSources(root: string): string[] {
  const dir = path.join(root, "packages/bio-toolpack/sim");
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name === "__pycache__") continue;
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(abs, entry.name), childRel);
      else if (entry.isFile() && entry.name.endsWith(".py")) out.push(childRel);
      else throw new Error(`unexpected file in sim sources: ${childRel}`);
    }
  };
  walk(dir, "sim");
  return out;
}

/** The complete, deterministic file set for a profile. */
export function buildBundle(profile: Profile, root = REPO_ROOT): Bundle {
  const files: Bundle = new Map();
  const read = (rel: string) => readFileSync(path.join(root, rel));
  const modules = importClosure(root, ENTRY, profile);
  for (const rel of modules) files.set(`src/${rel}`, { bytes: moduleBytes(root, rel, profile), mode: 0o444 });
  for (const pkg of [...new Set(modules.map((rel) => rel.split("/").slice(0, 2).join("/")))].sort()) {
    files.set(`src/${pkg}/package.json`, { bytes: read(`${pkg}/package.json`), mode: 0o444 });
  }
  files.set("bin/omb-check", { bytes: Buffer.from(OMB_CHECK), mode: 0o555 });
  files.set("PROMPT-SENTENCE.txt", { bytes: read("packages/bio-toolpack/prompt-sentence.txt"), mode: 0o444 });
  files.set("PROFILE", { bytes: Buffer.from(`${profile}\n`), mode: 0o444 });
  const readme = read("packages/bio-toolpack/TOOLS.md");
  if (profile === "full") {
    files.set("TOOLS.md", { bytes: Buffer.concat([readme, Buffer.from("\n"), read("packages/bio-toolpack/TOOLS-full.md")]), mode: 0o444 });
    files.set("bin/omb-sim", { bytes: Buffer.from(OMB_SIM), mode: 0o555 });
    for (const rel of simSources(root)) files.set(rel, { bytes: read(`packages/bio-toolpack/${rel}`), mode: 0o444 });
  } else {
    files.set("TOOLS.md", { bytes: readme, mode: 0o444 });
  }
  return new Map([...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function fileListing(files: ReadonlyMap<string, { sha256: string; mode: number }>): string {
  return [...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([rel, f]) => `${f.mode.toString(8)} ${f.sha256} ${rel}\n`).join("");
}

export function bundleDigest(bundle: Bundle): { sha256: string; files: Record<string, string> } {
  const entries = new Map([...bundle.entries()].map(([rel, f]) => [rel, { sha256: sha256(f.bytes), mode: f.mode }]));
  return { sha256: sha256(fileListing(entries)), files: Object.fromEntries([...entries.entries()].map(([rel, f]) => [rel, `${f.mode.toString(8)} ${f.sha256}`])) };
}

/** Hash an installed tree. Anything but directories and regular files is refused. */
export function hashTree(dir: string): { sha256: string; files: Record<string, string> } {
  const entries = new Map<string, { sha256: string; mode: number }>();
  const walk = (abs: string, rel: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.isFile()) entries.set(childRel, { sha256: sha256(readFileSync(childAbs)), mode: lstatSync(childAbs).mode & 0o777 });
      else throw new Error(`tool pack contains a non-regular file: ${childRel}`);
    }
  };
  walk(dir, "");
  return { sha256: sha256(fileListing(entries)), files: Object.fromEntries([...entries.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([rel, f]) => [rel, `${f.mode.toString(8)} ${f.sha256}`])) };
}

/** Write a bundle into a new directory; files and directories end read-only. */
export function writeBundle(bundle: Bundle, outDir: string): void {
  if (existsSync(outDir)) throw new Error(`refusing to overwrite ${outDir}`);
  mkdirSync(outDir, { recursive: true, mode: 0o755 });
  const dirs = new Set<string>([outDir]);
  for (const [rel, file] of bundle) {
    const target = path.join(outDir, rel);
    for (let d = path.dirname(target); d.startsWith(outDir) && !dirs.has(d); d = path.dirname(d)) dirs.add(d);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    writeFileSync(target, file.bytes, { mode: 0o600, flag: "wx" });
    chmodSync(target, file.mode);
  }
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) chmodSync(d, 0o555);
}

export interface Lock {
  schema: typeof LOCK_SCHEMA;
  node: string;
  profiles: Record<Profile, { sha256: string; files: Record<string, string> }>;
}

export function readLock(file = LOCK_FILE): Lock {
  const lock = JSON.parse(readFileSync(file, "utf8")) as Lock;
  if (lock.schema !== LOCK_SCHEMA || typeof lock.profiles !== "object" || !PROFILES.every((p) => /^[0-9a-f]{64}$/.test(lock.profiles[p]?.sha256 ?? ""))) {
    throw new Error(`invalid tool pack lock ${file}`);
  }
  return lock;
}

export function makeLock(root = REPO_ROOT): Lock {
  return {
    schema: LOCK_SCHEMA, node: NODE_BIN,
    profiles: { checks: bundleDigest(buildBundle("checks", root)), full: bundleDigest(buildBundle("full", root)) },
  };
}

/** Human-readable differences between a pinned digest and an actual one. */
export function digestDiff(pinned: Record<string, string>, actual: Record<string, string>): string[] {
  const out: string[] = [];
  for (const rel of [...new Set([...Object.keys(pinned), ...Object.keys(actual)])].sort()) {
    if (!(rel in actual)) out.push(`missing ${rel}`);
    else if (!(rel in pinned)) out.push(`unexpected ${rel}`);
    else if (pinned[rel] !== actual[rel]) out.push(`changed ${rel}`);
  }
  return out;
}
