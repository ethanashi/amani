import {mrEvidence,type MRDocument} from './mr-evidence.ts';
import {reviewEvidence} from './review-evidence.ts';
import type {ReviewDocument} from './review-records.ts';
import {renderDraft} from './render.ts';
import {buildRegistry} from './entities.ts';
import {canonicalSha256} from '../../bio-core/src/index.ts';
import {assertContext,type ReportContext} from './context.ts';
import {record,requireThat} from './common.ts';
import {identifier} from './pw5-records.ts';
import {assertMethods,methodCompleteness,type MethodsDocument,type MethodsSlot} from './methods.ts';
import {assertMatter,deriveMatterInput,type MatterDocument} from './matter.ts';
import {checkPW5Covariates} from './methods.ts';
import {checkMatterNarrative} from './matter.ts';
import {checkNarrative} from './prose.ts';
import {exactKeys,readPW5Receipt,type PW5Receipt,type PW5Authority} from './pw5-evidence.ts';
import {normalise,lexicalKey} from './normalise.ts';

/** Closed planned policies. Site evidence is supplied separately by a host receipt. */
export interface ChecklistPlanFields {
 reporting: {
  rationale: 'external-validation'|'replication'|'hypothesis-testing';
  design: 'cohort'|'case-control'|'cross-sectional'|'randomized-trial';
  interpretation: 'cautious-observational';
  generalisability: 'source-population-only';
 };
}
export interface StudySetting {sites:{id:string;name:string;city:string;country:string}[];startDate:string;endDate:string;manifestHash:string}
export interface VerifiedStudySetting {paperHash:string;value:StudySetting}
export const STUDY_SETTING_DOMAIN='omb-report/study-setting@1';
const settings=new WeakMap<VerifiedStudySetting,string>();
/** The host issues this receipt from authenticated stager metadata, not plan.json
 * or an owner's prose submission. A hash alone does not authenticate a setting. */
export function buildStudySetting(ctx:ReportContext,envelope:PW5Receipt<StudySetting>,verify:PW5Authority):VerifiedStudySetting {
 const value=readPW5Receipt(ctx,envelope,STUDY_SETTING_DOMAIN,verify);
 exactKeys(value,['sites','startDate','endDate','manifestHash'],'study setting field');
 requireThat(ctx.input.stagerManifests.some(m=>canonicalSha256(m)===value.manifestHash),'study setting manifest absent');
 requireThat(Array.isArray(value.sites)&&value.sites.length>0&&value.sites.length<=100,'missing study sites');
 requireThat(new Set(value.sites.map(s=>s.id)).size===value.sites.length,'duplicate study site');
 for(const site of value.sites){
  exactKeys(site,['id','name','city','country'],'study site field');
  requireThat(typeof site.id==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(site.id),'invalid study site id');
  requireThat(typeof site.name==='string'&&site.name.length>=2&&site.name.length<=80&&/^[\p{L}\p{M}]+(?:[ '-][\p{L}\p{M}]+)*$/u.test(site.name),'invalid study site identifier');
  const name=normalise(site.name);const nameReview=checkMatterNarrative(ctx,name);checkPW5Covariates(ctx,name);checkNarrative(name,name,'methods');
  requireThat(nameReview.flags.length===0,'site identifier needs owner review; not verified');
  siteNoun(site.name,'name');siteNoun(site.city,'city');
  requireThat(typeof site.country==='string'&&/^[A-Z]{2}$/u.test(site.country),'invalid study site country');
  const city=normalise(site.city);requireThat(checkMatterNarrative(ctx,city).flags.length===0,'site city needs owner review; not verified');checkPW5Covariates(ctx,city);checkNarrative(city,city,'methods');
 }
 date(value.startDate);date(value.endDate);requireThat(value.startDate<=value.endDate,'reversed study dates');
 const doc={paperHash:ctx.input.sha256,value};settings.set(doc,canonicalSha256(doc));return doc;
}
/** Restricted proper-name grammar: bounded title-cased noun components, only
 * closed lowercase name particles, and no clause introducers or assertion verbs.
 * Country is a two-letter code; this layer does not certify geopolitical identity. */
function siteNoun(value:unknown,field:string):asserts value is string {
 requireThat(typeof value==='string'&&value.length>=2&&value.length<=80&&/^[\p{L}\p{M}]+(?:[ '-][\p{L}\p{M}]+)*$/u.test(value),'invalid study site '+field);
 const tokens=value.normalize('NFKC').split(/[ '-]/u);
 requireThat(tokens.every(t=>/^(?:de|del|la|le|of|and|the|van|von|s)$/u.test(t)||/^\p{Lu}[\p{L}\p{M}]*$/u.test(t)),'study site '+field+' must be proper-name components');
 requireThat(!/\b(?:where|which|who|whose|that|with|without|because|while|when|under|cured?|recovered?|halved|doubled|approved|approval|consent|wrote|written|drafted|generated|causes?|caused|treatment|patients?|every|all|is|was|were|has|have|had|received|reduced|improved|provided|collected|achieved|found|proved|showed|resulted|performed|used)\b/iu.test(value),'study site '+field+' cannot contain clauses or verbs');
}
export interface ChecklistProducers {methods?:MethodsDocument;matter?:MatterDocument;setting?:VerifiedStudySetting;review?:ReviewDocument;mr?:MRDocument}
export interface ChecklistEvidence {source:string;text:string;sha256:string;verified:boolean}
// An item can only select its registered producer. New checklist domains require
// a typed producer here; an unsupported item deliberately remains unresolved.
const SOURCES:Readonly<Record<string,Readonly<Record<string,string>>>>=Object.freeze({
 STROBE:Object.freeze({'1a':'design-title','2':'rationale','3':'objectives','4':'design','5':'setting','7':'estimand','8':'data-sources','10':'sample-size-power','12a':'procedure','12c':'missing-data','18':'key-results','20':'interpretation','21':'generalisability','22':'funding'}),
 REMARK:Object.freeze({'1':'objectives','8':'estimand','9':'sample-size-power','10':'procedure','19':'interpretation','20':'generalisability'}),
 'STROBE-MR':Object.freeze({}),
});
const completeness=new Set<MethodsSlot>(['data-sources','sample-size-power','missing-data']);
function date(value:unknown):asserts value is string {
 requireThat(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'invalid reporting date');
}
export function checklistEvidence(ctx:ReportContext,name:string,item:{id:string;clinical:boolean},producers:ChecklistProducers={}):ChecklistEvidence|null {
 assertContext(ctx);
 if(['PRISMA','PRISMA-Abstracts','PRISMA-Harms','ReSEEM'].includes(name))return producers.review?reviewEvidence(ctx,producers.review,name,item.id):null;
 if(name==='STROBE-MR'&&!item.clinical&&producers.mr)return mrEvidence(ctx,producers.mr,item.id);
 const source=item.clinical?'clinical':SOURCES[name]?.[item.id];if(!source)return null;
 let text:string;const reporting=record(ctx.input.lockedPlan.reporting);
 if(source==='clinical')text='Research use only; no clinical role or implementation is proposed';
 else if(source==='objectives') {
  text=ctx.claims.map(c=>{identifier(c.plan.exposure,'objective exposure');identifier(c.plan.outcome,'objective outcome');return `The pre-specified objective was to examine ${c.plan.exposure} in relation to ${c.plan.outcome}.`;}).join(' ');
 } else if(source==='key-results') {
  text=ctx.claims.map(c=>renderDraft(ctx,`[claim:${c.id}].`,'results',buildRegistry([])).text).join(' ');
 } else if(source==='design'||source==='design-title') {
  const designs={'cohort':'This was an observational cohort study.','case-control':'This was a case-control study.','cross-sectional':'This was a cross-sectional study.','randomized-trial':'This was a randomized controlled trial.'};
  requireThat(reporting.design!=='randomized-trial','trial design requires an authenticated trial producer');
  requireThat(typeof reporting.design==='string'&&Object.hasOwn(designs,reporting.design),'missing typed study design');text=source==='design-title'?`The study used a ${reporting.design} design.`:designs[reporting.design as keyof typeof designs];
 } else if(source==='rationale') {
  const rationale={'external-validation':'The background motivation was to test whether earlier findings extend to an independent population.','replication':'Earlier findings motivated an independent replication of the pre-specified hypothesis.','hypothesis-testing':'The scientific background motivated testing the hypothesis recorded before data access.'};
  requireThat(typeof reporting.rationale==='string'&&Object.hasOwn(rationale,reporting.rationale),'missing typed study rationale');text=rationale[reporting.rationale as keyof typeof rationale];
 } else if(source==='setting') {
  if(!producers.setting){text='Owner-supplied study setting (unverified; authenticated stager record required).';return {source,text,verified:false,sha256:canonicalSha256({paperHash:ctx.input.sha256,name,item:item.id,source,text})};}
  const doc=producers.setting;requireThat(doc.paperHash===ctx.input.sha256&&settings.get(doc)===canonicalSha256(doc),'study setting changed, foreign or not authenticated');
  const s=doc.value;text=`Recruitment took place at ${s.sites.map(site=>`${site.name}, ${site.city}, ${site.country}`).join('; ')} from ${s.startDate} to ${s.endDate}.`;
 } else if(source==='interpretation') {
  requireThat(reporting.interpretation==='cautious-observational','missing interpretation policy');text='The findings warrant caution: an observational association does not establish causality.';
 } else if(source==='generalisability') {
  requireThat(reporting.generalisability==='source-population-only','missing generalisability policy');text='External validity is restricted to the source population; extension to other settings remains uncertain.';
 } else if(source==='funding') {
  requireThat(producers.matter,'missing software matter producer');assertMatter(ctx,producers.matter);const region=producers.matter.regions.find(r=>r.heading==='Funding');requireThat(region&&deriveMatterInput(ctx).funding.state==='confirmed','unresolved funding evidence');text=`Funding: ${region.text}.`;
 } else if(completeness.has(source as MethodsSlot)) {
  const value=methodCompleteness(ctx,source as MethodsSlot);
  text=source==='sample-size-power'&&value.text==='sample-size-power: fixed-secondary-sample.'?'The available secondary dataset determined the sample size; no prospective power calculation was used.':value.text;
 } else {
  requireThat(producers.methods,'missing software Methods producer');assertMethods(ctx,producers.methods);
  const facts=ctx.claims.map(c=>producers.methods!.slots.get(`proc:${c.id}.methods.${source}`));requireThat(facts.every(Boolean),'missing checklist procedure slot');text=facts.map(f=>f!.display.replace(/[.]?$/u,'.')).join(' ');
 }
 return {source,text,verified:true,sha256:canonicalSha256({paperHash:ctx.input.sha256,name,item:item.id,source,text})};
}
/** Advisory only. Synonyms never establish or invalidate factual evidence. */
export function checklistKeywordHint(excerpt:string,keywords:readonly string[]):boolean {
 const synonyms:Record<string,string[]>={scientific:['background'],rationale:['motivation'],architecture:['design','cohort'],places:['recruitment','sites'],dates:['from'],size:['sample'],statistical:['regression','procedure'],approach:['procedure','contrast'],cautious:['caution'],interpretation:['findings'],transferability:['external','validity']};
 const words=new Set(lexicalKey(excerpt).match(/[\p{L}]+/gu)??[]);
 return keywords.every(w=>[w,...(synonyms[w]??[])].some(v=>words.has(lexicalKey(v))));
}
