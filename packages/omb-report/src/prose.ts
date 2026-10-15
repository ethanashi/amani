import { genericLimitation, openResearchQuestion } from './boundaries.ts';
import { checkEnglish } from './english.ts';
import { requireThat } from './common.ts';
import { canonicalText, lexicalForms, lexicalKey, normalise } from './normalise.ts';
/** Detection is scoped to study assertions, not authorization of ordinary English. */
export const ASSERTION = /\b(?:conclusive|real|genuine|work(?:s|ed)|signif|associat\w*|correlat\w*|caus(?:e[sd]?|ing|al)|cur(?:e[sd]?|ing)|predict(?:s|ed|ing)?|confirm\w*|establish\w*|demonstrat\w*|show(?:s|ed|n)?|reveal\w*|prov(?:e[sd]?|en)|verif\w*|validat\w*|significan\w*|nonsignificant|effect(?:ive|iveness)?|driv\w*|linked|link|relationship|increas\w*|decreas\w*|reduc\w*|improv\w*|support\w*|null|protect\w*|confound\w*|remov\w*|definitiv\w*|robust\w*|harm\w*|safe|safety|benefit\w*)\b/iu;
export function hasAssertion(text:string):boolean {return lexicalForms(text).some(x=>ASSERTION.test(x));}
/** Plan labels are noun fragments, never sentences or hidden markup. Measures have
 * a separate closed vocabulary. Checked before any software interpolation. */
/** Pinned noun registry for common roles. Additional names must be in PW0's
 * frozen entity/variable registry, not merely supplied in a prose plan field. */
export const PLAN_NOUNS=Object.freeze(['age','sex','ALS','LDL','MCI','CVD','DM','CD','HDL','BMI','mortality','survival','blood pressure','biological rationale','prior biological rationale','directional prior evidence','incomplete records','community registry']);
export function planFragment(value:unknown,field:string,names:readonly string[]=PLAN_NOUNS):string {
 requireThat(typeof value==='string'&&value.trim().length>0,`missing plan ${field}`);
 const text=normalise(value);checkEnglish(text);
 requireThat(/^[\p{L}\p{M}]+(?:[ -][\p{L}\p{M}]+)*$/u.test(text),`plan ${field} must be a plain fragment`);
 requireThat(names.some(name=>lexicalKey(name)===lexicalKey(text)),`plan ${field} must resolve to a registered noun phrase`);
 return text;
}
export function validatePlan(plan:Record<string,unknown>,names:readonly string[]=PLAN_NOUNS):void {
 for(const key of ['exposure','outcome','one_sided_justification','controls_source'])if(plan[key]!==undefined)plan[key]=planFragment(plan[key],key,names);
 for(const key of ['adjustment','exclusions'])if(plan[key]!==undefined){requireThat(Array.isArray(plan[key]),`plan ${key} must be a list`);plan[key]=(plan[key] as unknown[]).map(x=>planFragment(x,key,names));}
 if(plan.estimand!==undefined){requireThat(typeof plan.estimand==='string','invalid estimand');const measure=normalise(plan.estimand).toLowerCase();requireThat(['odds ratio','risk ratio','hazard ratio','risk difference','mean difference','correlation','regression coefficient','r squared','estimate','auc'].includes(measure),'estimand requires a supported measure');plan.estimand=measure;}
}

/** Only software may assert these plan/provenance predicates. Narrative about
 * uncertainty, procedure rationale, or proposed future work remains free prose. */
export function checkNarrative(text:string,prose:string,region:string,reviewedMethod=false):void {
 const key=canonicalText(prose).toLowerCase();
 // Part B prose may describe uncertainty, not dismiss it or invent mitigation.
 if(region==='limitations'){
  const reassurance=/\b(?:unlikely to (?:matter|be important)|(?:no|little|not of) concern|immaterial|inconsequential|irrelevant|trivial|minor issue|non-issue|not an issue|nothing to worry|no threat|minimal bias|unaffected|stands(?: regardless)?|does not undermine|should not affect|(?:was|were|is|are|has been|have been) (?:fully )?(?:addressed|handled|resolved|accounted for)|technicality|formality|(?:further|additional) data (?:are|is) unnecessary|no (?:further|additional) data|(?:chance event|bad luck|fluke|spurious))\b/iu;
  requireThat(!lexicalForms(key).some(k=>reassurance.test(k)),'limitation reassurance requires certified evidence');
  requireThat(!/\b(?:sampling|recruitment) (?:is |was )?(?:adequate|representative|sufficient|appropriate|varied)\b|\bled to this result\b/iu.test(key),'limitation study assertion requires certified evidence');
 }
 const prospective=/\b(?:may|might|could|would|should|hypothesi\w*|whether|needed|warranted|future)\b/iu.test(key);
 requireThat(!/\b(?:sure|of course|here is the revised|as an ai)\b/iu.test(key),'conversational scaffolding');
 requireThat(reviewedMethod||!/\b(?:participants|patients|cases|controls|samples)\b[^.!?]*\b(?:were|was) included\b/iu.test(key),'inclusion criteria require a proc slot');
 requireThat(reviewedMethod||!procedureAssertion(key),'fact-bearing procedure requires a proc slot');
 const generalNegative=/\b(?:cannot|can not|could not) be excluded\b/iu.test(key)&&!/\b(?:participants|patients|cases|samples)\b/iu.test(key);
 if(region==='limitations'&&!/\[/u.test(text)&&genericLimitation(key))return;
 requireThat(!/\b(?:well-proven|not yet established|not confirmed|not been confirmed|needs verification|preliminary|needs confirmation|tentative|refuted|non-identifiable|voided|exploratory)\b/iu.test(key),'status evaluation requires a claim template');
 const statistic=/\b(?:OR|odds ratio|risk ratio|hazard ratio|risk difference|mean|median|estimate|probability|auc|confidence interval|effect size|sensitivity|specificity)\b/iu.test(key);
 requireThat(!statistic||! /\[(?:d|l|v|r):/u.test(text),'statistical result requires a claim template');
 // A term naming a kind of measure/claim is not itself a study finding.
 // Only the noun phrase is masked: every predicate and trailing clause remains checked.
 let semanticKey=key
  .replace(/\blinked to (?:eligibility|enrolment|enrollment) decisions\b/gu,'cross-referenced with administrative decisions')
  .replace(/\b(?:association measure|association question|prediction question|prediction claim|causal explanation|predicted probabilities|established disease|established diagnosis)\b/gu,'concept')
  .replace(/\b((?:assessment|evaluation|evaluating) (?:of )?(?:an? )?)(?:association|prediction)\b/gu,'$1concept')
  .replace(/\b(discussion of (?:whether )?)prediction\b/gu,'$1concept')
  .replace(/\b((?:a|the) definition) establishes (?=what\b|how\b|the meaning\b)/gu,'$1 describes ')
  .replace(/\b(what (?:a|the) definition) supports\b/gu,'$1 describes')
  .replace(/\b((?:explain|interpret|the meaning of|questions? about) (?:a|an|the)) (?:relationship|association)\b/gu,'$1 concept')
  .replace(/\b(?:association|relationship)(?= (?:could|might|would|may) (?:mean|represent)\b)/gu,'concept');
 // A nominal request for future settling data does not assert that a relation exists.
 // Keep all predicates checked; finite/completed clauses never get this treatment.
 if(region==='limitations'&&/^(?:information|data|observations|documentation|measurements|records|composition documentation)\b/u.test(key)&&! /\b(?:is|are|was|were|has|have|had|did|does|collected|obtained|analysed|analyzed)\b/u.test(key))semanticKey=semanticKey.replace(/\b(?:relationship|association)\b/gu,'topic');
 if(semanticKey!==key)requireThat(!/\b(?:cures?|causes?|proves?|demonstrates?|shows? that|is effective)\b/u.test(semanticKey),'empirical predicate alongside conceptual wording requires certified evidence');
 const studyResult=/\b(?:result|finding|conclusion|association|prediction|hypothesis)\w*\b/iu.test(semanticKey);
 const caution=/\b(?:caution|carefully|uncertainty|limitations|interpretation|interpreted)\b/iu.test(key)&&/\b(?:should|must|requires?|warrants?)\b/iu.test(key);
 requireThat(!(studyResult&&hasAssertion(semanticKey)&&!caution),'study finding requires a claim template');
 // Claims about literature need frozen evidence; hypotheses and generic limits
 // do not assert that a biological relationship has been established.
 const question=/^(?:this study looked at a blood marker and its link to a nerve disease|the research question concerns the relationship between molecular biology and clinical presentation)[.]$/iu.test(key);
 // Describing structure prediction is tool use, not an assertion of a study effect.
 // Remove only that operation; any additional biological assertion is still checked.
 const assertionKey=(reviewedMethod?semanticKey.replace(/\bsignificance (?:threshold|level)\b/gu,'decision criterion'):semanticKey).replace(/\b(?:predicted|predicts|predicting) (?:the|a) structure(?=[.!?]?$)/gu,'');
 requireThat(!hasAssertion(assertionKey)||openResearchQuestion(key)||question||prospective||generalNegative||caution||/\b(?:discuss|rationale|method|design|assumptions|cause of death|confounding cannot)\b/iu.test(key),'assertion needs a claim template or frozen citation');
 // Slots carry their own units. A drafter cannot rename raw rows as participants.
 if(/\[(?:m|d|l):/u.test(text))requireThat(!/\b(?:negative|minus|plus|times|over|pct|bp|people|participants|units|files|rows|mg|kg|ml|cm|x)\b|[/:;]/iu.test(prose),'numeric modifier or author-supplied unit');
}

/** Procedure fact classes have no hedge/method escape: these claims need a
 * producer even when a trailing clause expresses uncertainty. */
export function procedureAssertion(key:string):boolean {
 const genericNegative=/^(?:residual )?confounding cannot be excluded[.]$/iu.test(key);
 if(genericNegative)return false;
 return /\b(?:pre-?regist\w*|regist\w*|pre-?specif\w*|prespecif\w*|a priori|post hoc|beforehand|in advance|before (?:any |the )?(?:look|unblinding|data)|after unblinding|locked|one-sided|two-sided|one-tailed|two-tailed|directional (?:test|hypothesis)|exclud\w*|omitt?\w*|dropped|discard\w*|filtered out|ineligible|not enrolled|left out|removed|adjust\w*|unadjusted|controlled for|as covariates|validat\w*|hold-out|held-out|held out|external cohort|independent data|archiv\w*|deposited|repository|github|filed)\b/iu.test(key)
  ||/\bcontrols? (?:were |was )?(?:sampled|recruited|drawn|came|come)\b/iu.test(key)
  ||/\b(?:code|files|data|protocol) (?:was |were |is |are )?(?:stored|released|available|recorded)\b/iu.test(key);
}

/** PW6 free slots provide background/design explanation, never findings or recorded
 * contributions. Precise predicates block; residual prose is explicitly unverified and
 * requires PW7 spin/domain review. This is not a semantic proof or a vocabulary filter. */
export interface ProseReviewFlag {kind:'independent-review-required';text:string;reason:string}
export function checkReaderProse(text:string):ProseReviewFlag[] {
 const folded=canonicalText(text).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
 requireThat(!/\b(?:eradicat\w*|abolish\w*|eliminat\w*|cur(?:e[sd]?|ing))\b/u.test(folded),'unsupported finding requires a record-backed claim template');
 requireThat(!/\b(?:checked|verified|validated|reviewed|audited|confirmed)\s+by\b/u.test(folded)
  &&!/\b(?:author|researcher|investigator|reader|human|software|artificial intelligence|chatbot|language model|ai system)\b[^.!?]*\b(?:checked|verified|chose|selected|audited|reviewed|recomputed|analysed|analyzed|ran|reran|wrote)\b/u.test(folded)
  &&!/\b(?:we|i)\s+(?:checked|verified|audited)\s+(?!whether\b)/u.test(folded),
  'checking and contribution attributions require recorded actions');
 return [{kind:'independent-review-required',text,reason:'Free background/design prose may contain unsupported claims, procedure facts or jargon; PW7 spin/domain and human review required.'}];
}
