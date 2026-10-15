import {assertAIProseReview,aiReviewNotice} from './ai-review.ts';
import {plainClaimSentence} from './reader-templates.ts';
/** PW6 boxes for cross-field readers (design 3.1 rows 3 and 5, design 9): the plain summary,
 * the idea-in-brief box and the glossary box. Software assembles every box from records
 * and the vetted term registry; model text only fills the closed prose slots, which pass
 * through renderDraft and every existing lint before PW6's own checks run. */
import { checkReaderProse, type ProseReviewFlag } from './prose.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { requireThat } from './common.ts';
import { assertContext, type ReportContext } from './context.ts';
import { type EntityRegistry } from './entities.ts';
import { placeholders } from './grammar.ts';
import { LABEL_CROSSWALK } from './labels.ts';
import { limitationsPartA, limitationsPlainTwins, rankedPlainLimitations, protect, type RankedLimitation } from './limitations.ts';
import { validLock } from './lock.ts';
import { renderTitle } from './report.ts';
import { lexicalKey, normalise } from './normalise.ts';
import { renderDraft, type RenderedDraft } from './render.ts';
import { maskBibliographicIdentifiers,acronymScope,checkAcronyms, defineAtFirstUse, findAcronyms, plainify, type AcronymReport } from './acronyms.ts';
import { assertTermRegistry, inlineGlossaryUse, mentionsTerm, partText, GLOSSARY_INLINE_LIMIT, type AnalogyTrigger, type InlineUse, type PaperPart, type TermEntry, type TermRegistry } from './glossary.ts';
import { assertPlainEasierThanAbstract, measureText, readabilityAlarms, type ReadabilityAlarm, type RegionMetrics } from './readability.ts';

/** Process-local provenance: serialized/copied boxes must be rebuilt by the host. */
const softwareBoxes=new WeakMap<object,{paperInput:string;kind:string;digest:string}>();
function freezeDeep<T>(value:T):T {
 if(value&&typeof value==='object'){for(const child of Object.values(value))freezeDeep(child);Object.freeze(value);}
 return value;
}
function softwareBox<T extends object>(ctx:ReportContext,kind:string,value:T):T {
 freezeDeep(value);softwareBoxes.set(value,{paperInput:ctx.input.sha256,kind,digest:canonicalSha256(value)});return value;
}
export function assertSoftwareBox(ctx:ReportContext,value:unknown,kind:string):void {
 assertContext(ctx);const receipt=value&&typeof value==='object'?softwareBoxes.get(value):undefined;
 requireThat(receipt&&receipt.paperInput===ctx.input.sha256&&receipt.kind===kind&&receipt.digest===canonicalSha256(value),`${kind} was edited or was not built by software; requires software ${kind}`);
}

function primaryClaim(ctx:ReportContext) {const c=ctx.claims.find(c=>c.id===ctx.input.plannedFound.primaryClaimId);requireThat(c,'boxes need the pre-specified primary claim');return c;}
/** Design 3.1: at most 200 words in the plain summary. */
export const PLAIN_SUMMARY_MAX_WORDS=200;
export function countWords(text:string):number {return (text.match(/[\p{L}\p{N}]+(?:[.,'’-][\p{L}\p{N}]+)*/gu)??[]).length;}
export interface PlainSummaryDraft {context:string}
export interface PlainSummary {reviewFlags:readonly ProseReviewFlag[];context:RenderedDraft;result:string;notShown:readonly RankedLimitation[];limitationsPointer:string;fullLimitationsSha256:string;checking:string;text:string;words:number;sha256:string}
/** The fixed checking sentence comes only from recorded owner actions (design 11.1). */
export function checkingSentence(ctx:ReportContext):string {
 assertContext(ctx);const rerun=ctx.input.ownerDeclarations.filter(a=>a.action==='reran-analysis').at(-1);
 return rerun?`Software recomputed the numbers shown here, and the author re-ran the full analysis on ${rerun.at.slice(0,10)}.`:'Software recomputed the numbers shown here; the author has not re-run the analysis.';
}
/** "What was known, what we did" is the only model slot. The primary result, the label, what
 * the work does not show and the checking sentence are software, made acronym-free by the
 * kernel plain table. Any acronym left anywhere in the summary fails the build. */
export function renderPlainSummary(ctx:ReportContext,draft:PlainSummaryDraft,registry:EntityRegistry,terms:TermRegistry):PlainSummary {
 assertContext(ctx);assertTermRegistry(terms);const c=primaryClaim(ctx);
 requireThat(typeof draft?.context==='string'&&placeholders(draft.context).length===0,'plain summary prose takes no slots: no citations, glossary terms, claims or numbers');
 const reviewFlags=checkReaderProse(draft.context);
 const context=renderDraft(ctx,draft.context,'plain-summary-context',registry);
 const result=plainify(plainClaimSentence(ctx),terms,registry);
 const partA=limitationsPartA(ctx),twins=limitationsPlainTwins(ctx);requireThat(partA.length===twins.length,'plain twins differ from Limitations Part A');
 const ranked=rankedPlainLimitations(ctx);
 const notShown=ranked.slice(0,3).map(t=>({...protect(t.id,plainify(t.text,terms,registry)),severity:t.severity}));
 const limitationsPointer='See the full Limitations section for all limitations.';
 const fullLimitationsSha256=canonicalSha256(partA);
 const checking=checkingSentence(ctx);
 const text=[context.text.replace(/\n/gu,' '),result,notShown.map(r=>r.text).join(' '),limitationsPointer,checking].join('\n');
 const hits=findAcronyms(text,terms,registry);requireThat(hits.length===0,`acronym in plain-summary: ${hits[0]?.token}`);
 const words=countWords(text);requireThat(words<=PLAIN_SUMMARY_MAX_WORDS,`plain summary has ${words} words; the limit is ${PLAIN_SUMMARY_MAX_WORDS}`);
 return softwareBox(ctx,'plain summary',{reviewFlags,context,result,notShown,limitationsPointer,fullLimitationsSha256,checking,text,words,sha256:canonicalSha256({paperInput:ctx.input.sha256,text,notShown,limitationsPointer,fullLimitationsSha256})});
}

/** The software title with registered acronyms replaced by their plain forms (design 9:
 * no acronyms in the title). An unregistered acronym survives and fails the paper check. */
export function renderPlainTitle(ctx:ReportContext,registry:EntityRegistry,terms:TermRegistry):string {assertTermRegistry(terms);return plainify(renderTitle(ctx),terms,registry);}

export interface IdeaInBriefSlots {walkthrough:string}
/** The walk-through is a closed slot of at most four plain sentences. */
export const IDEA_WALKTHROUGH_MAX_SENTENCES=4;
/** The renderer owns Figure 1's number; the box only points to it. */
export const FIGURE_LEAD='Figure 1 shows the study design.';
export interface IdeaInBrief {reviewFlags:readonly ProseReviewFlag[];question:string;design:string;walkthrough:RenderedDraft;figureLead:string;text:string;sha256:string}
export function renderIdeaInBrief(ctx:ReportContext,slots:IdeaInBriefSlots,registry:EntityRegistry,terms:TermRegistry):IdeaInBrief {
 assertContext(ctx);assertTermRegistry(terms);const c=primaryClaim(ctx);
 const design=terms.pack.designs.find(d=>d.kind===c.kind);requireThat(design,`no vetted design explanation for claim kind ${c.kind}`);
 requireThat(typeof ctx.input.plainStatement==='string'&&ctx.input.plainStatement.trim().length>0,'idea-in-brief box needs the locked plain statement');
 const question=normalise(ctx.input.plainStatement);requireThat(!/\p{N}/u.test(question),'plain statement must be digit-free in the idea-in-brief box');
 requireThat(typeof slots?.walkthrough==='string'&&placeholders(slots.walkthrough).length===0,'idea-in-brief walk-through takes plain prose only, without slots');
 const reviewFlags=checkReaderProse(slots.walkthrough);
 const walkthrough=renderDraft(ctx,slots.walkthrough,'methods',registry);
 requireThat(walkthrough.sentences.length<=IDEA_WALKTHROUGH_MAX_SENTENCES,`idea-in-brief walk-through exceeds ${IDEA_WALKTHROUGH_MAX_SENTENCES} sentences`);
 const text=['The idea in brief',`The question: ${question}`,`The design: ${design.text}`,walkthrough.text.replace(/\n/gu,' '),FIGURE_LEAD].join('\n');
 const hits=findAcronyms(text,terms,registry);requireThat(hits.length===0,`acronym in idea-in-brief: ${hits[0]?.token}`);
 return softwareBox(ctx,'idea-in-brief box',{reviewFlags,question,design:design.text,walkthrough,figureLead:FIGURE_LEAD,text,sha256:canonicalSha256({paperInput:ctx.input.sha256,text})});
}

export interface GlossaryBox {terms:readonly {id:string;term:string;definition:string}[];analogies:readonly AnalogyTrigger[];crosswalk:readonly string[];inline:readonly string[];text:string;sha256:string}
const CROSSWALK_LABELS=Object.freeze({preRegistered:'pre-registered',postHoc:'post hoc (exploratory)',internal:'internal validation (random split of one dataset)',external:'external validation'});
/** Terms the paper uses (by text or by the checks its labels rest on), minus the terms already
 * defined inline, so every term is defined exactly once; analogies and the label crosswalk
 * are chosen from records. Acronyms are spelled out at first use inside the box. */
export function renderGlossaryBox(ctx:ReportContext,parts:readonly PaperPart[],registry:EntityRegistry,terms:TermRegistry,limit=GLOSSARY_INLINE_LIMIT):GlossaryBox {
 assertContext(ctx);assertTermRegistry(terms);
 const source=parts.filter(p=>p.region!=='glossary-box');
 const inline=inlineGlossaryUse(source,terms,limit).map(u=>u.id);
 const text=source.map(partText).join('\n');const gates=new Set(ctx.claims.flatMap(c=>c.requirements.map(r=>r.gate)));
 const used:TermEntry[]=terms.pack.terms.filter(t=>!inline.includes(t.id)&&(mentionsTerm(text,t,terms)||(t.gates??[]).some(g=>gates.has(g))))
  .sort((a,b)=>lexicalKey(a.term)<lexicalKey(b.term)?-1:1);
 const triggered:Record<AnalogyTrigger,boolean>={
  'plan-lock':ctx.claims.some(c=>validLock(ctx,c.id)),
  'planted-effects':[...gates].some(g=>g.startsWith('G5b')),
  'negative-controls':gates.has('G5a'),
  'multiplicity':ctx.claims.some(c=>c.familySize>1),
  'bias-budget':limitationsPartA(ctx).some(r=>/-(?:plasmode_bias|e_value|sample_overlap_bias)$/u.test(r.id)),
 };
 const analogies=terms.pack.analogies.filter(a=>triggered[a.trigger]);
 const crosswalk=[
  ...ctx.claims.some(c=>validLock(ctx,c.id))?[`${CROSSWALK_LABELS.preRegistered}: ${LABEL_CROSSWALK.preRegistered}.`]:[],
  ...ctx.claims.some(c=>!validLock(ctx,c.id))?[`${CROSSWALK_LABELS.postHoc}: ${LABEL_CROSSWALK.postHoc}.`]:[],
  ...ctx.claims.some(c=>c.evidenceType.startsWith('internal validation'))?[`${CROSSWALK_LABELS.internal}: ${LABEL_CROSSWALK.internal}.`]:[],
  ...ctx.claims.some(c=>c.evidenceType==='external validation')?[`${CROSSWALK_LABELS.external}: ${LABEL_CROSSWALK.external}.`]:[],
  LABEL_CROSSWALK.certainty.replace('certainty grades','certainty ratings'),
 ];
 const capital=(s:string)=>s[0]!.toUpperCase()+s.slice(1);
 const lines=['Glossary',...used.map(t=>`${capital(t.term)}${t.acronym?` (${t.acronym})`:''}: ${t.definition}.`),...analogies.length?['Analogies from other fields',...analogies.map(a=>a.text)]:[],'Label crosswalk',...crosswalk.map(capital)];
 const boxText=defineAtFirstUse(lines.join('\n'),terms,registry);
 checkAcronyms([{region:'glossary-box',text:boxText}],terms,registry);
 const termsOut=used.map(t=>({id:t.id,term:t.term,definition:t.definition}));
 return softwareBox(ctx,'glossary box',{terms:termsOut,analogies:analogies.map(a=>a.trigger),crosswalk,inline,text:boxText,sha256:canonicalSha256({paperInput:ctx.input.sha256,version:terms.pack.version,text:boxText,terms:termsOut,inline})});
}

export const PLAIN_SUMMARY_REGIONS=Object.freeze(['plain-summary','plain-summary-context','plain-summary-results']);
export const ABSTRACT_REGIONS=Object.freeze(['abstract','abstract-background','abstract-methods','abstract-results','abstract-conclusions']);
export interface ReadabilityReport {inline:InlineUse[];acronyms:AcronymReport;metrics:RegionMetrics[];alarms:ReadabilityAlarm[];plainSummary:RegionMetrics|null;abstract:RegionMetrics|null}
/** Which reader layers the venue carries (design 3.2). The default is the medRxiv/bioRxiv
 * profile: plain summary, idea-in-brief box and glossary box. A venue profile may opt out. */
export interface ReaderLayers {plainSummary:boolean;ideaInBrief:boolean;glossaryBox:boolean}
export const DEFAULT_READER_LAYERS:ReaderLayers=Object.freeze({plainSummary:true,ideaInBrief:true,glossaryBox:true});
export interface ReadablePaperOptions {glossaryBox?:GlossaryBox;ideaInBrief?:IdeaInBrief;plainSummary?:PlainSummary;limit?:number;layers?:ReaderLayers}
/** The paper-level PW6 gate over the assembled paper in reading order. Blocking: the inline
 * limit and define-once rule, acronym rules, a fresh glossary box, and the plain summary
 * being easier than the abstract. Advisory: every readability alarm. */
export function checkReadablePaper(ctx:ReportContext,parts:readonly PaperPart[],registry:EntityRegistry,terms:TermRegistry,options:ReadablePaperOptions={}):ReadabilityReport {
 assertContext(ctx);assertTermRegistry(terms);const limit=options.limit??GLOSSARY_INLINE_LIMIT;const layers=options.layers??DEFAULT_READER_LAYERS;
 const only=(region:string)=>{const found=parts.filter(p=>p.region===region);requireThat(found.length<=1,`one ${region} per paper`);return found[0];};
 const box=only('glossary-box'),idea=only('idea-in-brief'),plain=only('plain-summary');
 requireThat(!parts.some(p=>p.region==='plain-summary-context'||p.region==='plain-summary-results'),'the plain summary is one software part');
 requireThat(!layers.glossaryBox||box,'the venue requires the glossary box');
 requireThat(!layers.ideaInBrief||idea,'the venue requires the idea-in-brief box');
 requireThat(!layers.plainSummary||plain,'the venue requires the plain summary');
 // Each reader layer must be the software object for this PaperInput, unedited.
 if(idea)assertSoftwareBox(ctx,options.ideaInBrief,'idea-in-brief box');
 if(plain)assertSoftwareBox(ctx,options.plainSummary,'plain summary');
 if(idea)requireThat(options.ideaInBrief?.text===idea.text&&options.ideaInBrief.sha256===canonicalSha256({paperInput:ctx.input.sha256,text:idea.text}),'idea-in-brief box was edited or was not built by software');
 if(plain)requireThat(options.plainSummary?.text===plain.text&&options.plainSummary.sha256===canonicalSha256({paperInput:ctx.input.sha256,text:plain.text,notShown:options.plainSummary.notShown,limitationsPointer:options.plainSummary.limitationsPointer,fullLimitationsSha256:options.plainSummary.fullLimitationsSha256}),'plain summary was edited or was not built by software');
 const inline=inlineGlossaryUse(parts,terms,limit);
 const acronyms=checkAcronyms(parts.map(p=>acronymScope(p.region)==='body'&&!p.draft?{...p,text:maskBibliographicIdentifiers(ctx,partText(p))}:p),terms,registry);
 if(box){const expected=renderGlossaryBox(ctx,parts,registry,terms,limit);requireThat(options.glossaryBox?.sha256===expected.sha256&&box.text===expected.text,'glossary box is stale or was not built by software');}
 // Reviewer metadata remains visible and acknowledgment-bound, but its hashes
 // are not reading prose. Never strip a lookalike notice supplied by a drafter.
 const metricText=(p:PaperPart)=>{
  let text=p.text;
  const reviews=[p.draft?.aiReview,p.region==='plain-summary'?options.plainSummary?.context.aiReview:undefined,p.region==='idea-in-brief'?options.ideaInBrief?.walkthrough.aiReview:undefined];
  for(const review of reviews){if(!review)continue;assertAIProseReview(ctx,review);const notice=aiReviewNotice(review);if(notice)text=text.replaceAll(notice,'');}
  return text;
 };
 const metrics=parts.filter(p=>/\p{L}/u.test(partText(p))).map(p=>measureText(p.region,metricText(p)));
 const alarms=metrics.flatMap(m=>readabilityAlarms(m));
 const join=(regions:readonly string[])=>parts.filter(p=>regions.includes(p.region)).map(metricText).join('\n');
 const plainText=join(PLAIN_SUMMARY_REGIONS),abstractText=join(ABSTRACT_REGIONS);
 let plainSummary:RegionMetrics|null=null,abstract:RegionMetrics|null=null;
 if(plainText.trim()){
  requireThat(abstractText.trim(),'a plain summary needs an abstract to be compared with');
  plainSummary=measureText('plain-summary',plainText);abstract=measureText('abstract',abstractText);
  assertPlainEasierThanAbstract(plainSummary,abstract);
 }
 return {inline,acronyms,metrics,alarms,plainSummary,abstract};
}
