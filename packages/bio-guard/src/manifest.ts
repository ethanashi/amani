import { constants, copyFileSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, canonicalSha256 } from "../../bio-core/src/index.ts";
import { directory, hashFile, inventory, safeRelative } from "./files.ts";
import { assertTerms, checkTerms, type DatasetIdentity } from "./terms.ts";
import { exactKeys, isoTimestamp, record, result, type GuardResult } from "./validation.ts";

export const MANIFEST_FILE = "manifest.json";

export interface DatasetFile extends DatasetIdentity {
  path: string;
  retrievedAt: string;
  sha256: string;
  bytes: number;
}
export interface DatasetManifest {
  version: 1;
  files: DatasetFile[];
}
export type ManifestVerification = GuardResult & { manifestSha256?: string };

function validateManifest(value: unknown): asserts value is DatasetManifest {
  if (!record(value) || !exactKeys(value, ["version", "files"]) || value.version !== 1 || !Array.isArray(value.files) || !value.files.length) {
    throw new Error("missing, empty or unsupported manifest");
  }
  const seen = new Set<string>();
  for (const entry of value.files) {
    if (!record(entry) || !exactKeys(entry, ["path", "source", "accession", "url", "retrievedAt", "sha256", "bytes", "terms"]) ||
      !safeRelative(entry.path) || entry.path === MANIFEST_FILE || entry.path.startsWith(`${MANIFEST_FILE}/`) ||
      !isoTimestamp(entry.retrievedAt) || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.bytes) || (entry.bytes as number) < 0) throw new Error("malformed manifest file record");
    const folded = entry.path.normalize("NFC").toLowerCase();
    if (seen.has(folded)) throw new Error(`duplicate manifest path: ${entry.path}`);
    seen.add(folded);
    const terms = checkTerms(entry);
    if (!terms.ok) throw new Error(`${entry.path}: ${terms.reasons.join("; ")}`);
  }
}

/** A failed or unavailable check is a refusal, never an empty successful result.
 * Pin expectedManifestSha256 in the host journal to also detect manifest+data replacement.
 */
export function verifyManifest(dir: string, expectedManifestSha256?: string): ManifestVerification {
  try {
    const root = directory(dir);
    const tree = inventory(root);
    if (!tree.files.includes(MANIFEST_FILE)) throw new Error("manifest missing");
    if (lstatSync(path.join(root, MANIFEST_FILE)).size > 4 * 1024 * 1024) throw new Error("manifest exceeds 4 MiB");
    const manifest: unknown = JSON.parse(readFileSync(path.join(root, MANIFEST_FILE), "utf8"));
    validateManifest(manifest);
    const manifestSha256 = canonicalSha256(manifest);
    const reasons: string[] = [];
    if (expectedManifestSha256 !== undefined && expectedManifestSha256 !== manifestSha256) reasons.push("manifest commitment mismatch");
    const expected = new Set(manifest.files.map(file => file.path));
    for (const file of tree.files) if (file !== MANIFEST_FILE && !expected.has(file)) reasons.push(`extra file: ${file}`);
    // Empty/unlisted directories also fail closed, including hidden directories.
    for (const entry of tree.directories) if (!manifest.files.some(file => file.path.startsWith(`${entry}/`))) reasons.push(`extra directory: ${entry}`);
    for (const file of manifest.files) {
      if (!tree.files.includes(file.path)) { reasons.push(`missing file: ${file.path}`); continue; }
      const actual = hashFile(path.join(root, file.path));
      if (actual.sha256 !== file.sha256) reasons.push(`hash mismatch: ${file.path}`);
      if (actual.bytes !== file.bytes) reasons.push(`byte count mismatch: ${file.path}`);
    }
    return { ...result(reasons), manifestSha256 };
  } catch (error) { return result([`manifest verification refused: ${error instanceof Error ? error.message : String(error)}`]); }
}

export function assertVerifiedManifest(dir: string, expectedManifestSha256?: string): void {
  const checked = verifyManifest(dir, expectedManifestSha256);
  if (!checked.ok) throw new Error(`analysis refused: ${checked.reasons.join("; ")}`);
}

export interface StageFile extends DatasetIdentity {
  path: string;
  sourcePath: string;
  /** Actual retrieval time supplied by the trusted host, not the staging clock. */
  retrievedAt: string;
  /** Pinned by the host before staging, not inferred from a worker's output. */
  sha256: string;
  bytes: number;
}
export type StagingBoundary = "before-copy" | "after-source-hash" | "after-copy" | "before-manifest" | "after-manifest";

/** Offline, exclusive staging. Every terms rule runs before opening any source file.
 * The destination must not exist; only a complete verified dataset survives success.
 */
export function stageDataset(input: {
  destination: string;
  files: StageFile[];
  now: () => number;
  faultAt?: (point: StagingBoundary) => void;
}): { manifest: DatasetManifest; manifestSha256: string } {
  if (!Array.isArray(input.files) || !input.files.length) throw new Error("staging refused: no files");
  for (const file of input.files) assertTerms(file);
  const stagingTime = input.now();
  if (!Number.isFinite(stagingTime) || !isoTimestamp(new Date(stagingTime).toISOString())) throw new Error("invalid staging clock");
  for (const file of input.files) {
    if (!isoTimestamp(file.retrievedAt) || Date.parse(file.retrievedAt) > stagingTime) {
      throw new Error("retrieval timestamp must be valid and no later than staging time");
    }
  }
  const manifest: DatasetManifest = { version: 1, files: input.files.map(file => ({
    path: file.path, source: file.source, accession: file.accession, url: file.url,
    terms: { ...file.terms }, sha256: file.sha256, bytes: file.bytes, retrievedAt: file.retrievedAt,
  })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
  validateManifest(manifest);
  if (!path.isAbsolute(input.destination)) throw new Error("staging destination must be absolute");
  const destination = path.join(directory(path.dirname(input.destination)), path.basename(input.destination));
  // Outside try: an existing destination must NEVER be removed on refusal.
  mkdirSync(destination, { mode: 0o700 });
  try {
    for (const file of input.files) {
      input.faultAt?.("before-copy");
      const actual = hashFile(file.sourcePath);
      if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes) throw new Error(`source hash/bytes mismatch: ${file.path}`);
      input.faultAt?.("after-source-hash");
      const target = path.join(destination, file.path);
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      copyFileSync(file.sourcePath, target, constants.COPYFILE_EXCL);
      input.faultAt?.("after-copy");
    }
    input.faultAt?.("before-manifest");
    writeFileSync(path.join(destination, MANIFEST_FILE), canonicalJson(manifest), { flag: "wx", mode: 0o400 });
    input.faultAt?.("after-manifest");
    const manifestSha256 = canonicalSha256(manifest);
    assertVerifiedManifest(destination, manifestSha256);
    return { manifest, manifestSha256 };
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}
