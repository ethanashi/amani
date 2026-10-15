# Batch modelling changes the evidence for extensive expression differences in a blinded investigation

## Abstract

An archived blind investigation examined whether extensive expression differences between C10 and C15 remained supported when batch effects were included in the statistical test model. The completed analysis reconstructed the described pipeline of whole-matrix quantile normalisation, condition-protected parametric ComBat adjustment, and condition-only empirical-Bayes moderated testing. A preferred analysis used the same normalised expression values with condition and batch fitted jointly. The reconstructed pipeline yielded 2011 discoveries, whereas the preferred analysis yielded 11 under the same frozen Benjamini–Hochberg counting rule. The reported verdict was does-not-hold-up, with attribution to batch-adjustment-step. No confirmed duplicated units were reported. These findings show that the reported extent of differential expression depended strongly on batch handling. They do not establish an absence of expression differences. The discovery counts support a substantial revision of the extensive-difference claim, while the stage attribution identifies a computational source of sensitivity without establishing a unique technical mechanism.

## Introduction

Expression comparisons across batches require a distinction between adjusting observed profiles and accounting for batch in the uncertainty of a condition contrast. Protecting condition during batch correction preserves its fitted contribution, but the subsequent statistical model still determines how variation is attributed and how precisely the contrast is estimated. Consequently, a large discovery set after adjustment needs evaluation against an analysis that explicitly conditions on batch during testing.

The archived task asked whether C10 and C15 differed extensively in expression after the described preprocessing and empirical-Bayes analysis. It requested a reconstruction using every supplied sample and condition, followed by a defensible analysis beginning with the same quantile-normalised values. The frozen plan translated the qualitative extent claim into a majority-retention criterion involving discovery retention, directional agreement, and an exploratory global assessment. That criterion was an operational definition rather than a supplied published numerical target.

This reading preprint draws on the completed execution record, its frozen computational source, and the supplied report facts. The task and plan establish the question and analytic commitments; the reported outputs establish the findings presented here. Disguised condition and feature identities carry no biological interpretation.

## Methods

Expression columns were matched exactly to sample-sheet identifiers, and metadata were reordered to the matrix headers. The executed code checked matrix shape, identifier uniqueness, finite expression values, complete annotations, and alias-registry coverage. Registry cells were decoded before resolving sample identities. Confirmed identity groups were defined through canonical alias identity or exactly equal complete raw expression profiles; high correlation alone did not qualify. Correlations, distances, distributions, and principal-component profiles were computed as diagnostics. Unusual expression profiles were retained rather than treated as demonstrated technical failures.

The full expression matrix, already on a logarithmic scale, underwent quantile normalisation before any restriction or identity-group handling. Sorted columns were averaged by rank, with average-rank interpolation for ties. The resulting matrix was reused throughout, without feature filtering or subset renormalisation. The prior reconstruction retained all supplied samples. The preferred procedure specified averaging concordantly annotated confirmed duplicate groups and excluding groups with conflicting annotations.

For the reconstructed pipeline, parametric ComBat estimated batch location and scale effects while protecting all condition levels. The implementation standardised expression, estimated empirical prior distributions across features, iterated posterior batch adjustments under bounded convergence rules, and restored scale and the protected condition contribution. Adjusted expression then entered a condition-only model. The preferred analysis instead fitted condition indicators and batch fixed effects jointly to the quantile-normalised expression. Singular-value decomposition supported rank determination, contrast-estimability checking, and estimation of C10 minus C15.

Feature testing used empirical-Bayes moderated Student statistics with non-robust, non-trended variance moderation and the prescribed degrees-of-freedom cap. Benjamini–Hochberg adjustment covered the entire feature family under the same strict frozen discovery threshold. Untestable features were retained in that family with non-significant probabilities. The numerical implementation used Python array and scientific-computing libraries, with deterministic identity checks included before the expression analysis.

Computational comparisons combined condition-only or joint condition-and-batch models with normalised or ComBat-adjusted expression. Additional diagnostics restricted the target conditions and shared batches where estimable, and omitted individual batches or target samples. These procedures assessed dependence on model specification and observations; their individual outcomes are not supplied as report facts.

The global calculation estimated the mean squared conditional contrast after subtracting ordinary sampling variance. Sample-level Rademacher wild resampling used leverage-corrected residuals and shared weights across features to preserve their dependence. Full-model draws supplied uncertainty calculations, while restricted-model draws imposed equal target-condition coefficients for a greater-tail test. A Gram-matrix quadratic implemented the refits efficiently. The estimand concerned correlated probe outcomes, with independent sample profiles as the analysis units. The frozen decision rule required majority retention of discoveries and concordant signs together with global statistical support and a positive interval lower endpoint.

## Results

The execution record verifies a completed real-data analysis. The reconstructed prior pipeline reported 2011 significant features, while the preferred model reported 11. Batch was handled within the preferred test model. Because the feature family and discovery rule were held fixed, the difference in counts directly demonstrates sensitivity of the extensive-discovery claim to the analytic treatment of batch.

The final discovery set failed the frozen majority-retention requirement. This failure suffices for the reported does-not-hold-up verdict regardless of the other components of the conjunctive rule. The supplied facts do not provide discovery overlap, sign agreement, the global effect estimate, its uncertainty, or the global test probability, so no outcomes for those quantities are asserted here.

The reported cause was batch-adjustment-step. Under the executed attribution logic, this label identifies a greater added discovery excess associated with ComBat than the excess already present in condition-only testing of normalised expression, relative to the preferred model. The supplied duplicate-unit finding was empty: the identity checks reported no confirmed duplicated units. Thus, the documented discovery reduction is not accompanied by a reported duplicate-removal explanation.

## Discussion

The central finding is a loss of support for the extent of the expression claim under direct batch modelling. Discoveries remained in the preferred analysis, so the verdict should be read as failure to substantiate widespread differences rather than evidence that the conditions are biologically identical. Discovery counts reflect both estimated effects and their uncertainty; their reduction cannot alone establish that the underlying effects disappeared.

The batch-adjustment attribution is more specific than a general observation that preprocessing matters. The frozen comparisons were designed to distinguish excess discoveries introduced after ComBat from excess already present when batch was omitted from testing normalised expression. Nevertheless, a stage-level attribution does not identify a unique mechanism. Ignored adjustment uncertainty and induced sample dependence are relevant explanations contemplated by the design, but the supplied facts do not quantify their contributions or distinguish them from changes in estimated effects and residual variation.

The preferred model assumes additive batch effects and independent retained sample profiles. An empty duplicate finding addresses the defined alias and exact-profile checks; it does not exclude hidden biological overlap without subject identifiers. Likewise, computed profile diagnostics do not by themselves establish mislabelling or technical failure. These boundaries matter when interpreting computational attribution as evidence about the study design.

Software provenance notice: The archived scientific claim retains the native status insufficient-evidence. The global matrix-join analysis remains exploratory and is not certified as a registered scalar-column design; its bootstrap interval is a diagnostic rather than a software-certified interval. Completed execution establishes that the archived computation ran, not successful independent replication. Manuscript review and endorsement remain pending.

## Evidence and provenance

This reading manuscript was drafted retrospectively from the archived blind investigation. Numerical values are reported outputs of that run; typesetting does not independently certify them. The study identity and published answer were unavailable to the manuscript drafter.

Native claim status: c10 c15 transcriptome effect = insufficient evidence.

This manuscript is an unendorsed reading draft. Cross-family manuscript review and owner endorsement are pending.
