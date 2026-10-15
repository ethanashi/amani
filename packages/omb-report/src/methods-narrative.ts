import {canonicalSha256} from '../../bio-core/src/index.ts';
import {type ReportContext,assertContext} from './context.ts';
import {record,requireThat,strings} from './common.ts';
import {canonicalText} from './normalise.ts';
import {aiComparisonKey,type AIReviewFlag} from './ai-prose.ts';

export interface MethodNarrativeReview {paperHash:string;proseHash:string;flags:AIReviewFlag[];methodFact:boolean;adjustmentMatched:boolean}
const reviewed=new WeakMap<MethodNarrativeReview,string>();
export function assertMethodNarrative(ctx:ReportContext,review:MethodNarrativeReview,prose:string):void {
 assertContext(ctx);requireThat(review.paperHash===ctx.input.sha256&&review.proseHash===canonicalSha256(prose)&&reviewed.get(review)===canonicalSha256(review),'Methods narrative proof changed or belongs to another paper/sentence');
}
const PROFILES:Record<string,{family:string;calibration:string}>=Object.freeze({
 'ols.wild-hc2-bm@2':{family:'linear',calibration:'wild-bootstrap'},
 'two-group.welch-perm@2':{family:'welch',calibration:'permutation'},
 'paired.signflip-t@2':{family:'paired',calibration:'sign-flip'},
 'crossover.hills-armitage@2':{family:'crossover',calibration:'registered'},
 'stratified.weighted-welch@2':{family:'welch',calibration:'registered'},
 'stratified.cr2-bm-relabel@2':{family:'stratified',calibration:'permutation'},
 'binary.exact-rd@1':{family:'risk-difference',calibration:'exact'},
 'rank.brunner-munzel-perm@2':{family:'rank',calibration:'permutation'},
 'ratio.log-gm-welch-perm@2':{family:'welch',calibration:'permutation'},
});
const factual=/\b(?:(?:was|were|is|are|has been|have been)\s+(?:\w+\s+){0,3}(?:used|applied|performed|fitted|fit|estimated|imputed|excluded|removed|selected|normalized|normalised|standardized|standardised|winsorised|winsorized|processed|stored|collected|frozen|fixed|set|specified|chosen|tested|split|divided|handled)|(?:we|analyses|analysis|models|samples|data|the procedure)\s+(?:used|applied|performed|employed|underwent|included|imputed|excluded|selected|fitted|estimated|normalized|normalised|stored|collected|fixed|specified)|using|we did not use)\b/u;
/** Recognized factual propositions are compared with typed records. Unknown
 * techniques remain explicit owner-review flags, never implicitly verified.
 * This is a bounded factual vocabulary, not a whitelist of permitted sentences. */
export function assessMethodsNarrative(ctx:ReportContext,prose:string):MethodNarrativeReview {
 assertContext(ctx);const text=aiComparisonKey(canonicalText(prose)),reasons=new Set<string>();let methodFact=false,adjustmentMatched=false;
 const policy=record(ctx.input.lockedPlan.methodsPolicy),executions=record(record(ctx.input.runMetadata).procedureExecutions);
 const profiles=ctx.claims.map(c=>{
  const execution=record(executions[c.id]);const cert=ctx.input.certifications.find(cert=>cert.id===c.certificationId);
  const procedure=record(record(cert?.certificate.procedures)[c.id]);const result=record(record(cert?.certificate.procedureResults)[c.id]);
  return execution.certificateHash===c.certHash&&execution.procedureId===procedure.procedureId&&result.procedure===execution.procedureId&&result.status==='ok'?PROFILES[String(execution.procedureId)]:undefined;
 });
 let negative=false;
 const compare=(category:string,expected:unknown,observed:unknown,negated=negative)=>{methodFact=true;if(observed===undefined||observed===null){reasons.add('methods-unrecorded:'+category);return;}requireThat(negated?observed!==expected:observed===expected,`Methods contradiction: ${category} differs from records; use software template slots`);};
 const allProfiles=(key:'family'|'calibration')=>profiles.length&&profiles.every(p=>p&&p[key]===profiles[0]?.[key])?profiles[0]![key]:undefined;
 // Adjustment sets remain closed and alias-bound. The grammar consumes the
 // entire statement, so a matching covariate cannot hide an extra assertion.
 const adjustment=/^(?:we adjusted for|(?:the )?(?:analysis|analyses|models?) (?:was|were) adjusted for|adjustment for|correction for|we corrected for|we regress(?:ed)? out) (.+?)(?: was applied)?[.!?]?$/u.exec(text);
 if(adjustment){
  const named=adjustment[1]!.replace(/[.!?]+$/u,'').split(/\s*(?:,|\band\b)\s*/u).filter(Boolean);
  requireThat(named.length>0,'empty adjustment set');
  for(const c of ctx.claims){const locked=strings(c.plan.adjustment).map(aiComparisonKey),aliases=record(c.plan.covariateAliases);
   const resolved=named.map(n=>locked.find(a=>a===n)||Object.entries(aliases).find(([name,values])=>locked.includes(aiComparisonKey(name))&&strings(values).map(aiComparisonKey).includes(n))?.[0]).map(n=>n?aiComparisonKey(n):null);
   requireThat(resolved.every(n=>n!==null)&&new Set(resolved).size===resolved.length&&canonicalSha256([...resolved].sort())===canonicalSha256([...locked].sort()),'Methods contradiction: adjustment set differs from locked plan; covariate statements require a plan adjustment proc slot / software template slots');
  }
  methodFact=true;adjustmentMatched=true;
 }
 // Inspect technique mentions regardless of the governing verb. Clause-local
 // negation avoids reversing a second method merely because the first is denied.
 for(const text of aiComparisonKey(canonicalText(prose)).split(/[.!?;]|\b(?:but|whereas|and)\b/u)){
  negative=/\b(?:not|never|without)\b|\bno (?:missing values|imputation)\b/u.test(text);
  const technique=/\b(?:imput\w*|chained equations|mice|complete[ -](?:cases?|records?)|listwise deletion|linear regression|ordinary least squares|logistic|cox|random.forest|poisson|mixed.effects|random.effects|wild.bootstrap|permutation|sign.flip|exact test|preprocess\w*|normaliz\w*|normalis\w*|standardiz\w*|standardis\w*|scaling|feature selection|exclu\w*|one.sided|two.sided|one.tailed|two.tailed|directional test|python|sas|stata|spss|julia|matlab|excel|software|transformation|log.transform\w*|winsori\w*|maximum likelihood|refrigerat\w*|cryopreserv\w*|fasting|centrifug\w*|threshold|resampl\w*|seed|runtime|hardware)\b/u.test(text);
  const impliedImputation=/\bmissing\b/u.test(text)&&/\bestimated values\b/u.test(text)||/\bincomplete\b/u.test(text)&&/\bfilled in\b/u.test(text);
  const uncertain=/\b(?:may|might|could|can|should|would|future|hypothetical|previous studies|prior studies|the literature|in general|for example)\b/u.test(text);
  if((technique||impliedImputation)&&uncertain){methodFact=true;reasons.add('methods-unrecorded:uncertain-technique');continue;}
  // Track each clause independently: an earlier matched fact cannot hide a
  // later unknown technique. compare() still supplies the authenticated proof.
  const priorMethodFact:boolean=methodFact;methodFact=false;
  if(/\b(?:chained equations|mice)\b/u.test(text))compare('imputation-algorithm','chained-equations',policy['imputation-algorithm']);
  if(/\b(?:imput\w*|chained equations|mice)\b/u.test(text)||impliedImputation)compare('missing-data',true,policy['missing-data']===undefined?undefined:policy['missing-data']==='multiple-imputation');
  if(/\b(?:complete.cases?|complete.records?|complete.case analysis|listwise deletion)\b/u.test(text))compare('missing-data','complete-case',policy['missing-data']);
  if(/\b(?:no missing|missing.free)\b/u.test(text)&&!/\bimput\w*/u.test(text))compare('missing-data','no-missing-values',policy['missing-data'],false);
  if(/\b(?:linear|ordinary least squares) regression\b/u.test(text))compare('model-family','linear',allProfiles('family'));
  if(/\b(?:logistic|cox|random.forest|poisson|mixed.effects|random.effects)\b/u.test(text))compare('model-family',text.match(/\b(logistic|cox|random.forest|poisson|mixed.effects|random.effects)\b/u)![1]!.replace(/ /gu,'-'),allProfiles('family'));
  if(/\b(?:wild.bootstrap|permutation|sign.flip|exact test)\b/u.test(text))compare('calibration',text.match(/\b(wild.bootstrap|permutation|sign.flip|exact test)\b/u)![1]!.replace(/ /gu,'-').replace('exact-test','exact'),allProfiles('calibration'));
  if(/\b(?:preprocessing|normalization|normalisation|standardization|standardisation|scaling)\b/u.test(text)&&/\b(?:training|entire|full|before splitting)\b/u.test(text))compare('preprocessing-within-folds',/\b(?:entire|full|before splitting)\b/u.test(text)?'before-splitting':'within-training-folds',policy['preprocessing-within-folds']);
  if(/\bfeature selection\b/u.test(text))compare('feature-selection-within-folds',negative||/\bno\b/u.test(text)?'none':'within-training-folds',policy['feature-selection-within-folds'],false);
  if(/\b(?:exclusion|exclusions|excluded)\b/u.test(text)&&/\b(?:before|after) splitting\b/u.test(text))compare('exclusion-order',text.includes('after splitting')?'after-splitting':'before-splitting',policy['exclusion-order']);
  if(/\b(?:one.sided|two.sided|one.tailed|two.tailed|directional test)\b/u.test(text))compare('test-direction',/\b(?:one[ -]|directional test)/u.test(text)?'one-sided':'two-sided',ctx.claims.every(c=>c.plan.direction==='two-sided')?'two-sided':ctx.claims.every(c=>['greater','less'].includes(String(c.plan.direction)))?'one-sided':undefined);
  {
   const software=/\b(?:r|python|sas|stata|spss|julia|matlab|excel)\b/u.exec(text)?.[0];
   if(software){const packages=record(ctx.input.environmentLock).packages;compare('software:'+software,true,Array.isArray(packages)&&!/\bdata entry\b/u.test(text)?packages.map(record).some(p=>aiComparisonKey(String(p.name))===software):undefined);}
  }
  if((technique||impliedImputation||factual.test(text)&&/\b(?:seed|resampl\w*|runtime|hardware|threshold|alpha|significance level|samples?|specimens?|data|models?|likelihood|software|package|regression|analysis|analyses|test|testing)\b/u.test(text))&&!methodFact){methodFact=true;reasons.add('methods-unrecorded:procedure');}
  if(/\bexecution took place\b/u.test(text)){methodFact=true;reasons.add('methods-unrecorded:hardware');}
  if(/\b(?:winsori\w*|maximum likelihood|refrigerat\w*|cryopreserv\w*|fasting|centrifug\w*|threshold|resampl\w*|seed|runtime|hardware|transformation|log.transform\w*)\b/u.test(text)){methodFact=true;reasons.add('methods-unrecorded:detail');}
  methodFact=methodFact||priorMethodFact;
 }

 const proseHash=canonicalSha256(prose);const flags=[...reasons].sort().map(reason=>({id:canonicalSha256({paperHash:ctx.input.sha256,proseHash,reason}),paperHash:ctx.input.sha256,proseHash,reason}));
 const review={paperHash:ctx.input.sha256,proseHash,flags,methodFact,adjustmentMatched};reviewed.set(review,canonicalSha256(review));return review;
}
