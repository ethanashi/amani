import type { SchedPolicy } from "./policy.ts";
import { FAMILIES, isFamily, type Family, type FamilyRequirement, type JobRecord } from "./types.ts";

/** Families a requirement allows, minus refusers, in preference order. */
export function allowedFamilies(
  req: FamilyRequirement | null,
  excluded: readonly Family[],
  order: readonly Family[],
): Family[] {
  if (!req) return [];
  const base = req.mode === "any" ? order : req.mode === "exactly" ? [req.family] : order.filter((f) => f !== req.producer);
  return base.filter((f) => !excluded.includes(f));
}

export function describeRequirement(req: FamilyRequirement | null): string {
  if (!req) return "none";
  if (req.mode === "any") return "any";
  if (req.mode === "exactly") return `exactly:${req.family}`;
  return `cross-family:not-${req.producer}`;
}

export function validRequirement(req: unknown): req is FamilyRequirement {
  if (req === null || typeof req !== "object") return false;
  const r = req as Record<string, unknown>;
  if (r.mode === "any") return Object.keys(r).length === 1;
  if (r.mode === "exactly") return isFamily(r.family) && Object.keys(r).length === 2;
  if (r.mode === "cross-family") return isFamily(r.producer) && Object.keys(r).length === 2;
  return false;
}

export interface Placement { list: Family[]; unavailable: string | null }

/**
 * Ordered families to try for a queued LLM job, or why none can ever take it.
 * - A pinned job (it holds a session) can only resume on its pinned family.
 * - A reroute hint goes first when the requirement allows it.
 * - "any" jobs reach the secondary pool only when overflow is enabled.
 */
export function placementFamilies(job: JobRecord, policy: SchedPolicy): Placement {
  const req = job.spec.family;
  const allowed = allowedFamilies(req, job.excluded, policy.familyOrder).filter((f) => policy.pools[f].sessions > 0);
  if (allowed.length === 0) {
    const refused = job.excluded.length ? `refused by ${job.excluded.join("+")}` : "no enabled pool";
    return { list: [], unavailable: `requirement ${describeRequirement(req)}; ${refused}` };
  }
  if (job.pinned) {
    return allowed.includes(job.pinned)
      ? { list: [job.pinned], unavailable: null }
      : { list: [], unavailable: `session family ${job.pinned} is no longer allowed` };
  }
  let list = allowed;
  if (job.preferred && allowed.includes(job.preferred)) list = [job.preferred, ...allowed.filter((f) => f !== job.preferred)];
  if (req?.mode === "any" && !policy.overflowToSecondary) list = list.slice(0, 1);
  return { list, unavailable: null };
}

/** Invariant checked immediately before every dispatch. A violation is a scheduler bug, never a fallback. */
export function assertFamilyAllowed(job: JobRecord, family: Family, policy: SchedPolicy): void {
  const allowed = allowedFamilies(job.spec.family, job.excluded, policy.familyOrder);
  if (!allowed.includes(family) || (job.pinned !== null && job.pinned !== family)) {
    throw new Error(`omb-sched invariant: job ${job.spec.id} may not run on ${family} (${describeRequirement(job.spec.family)})`);
  }
}

/** Sort a family list in the fixed FAMILIES order (stable, deterministic persistence). */
export const sortFamilies = (list: readonly Family[]): Family[] => FAMILIES.filter((f) => list.includes(f));
