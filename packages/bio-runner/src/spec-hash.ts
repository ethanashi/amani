import { canonicalSha256 } from "./core.ts";

/**
 * The hash of a frozen spec (an analysis plan, a worker turn spec). Always `canonicalSha256`: every nested field
 * counts and key order does not. Amani's `specHash` (L/packages/company/src/experiments.ts) passed a top-level key
 * list as a JSON.stringify replacer, which silently drops nested fields; it is deliberately not copied.
 */
export function specSha256(spec: unknown): string {
  return canonicalSha256(spec);
}
