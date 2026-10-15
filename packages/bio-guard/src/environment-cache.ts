import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalSha256 } from "../../bio-core/src/index.ts";
import { directory, hashFile, within } from "./files.ts";
import { assertNoExtendedAcl } from "./acl.ts";

export interface EnvironmentVerificationCache {
  /** Trusted host state, outside every worker-writable/input root. Must already exist. */
  stateRoot: string;
  prefix: string;
  /** Read and hashed on every lookup; never use a worker-supplied commitment. */
  lockfile: string;
}

/** Every entry, without following links. ctime catches edits with restored mtimes;
 * directory metadata catches added/removed entries at any depth. No content reads
 * of installed packages and no repeated filesystem-based ancestor comparisons.
 */
function fingerprint(prefix: string): string {
  const fields: (string | bigint)[] = [];
  function visit(file: string): void {
    const st = lstatSync(file, { bigint: true });
    fields.push(file, st.dev, st.ino, st.mode, st.uid, st.gid, st.nlink, st.size, st.mtimeNs, st.ctimeNs);
    if (st.isDirectory()) for (const name of readdirSync(file).sort()) visit(`${file}${path.sep}${name}`);
  }
  visit(prefix);
  return createHash("sha256").update(fields.join("\0")).digest("hex");
}

function ownedDirectory(file: string, privateMode: boolean): string {
  const root = directory(file), st = lstatSync(root);
  if (!process.getuid || st.uid !== process.getuid() || (st.mode & (privateMode ? 0o077 : 0o022))) {
    throw new Error(`environment cache directory is not owner-controlled: ${file}`);
  }
  assertNoExtendedAcl(root);
  return root;
}

function readReceipt(file: string): unknown {
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || !process.getuid || st.uid !== process.getuid() || (st.mode & 0o077)) {
      throw new Error("environment cache file is not owner-only");
    }
    assertNoExtendedAcl(file);
    if (st.size > 64 * 1024) return null;
    try { return JSON.parse(readFileSync(fd, "utf8")) as unknown; }
    catch (error) { if (error instanceof SyntaxError) return null; throw error; }
  } finally { closeSync(fd); }
}

/** Internal cache seam: only the trusted deterministic inspector may supply verify.
 * Filesystem inputs must remain host-owned and immutable through execution, just
 * as for an uncached check. This is a metadata manifest, not a content attestation.
 */
export function verifyEnvironment(
  input: EnvironmentVerificationCache, policyIdentity: string[], verify: (prefix: string) => void,
  excludedRoots: string[] = [],
): "hit" | "verified" {
  const prefix = directory(input.prefix);
  const state = ownedDirectory(input.stateRoot, false);
  const assertDisjoint = (storage: string) => {
    if ([prefix, ...excludedRoots].some(root => within(root, storage) || within(storage, root))) {
      throw new Error("cache state overlaps input or worker roots");
    }
  };
  assertDisjoint(state);
  let cacheDir = path.join(state, "environment-verifications");
  try { mkdirSync(cacheDir, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  cacheDir = ownedDirectory(cacheDir, true);
  assertDisjoint(cacheDir);
  const file = path.join(cacheDir, `${canonicalSha256({ prefix })}.json`);
  // Version 1 receipts predate the extended-ACL policy and must be reinspected.
  const before = { version: 2, prefix, lockfileHash: hashFile(input.lockfile).sha256,
    policyHash: canonicalSha256(policyIdentity), fingerprint: fingerprint(prefix) };
  const receipt = readReceipt(file);
  if (receipt !== null && typeof receipt === "object" && canonicalSha256(receipt) === canonicalSha256(before)) return "hit";
  verify(prefix);
  if (hashFile(input.lockfile).sha256 !== before.lockfileHash || fingerprint(prefix) !== before.fingerprint) {
    throw new Error("environment changed during verification");
  }
  const temporary = path.join(cacheDir, `.verify-${randomUUID()}`);
  try {
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, JSON.stringify(before) + "\n"); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
  return "verified";
}
