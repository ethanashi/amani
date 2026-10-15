# Tier C trial procedures

Host APIs are `certifyMetaAnalysis(input)` and `certifySurrogacy(input)` from
`omb-certify/src/tierc.ts`. Their `official` map contains only unblocked computed
fields. `audit` is for diagnostics, never publication. A certified computation is
not a full-kernel Confirmed claim; population assumptions, calibration, provenance,
look accounting and the other kernel gates still apply.

Amani plans lock `sharedKnobs.tierc_procedures` entries:

```json
{
  "id": "safety",
  "kind": "adverse-events",
  "table": "trials.json",
  "settings": {"measure": "RR", "model": "MH"},
  "report_path": "/safety",
  "claim_ids": ["harm"]
}
```

`table` is relative to the staged raw-input root, with no `data/` prefix. JSON rows:

```json
[{"id":"trial-a","eventsTreatment":12,"totalTreatment":1000,
  "eventsControl":8,"totalControl":1000,"measure":"RR"}]
```

For surrogacy, use kind `trial-surrogacy`, settings such as
`{"ciMethod":"fisher","outcomeBenefitDirection":"less"}`, and rows:

```json
[{"id":"trial-a","surrogate":-0.3,"outcome":-0.2,
  "seSurrogate":0.05,"seOutcome":0.07,"correlation":0.2,
  "surrogateScale":"log NfL ratio","outcomeScale":"log hazard ratio"}]
```

At least three independent trial rows are needed for descriptive regression. The
validated verdict requires at least ten plus the other diagnostics and release
envelope. Both effect directions default to greater; lock `less` when lower means
benefit. All trials must use the same endpoint definition, time horizon and scale.
Independent trial IDs are required; aggregate multiple treatment arms sharing a
control before staging. Counts must represent participants with events, not recurrent
event totals. Missing counts or SEs are errors, not zeroes. Different effect measures
must be converted with a justified upstream method or analyzed separately.

The registry owns all guard thresholds and default alternatives. Optional locked
`assumption_decisions` may narrow alternatives; they cannot waive blocks. A failed
Peto or corrected rare-event primary defaults to uncorrected MH only if computed and
allowed. OR/RR exclude double-zero trials; RD includes them. An unavailable individual
Wald interval stays missing; it never introduces pseudo-counts into the MH pool.
Exact OR uses conditional margins, log-space convolution and equal-tailed inversion,
with bounded computational support. DL uses unmodified HKSJ t intervals and requires
estimable within-trial variances; continuity corrections are explicit sensitivity
settings. Q/I2 use the estimable inverse-variance subset (k reported), I2 is a proportion,
and its CI transforms the Q-profile tau2 bounds using typical sampling variance.

The absolute-effect companion is direct MH RD, a separate estimand from an OR/RR
random-effects mean. NNH is positive for harm; benefit is explicitly identified.
Intervals spanning zero produce separate harm and benefit rays with unbounded ends.
A `null` endpoint plus `ciBoundaries` preserves infinite/unavailable bounds in JSON.
Counts include submitted and ratio-eligible trial/arm totals and double-zero exclusions;
these provide the analysis-stage PRISMA counts, not invented literature-search counts.

Surrogacy reports observed-effect weighted R2, signed Fisher/Kish or trial-pairs
bootstrap uncertainty, corrected-moment EIV sensitivity, prediction-band STE and LOTO
observed/predicted intervals. Unknown error correlations use a declared sensitivity
grid. STE is restricted to the observed benefit-oriented range and refers to a new
observed trial effect at the median outcome SE. LOTO flags folds requiring extrapolation.
IQWiG-style strong/weak classification uses the lower/upper signed-r bounds respectively;
ReSEEM metadata records what was computed and its scope. No patient-level or regulatory
surrogate validation follows from these aggregate trial data.

`ae.labelEnvelope` / `surrogacy.labelEnvelope` name the population assumptions,
evaluated cells and frozen calibration hash. Surrogacy uses a family-wide
normal/t5/t3/contaminated/skewed calibration, n 10–100 by passing grid brackets and SE
ratios up to 5:1. Every inference uses the classical/robust interval hull and validation
requires agreement of both threshold classifications. Unequal precision or a failed
residual-tail screen selects `surrogacy.robustRegression` / `surrogacy.robustR2` via the
locked default rules. `selectedFields` names these alternatives for consumers. The screen
is secondary; interval calibration includes all tail laws whether detected or missed.
Classical arithmetic remains in audit only. Optional percentile bootstrap, unsupported
designs and disagreement cannot earn the label; valid descriptive classification remains.
No sample diagnostic proves population assumptions. See validation/tierc-procs/CALIBRATION.md
for the exact family, complete validity/power cells and diagnostic power. Round 2 uses
separate slope/correlation width factors: 1.50/1.25 (n10–14), 1.45/1.25 (n15–24),
1.50/1.35 (n25–49), and 1.35/1.35 (n50–100). These were selected on pilot seeds
and confirmed on fresh release seeds; release eligibility checks the frozen selection hash.

PW3 `tiercFigureBundle` takes staged inputs, an authenticated existing claim and a host
record authority; it recomputes/guards before signing forest, funnel, summary-table or
surrogacy-scatter records. It preserves the existing claim label. Unestimable individual
forest marks are omitted and retained with reasons in report records. Every plotted
number has a source CSV and round-trip verification. Standard report bindings override
worker drafts and frozen fallback values, including an absent interpretation draft.

The PW3 bundle also contains `summaryOfFindings`, a PW9-ready typed table spec. Every
numeric cell resolves through signed facts; GRADE certainty is explicitly not assessed by
software. Preserve the count/absolute-effect denominators and missing/unbounded interval
semantics when rendering it.
