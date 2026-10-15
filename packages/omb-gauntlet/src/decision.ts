// The deterministic decision-rule evaluator: locked plan + software-recomputed numbers -> one
// outcome per claim. No LLM, no transcript, no worker-written status is read.
//
// Statistical kinds (effect-exists, effect-size, null, out-of-sample):
//   supported     adjusted p <= alpha / L (family-adjusted, L looks) and, for one-sided rules, the
//                 estimate lies on the declared side of the null value;
//   contradicted  not supported, and the CI lies inside the MEI band around the null value
//                 (two-sided: both bounds; greater: upper bound below null + MEI; less: lower bound
//                 above null - MEI) - "CI below the MEI";
//   inconclusive  otherwise; unevaluable when a number the rule needs is missing.
// Reproduction: |estimate - target| <= tolerance (or target inside the CI when no tolerance).
// Data integrity: the claimed value equals the software staging fact (G1 evidence).
// Citation: decided by the CIT gate (verified / fabricated or quote-not-found / other).

import type { GateBoard } from "./gates.ts";
import { finite } from "./json.ts";
import { adjustPValues } from "./multiplicity.ts";
import { isStatistical, type ClaimKind, type Plan, type PlanClaim } from "./plan.ts";
import { POLICY, meiBounds } from "./policy.ts";
import { findEntry, type Interval, type MetricTable, type MetricValue, type PrimaryOutputs } from "./primary.ts";

export type DecisionOutcome = "supported" | "contradicted" | "inconclusive" | "unevaluable";

export interface DecisionValues {
  readonly estimate: number | null;
  readonly ci: Interval | null;
  readonly p: number | null;
  readonly pAdjusted: number | null;
  readonly alphaEffective: number | null;
  readonly nUnits: number | null;
  readonly observedDirection: "greater" | "less" | "none" | null;
}

export interface DecisionResult {
  readonly claimId: string;
  readonly kind: ClaimKind;
  readonly outcome: DecisionOutcome;
  readonly material?: boolean | null;
  /** Software-written reason; contains no unit IDs. */
  readonly reason: string;
  readonly values: DecisionValues;
  /** Software-derived numbers for the metric table ("<claim>.p_adjusted", "<claim>.alpha"). */
  readonly derived: Readonly<Record<string, MetricValue>>;
}

export interface DecisionContext {
  readonly plan: Plan;
  readonly primary: PrimaryOutputs | null;
  readonly metrics: MetricTable;
  readonly board: GateBoard;
  /** L, the number of looks allowed on the data (default 1): alpha_effective = alpha / L. */
  readonly looksAllowed?: number;
}

const EMPTY: DecisionValues = { estimate: null, ci: null, p: null, pAdjusted: null, alphaEffective: null, nUnits: null, observedDirection: null };

function result(claim: PlanClaim, outcome: DecisionOutcome, reason: string, values: Partial<DecisionValues> = {}, derived: Record<string, MetricValue> = {}): DecisionResult {
  const ci=values.ci, mei=claim.materialMei === undefined ? claim.mei : claim.materialMei;
  // Bounds on the estimand's MEI scale (a geometric-mean ratio is judged multiplicatively around the
  // null ratio, K2b-fix2); undefined bounds are never material.
  const bounds=mei===null?null:meiBounds(claim.estimand,claim.nullValue,mei);
  const material=claim.knobs.material===true && outcome==='supported' && ci && bounds!==null
    ? claim.direction==='greater'?ci[0]>bounds[1]:claim.direction==='less'?ci[1]<bounds[0]:ci[0]>bounds[1]||ci[1]<bounds[0]
    : claim.knobs.material===true ? false : null;
  return { claimId: claim.id, kind: claim.kind, outcome, material, reason, values: { ...EMPTY, ...values }, derived };
}

/** Family-adjusted p-values of every confirmatory statistical claim (missing p counts as 1). */
export function familyAdjustedP(plan: Plan, primary: PrimaryOutputs | null): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const statistical = plan.claims.filter((c) => isStatistical(c.kind));
  // An unkeyed primary.json block ("*") belongs only to a single-claim plan (same rule everywhere).
  const single = plan.claims.length === 1;
  for (const family of plan.families) {
    // Exploratory claims are outside the confirmatory family (they still count in its size).
    const members = statistical.filter((c) => c.family === family.name && !c.exploratory);
    const ps = members.map((c) => findEntry(primary, c.metric, single)?.p ?? null);
    const adjusted = adjustPValues(ps.map((p) => p ?? 1), family.method, family.size);
    members.forEach((c, i) => out.set(c.id, ps[i] === null ? null : adjusted[i]!));
  }
  return out;
}

function decideStatistical(claim: PlanClaim, ctx: DecisionContext, adjusted: Map<string, number | null>): DecisionResult {
  const entry = findEntry(ctx.primary, claim.metric, ctx.plan.claims.length === 1);
  if (!entry) return result(claim, "unevaluable", "no software-recomputed block for this claim's metric");
  const looks = ctx.looksAllowed ?? POLICY.looksAllowedDefault;
  if (!Number.isSafeInteger(looks) || looks < 1) return result(claim, "unevaluable", "invalid look budget");
  if (!finite(claim.alpha) || claim.alpha <= 0 || claim.alpha > POLICY.alphaMax) return result(claim, "unevaluable", "invalid locked alpha");
  // A directional claim is never decided above the calibrated one-sided level.
  const alphaEffective = Math.min(claim.alpha, claim.direction === "two-sided" ? POLICY.alphaMax : POLICY.directionalAlphaMax) / looks;
  const base: Partial<DecisionValues> = { estimate: entry.estimate, ci: entry.ci, p: entry.p, nUnits: entry.nUnits, alphaEffective };
  if (entry.p === null) return result(claim, "unevaluable", "no software-recomputed p-value", base);
  const pAdjusted = claim.exploratory ? entry.p : adjusted.get(claim.id) ?? null;
  if (pAdjusted === null) return result(claim, "unevaluable", "no family-adjusted p-value", base);
  const needsEstimate = claim.direction !== "two-sided" || claim.kind === "effect-size" || claim.kind === "out-of-sample";
  if (needsEstimate && entry.estimate === null) return result(claim, "unevaluable", "the rule needs a recomputed estimate", { ...base, pAdjusted });
  if ((claim.kind === "effect-size" || claim.kind === "out-of-sample") && entry.ci === null) {
    return result(claim, "unevaluable", "estimate claims need a recomputed confidence interval", { ...base, pAdjusted });
  }
  const observedDirection = entry.estimate === null ? null
    : entry.estimate > claim.nullValue ? "greater" : entry.estimate < claim.nullValue ? "less" : "none";
  const values: Partial<DecisionValues> = { ...base, pAdjusted, observedDirection };
  const derived: Record<string, MetricValue> = { [`${claim.id}.p_adjusted`]: pAdjusted, [`${claim.id}.alpha`]: alphaEffective };
  const significant = pAdjusted <= alphaEffective;
  const sideOk = claim.direction === "two-sided" || observedDirection === claim.direction;
  if (significant && sideOk) {
    return result(claim, "supported", `adjusted p <= alpha ${alphaEffective}${claim.direction === "two-sided" ? "" : `, estimate on the declared side (${claim.direction})`}`, values, derived);
  }
  // Contradiction needs non-significance at the locked level too (never at the capped level alone).
  const bounds = claim.mei === null ? null : meiBounds(claim.estimand, claim.nullValue, claim.mei);
  if (entry.p > Math.max(alphaEffective, claim.alpha / looks) && bounds !== null && entry.ci !== null) {
    const [lo, hi] = entry.ci;
    const [lower, upper] = bounds;
    const inside = claim.direction === "two-sided" ? lo > lower && hi < upper
      : claim.direction === "greater" ? hi < upper : lo > lower;
    if (inside) return result(claim, "contradicted", "not supported, and the confidence interval excludes effects at least as large as the minimum effect of interest", values, derived);
  }
  const why = significant && !sideOk ? "significant, but the estimate lies on the other side of the null value"
    : claim.mei === null ? "not supported; no minimum effect of interest, so absence cannot be shown"
      : entry.ci === null ? "not supported; no confidence interval, so absence cannot be shown"
        : "not supported, and the confidence interval still includes effects of interest";
  return result(claim, "inconclusive", why, values, derived);
}

function decideReproduction(claim: PlanClaim, ctx: DecisionContext): DecisionResult {
  const entry = findEntry(ctx.primary, claim.metric, ctx.plan.claims.length === 1);
  if (!entry || entry.estimate === null) return result(claim, "unevaluable", "no software-recomputed estimate for the reproduced value");
  const target = claim.target;
  if (target === null) return result(claim, "unevaluable", "no published target value");
  const values: Partial<DecisionValues> = { estimate: entry.estimate, ci: entry.ci, p: entry.p, nUnits: entry.nUnits };
  const cap = POLICY.reproductionToleranceCapRel * Math.abs(target.value);
  if (target.tolerance !== null) {
    const allowed = Math.min(cap, Math.max(target.tolerance.abs, target.tolerance.rel * Math.abs(target.value)));
    return Math.abs(entry.estimate - target.value) <= allowed
      ? result(claim, "supported", "recomputed estimate within the declared tolerance of the published value", values)
      : result(claim, "contradicted", "recomputed estimate outside the declared tolerance of the published value", values);
  }
  if (entry.ci === null) return result(claim, "unevaluable", "no tolerance declared and no recomputed confidence interval", values);
  return Math.abs(entry.estimate - target.value) <= cap && entry.ci[0] <= target.value && target.value <= entry.ci[1]
    ? result(claim, "supported", "published value lies inside the recomputed confidence interval", values)
    : result(claim, "contradicted", "published value lies outside the recomputed confidence interval", values);
}

function decideIntegrity(claim: PlanClaim, ctx: DecisionContext): DecisionResult {
  const g1 = ctx.board.lookup("G1", claim.id);
  if (!g1.passed || g1.result === null) return result(claim, "unevaluable", "software staging facts (G1) are unavailable");
  const facts = g1.result.evidence.facts;
  const fact = facts !== null && typeof facts === "object" && !Array.isArray(facts) ? (facts as Record<string, unknown>)[claim.fact ?? claim.metric] : undefined;
  if (!finite(fact)) return result(claim, "unevaluable", `software staging did not establish the fact ${JSON.stringify(claim.fact ?? claim.metric)}`);
  const fromMetrics = ctx.metrics.values.get(claim.metric);
  const asserted = claim.assertedValue ?? (typeof fromMetrics === "number" ? fromMetrics : null);
  if (asserted === null) return result(claim, "unevaluable", "the claim asserts no value to verify");
  return asserted === fact
    ? result(claim, "supported", "the claimed value equals the software staging fact", { estimate: asserted })
    : result(claim, "contradicted", "the claimed value differs from the software staging fact", { estimate: asserted });
}

const CITATION_CONTRADICTED = new Set(["fabricated", "quote-not-found"]);

function decideCitation(claim: PlanClaim, ctx: DecisionContext): DecisionResult {
  const cit = ctx.board.lookup("CIT", claim.id);
  if (cit.passed) return result(claim, "supported", "every cited item resolves verbatim against the frozen index");
  if (cit.reason === null && cit.outcome === "failed" && Array.isArray(cit.result?.evidence.statuses) && cit.result.evidence.statuses.includes(cit.result.code ?? "") && cit.result?.code !== undefined && CITATION_CONTRADICTED.has(cit.result.code)) {
    return result(claim, "contradicted", `a cited item is ${cit.result.code} against the frozen index`);
  }
  if (cit.outcome === "absent" || cit.outcome === "not-run") return result(claim, "unevaluable", "citation resolution has not run");
  return result(claim, "inconclusive", "citation resolution did not verify every cited item");
}

export function decideClaim(claim: PlanClaim, ctx: DecisionContext, adjusted = familyAdjustedP(ctx.plan, ctx.primary)): DecisionResult {
  switch (claim.kind) {
    case "reproduction": return decideReproduction(claim, ctx);
    case "data-integrity": return decideIntegrity(claim, ctx);
    case "citation": return decideCitation(claim, ctx);
    default: return decideStatistical(claim, ctx, adjusted);
  }
}

export function decidePlan(ctx: DecisionContext): Map<string, DecisionResult> {
  const adjusted = familyAdjustedP(ctx.plan, ctx.primary);
  return new Map(ctx.plan.claims.map((claim) => [claim.id, decideClaim(claim, ctx, adjusted)]));
}
