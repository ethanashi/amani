import {canonicalSha256} from '../../bio-core/src/index.ts';
import {type ReportContext} from './context.ts';
import {requireThat} from './common.ts';
import {renderDraft} from './render.ts';
import {buildRegistry} from './entities.ts';
import {formatNumber} from './format.ts';
import {assertReview,OUTCOMES,type ReviewDocument,type ReviewAnalysis} from './review-records.ts';
import type {ChecklistEvidence} from './checklist-evidence.ts';

/** Every string below is software grammar over closed values or authenticated
 * identifiers. Human interpretations and declarations have no verified producer. */
export function reviewEvidence(ctx:ReportContext,doc:ReviewDocument,name:string,id:string):ChecklistEvidence|null {
 assertReview(ctx,doc);const r=doc.records,p=r.policy,flow=doc.flow;
 if(!['PRISMA','PRISMA-Abstracts','PRISMA-Harms','ReSEEM'].includes(name))return null;
 if(name==='PRISMA-Harms'&&p.purpose!=='adverse-event-screen'||name==='ReSEEM'&&p.purpose!=='trial-level-surrogacy')return null;
 const zeroEventText={ 'not-applicable':'event-count correction was not applicable','none-observed':'no zero-event cells occurred','continuity-half':'0.5 was added to every cell of studies containing a zero-event cell','exclude-double-zero':'studies with zero events in both arms were excluded'} as const;
 const primary=r.analyses.filter(a=>a.role==='primary');
 const analysisOutcomes=p.outcomes.filter(x=>p.purpose!=='trial-level-surrogacy'||x!=='overall-survival');
 const hasAnalysis=primary.length>0&&analysisOutcomes.every(x=>primary.some(a=>a.outcome===x));
 const population=p.population.replaceAll('-',' '),intervention=p.intervention.replaceAll('-',' '),comparator=p.comparator.replaceAll('-',' ');
 const endpoints=p.outcomes.map(x=>OUTCOMES[x]).join('; ');
 const citations=(studyId:string)=>flow.trace.reports.filter(x=>x.studyId===studyId&&x.decision==='included').map(x=>x.citationKey).join(', ');
 const profiles=r.studies.map(s=>`${s.id} [${citations(s.id)}]: ${s.participants} participants; ${s.population}; ${s.condition}; ${s.intervention} versus ${s.comparator}; follow-up ${s.followupDays} days`).join('; ');
 const eligibility=`Eligible studies were randomized trials in ${population}, covering ${p.condition.replaceAll('-',' ')}, comparing ${intervention} interventions with ${comparator}, with follow-up of at least ${p.minimumFollowupDays} days. Other designs and populations outside these criteria were excluded; absence of a reported outcome alone did not exclude a trial.`;
 const sources=r.searches.map(s=>`${s.source} last searched on ${s.date}`).join('; ');
 const queries=r.searches.map(s=>`${s.source} query (${s.terms.join(` ${s.operator} `)}), language ${s.language}, date limits ${s.from??'unbounded'} to ${s.to??'unbounded'}`).join('; ');
 const objective=p.purpose==='adverse-event-screen'?`The review question concerned ${endpoints} in randomized trials of ${intervention} interventions versus ${comparator} among ${population}, covering ${p.condition.replaceAll('-',' ')}.`:`The objective was trial-level evaluation of ${analysisOutcomes.join(' and ')} as surrogate endpoints for overall survival, using aggregate data from randomized trials of ${intervention} interventions versus ${comparator} in ${population}, covering ${p.condition.replaceAll('-',' ')}.`;
 const title=p.purpose==='adverse-event-screen'?(hasAnalysis?'Systematic review and meta-analysis of randomized-trial adverse events.':'Systematic review of randomized-trial adverse events.'):`Systematic review${hasAnalysis?' and aggregate-data meta-analysis':''} of ${analysisOutcomes.join(' and ')} as surrogates for overall survival in ${p.condition.replaceAll('-',' ')}.`;
 const methods=(a:ReviewAnalysis)=>`${a.id}: ${a.model.replaceAll('-',' ')} with ${a.weighting.replaceAll('-',' ')} weights, chosen for ${a.rationale.replaceAll('-',' ')}; heterogeneity assessed by ${a.heterogeneity}; ${a.software.name} ${a.software.version} [${a.citationKey}]`;
 const kernel=(a:ReviewAnalysis,suffix:string)=>{
  const c=ctx.claims.find(c=>c.id===a.claimId)!;const cert=ctx.input.certifications.find(x=>x.id===c.certificationId)!;
  const facts=cert.metricGrades.filter(f=>f.key===`${a.claimId}.${suffix}`&&f.claimId===a.claimId&&f.certHash===c.certHash&&f.certificationId===c.certificationId&&f.source==='kernel'&&f.grade==='kernel-recomputed'&&f.producerGate);
  requireThat(facts.length===1&&typeof facts[0]!.value==='number'&&Number.isFinite(facts[0]!.value),'review result requires unique kernel fact');return facts[0]!.value as number;
 };
 const ready=(a:ReviewAnalysis)=>{
  const c=ctx.claims.find(c=>c.id===a.claimId)!;if(!c.bundle)return false;
  const cert=ctx.input.certifications.find(x=>x.id===c.certificationId)!;
  return (a.heterogeneity==='Q-and-I-squared'?['i2','q']:['residualVariance']).every(suffix=>cert.metricGrades.some(f=>f.key===`${a.claimId}.${suffix}`&&f.claimId===a.claimId&&f.certHash===c.certHash&&f.certificationId===c.certificationId&&f.source==='kernel'&&f.grade==='kernel-recomputed'&&Boolean(f.producerGate)));
 };
 const result=(a:ReviewAnalysis)=>{
  const c=ctx.claims.find(c=>c.id===a.claimId)!;requireThat(c.bundle,'review result requires complete certified bundle');
  let extra:string;
  if(a.heterogeneity==='Q-and-I-squared'){const i2=kernel(a,'i2'),q=kernel(a,'q');requireThat(i2>=0&&i2<=100&&q>=0,'invalid heterogeneity facts');extra=`I squared ${formatNumber(i2,'effect')}%; Q ${formatNumber(q,'effect')}`;}
  else {const residual=kernel(a,'residualVariance');requireThat(residual>=0,'invalid residual variance');extra=`residual variance ${formatNumber(residual,'effect')}`;}
  const participants=a.studyIds.reduce((n,id)=>n+r.studies.find(s=>s.id===id)!.participants,0);
  const direction=p.purpose==='adverse-event-screen'?` The point estimate corresponds to ${c.bundle.estimate>c.bundle.nullValue?'more':c.bundle.estimate<c.bundle.nullValue?'fewer':'equal'} ${a.outcome.replaceAll('-',' ')} with ${intervention} versus ${comparator}; this comparison does not establish causality.`:'';
  return `${a.id}, ${a.studyIds.length} trials (${participants} participants): ${renderDraft(ctx,`[claim:${a.claimId}].`,'results',buildRegistry([])).text} ${extra}.${direction}`;
 };
 const flowText=()=>{
  const b=flow.databasesAndRegisters,o=flow.otherSources;
  return `Study selection identified ${b.identified} database/register records and ${o.identified} records from other sources. Before screening, ${b.removedBeforeScreening.duplicates+o.removedBeforeScreening.duplicates} duplicates, ${b.removedBeforeScreening.automation} automated exclusions and ${b.removedBeforeScreening.other+o.removedBeforeScreening.other} other removals were recorded. Screening assessed ${b.screened} records and excluded ${b.excludedAtScreening}. Retrieval sought ${b.reportsSought+o.reportsSought} reports; ${b.reportsNotRetrieved+o.reportsNotRetrieved} were unavailable. Eligibility assessment covered ${b.reportsAssessed+o.reportsAssessed} reports, excluding ${b.reportsExcluded+o.reportsExcluded}. Newly included reports numbered ${flow.included.newReports}, representing ${flow.included.newStudies} studies. With ${flow.previous.reports} prior reports from ${flow.previous.studies} studies, the review contains ${flow.included.totalReports} reports from ${flow.included.totalStudies} unique studies.`;
 };
 const excluded=flow.trace.reports.filter(x=>x.decision==='excluded');
 const excludedText=excluded.length?`Reports considered at full-text eligibility but excluded were ${excluded.map(x=>`[${x.citationKey}] (${x.studyId}): ${x.reason}`).join('; ')}.`:'No retrieved reports were excluded after the full-text eligibility assessment.';
 const dataItems=`Outcomes sought were ${endpoints}. All compatible measures, timepoints and analyses were sought; studies with unavailable outcome results were retained.`;
 const otherItems=r.collection?`Additional extraction variables comprised participant count, population, condition, intervention, comparator and follow-up duration. Missing or unclear values were recorded as missing without imputation.`:null;
 let text:string|null=null;
 const main=(item:string):string|null=>{
  switch(item){
   case '1':return title;
   case '4':return objective;
   case '5':return `${eligibility} Planned synthesis groups were defined by outcome and comparison.`;
   case '6':return `Information sources comprised ${sources}.`;
   case '7':return `Complete executed search specifications: ${queries}.`;
   case '8':{const w=r.workflow;return w?`Eligibility screening used ${w.recordReviewers} reviewers per record and ${w.reportReviewers} per retrieved report, working ${w.independent?'independently':'jointly'}; disagreements used ${w.resolution.replaceAll('-',' ')}. Automation was ${w.automation.replaceAll('-',' ')}.`:null;}
   case '9':{const c=r.collection;return c?`Data collection used ${c.reviewers} extractors per report, working ${c.independent?'independently':'jointly'}. Extraction automation: ${c.automation.replaceAll('-',' ')}. Investigator contact to obtain or confirm data: ${c.investigatorContact}.`:null;}
   case '10a':return dataItems;
   case '10b':return otherItems;
   case '12':return hasAnalysis&&primary.every(a=>ctx.claims.find(c=>c.id===a.claimId)!.bundle)?`Outcome-specific measures: ${primary.map(a=>`${a.outcome}, ${ctx.claims.find(c=>c.id===a.claimId)!.bundle?.measure??'unavailable'}`).join('; ')}.`:null;
   case '13a':return hasAnalysis?`Synthesis eligibility compared recorded trial outcomes and comparisons against the planned groups; memberships were ${r.analyses.map(a=>`${a.id}: ${a.studyIds.join(', ')}`).join('; ')}.`:null;
   case '13b':return hasAnalysis?`Summary-data preparation applied ${r.analyses.map(a=>`${a.id}: ${a.preparation.replaceAll('-',' ')}, ${a.missingSummary.replaceAll('-',' ')}, zero-event handling: ${zeroEventText[a.zeroEvents]}`).join('; ')}.`:null;
   case '13c':return hasAnalysis?`Presentation methods for individual and pooled estimates used ${r.analyses.map(a=>`${a.id}: ${a.display.replaceAll('-',' ')}`).join('; ')}.`:null;
   case '13d':return hasAnalysis?`Statistical synthesis procedures were ${r.analyses.map(methods).join('; ')}.`:null;
   case '13e':return hasAnalysis?`Investigations of heterogeneity used the recorded subgroup policy: ${r.analyses.map(a=>`${a.id}: ${a.subgroups}`).join('; ')}.`:null;
   case '13f':return hasAnalysis?`Robustness checks used the sensitivity procedures ${r.analyses.map(a=>`${a.id}: ${a.sensitivity.replaceAll('-',' ')}`).join('; ')}.`:null;
   case '16a':return flowText();
   case '16b':return excludedText;
   case '17':return r.studies.length&&r.studies.every(s=>citations(s.id))?`Included randomized-trial characteristics and citations: ${profiles}.`:null;
   case '20b':return hasAnalysis&&r.analyses.every(ready)?r.analyses.map(result).join(' '):null;
   case '20c':{const analyses=r.analyses.filter(a=>a.role==='heterogeneity');return !hasAnalysis?null:analyses.length?(analyses.every(ready)?`Heterogeneity investigations: ${analyses.map(result).join(' ')}`:null):r.analyses.every(a=>a.subgroups==='none')?'No subgroup or meta-regression investigations of heterogeneity were conducted in the recorded review analyses.':null;}
   case '20d':{const analyses=r.analyses.filter(a=>a.role==='sensitivity');return !hasAnalysis?null:analyses.length?(analyses.every(ready)?`Sensitivity findings: ${analyses.map(result).join(' ')}`:null):r.analyses.every(a=>a.sensitivity==='none')?'No sensitivity analyses were conducted for robustness of the recorded synthesized estimates.':null;}
   default:return null;
  }
 };
 if(name==='PRISMA')text=main(id);
 if(name==='PRISMA-Abstracts'){
  const map:Record<string,string>={'1':'1','2':'4','3':'5','4':'6'};if(map[id])text=main(map[id]!);
  if(id==='6'&&hasAnalysis)text=`Abstract synthesis methods: ${primary.map(a=>`${methods(a)}; presentation ${a.display.replaceAll('-',' ')}`).join('; ')}.`;
  if(id==='7'&&r.studies.length)text=`The review included ${r.studies.length} randomized trials and ${r.studies.reduce((n,s)=>n+s.participants,0)} participants. Study profiles were ${profiles}.`;
  if(id==='8'&&hasAnalysis&&primary.every(ready))text=`Main outcome estimates: ${primary.map(result).join(' ')}`;
 }
 if(name==='PRISMA-Harms'){
  if(id==='1')text=title;
  if(id==='14'&&hasAnalysis)text=`Zero-event handling in the adverse-event syntheses: ${r.analyses.map(a=>`${a.id}, ${zeroEventText[a.zeroEvents]}`).join('; ')}.`;
  if(id==='18'&&r.studies.length&&r.studies.every(s=>p.outcomes.every(o=>s.harms.some(h=>h.outcome===o))))text=`Harm definitions, ascertainment and observation periods: ${r.studies.flatMap(s=>s.harms.map(h=>`${s.id} [${h.citationKey}], ${OUTCOMES[h.outcome]}, ${h.ascertainment.replaceAll('-',' ')} ascertainment from day ${h.startDay} through day ${h.endDay}`)).join('; ')}.`;
  if(id==='21'&&r.causality==='not-assessed')text='Causality of the recorded adverse events was not assessed; event occurrence alone does not establish a causal relationship with the intervention.';
 }
 if(name==='ReSEEM'){
  const map:Record<string,string>={'1':'1','4':'4','6':'5','7':'6','8':'7','9':'8','10':'9'};if(map[id]&&(id!=='1'||hasAnalysis))text=main(map[id]!);
  if(id==='11'&&otherItems)text=`Review data inventory: ${dataItems} ${otherItems}`;
  if(id==='17')text=`${flowText()} ${excludedText}`;
  if(id==='16C'&&hasAnalysis)text=`Trial-level association methods: ${primary.map(a=>{const s=a.surrogacy!;return `${methods(a)}; unit ${s.unit}, treatment effects ${s.effectMetric} from ${s.effectSource} estimates, measurement error ${s.measurementError}, weights ${a.weighting} to ${a.weighting==='sample-size'?'reflect trial size':'reflect estimate precision'}, surrogate threshold effect ${s.ste==='not-estimated'?'not estimated':'estimated using the regression prediction limit'}`;}).join('; ')}.`;
  if(id==='16D'&&hasAnalysis)text=`Surrogacy validation procedures recorded for each trial-level analysis: ${primary.map(a=>`${a.id}, ${a.surrogacy!.validation.replaceAll('-',' ')}`).join('; ')}.`;
 }
 if(text===null)return null;
 const source=`review:${name}:${id}`;return {source,text,verified:true,sha256:canonicalSha256({paperHash:ctx.input.sha256,name,item:id,source,text,recordsHash:doc.sha256,ledgerHash:flow.ledgerHash})};
}
