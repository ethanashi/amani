import type {MetaAnalysisResult,MetaEstimate} from '../../omb-procedures/src/meta-analysis.ts';
import type {FactKind} from './port.ts';
/** PW9-ready table specification. Every numeric member is a signed fact ID, never display text.
 * Null interval endpoints are unavailable; NNH ray upper=null specifically means unbounded. */
export interface SummaryOfFindingsTableSpec {
 kind:'summary-of-findings';id:string;placement:'results';claimId:string;
 columns:readonly string[];
 rows:Array<{
  outcome:string;trials:string;participants:string;relativeMeasure:'OR'|'RR'|null;
  relativeEffect:{estimate:string;lower:string|null;upper:string|null}|null;
  assumedRiskPer1000:string;correspondingRiskPer1000:{estimate:string;lower:string|null;upper:string|null};
  absoluteEffectPer1000:{estimate:string;lower:string|null;upper:string|null};
  numberNeededToHarm:string|null;numberNeededToHarmIntervals:Array<{lower:string;upper:string|null}>;
  heterogeneity:{i2:string;lower:string|null;upper:string|null;tau2:string}|null;
  doubleZero:{rule:'include'|'exclude';count:string;excluded:string;includedTrials:string};
  certainty:'not assessed by software (requires reviewer judgment)';
 }>;
 notes:readonly string[];
}
interface Bindings {scalar:(id:string,value:number,kind:FactKind)=>string;entity:(id:string,text:string)=>string}
/** Called only after host certification, sharing the forest/report official projection. */
export function summaryOfFindings(official:Record<string,unknown>,selectedPrimary:string|null,claimId:string,b:Bindings):SummaryOfFindingsTableSpec|null {
 const primary=selectedPrimary?official[selectedPrimary] as MetaEstimate|undefined:undefined,absolute=official['ae.absolute'] as MetaAnalysisResult['absolute']|undefined,counts=official['ae.counts'] as MetaAnalysisResult['counts']|undefined,settings=official['ae.settings'] as MetaAnalysisResult['settings']|undefined,het=official['ae.heterogeneity'] as MetaAnalysisResult['heterogeneity']|undefined;
 if(!primary||!absolute?.riskDifference||!counts||!settings)return null;
 if(settings.doubleZeroRule!=='include'&&settings.doubleZeroRule!=='exclude')return null;
 const fact=(name:string,value:number,kind:FactKind='effect')=>b.scalar(`ae.sof.${name}`,value,kind);
 const maybe=(name:string,value:number|null)=>typeof value==='number'&&Number.isFinite(value)?fact(name,value,'ci'):null;
 const interval=(name:string,e:number,ci:[number,number],kind:FactKind='effect')=>({estimate:fact(`${name}.estimate`,e,kind),lower:maybe(`${name}.lower`,ci[0]),upper:maybe(`${name}.upper`,ci[1])});
 if(!Number.isFinite(primary.estimate))return null;
 const p=absolute.controlRisk,measure=settings.measure,rd=absolute.riskDifference;
 // Corresponding risk is the selected relative effect applied to the certified pooled control risk.
 // RD uses that same control risk plus the certified RD; invalid extrapolated risks are withheld.
 const corresponding=(e:number)=>measure==='OR'?p*e/(1-p+p*e):measure==='RR'?p*e:p+e;
 const risk=corresponding(primary.estimate);
 if(!Number.isFinite(risk)||risk<0||risk>1)return null;
 const riskBound=(value:number)=>{if(typeof value!=='number'||!Number.isFinite(value))return NaN;const r=corresponding(value);return r>=0&&r<=1?r*1000:NaN;};
 return {kind:'summary-of-findings',id:'ae-summary-of-findings',placement:'results',claimId,
 columns:['Outcome','Trials and participants','Relative effect with CI','Assumed and corresponding risk per 1000','Absolute effect per 1000 with CI','Number needed to harm','Heterogeneity (I² with CI, τ²)','Double-zero handling','Certainty'],
 rows:[{outcome:b.entity('ae.sof.outcome','Adverse events'),trials:fact('trials',counts.inputTrials,'count'),participants:fact('participants',counts.totalTreatment+counts.totalControl,'count'),relativeMeasure:measure==='RD'?null:measure,
 relativeEffect:measure==='RD'?null:interval('relative',primary.estimate,primary.ci,measure==='OR'?'or':'rr'),assumedRiskPer1000:fact('assumedRisk',p*1000),correspondingRiskPer1000:interval('correspondingRisk',risk*1000,primary.ci.map(riskBound) as [number,number]),
 absoluteEffectPer1000:interval('absolute',rd.estimate*1000,rd.ci.map(x=>x*1000) as [number,number],'difference'),
 numberNeededToHarm:absolute.direction==='harm'&&absolute.nnh!==null?fact('nnh',absolute.nnh):null,
 numberNeededToHarmIntervals:absolute.nnhIntervals.filter(x=>x.direction==='harm').map((x,i)=>({lower:fact(`nnh${i}.lower`,x.lower),upper:x.upper===null?null:fact(`nnh${i}.upper`,x.upper)})),
 heterogeneity:het?{i2:fact('i2',het.i2),lower:maybe('i2.lower',het.i2CI[0]),upper:maybe('i2.upper',het.i2CI[1]),tau2:fact('tau2',het.tau2)}:null,
 doubleZero:{rule:settings.doubleZeroRule,count:fact('doubleZero',counts.doubleZero,'count'),excluded:fact('excludedDoubleZero',counts.excludedDoubleZero,'count'),includedTrials:fact('includedTrials',counts.includedTrials,'count')},certainty:'not assessed by software (requires reviewer judgment)'}],
 notes:['Trial and participant totals include every supplied trial. Relative pooling follows the declared double-zero rule; direct MH risk difference includes double-zero trials.','Assumed risk is pooled observed control risk. Corresponding risk applies the selected pooled effect to that baseline; absolute effect is the separately certified direct MH risk difference.','Null bounds are unavailable; a null upper endpoint of an NNH interval denotes an unbounded harm interval. I² is a proportion. NNH is absent for a benefit point estimate.','This table reports certified arithmetic and does not assign GRADE certainty or promote a claim label.']};
}
