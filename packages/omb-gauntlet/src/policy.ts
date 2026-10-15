// Software-owned constants of the gauntlet (design section 5). A plan or caller may tighten these,
// never loosen them: looser requests are clamped to these values with a warning.

export const POLICY = Object.freeze({
  /** Default and maximum family alpha. A plan may declare a smaller alpha only. */
  alphaDefault: 0.05,
  alphaMax: 0.05,
  /** Owner decision (ICH E9): directional claims are decided at one-sided .025 at most; the K2a
   * false-direction bound (<= 5%) was calibrated at that level and is never stamped above it. */
  directionalAlphaMax: 0.025,
  /** G5b: planted-effect power needed for "refuted" / no-effect. */
  powerThreshold: 0.8,
  /** G5b: minimum planted-effect seeds. */
  plantedSeeds: 100,
  /** G5b: absolute tolerance below nominal interval coverage for the Wilson lower bound. */
  g5bCoverageTolerance: 0.05,
  /** G4: floats in the re-run must match within this relative tolerance (cap). */
  g4RelativeTolerance: 1e-9,
  /** G3: floating-point exactness, relative (cap). */
  g3RelativeTolerance: 1e-9,
  /** G3: display rounding is accepted only when half a display unit is at most this fraction of the
   * recomputed value (about three significant digits). */
  g3DisplayPrecisionCap: 0.005,
  /** Reproduction claims: the declared tolerance around a published value is capped at 10%. */
  reproductionToleranceCapRel: 0.1,
  /** G5a sequential null calibration at alpha 0.05: 200 permutations; <=14 rejections pass, >=20 fail;
   * 15-19 extend to 600 in total (400 more, new seeds) and fail at >=42 in total. */
  g5a: Object.freeze({ alpha: 0.05, stage1: 200, passMax: 14, failMin: 20, total: 600, failMinTotal: 42 }),
  /** G6: Benjamini-Hochberg only for declared screens of at least this many tests; Holm otherwise. */
  bhMinScreen: 20,
  /** Looks allowed on one partition (L in alpha_family / L). */
  looksAllowedDefault: 1,
});

/** Geometric-mean-ratio estimands: their MEI is on the natural-log scale (|log ratio|). */
const LOG_RATIO_ESTIMANDS: readonly string[] = ["geometric mean ratio", "ratio of geometric means"];
/** Brunner–Munzel relative-effect estimands, p = P(X<Y) + P(X=Y)/2: their MEI is |p − 0.5|. */
const RELATIVE_EFFECT_ESTIMANDS: readonly string[] = ["probability superiority", "relative effect", "common language effect"];
const fold = (estimand: string | null): string => estimand?.trim().toLowerCase() ?? "";

/** Owner decision (kernel v3, 2026-10-12): the registered minimum effect of interest on the ratio
 * and rank scales. A geometric-mean ratio of 1.25 (or 0.80), i.e. |log ratio| >= log 1.25 (the FDA
 * bioequivalence convention); a Brunner–Munzel relative effect with |p − 0.5| >= 0.06 (Cohen's
 * d ≈ 0.2 under normality). A locked plan may declare a larger MEI, never a smaller one. */
export const MEI_POLICY = Object.freeze({ logRatio: Math.log(1.25), relativeEffect: 0.06 });

/** The scale an estimand's MEI is expressed on: 'log-ratio' means the MEI m bounds |log(ratio /
 * null)|, so the bounds around a null ratio r0 are r0·e^{−m} and r0·e^{m}; 'additive' means
 * null ± m on the estimand's own scale (the relative-effect scale for Brunner–Munzel). */
export function meiScale(estimand: string | null): "log-ratio" | "additive" {
  return LOG_RATIO_ESTIMANDS.includes(fold(estimand)) ? "log-ratio" : "additive";
}

/** Absolute cap on the refutation MEI, on the estimand's MEI scale (meiScale). No generic scale-free
 * default is scientifically meaningful: unsupported metric families have no refutation allowance
 * until a trusted policy is registered. The ratio cap is applied on the log scale. */
export function meiCap(estimand:string|null):number|null {
  const e = fold(estimand);
  if (LOG_RATIO_ESTIMANDS.includes(e)) return MEI_POLICY.logRatio;
  if (RELATIVE_EFFECT_ESTIMANDS.includes(e)) return MEI_POLICY.relativeEffect;
  // A risk difference is an additive difference of probabilities (binary.exact-rd@1), so the same
  // absolute cap applies; without one its G7 tolerance bound could never be evaluated.
  return ['linear difference','linear slope','mean difference','additive difference','additive slope','logistic slope','log odds ratio','odds ratio','auc improvement','brier improvement','accuracy improvement','net benefit improvement','ece improvement','risk difference','binary risk difference'].includes(e)?1:null;
}

/** Registered lower bound on the MEI used for materiality ("never a smaller one"), on the
 * estimand's MEI scale; null where no floor is registered (additive estimands). */
export function meiFloor(estimand: string | null): number | null {
  const e = fold(estimand);
  return LOG_RATIO_ESTIMANDS.includes(e) ? MEI_POLICY.logRatio : RELATIVE_EFFECT_ESTIMANDS.includes(e) ? MEI_POLICY.relativeEffect : null;
}

/** [lower, upper] effects of interest around the null for an MEI on the estimand's scale; null when
 * the bounds are undefined (a log-ratio MEI around a non-positive null ratio, or a non-positive MEI). */
export function meiBounds(estimand: string | null, nullValue: number, mei: number): [number, number] | null {
  if (!Number.isFinite(nullValue) || !Number.isFinite(mei) || mei <= 0) return null;
  if (meiScale(estimand) === "log-ratio") return nullValue > 0 ? [nullValue * Math.exp(-mei), nullValue * Math.exp(mei)] : null;
  return [nullValue - mei, nullValue + mei];
}

/** Human-readable MEI with its scale (a log-ratio MEI also shows the ratio it stands for). */
export function describeMei(estimand: string | null, mei: number | null): string {
  if (mei === null) return "none";
  return meiScale(estimand) === "log-ratio" ? `log-ratio ${Number(mei.toPrecision(6))} (ratio ${Number(Math.exp(mei).toPrecision(6))})` : String(mei);
}
