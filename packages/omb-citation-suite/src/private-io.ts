// Plaintext hold-out may only be written inside the grading root, and never through a symlink:
// the destination directory's real path must lie inside the root's real path with no symlink
// between them, and the file is created exclusively with O_NOFOLLOW (an existing file or a planted
// symlink at the final component is refused, never followed or overwritten).
//
// The look ledger records every frozen verifier that scored the hold-out, so held-out results are
// reported with how many times the hold-out has been looked at.

import { closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export function insideRealRoot(root: string, file: string): { ok: true; target: string } | { ok: false; reason: string } {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const rootReal = realpathSync(root);
  const target = resolve(file);
  const parent = dirname(target);
  let parentReal: string;
  try {
    parentReal = realpathSync(parent);
  } catch {
    return { ok: false, reason: `destination directory does not exist: ${parent}` };
  }
  if (parentReal !== rootReal && !parentReal.startsWith(rootReal + sep)) {
    return { ok: false, reason: `private output must be inside the grading root (${rootReal})` };
  }
  const lexical = relative(resolve(root), parent);
  const real = relative(rootReal, parentReal);
  if (lexical !== real) return { ok: false, reason: "symlink in the private output path refused" };
  return { ok: true, target };
}

/** Exclusive, no-follow creation of a private file inside the grading root. */
export function writePrivateFile(root: string, file: string, data: string): string {
  const check = insideRealRoot(root, file);
  if (!check.ok) throw new Error(check.reason);
  let fd: number;
  try {
    fd = openSync(check.target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ELOOP") throw new Error(`refusing to write over an existing file or symlink: ${check.target}`);
    throw e;
  }
  try {
    writeSync(fd, data);
  } finally {
    closeSync(fd);
  }
  return check.target;
}

export interface LookEntry {
  suite: string;
  verifierId: string;
  resultsSha256: string;
  at: string;
}

export interface LookInfo {
  number: number;
  priorVerifierIds: string[];
}

/**
 * Record a held-out scoring of a frozen verifier. Re-scoring the same verifier with the same results
 * is idempotent; the same verifier id with different results is refused (it was not frozen).
 */
export function recordLook(root: string, entry: Omit<LookEntry, "at">, now: () => Date): LookInfo {
  if (!entry.verifierId.trim()) throw new Error("a frozen verifier id is required to score the hold-out");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const ledger = join(realpathSync(root), "pw4s-looks.jsonl");
  const prior: LookEntry[] = existsSync(ledger)
    ? readFileSync(ledger, "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as LookEntry)
    : [];
  const forSuite = prior.filter((e) => e.suite === entry.suite);
  const same = forSuite.find((e) => e.verifierId === entry.verifierId);
  if (same && same.resultsSha256 !== entry.resultsSha256) {
    throw new Error(`verifier ${entry.verifierId} already scored this hold-out with different results; freeze a new verifier id`);
  }
  const order = [...new Set(forSuite.map((e) => e.verifierId))];
  if (!same) {
    const fd = openSync(ledger, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      writeSync(fd, JSON.stringify({ ...entry, at: now().toISOString() }) + "\n");
    } finally {
      closeSync(fd);
    }
    order.push(entry.verifierId);
  }
  const idx = order.indexOf(entry.verifierId);
  return { number: idx + 1, priorVerifierIds: order.slice(0, idx) };
}
