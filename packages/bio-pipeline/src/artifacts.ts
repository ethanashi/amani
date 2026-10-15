import { createHash } from "node:crypto";
import { ProofArtifactStore, validateArtifactRef, type ProofArtifactRef } from "../../bio-core/src/index.ts";

/** Reuse only publications that this instance has already durably completed.
 * Capture still uses core's bounded, no-link, stable-file reader, and every reuse
 * re-verifies bytes. Failed/interrupted publications never enter the cache. */
export class PipelineArtifactStore extends ProofArtifactStore {
  private readonly committed = new Set<string>();
  override putBytes(bytes: Uint8Array, metadata: { mediaType: string; label: string }): ProofArtifactRef {
    const ref = { sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.byteLength, ...metadata };
    validateArtifactRef(ref);
    if (this.committed.has(ref.sha256)) { this.verify(ref); return ref; }
    const stored = super.putBytes(bytes, metadata);
    this.committed.add(stored.sha256);
    return stored;
  }
}
