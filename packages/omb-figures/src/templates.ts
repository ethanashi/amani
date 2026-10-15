/**
 * The fixed, versioned template text. Every static string a renderer, caption or alt-text
 * generator can emit is listed here; nothing else is "fixed template text" for the closed-world
 * check. Entries hold no digits and no number words (asserted by tests); the only digit-bearing
 * template strings are TEMPLATE_CONSTANTS, which are treated as bound values with their own source.
 */
export const TEMPLATE_VERSION = "omb-figures-templates@1";

export const T = {
  titleFunnel:'Funnel plot', titleSurrogacy:'Trial-level surrogacy',
  tiercEffect:'Effect on analysis scale',tiercSE:'Standard error',tiercSurrogate:'Surrogate effect',tiercOutcome:'Final outcome effect',
  altFunnel:'Trial effects against their standard errors, with smaller standard errors at the top.',
  capFunnel:'Points are estimable trial effects; the dashed wedge is the normal reference around the pooled effect. Asymmetry alone does not establish publication bias.',
  altSurrogacy:'Final outcome effects against surrogate effects, with fitted regression and prediction limits.',
  capSurrogacy:'Points are independent trials; error bars show a standard error. Dashed lines are prediction limits; the solid line is the weighted regression.',

  titleConsort: "Participant flow", assessed: "Assessed", enrolled: "Enrolled", allocated: "Allocated", lost: "Lost to follow-up",
  consortCap: "Boxes show certified participant counts; exclusions and losses reconcile with the analysed population.",
  titleKm: "Kaplan–Meier survival", kmX: "Time", kmY: "Survival probability",
  kmRisk: "Number at risk", kmCap: "Step curves show survival; bands show confidence intervals; ticks show censoring. Risk counts are shown below.",
  mrExcluded: "Excluded variants remain visible as squares.",
  tableReference: " (reference)", tableMethods: "Methods: ",
  // separators
  space: " ", comma: ", ", semicolon: "; ", colon: ": ", period: ".", periodSpace: ". ", openParen: " (", closeParen: ")",
  to: " to ", nEq: "n = ", eventsEq: "events = ", pEq: "p = ", pRel: "p ", dagger: "†",
  footnoteExec: "† Computed by AI-written code, re-run by software, not recomputed by the kernel.",
  ciClose: " CI)", ciWord: " CI",
  // kind titles (SVG <title>)
  titleForest: "Forest plot", titleMrForest: "Mendelian randomization forest plot",
  titleRoc: "Receiver operating characteristic curve", titleCalibration: "Calibration plot",
  titleDecision: "Decision curve", titleVolcano: "Volcano plot", titleMrScatter: "Mendelian randomization scatter plot",
  titleColoc: "Colocalization posterior probabilities", titleDataFlow: "Data flow diagram", titleClaimFlow: "Claim flow diagram",
  // measure names
  measureOr: "Odds ratio", measureHr: "Hazard ratio", measureRr: "Risk ratio", measureRatio: "Ratio",
  measureEffect: "Effect estimate", measureDifference: "Difference", measureBeta: "Effect estimate",
  measureAuc: "Area under the curve", measureProportion: "Proportion", measureProbability: "Probability",
  measureNetBenefit: "Net benefit", measurePosterior: "Posterior probability", measureMean: "Mean",
  measureMedian: "Median", measureSlope: "Slope",
  logScale: " (log scale)",
  // axis titles
  rocX: "False-positive rate", rocY: "True-positive rate",
  calX: "Predicted probability", calY: "Observed proportion",
  dcX: "Threshold probability", dcY: "Net benefit",
  volcanoX: "Estimate",
  mrsX: "Variant effect on exposure", mrsY: "Variant effect on outcome",
  colocX: "Posterior probability",
  // legends and annotations
  aucOpen: " (AUC ", calSlope: "Calibration slope ", calIntercept: "; intercept ",
  treatAll: "Treat all", treatNone: "Treat none", lockedThreshold: "Locked threshold",
  volcanoUp: "Passed FDR threshold, positive estimate", volcanoDown: "Passed FDR threshold, negative estimate",
  volcanoNs: "Did not pass FDR threshold", fdrThreshold: "FDR threshold",
  slopeLabel: ": slope ",
  mrIvw: "Inverse-variance weighted", mrEgger: "MR-Egger", mrWeightedMedian: "Weighted median", mrWeightedMode: "Weighted mode",
  summaryHeading: "Summary estimates", variantHeading: "Variants",
  colocH0: "Neither trait associated", colocH1: "Exposure trait only", colocH2: "Outcome trait only",
  colocH3: "Both traits, distinct variants", colocH4: "Both traits, shared variant", decisionThreshold: "Decision threshold",
  // data flow
  stageRaw: "Records retrieved", stageDeduplicated: "After removing duplicates", stageEligible: "Eligible records",
  stageUnits: "Analysis units", stageAnalysed: "Analysed", excluded: "Excluded", removed: "Removed",
  // claim flow
  flowProposed: "Hypotheses proposed", flowLocked: "Locked before any look", flowLooked: "Looked at confirming data",
  statusConfirmedA: "All required", statusConfirmedB: "checks passed",
  statusReplicatedA: "Replicated in", statusReplicatedB: "independent data",
  statusTentativeA: "Supported, not every", statusTentativeB: "check passed",
  statusRefutedA: "Ruled out at the", statusRefutedB: "smallest effect",
  statusInsufficientA: "Could not", statusInsufficientB: "decide",
  statusNonIdentifiableA: "Not identifiable", statusNonIdentifiableB: "from these data",
  statusExploratoryA: "Exploratory", statusExploratoryB: "not tested on held-out data",
  statusVoidedA: "Voided", statusVoidedB: "not counted",
  // alt text
  altRowsInOrder: "Rows in plan order: ", altEstimate: ": estimate ", altInterval: ", interval ",
  altNullLine: "A dashed vertical line marks the null value. ",
  altTruncated: " (interval continues beyond the axis)",
  altIntervalsAre: "Intervals are ", altConfidence: " confidence intervals.",
  altLogAxis: "The axis is logarithmic. ",
  altRocSeries: "Curves: ", altChance: "A dashed diagonal marks chance performance. ",
  altBand: " with a shaded confidence band",
  altCalibration: "Binned predicted probabilities are plotted against observed proportions. ",
  altIdentity: "A dashed diagonal marks perfect calibration. ",
  dcTruncation: "Treat all reference is clipped at the lower axis boundary; downward arrows mark continuation. ",
  altDecision: "Net benefit of the model across threshold probabilities, compared with treating all and treating none. ",
  altLocked: "Dotted vertical lines mark the locked thresholds: ",
  altVolcano: "Each point is a tested feature from a family of ",
  altVolcanoFeatures: " features; points passing the false-discovery threshold of ",
  altVolcanoLabelled: " are coloured by the sign of the estimate. Labelled features, by adjusted p: ",
  altMrScatter: "Each point is a variant, oriented so its effect on the exposure is positive, with error bars of a standard error either side. Fitted lines: ",
  altMrForest: "Per-variant estimates followed by summary estimates. ",
  altColoc: "Posterior probability of each colocalization hypothesis: ",
  altColocThreshold: "A dashed vertical line marks the decision threshold of ",
  altDataFlow: "Flow of records from retrieval to analysis: ",
  altClaimFlow: "Flow of hypotheses from proposal to label: ",
  altArrow: " then ", altSplits: "Split into ",
  // tables
  tableCharacteristic: "Characteristic", tableMeanSd: ", mean (SD)", tableMedianIqr: ", median (IQR)", tableCountPct: ", n (%)",
  tableLevelIndent: "– ", tableMissing: "Missing",
  tableClaim: "Claim", tableMeasure: "Measure", tableEstimateOpen: "Estimate (", tableP: "p", tableN: "n", tableLabel: "Label",
  tableSource: "Source", tablePublishedOpen: "Published estimate (", tablePublishedPerRow: "Published estimate (interval level per row)", tableThisStudyOpen: "This study (", tableAgrees: "Direction agrees",
  tableYes: "Yes", tableNo: "No", tablePublishedNote: "Published values, not recomputed.",
  tableUnverifiedNote: "Numbers computed by AI-written code and not checked by the kernel.", tableQuantity: "Quantity", tableValue: "Value",
  tableExecNote: "† Computed by AI-written code, re-run by software, not recomputed by the kernel.",
  // caption encodings
  capForest: "Squares are estimates; horizontal lines are ", capForestTail: " confidence intervals; the dashed vertical line marks the null value; arrows mark intervals that continue beyond the axis.",
  capMrForest: "Squares are per-variant estimates and diamonds are summary estimates; lines are ",
  capRoc: "Lines are receiver operating characteristic curves; the dashed diagonal marks chance performance.",
  capCalibration: "Points are binned observed proportions; the dashed diagonal marks perfect calibration.",
  capDecision: "The solid line is the model; the dashed line is treat all; the solid horizontal line, at no net benefit, is treat none.",
  capVolcano: "Points are features; the dashed horizontal line marks the false-discovery threshold; the vertical line marks no difference.",
  capMrScatter: "Points are variants with error bars of a standard error either side; lines are the fitted method slopes.",
  capColoc: "Bars are posterior probabilities; the dashed line marks the decision threshold.",
  capDataFlow: "Boxes give counts by stage; side boxes give exclusions with their recorded reasons.",
  capClaimFlow: "Boxes count hypotheses by stage and by the label they received.",
} as const;

export type TemplateKey = keyof typeof T;

/** Template strings that contain digits. They print only by exact match and carry their own source. */
export const TEMPLATE_CONSTANTS = {
  volcanoY: "−log₁₀ adjusted p",
} as const;

/** The template vocabulary: every entry plus its trailing-space-trimmed twin (sentence-final use). */
export const LIBRARY: readonly string[] = Object.freeze([...new Set(Object.values(T).flatMap((s) => [s, s.trimEnd()]).filter(Boolean))].sort());
