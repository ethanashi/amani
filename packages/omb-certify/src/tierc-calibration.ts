import {SURROGACY_WIDTHS} from '../../omb-procedures/src/surrogacy-widths.ts';
import {SURROGACY_RELEASE} from '../../omb-procedures/src/surrogacy-release.ts';
import {surrogateCountBracket,surrogatePrecision} from '../../omb-procedures/src/surrogacy-envelope.ts';
/** Frozen public-simulation evidence, bound into the registry hash. Not an empirical normality test. */
import type {MetaAnalysisInput} from '../../omb-procedures/src/meta-analysis.ts';
import type {SurrogacyInput} from '../../omb-procedures/src/surrogacy.ts';
export const TIERC_CALIBRATION = {
  "sha256": "e60f668e61617fc0b38e1c261718e271c1804c6ddce98e3f08ec42e1ece166c7",
  "replicatesPerCell": 5000,
  "cells": 35,
  "seed": "tierc-release-independent-20261013-v1",
  "rule": "one-sided 95% CP upper <= .0625, both null rejection and CI noncoverage; >=95% estimability; cells only, no interpolation",
  "admitted": [
    {
      "family": "binomial-trials",
      "model": "MH",
      "measure": "OR",
      "k": 5,
      "n": 1000,
      "controlRisk": 0.001,
      "allocation": 1,
      "tau": 0,
      "rejectionCPUpper": 0.023357162838799905,
      "noncoverageCPUpper": 0.023678607034139182
    },
    {
      "family": "binomial-trials",
      "model": "MH",
      "measure": "OR",
      "k": 10,
      "n": 1000,
      "controlRisk": 0.01,
      "allocation": 2,
      "tau": 0,
      "rejectionCPUpper": 0.05243284983524707,
      "noncoverageCPUpper": 0.05243284983524707
    },
    {
      "family": "binomial-trials",
      "model": "MH",
      "measure": "OR",
      "k": 20,
      "n": 200,
      "controlRisk": 0.1,
      "allocation": 4,
      "tau": 0,
      "rejectionCPUpper": 0.05704342455749847,
      "noncoverageCPUpper": 0.05704342455749847
    },
    {
      "family": "binomial-trials",
      "model": "MH",
      "measure": "RR",
      "k": 5,
      "n": 1000,
      "controlRisk": 0.001,
      "allocation": 1,
      "tau": 0,
      "rejectionCPUpper": 0.02032584304891316,
      "noncoverageCPUpper": 0.020634841608730498
    },
    {
      "family": "binomial-trials",
      "model": "MH",
      "measure": "RR",
      "k": 10,
      "n": 1000,
      "controlRisk": 0.01,
      "allocation": 2,
      "tau": 0,
      "rejectionCPUpper": 0.052852456362482814,
      "noncoverageCPUpper": 0.052852456362482814
    },
    {
      "family": "binomial-trials",
      "model": "MH",
      "measure": "RR",
      "k": 20,
      "n": 200,
      "controlRisk": 0.1,
      "allocation": 4,
      "tau": 0,
      "rejectionCPUpper": 0.05515860717377197,
      "noncoverageCPUpper": 0.05515860717377197
    },
    {
      "family": "binomial-trials",
      "model": "MH",
      "measure": "RD",
      "k": 5,
      "n": 1000,
      "controlRisk": 0.001,
      "allocation": 1,
      "tau": 0,
      "rejectionCPUpper": 0.04359665616937186,
      "noncoverageCPUpper": 0.04359665616937186
    },
    {
      "family": "binomial-trials",
      "model": "MH",
      "measure": "RD",
      "k": 10,
      "n": 1000,
      "controlRisk": 0.01,
      "allocation": 2,
      "tau": 0,
      "rejectionCPUpper": 0.05473951462365648,
      "noncoverageCPUpper": 0.05473951462365648
    },
    {
      "family": "binomial-trials",
      "model": "MH",
      "measure": "RD",
      "k": 20,
      "n": 200,
      "controlRisk": 0.1,
      "allocation": 4,
      "tau": 0,
      "rejectionCPUpper": 0.055996523335390874,
      "noncoverageCPUpper": 0.055996523335390874
    },
    {
      "family": "binomial-trials",
      "model": "Peto",
      "measure": "OR",
      "k": 10,
      "n": 1000,
      "controlRisk": 0.001,
      "allocation": 1,
      "tau": 0,
      "rejectionCPUpper": 0.044862075997164574,
      "noncoverageCPUpper": 0.044871027450911344
    },
    {
      "family": "binomial-trials",
      "model": "exact",
      "measure": "OR",
      "k": 5,
      "n": 20,
      "controlRisk": 0.1,
      "allocation": 1,
      "tau": 0,
      "rejectionCPUpper": 0.02873047312122872,
      "noncoverageCPUpper": 0.02873047312122872
    },
    {
      "family": "binomial-trials",
      "model": "DL",
      "measure": "OR",
      "k": 10,
      "n": 500,
      "controlRisk": 0.1,
      "allocation": 1,
      "tau": 0.3,
      "rejectionCPUpper": 0.054320331054981935,
      "noncoverageCPUpper": 0.054320331054981935
    },
    {
      "family": "binomial-trials",
      "model": "DL",
      "measure": "RR",
      "k": 10,
      "n": 500,
      "controlRisk": 0.1,
      "allocation": 1,
      "tau": 0,
      "rejectionCPUpper": 0.05515860717377197,
      "noncoverageCPUpper": 0.05515860717377197
    },
    {
      "family": "binomial-trials",
      "model": "DL",
      "measure": "RD",
      "k": 10,
      "n": 500,
      "controlRisk": 0.1,
      "allocation": 1,
      "tau": 0,
      "rejectionCPUpper": 0.052223010233187886,
      "noncoverageCPUpper": 0.052223010233187886
    },
    {
      "family": "bivariate-normal-observed-effects",
      "n": 10,
      "rho": 0,
      "standardError": 0.03,
      "weights": "equal",
      "ciMethod": "fisher",
      "rejectionCPUpper": 0.056205947080888635,
      "noncoverageCPUpper": 0.057462034462080064
    },
    {
      "family": "bivariate-normal-observed-effects",
      "n": 10,
      "rho": 0.5,
      "standardError": 0.03,
      "weights": "equal",
      "ciMethod": "fisher",
      "rejectionCPUpper": 0.0005989670023133279,
      "noncoverageCPUpper": 0.028302188269088202
    },
    {
      "family": "bivariate-normal-observed-effects",
      "n": 10,
      "rho": 0.9,
      "standardError": 0.03,
      "weights": "equal",
      "ciMethod": "fisher",
      "rejectionCPUpper": 0.0005989670023133279,
      "noncoverageCPUpper": 0.055996523335390874
    },
    {
      "family": "bivariate-normal-observed-effects",
      "n": 20,
      "rho": 0,
      "standardError": 0.03,
      "weights": "equal",
      "ciMethod": "fisher",
      "rejectionCPUpper": 0.05515860717377197,
      "noncoverageCPUpper": 0.05578707759620839
    },
    {
      "family": "bivariate-normal-observed-effects",
      "n": 20,
      "rho": 0.5,
      "standardError": 0.03,
      "weights": "equal",
      "ciMethod": "fisher",
      "rejectionCPUpper": 0.0005989670023133279,
      "noncoverageCPUpper": 0.048862150473513916
    },
    {
      "family": "bivariate-normal-observed-effects",
      "n": 20,
      "rho": 0.9,
      "standardError": 0.03,
      "weights": "equal",
      "ciMethod": "fisher",
      "rejectionCPUpper": 0.0005989670023133279,
      "noncoverageCPUpper": 0.05327196694894659
    },
    {
      "family": "bivariate-normal-observed-effects",
      "n": 50,
      "rho": 0,
      "standardError": 0.03,
      "weights": "equal",
      "ciMethod": "fisher",
      "rejectionCPUpper": 0.058299001249939836,
      "noncoverageCPUpper": 0.05871735993938801
    },
    {
      "family": "bivariate-normal-observed-effects",
      "n": 50,
      "rho": 0.5,
      "standardError": 0.03,
      "weights": "equal",
      "ciMethod": "fisher",
      "rejectionCPUpper": 0.0005989670023133279,
      "noncoverageCPUpper": 0.048020882360667205
    },
    {
      "family": "bivariate-normal-observed-effects",
      "n": 50,
      "rho": 0.9,
      "standardError": 0.03,
      "weights": "equal",
      "ciMethod": "fisher",
      "rejectionCPUpper": 0.0005989670023133279,
      "noncoverageCPUpper": 0.05348168661946445
    },
    {
      "family": "binomial-alternative",
      "model": "MH",
      "measure": "OR",
      "k": 10,
      "n": 500,
      "controlRisk": 0.1,
      "allocation": 1,
      "tau": 0,
      "target": 1.5,
      "rejectionCPUpper": 0.0005989670023133279,
      "noncoverageCPUpper": 0.05536811964088714
    },
    {
      "family": "binomial-alternative",
      "model": "MH",
      "measure": "RR",
      "k": 10,
      "n": 500,
      "controlRisk": 0.1,
      "allocation": 1,
      "tau": 0,
      "target": 1.5,
      "rejectionCPUpper": 0.0005989670023133279,
      "noncoverageCPUpper": 0.05348168661946445
    },
    {
      "family": "binomial-alternative",
      "model": "MH",
      "measure": "RD",
      "k": 10,
      "n": 500,
      "controlRisk": 0.1,
      "allocation": 1,
      "tau": 0,
      "target": 0.03,
      "rejectionCPUpper": 0.0005989670023133279,
      "noncoverageCPUpper": 0.059553832299686665
    },
    {
      "family": "binomial-alternative",
      "model": "Peto",
      "measure": "OR",
      "k": 10,
      "n": 500,
      "controlRisk": 0.005,
      "allocation": 1,
      "tau": 0,
      "target": 1.5,
      "rejectionCPUpper": 0.0005989670023133279,
      "noncoverageCPUpper": 0.058299001249939836
    },
    {
      "family": "binomial-alternative",
      "model": "exact",
      "measure": "OR",
      "k": 5,
      "n": 20,
      "controlRisk": 0.1,
      "allocation": 1,
      "tau": 0,
      "target": 1.5,
      "rejectionCPUpper": 0.0005989670023133279,
      "noncoverageCPUpper": 0.038946471152557754
    },
    {
      "family": "binomial-alternative",
      "model": "DL",
      "measure": "OR",
      "k": 10,
      "n": 500,
      "controlRisk": 0.1,
      "allocation": 1,
      "tau": 0.25,
      "target": 1.5,
      "rejectionCPUpper": 0.0005989670023133279,
      "noncoverageCPUpper": 0.050753440804027716
    }
  ],
  "excludedFamilies": [
    "bivariate t5",
    "unequal-precision WLS slope inference",
    "bootstrap intervals (not release-calibrated)"
  ]
} as const;
export function metaLabelEnvelope(input:MetaAnalysisInput){
 const trials=input.trials,model=input.model??'MH',designs=TIERC_CALIBRATION.admitted.filter(c=>'model' in c&&c.model===model&&c.measure===input.measure&&c.k===trials.length&&trials.every(t=>t.totalTreatment===c.n&&t.totalControl===c.n*c.allocation));
 return {withinDesignEnvelope:designs.length>0&&(input.continuityCorrection??0)===0&&(input.role??'primary')==='primary',calibrationHash:TIERC_CALIBRATION.sha256,nominalAlpha:.05,maximumErrorRate:.0625,cells:designs,
 guarantee:'Conditional on independent binomial randomized trials and the listed fixed baseline risks, common effects or normal log-OR heterogeneity. Only listed population/design cells were evaluated; matching arm sizes cannot establish these population assumptions. No interpolation or full-kernel Confirmed label is implied.'};
}
export function surrogateLabelEnvelope(input:SurrogacyInput){
 const n=input.trials.length,bracket=surrogateCountBracket(n),ratios=surrogatePrecision(input.trials);
 const withinDesignEnvelope=n>=10&&bracket.length>0&&Math.max(ratios.outcome,ratios.surrogate)<=5&&(input.ciMethod??'fisher')==='fisher'&&SURROGACY_RELEASE.spotChecksPass&&('ruleSelectionHash' in SURROGACY_RELEASE&&SURROGACY_RELEASE.ruleSelectionHash===SURROGACY_WIDTHS.pilotSelectionHash);
 return {withinDesignEnvelope,calibrationHash:SURROGACY_RELEASE.sha256,nominalAlpha:.05,maximumErrorRate:.0625,minimumObservedCoverage:.95,bracket,seRatios:ratios,lawFamily:SURROGACY_RELEASE.lawFamily,rule:'Classical AND calibrated HC3 partner; interval hull, never intersection',
 guarantee:'Independent observed-effect trials under the declared normal, shared-scale t5/t3, contaminated-normal and skewed-lognormal family, precision ratios up to five independent of effects. Every law/precision cell at both bracketing counts passes. Only the joint conservative intervals are release-calibrated; neither tail-screen passage nor design matching proves a population law. No latent, causal or regulatory validation.'};
}
