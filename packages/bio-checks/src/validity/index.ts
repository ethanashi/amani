// Calibration compatibility names share the single core implementation.
export { checkCalibration as calibrateTask } from "../calibration.ts";
export type { CalibrationRunner, RunnerCalibrationInput as CalibrationInput, RunnerCalibrationResult as CalibrationResult } from "../calibration.ts";
export type CalibrationStatus = import("../calibration.ts").RunnerCalibrationResult["status"];

// Block 4d: content-duplicate / pseudo-replication detector (the test-only hash seam stays internal).
export { DUPLICATE_POLICY, detectContentDuplicates, detectNearDuplicates, effectiveUnits } from "./duplicates.ts";
export type {
  ContentDuplicateCounts,
  ContentDuplicateGroup,
  ContentDuplicateInput,
  ContentDuplicateReport,
  DuplicateEvidence,
  DuplicatePolicy,
  EffectiveUnitsOptions,
  EffectiveUnitsResult,
  NearDuplicateCounts,
  NearDuplicateInput,
  NearDuplicatePair,
  NearDuplicateReport,
  VectorBasis,
  VectorSource,
} from "./duplicates.ts";

export interface SplitSample {
  sampleId: string;
  donorId?: string | null;
}

export interface DonorDisjointResult {
  valid: boolean;
  leakedDonors: string[];
  missingDonor: string[];
  reason: string;
}

function hasDonor(sample: SplitSample): sample is SplitSample & { donorId: string } {
  return typeof sample.donorId === "string" && sample.donorId.length > 0;
}

export function checkDonorDisjoint(input: { train: readonly SplitSample[]; test: readonly SplitSample[] }): DonorDisjointResult {
  const missingDonor = [...input.train, ...input.test].filter((s) => !hasDonor(s)).map((s) => String(s.sampleId));
  const trainDonors = new Set(input.train.filter(hasDonor).map((s) => s.donorId));
  const leaked = new Set(input.test.filter(hasDonor).map((s) => s.donorId).filter((d) => trainDonors.has(d)));
  const leakedDonors = [...leaked].sort();
  const reasons: string[] = [];
  // Fail closed: an empty side proves nothing about disjointness.
  if (input.train.length === 0 || input.test.length === 0) reasons.push("empty train or test split cannot be verified");
  if (missingDonor.length > 0) reasons.push(`samples without donorId: ${missingDonor.join(", ")}`);
  if (leakedDonors.length > 0) reasons.push(`donors in both train and test: ${leakedDonors.join(", ")}`);
  const valid = reasons.length === 0;
  return { valid, leakedDonors, missingDonor, reason: valid ? "train and test are donor-disjoint" : reasons.join("; ") };
}

export interface ReplicateSample {
  sampleId: string;
  donorId?: string | null;
  cellLineId?: string | null;
}

export type AnalysisUnit = "donor" | "cellLine" | "sample";

export interface PseudoReplicationResult {
  effectiveN: number;
  declaredN: number;
  valid: boolean;
  reason: string;
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function checkPseudoReplication(input: {
  samples: readonly ReplicateSample[];
  unit: AnalysisUnit;
  declaredN?: number;
}): PseudoReplicationResult {
  const suppliedN = Object.hasOwn(input, "declaredN") ? input.declaredN : input.samples.length;
  const declaredN = typeof suppliedN === "number" ? suppliedN : NaN;
  if (!Number.isSafeInteger(declaredN) || declaredN <= 0) {
    return { effectiveN: 0, declaredN, valid: false, reason: "declaredN must be a finite positive safe integer" };
  }
  if (input.unit !== "donor" && input.unit !== "cellLine" && input.unit !== "sample") {
    return { effectiveN: 0, declaredN, valid: false, reason: "unknown or missing analysis unit" };
  }
  // Fail closed: zero samples cannot establish any unit of analysis.
  if (input.samples.length === 0) {
    return { effectiveN: 0, declaredN, valid: false, reason: "no samples; independence cannot be established" };
  }
  if (input.unit === "sample") {
    // Distinct record IDs alone say nothing about biological independence. Require
    // donor metadata, and reject any known shared donor or cell line as well.
    for (const key of ["sampleId", "donorId", "cellLineId"] as const) {
      const ids = input.samples.map((s) => s[key]);
      const supplied = key === "cellLineId" ? ids.filter((id) => id !== undefined && id !== null) : ids;
      if (supplied.some((id) => !validIdentity(id)) || new Set(supplied).size !== supplied.length) {
        return { effectiveN: 0, declaredN, valid: false, reason: `missing, invalid or duplicate ${key}; sample independence cannot be established` };
      }
    }
    const effectiveN = input.samples.length;
    return { effectiveN, declaredN, valid: declaredN <= effectiveN,
      reason: declaredN <= effectiveN ? "unique samples from distinct donors with no known shared cell line" : "declaredN exceeds independent sample count" };
  }
  const key = input.unit === "donor" ? "donorId" : "cellLineId";
  const missing = input.samples.filter((s) => !validIdentity(s[key]));
  const effectiveN = new Set(input.samples.map((s) => s[key]).filter(validIdentity)).size;
  if (missing.length > 0) {
    return { effectiveN, declaredN, valid: false, reason: `${missing.length} sample(s) lack ${key}; independence cannot be established` };
  }
  if (declaredN > effectiveN) {
    return {
      effectiveN,
      declaredN,
      valid: false,
      reason: `declared n=${declaredN} counts replicates; only ${effectiveN} independent ${input.unit} unit(s)`,
    };
  }
  return { effectiveN, declaredN, valid: true, reason: `n=${declaredN} does not exceed ${effectiveN} independent ${input.unit} unit(s)` };
}

export interface ClusterVsGradientOptions {
  seed?: number;
  simulations?: number;
  quantile?: number;
  margin?: number;
  restarts?: number;
}

export interface ClusterVsGradientResult {
  supported: boolean;
  statistic: number;
  nullQuantile: number;
  /** (count(null statistic >= observed) + 1) / (simulations + 1); NaN if unverified. */
  pValue: number;
  reason: string;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sqDist(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return s;
}

/** k-means++ seeding plus Lloyd iterations; best of `restarts` by inertia. */
function kmeans(points: readonly number[][], k: number, rand: () => number, restarts: number): number[] | undefined {
  let best: number[] | undefined;
  let bestInertia = Infinity;
  const n = points.length;
  for (let r = 0; r < restarts; r++) {
    const centers: number[][] = [[...points[Math.floor(rand() * n)]!]];
    while (centers.length < k) {
      const d = points.map((p) => Math.min(...centers.map((c) => sqDist(p, c))));
      const total = d.reduce((a, b) => a + b, 0);
      if (!Number.isFinite(total) || total <= 0) return undefined;
      let target = rand() * total;
      let idx = -1;
      for (let i = 0; i < n; i++) {
        // A zero RNG draw must not select a zero-weight (duplicate) center.
        if (d[i]! <= 0) continue;
        idx = i;
        target -= d[i]!;
        if (target < 0) break;
      }
      if (idx < 0) return undefined;
      centers.push([...points[idx]!]);
    }
    const labels = new Array<number>(n).fill(-1);
    let converged = false;
    for (let iter = 0; iter < 100; iter++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        let bj = 0;
        let bd = Infinity;
        for (let j = 0; j < k; j++) {
          const dd = sqDist(points[i]!, centers[j]!);
          if (dd < bd) {
            bd = dd;
            bj = j;
          }
        }
        if (labels[i] !== bj) {
          labels[i] = bj;
          changed = true;
        }
      }
      if (!changed) {
        converged = true;
        break;
      }
      for (let j = 0; j < k; j++) {
        const members = points.filter((_, i) => labels[i] === j);
        if (members.length === 0) continue;
        centers[j] = members[0]!.map((_, c) => members.reduce((s, m) => s + m[c]!, 0) / members.length);
      }
    }
    // An unsuccessful restart is never eligible for the best fit. If all fail,
    // the caller refuses the entire observed/null comparison.
    if (!converged || new Set(labels).size !== k) continue;
    const inertia = points.reduce((s, p, i) => s + sqDist(p, centers[labels[i]!]!), 0);
    if (inertia < bestInertia) {
      bestInertia = inertia;
      best = labels;
    }
  }
  return best;
}

/** Mean silhouette width (Euclidean). */
function silhouette(points: readonly number[][], labels: readonly number[], k: number): number {
  const n = points.length;
  const sizes = new Array<number>(k).fill(0);
  for (const l of labels) sizes[l]!++;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const sums = new Array<number>(k).fill(0);
    for (let j = 0; j < n; j++) if (j !== i) sums[labels[j]!]! += Math.sqrt(sqDist(points[i]!, points[j]!));
    const own = labels[i]!;
    if (sizes[own]! <= 1) continue;
    const a = sums[own]! / (sizes[own]! - 1);
    let b = Infinity;
    for (let c = 0; c < k; c++) if (c !== own && sizes[c]! > 0) b = Math.min(b, sums[c]! / sizes[c]!);
    if (!Number.isFinite(b)) continue;
    const m = Math.max(a, b);
    total += m === 0 ? 0 : (b - a) / m;
  }
  return total / n;
}

/** Eigen-decomposition of a symmetric matrix by cyclic Jacobi rotations. */
function symmetricEigen(matrix: number[][]): { values: number[]; vectors: number[][] } | undefined {
  const d = matrix.length;
  const scale = matrix.reduce((max, row) => row.reduce((m, x) => Math.max(m, Math.abs(x)), max), 0);
  if (!Number.isFinite(scale) || scale === 0) return undefined;
  const normalized = matrix.map((row) => row.map((x) => x / scale));
  const a = normalized.map((r) => [...r]);
  const normSquared = normalized.reduce((sum, row) => row.reduce((s, x) => s + x * x, sum), 0);
  const v: number[][] = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < d; p++) for (let q = p + 1; q < d; q++) off += a[p]![q]! ** 2;
    if (2 * off <= 1e-24 * normSquared) break;
    for (let p = 0; p < d; p++) {
      for (let q = p + 1; q < d; q++) {
        const apq = a[p]![q]!;
        if (apq === 0) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.hypot(theta, 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let r = 0; r < d; r++) {
          const arp = a[r]![p]!;
          const arq = a[r]![q]!;
          a[r]![p] = c * arp - s * arq;
          a[r]![q] = s * arp + c * arq;
        }
        for (let r = 0; r < d; r++) {
          const apr = a[p]![r]!;
          const aqr = a[q]![r]!;
          a[p]![r] = c * apr - s * aqr;
          a[q]![r] = s * apr + c * aqr;
        }
        for (let r = 0; r < d; r++) {
          const vrp = v[r]![p]!;
          const vrq = v[r]![q]!;
          v[r]![p] = c * vrp - s * vrq;
          v[r]![q] = s * vrp + c * vrq;
        }
      }
    }
  }
  const values = a.map((r, i) => r[i]!);
  const tolerance = 1e-10;
  if (values.some((x) => !Number.isFinite(x) || x < -tolerance * Math.sqrt(normSquared))) return undefined;
  // Verify A V = V Λ and Vᵀ V = I, including after the iteration budget is
  // exhausted. A bad decomposition cannot silently define a different null.
  let residualSquared = 0;
  let orthogonalitySquared = 0;
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      const av = normalized[i]!.reduce((sum, x, c) => sum + x * v[c]![j]!, 0);
      residualSquared += (av - v[i]![j]! * Math.max(0, values[j]!)) ** 2;
      const dot = v.reduce((sum, row) => sum + row[i]! * row[j]!, 0);
      orthogonalitySquared += (dot - (i === j ? 1 : 0)) ** 2;
    }
  }
  if (!Number.isFinite(residualSquared) || residualSquared > tolerance ** 2 * normSquared ||
      !Number.isFinite(orthogonalitySquared) || orthogonalitySquared > tolerance ** 2 * d) return undefined;
  return { values: values.map((x) => Math.max(0, x) * scale), vectors: v };
}

function unsupported(reason: string): ClusterVsGradientResult {
  return { supported: false, statistic: NaN, nullQuantile: NaN, pValue: NaN, reason };
}

/**
 * Tests whether k clusters are supported against a continuous null: data drawn uniformly
 * from a box aligned with the principal axes, matched in mean and covariance. A uniform
 * (not Gaussian) null is used because a gradient sampled evenly along an axis is uniform
 * along that axis, which partitions with higher silhouette than a Gaussian would.
 */
export function checkClusterVsGradient(
  points: readonly (readonly number[])[],
  k: number,
  options: ClusterVsGradientOptions = {},
): ClusterVsGradientResult {
  if (options === null || typeof options !== "object") return unsupported("invalid options: expected an options object");
  const { seed = 0, simulations = 19, quantile = 0.95, margin = 0.05, restarts = 5 } = options;
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(simulations) || simulations < 1 || simulations > 999 ||
      !Number.isSafeInteger(restarts) || restarts < 1 || restarts > 100 ||
      !Number.isFinite(quantile) || quantile <= 0 || quantile >= 1 || !Number.isFinite(margin) || margin < 0) {
    return unsupported("invalid options: seed must be a safe integer; simulations 1..999 and restarts 1..100 integers; quantile in (0,1); finite margin >= 0");
  }
  const n = points.length;
  const dim = points[0]?.length ?? 0;
  if (!Number.isInteger(k) || k < 2 || n < 2 * k || dim === 0 || points.some((p) => p.length !== dim || p.some((x) => !Number.isFinite(x)))) {
    return unsupported("invalid input: need k>=2, >=2k finite points of equal dimension");
  }
  if (new Set(points.map((p) => JSON.stringify(p))).size < k) return unsupported("invalid input: fewer than k distinct locations");
  // A common scale preserves Euclidean geometry while protecting distances and
  // covariance products against overflow/underflow when measurement units change.
  const dataScale = points.reduce((max, row) => row.reduce((m, x) => Math.max(m, Math.abs(x)), max), 0);
  const data = points.map((p) => p.map((x) => x / dataScale));
  const rand = mulberry32(seed);
  const observedLabels = kmeans(data, k, rand, restarts);
  if (!observedLabels) return unsupported("observed fit failed to converge with k occupied clusters");
  const statistic = silhouette(data, observedLabels, k);
  if (!Number.isFinite(statistic)) return unsupported("non-finite observed silhouette");

  const mean = Array.from({ length: dim }, (_, c) => data.reduce((s, p) => s + p[c]!, 0) / n);
  const cov = Array.from({ length: dim }, (_, i) =>
    Array.from({ length: dim }, (_, j) => data.reduce((s, p) => s + (p[i]! - mean[i]!) * (p[j]! - mean[j]!), 0) / (n - 1)),
  );
  const eigen = symmetricEigen(cov);
  if (!eigen) return unsupported("covariance decomposition failed convergence or residual validation");
  const { values, vectors } = eigen;
  const halfWidths = values.map((ev) => Math.sqrt(3 * Math.max(ev, 0)));

  const nullStats: number[] = [];
  for (let s = 0; s < simulations; s++) {
    const sim = Array.from({ length: n }, () => {
      const z = halfWidths.map((h) => (2 * rand() - 1) * h);
      return mean.map((m, r) => m + z.reduce((acc, zc, c) => acc + vectors[r]![c]! * zc, 0));
    });
    const labels = kmeans(sim, k, rand, restarts);
    if (!labels) return unsupported("null fit failed to converge with k occupied clusters");
    const nullStatistic = silhouette(sim, labels, k);
    if (!Number.isFinite(nullStatistic)) return unsupported("non-finite null silhouette");
    nullStats.push(nullStatistic);
  }
  nullStats.sort((a, b) => a - b);
  const nullQuantile = nullStats[Math.min(nullStats.length - 1, Math.ceil(quantile * nullStats.length) - 1)]!;
  const exceedances = nullStats.filter((value) => value >= statistic).length;
  const pValue = (exceedances + 1) / (simulations + 1);
  // Equivalent to p <= 1-q, but avoids cancellation at e.g. p=0.1, q=0.9.
  const significant = quantile <= 1 - pValue;
  const supported = significant && statistic > nullQuantile + margin;
  return {
    supported,
    statistic,
    nullQuantile,
    pValue,
    reason: supported
      ? `Monte Carlo p=${pValue} meets significance ${1 - quantile}; silhouette ${statistic.toFixed(3)} exceeds continuous-null q${quantile} ${nullQuantile.toFixed(3)} + ${margin}`
      : `cluster support not established: Monte Carlo p=${pValue} (required <= ${1 - quantile}); silhouette ${statistic.toFixed(3)}, continuous-null q${quantile} ${nullQuantile.toFixed(3)} + ${margin}`,
  };
}
