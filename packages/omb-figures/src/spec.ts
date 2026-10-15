/**
 * Figure and table specifications. A spec names certified record IDs and label templates only;
 * it never carries a number, a colour, a font, an axis range or a row order of its own. Every
 * setting is fixed by the kind's template (section 5: "the LLM chooses none of them").
 */
import type { ClaimStatus } from "./port.ts";
import type { Placement } from "./store.ts";

/** Static text plus [m:], [e:] and [lvl:] placeholders. */
export type LabelTemplate = string;

export interface CaptionSpec {
  /** The message sentence (drafted elsewhere); numbers only through placeholders. */
  readonly message: LabelTemplate;
  /** Software short label, e.g. the three-part label rendered by PW2. */
  readonly shortLabel?: LabelTemplate;
}

interface Base {
  readonly id: string;
  readonly placement: Placement;
  readonly caption: CaptionSpec;
}

export interface IntervalRef {
  readonly estimate: string;
  readonly lower: string;
  readonly upper: string;
}

export interface ForestRow extends IntervalRef { readonly label: LabelTemplate }

export interface ForestSpec extends Base {
  readonly kind: "forest";
  readonly claimId: string;
  /** Every pre-specified row, including failing sensitivity rows, in plan order. */
  readonly rows: readonly ForestRow[];
}

export const MR_METHODS = ["ivw", "egger", "weighted-median", "weighted-mode"] as const;
export type MrMethod = (typeof MR_METHODS)[number];

export interface MrForestSpec extends Base {
  readonly kind: "mr-forest";
  readonly claimId: string;
  readonly variants: readonly ForestRow[];
  readonly summaries: readonly (IntervalRef & { readonly method: MrMethod })[];
}

export interface RocSeries {
  readonly label: LabelTemplate;
  readonly fpr: string;
  readonly tpr: string;
  /** Optional bootstrap band: lower and upper true-positive rate at each false-positive rate. */
  readonly bandLower?: string;
  readonly bandUpper?: string;
  readonly auc: string;
}

export interface RocSpec extends Base {
  readonly kind: "roc";
  readonly claimId: string;
  readonly series: readonly RocSeries[];
}

export interface CalibrationSpec extends Base {
  readonly kind: "calibration";
  readonly claimId: string;
  readonly predicted: string;
  readonly observed: string;
  readonly lower?: string;
  readonly upper?: string;
  readonly slope: string;
  readonly intercept: string;
}

export interface DecisionCurveSpec extends Base {
  readonly kind: "decision-curve";
  readonly claimId: string;
  readonly modelLabel: LabelTemplate;
  readonly thresholds: string;
  readonly netBenefit: string;
  readonly treatAll: string;
  readonly lockedThresholds?: readonly string[];
}

export interface VolcanoSpec extends Base {
  readonly kind: "volcano";
  readonly claimId: string;
  readonly estimate: string;
  readonly pAdjusted: string;
  /** Entity list aligned with the series (feature names). */
  readonly features: string;
  /** False-discovery threshold on the adjusted p scale. */
  readonly threshold: string;
  readonly familySize: string;
}

export interface MrScatterSpec extends Base {
  readonly kind: "mr-scatter";
  readonly claimId: string;
  readonly mrKeep?: string;
  readonly betaExposure: string;
  readonly seExposure: string;
  readonly betaOutcome: string;
  readonly seOutcome: string;
  /** Must include the inverse-variance weighted fit. */
  readonly fits: readonly { readonly method: MrMethod; readonly slope: string; readonly intercept?: string }[];
}

/** ggsurvfit convention: CI band, censor ticks and number-at-risk table are mandatory.
 * Times include zero; risk is just before each knot, events precede censoring at ties. */
export interface KaplanMeierSpec extends Base {
  readonly kind: "kaplan-meier";
  readonly claimId: string;
  readonly groups: readonly {
    readonly label: LabelTemplate; readonly n: string;
    readonly time: string; readonly survival: string; readonly lower: string; readonly upper: string;
    readonly risk: string; readonly events: string; readonly censored: string;
  }[];
}

export interface ColocSpec extends Base {
  readonly kind: "coloc";
  readonly claimId: string;
  /** Posterior probabilities of hypotheses H0 to H4, in that order. */
  readonly posteriors: readonly [string, string, string, string, string];
  readonly threshold: string;
}

export const FLOW_STAGES = ["raw", "deduplicated", "eligible", "units", "analysed"] as const;
export type FlowStage = (typeof FLOW_STAGES)[number];

export interface DataFlowStage {
  readonly stage: FlowStage;
  readonly count: string;
  readonly events?: string;
  /** What the unit is, for the units stage (e.g. "donors"). */
  readonly unitLabel?: LabelTemplate;
  /** Records removed between the previous stage and this one, with reasons recorded at the time. */
  readonly removed?: { readonly total: string; readonly reasons: readonly { readonly label: LabelTemplate; readonly count: string }[] };
}

export interface DataFlowSpec extends Base {
  readonly kind: "data-flow";
  readonly stages: readonly DataFlowStage[];
  readonly splits?: readonly { readonly label: LabelTemplate; readonly count: string; readonly events?: string }[];
}

export interface ClaimFlowSpec extends Base {
  readonly kind: "claim-flow";
  readonly proposed: string;
  readonly locked: string;
  readonly looked: string;
  readonly outcomes: readonly { readonly status: ClaimStatus; readonly count: string }[];
}

/** CONSORT allocation and follow-up, from certified staging-ledger counts. */
export interface ConsortSpec extends Base {
  readonly kind: "consort";
  readonly assessed: string; readonly enrolled: string;
  readonly excluded: readonly {readonly label: LabelTemplate; readonly count: string}[];
  readonly arms: readonly {readonly label: LabelTemplate; readonly allocated: string; readonly analysed: string;
    readonly lost: readonly {readonly label: LabelTemplate; readonly count: string}[]}[];
}

export interface FunnelSpec extends Base { readonly kind:'funnel'; readonly claimId:string; readonly effects:string; readonly standardErrors:string; readonly center:string }
export interface SurrogacyScatterSpec extends Base { readonly kind:'surrogacy-scatter'; readonly claimId:string; readonly surrogate:string; readonly outcome:string; readonly seSurrogate:string; readonly seOutcome:string; readonly grid:string; readonly fitted:string; readonly lower:string; readonly upper:string }
export type FigureSpec =
  | FunnelSpec | SurrogacyScatterSpec | ForestSpec | MrForestSpec | RocSpec | CalibrationSpec | DecisionCurveSpec
  | VolcanoSpec | MrScatterSpec | ColocSpec | DataFlowSpec | ClaimFlowSpec | KaplanMeierSpec | ConsortSpec;

export type FigureKind = FigureSpec["kind"];
export const FIGURE_KINDS: readonly FigureKind[] = [
  "funnel", "surrogacy-scatter", "forest", "mr-forest", "roc", "calibration", "decision-curve", "volcano", "mr-scatter", "coloc", "data-flow", "claim-flow", "kaplan-meier", "consort",
];

// ---------------------------------------------------------------------------------------------
// Tables

export interface PopulationCellMeanSd { readonly mean: string; readonly sd: string }
export interface PopulationCellMedianIqr { readonly median: string; readonly q1: string; readonly q3: string }
export interface PopulationCellCount { readonly count: string; readonly percent: string }

export type PopulationVariable =
  | { readonly label: LabelTemplate; readonly type: "mean-sd"; readonly cells: readonly PopulationCellMeanSd[]; readonly missing: readonly PopulationCellCount[] }
  | { readonly label: LabelTemplate; readonly type: "median-iqr"; readonly cells: readonly PopulationCellMedianIqr[]; readonly missing: readonly PopulationCellCount[] }
  | { readonly label: LabelTemplate; readonly type: "categorical"; readonly levels: readonly { readonly label: LabelTemplate; readonly reference?: boolean; readonly cells: readonly PopulationCellCount[] }[]; readonly missing: readonly PopulationCellCount[] };

export interface PopulationTableSpec {
  readonly kind: "population";
  readonly id: string;
  readonly placement: Placement;
  readonly datasets: readonly { readonly label: LabelTemplate; readonly n: string }[];
  readonly variables: readonly PopulationVariable[];
}

export interface ClaimResultsTableSpec {
  readonly kind: "claim-results";
  readonly id: string;
  readonly placement: Placement;
  /** Plan order. */
  readonly rows: readonly (IntervalRef & { readonly claimId: string; readonly label: LabelTemplate; readonly p?: string; readonly n?: string })[];
}

export interface ComparisonTableSpec {
  readonly kind: "comparison";
  readonly id: string;
  readonly placement: Placement;
  readonly claimId: string;
  readonly ours: IntervalRef;
  /** Previous studies: published-grade values from verified quotes. */
  readonly studies: readonly (IntervalRef & { readonly label: LabelTemplate })[];
}

/** Design section 2.2: "Numbers computed by AI-written code and not checked by the kernel". Supplement only. */
export interface UnverifiedNumbersTableSpec {
  readonly kind: "unverified-numbers";
  readonly id: string;
  readonly placement: Placement;
  readonly rows: readonly { readonly label: LabelTemplate; readonly fact: string }[];
}

export type TableSpec = PopulationTableSpec | ClaimResultsTableSpec | ComparisonTableSpec | UnverifiedNumbersTableSpec;
