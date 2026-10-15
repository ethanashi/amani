import { canonicalSha256 } from "../../bio-core/src/index.ts";
import { hash } from "./records.ts";

export const MERKLE_SCHEME = "bio-registry-merkle-v1" as const;
/** Ordered leaves; canonical JSON domain separation; duplicate the last node at odd levels. */
export function merkleRoot(recordHashes: readonly string[]): string {
  let level = recordHashes.map(recordHash => {
    hash(recordHash);
    return canonicalSha256({ domain: `${MERKLE_SCHEME}:leaf`, recordHash });
  });
  if (!level.length) return canonicalSha256({ domain: `${MERKLE_SCHEME}:empty` });
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(canonicalSha256({ domain: `${MERKLE_SCHEME}:node`, left: level[i]!, right: level[i + 1] ?? level[i]! }));
    }
    level = next;
  }
  // Bind the count: otherwise three leaves and four with a duplicate tail share a root.
  return canonicalSha256({ domain: `${MERKLE_SCHEME}:root`, count: recordHashes.length, root: level[0]! });
}
export interface RegistryCommitment {
  readonly scheme: typeof MERKLE_SCHEME;
  readonly streamId: string;
  readonly recordCount: number;
  readonly recordHashes: readonly string[];
  readonly merkleRoot: string;
  readonly chainHead: string | null;
}
