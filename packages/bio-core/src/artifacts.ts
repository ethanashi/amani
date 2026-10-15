import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface ProofArtifactRef {
  sha256: string;
  sizeBytes: number;
  mediaType: string;
  label: string;
}

/** Host-private immutable snapshots. Artifacts are observations, not verdicts. */
export class ProofArtifactStore {
  readonly root: string;
  readonly #maxBytes: number;

  constructor(root: string, maxBytes = 32 * 1024 * 1024) {
    if (!path.isAbsolute(root) || root === path.parse(root).root) throw new Error("artifact root must be a private absolute directory");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024 * 1024) throw new Error("invalid artifact size budget");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const info = lstatSync(root);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error("artifact root must be an owner-private directory, not a symlink");
    this.root = realpathSync(root);
    this.#maxBytes = maxBytes;
  }

  putBytes(bytes: Uint8Array, metadata: { mediaType: string; label: string }): ProofArtifactRef {
    validateMetadata(metadata);
    if (bytes.byteLength > this.#maxBytes) throw new Error("artifact exceeds size budget");
    const sha256 = digest(bytes);
    const ref = { sha256, sizeBytes: bytes.byteLength, mediaType: metadata.mediaType, label: metadata.label };
    const destination = this.pathFor(ref);
    const temporary = path.join(this.root, `.pending-${randomUUID()}`);
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, bytes); fchmodSync(fd, 0o400); fsyncSync(fd); }
    catch (error) { closeSync(fd); unlinkSync(temporary); throw error; }
    closeSync(fd);
    try {
      try { linkSync(temporary, destination); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      // A competing publisher or preexisting corrupt object cannot be trusted
      // just because the filename equals the expected digest.
      this.verify(ref);
      const dir = openSync(this.root, constants.O_RDONLY);
      try { fsyncSync(dir); } finally { closeSync(dir); }
    } finally { unlinkSync(temporary); }
    return ref;
  }

  captureFile(sourceRoot: string, relativePath: string, metadata: { mediaType: string; label: string }): ProofArtifactRef {
    validateArtifactPath(relativePath);
    if (lstatSync(sourceRoot).isSymbolicLink()) throw new Error("artifact source root cannot be a symlink");
    const root = realpathSync(sourceRoot);
    const source = path.join(root, relativePath);
    let current = root;
    for (const segment of relativePath.split("/")) {
      current = path.join(current, segment);
      if (lstatSync(current).isSymbolicLink()) throw new Error("artifact source cannot traverse symlinks");
    }
    if (!inside(realpathSync(path.dirname(source)), root)) throw new Error("artifact source escaped its declared root");
    return this.putBytes(readBounded(source, this.#maxBytes, true), metadata);
  }

  pathFor(ref: ProofArtifactRef): string {
    validateArtifactRef(ref);
    return path.join(this.root, ref.sha256);
  }

  verify(ref: ProofArtifactRef): void {
    const bytes = readBounded(this.pathFor(ref), this.#maxBytes, false);
    if (bytes.length !== ref.sizeBytes || digest(bytes) !== ref.sha256) throw new Error("retained artifact integrity mismatch");
  }
}

export function validateArtifactPath(value: string): void {
  // One component under a host-created output root. Traversing mutable child
  // directories would require openat2/dirfd walking for race-safe containment.
  // Screenshot/trace producers choose explicit flat output names instead.
  if (typeof value !== "string" || !value || value.length > 255 || path.isAbsolute(value) || value.includes("/") || value.includes("\\") || value.includes("\0")
    || value.split("/").some(part => !part || part === "." || part === "..")) throw new Error("invalid relative artifact path");
}

export function validateArtifactRef(ref: ProofArtifactRef): void {
  if (typeof ref !== "object" || ref === null || typeof ref.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(ref.sha256)
    || Object.keys(ref).sort().join(",") !== "label,mediaType,sha256,sizeBytes"
    || !Number.isSafeInteger(ref.sizeBytes) || ref.sizeBytes < 0 || ref.sizeBytes > 256 * 1024 * 1024) throw new Error("invalid artifact reference");
  validateMetadata(ref);
}

function validateMetadata(metadata: { mediaType: string; label: string }): void {
  if (typeof metadata.mediaType !== "string" || metadata.mediaType.length > 128 || !/^[\w.+-]+\/[\w.+-]+$/.test(metadata.mediaType)
    || typeof metadata.label !== "string" || !metadata.label.trim() || metadata.label.length > 256 || /[\x00-\x1f]/.test(metadata.label)) throw new Error("invalid artifact metadata");
}

function readBounded(file: string, limit: number, rejectHardlinks: boolean): Buffer {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(limit) || (rejectHardlinks && before.nlink !== 1n)) throw new Error("artifact must be a bounded regular unlinked file");
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, limit - total + 1));
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (!count) break;
      total += count;
      if (total > limit) throw new Error("artifact grew beyond size budget");
      chunks.push(chunk.subarray(0, count));
    }
    const after = fstatSync(fd, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error("artifact changed while being captured");
    return Buffer.concat(chunks);
  } finally { closeSync(fd); }
}

function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function inside(value: string, root: string): boolean { return value === root || value.startsWith(root + path.sep); }
