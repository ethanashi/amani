import {assertNarrativeQuality} from '../../omb-report/src/text-quality.ts';
import {claimCountSentence} from '../../omb-report/src/reader-templates.ts';
import { readFileSync } from 'node:fs';
import { canonicalJson, canonicalSha256 } from '../../bio-core/src/index.ts';
import {
  assertContext, assertMethods, assertMatter, renderDraft, renderResults, renderTitle,
  threePartLabel, outcomeText, limitationsPartA, limitationsPartB, renderProtected, verifyProtectedText,
  deviationsTable, derivationsTable, methodCompleteness, plain, record, requireThat, exactKeys,
  renderChecklistEvidence, reportingChecklist, renderFinalAnchors, fillChecklist, exportChecklistAnchors,
  PAPER_RENDER_DOMAIN, ANCHOR_DOMAIN, readPW5Receipt, extractNumericValues,
  type ReportContext, type MethodsDocument, type MatterDocument, type EntityRegistry, type LimitationEntry,
  type RenderedDraft, type PW5Receipt, type PW5Authority, type ChecklistSlot, type ChecklistName, type VerifiedStudySetting,
} from '../../omb-report/src/index.ts';
import { paperBundle, type AuditRow, type OwnerSignoff } from '../../omb-citations/src/index.ts';
import { renderFigure, renderTable, verifyFigure, verifyTable, type FigureSpec, type TableSpec, type FactStore } from '../../omb-figures/src/index.ts';
import { verifyBlind, validateBlind, blindProjection, type BlindArtifact } from './blind.ts';

export interface VenueProfile {
  studyTypeMinimums:Record<string,Record<string,number>>; sectionMinimums: Record<string,number>; minDistinctNarrativeSentences:number; requiredPieces:string[]; genreHash?:string;
  id: string; format: 'research-article'|'short-note'; sectionCaps: Record<string, number>; totalWords: number;
  maxDisplays: number; maxReferences: number; summaryLayers: ('plain-summary'|'key-points'|'author-summary')[];
  aiDraftingAllowed: boolean; policyStatus: 'draft-only-recheck-at-packaging';
}
export function venueProfile(name: 'preprint'|'short-note'): VenueProfile {
  requireThat(['preprint','short-note'].includes(name),'unknown venue profile');
  return JSON.parse(readFileSync(new URL(`../profiles/${name}.json`,import.meta.url),'utf8')) as VenueProfile;
}
export interface ResultsDraft { summary: string; results: string; discussion: string; partB: LimitationEntry[] }
export interface SourcePiece { id: string; text: string; sourceHash: string }
export interface CitationEvidence { rows: AuditRow[]; signoff: OwnerSignoff | null; keys: Record<string,string> }
export interface ManuscriptInputs {
  temporal?:{receipt:import('./temporal.ts').LookLedgerReceipt;trust:import('./temporal.ts').LedgerTrust};
  ctx: ReportContext; registry: EntityRegistry; methods: MethodsDocument; matter: MatterDocument; profile: VenueProfile;
  /** Host-generated evidence only. Signed source hashes are checked against PaperInput.
   * This seam carries study-type pieces from upstream producers, never model prose. */
  pieces: PW5Receipt<SourcePiece[]>;
  citations: PW5Receipt<CitationEvidence>;
  checklists: Partial<Record<ChecklistName, Record<string, ChecklistSlot>>>;
  setting?: VerifiedStudySetting;
  displays: ({ type:'figure'; spec:FigureSpec; store:FactStore } | {type:'table';spec:TableSpec;store:FactStore})[];
  sign<T>(domain:string,payload:T): PW5Receipt<T>;
  verify: PW5Authority;
}
export interface Section { id:string; heading:string; markdown:string; sourceHashes:string[]; drafts:RenderedDraft[]; words:number }
export interface Manuscript {
  paperHash:string; blindHash:string; profileHash:string; sections:Section[]; markdown:string; sha256:string;
  skeletonHash:string; pending:string[]; numberTrace:{section:string;values:string[];sourceHashes:string[]}[];
  displayHashes:string[]; displayArtifacts:unknown[]; citationHash:string; draft:ResultsDraft;
}
export const VARIANTS: Readonly<Record<string,{checklists:ChecklistName[];pieces:string[]}>> = Object.freeze({
 'effect-exists':{checklists:['STROBE'],pieces:['unadjusted-and-adjusted','e-value']},
 'out-of-sample':{checklists:['TRIPOD+AI'],pieces:['split-counts','calibration','decision-curves','subgroups','sample-size','model-card']},
 'causal-genetic':{checklists:['STROBE-MR'],pieces:['assumptions','per-variant','sample-overlap','control-results','instrument-details','mr-plots']},
 'data-integrity':{checklists:[],pieces:['integrity-checklist','provenance-map','legitimate-explanations']},
 'reproduction':{checklists:[],pieces:['published-versus-recomputed','author-contact']},
 'diagnostic-accuracy':{checklists:['TRIPOD+AI'],pieces:['stard-checklist','threshold-tables','alternative-diagnoses']},
 'literature-synthesis':{checklists:['PRISMA'],pieces:['query-strings','review-flow','prisma-traice']},
});
export function requiredStructure(ctx:ReportContext) {
  const variants=ctx.claims.map(c=>{
    const v=VARIANTS[c.kind];requireThat(v,`unsupported study kind ${c.kind}`);
    if(c.kind==='reproduction'){
      requireThat(typeof c.plan.originalChecklist==='string','reproduction requires the original checklist');
      const name=c.plan.originalChecklist as ChecklistName;reportingChecklist(name);
      return {...v,checklists:[name]};
    }
    return v;
  });
  return {checklists:[...new Set(variants.flatMap(v=>v.checklists))], pieces:[...new Set(['study-design',...variants.flatMap(v=>v.pieces)])]};
}
/** Count visible words: escaped punctuation and protected hash markers are not words. */
export function visibleText(markdown:string):string {
  return markdown.replace(/<!--[^]*?-->/gu,'').replace(/&#(\d+);/gu,(_,n:string)=>String.fromCodePoint(Number(n))).replace(/&(?:amp|lt|gt|quot);/gu,v=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"'}[v]!)).replace(/\[([^\]]+)\]\([^)]*\)/gu,'$1').replace(/<[^>]*>/gu,'');
}
export function wordCount(markdown:string):number {return visibleText(markdown).match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)?.length??0;}
export function checkVenue(profile:VenueProfile,sections:readonly Section[],displays:number,references:number):void {
  requireThat(profile.aiDraftingAllowed===true,'venue prohibits AI drafting');
  requireThat(['research-article','short-note'].includes(profile.format),'unknown venue format');
  requireThat(Array.isArray(profile.summaryLayers)&&new Set(profile.summaryLayers).size===profile.summaryLayers.length&&profile.summaryLayers.every(s=>['plain-summary','key-points','author-summary'].includes(s)),'invalid summary layers');
  requireThat(['abstract','introduction','methods','results','discussion','limitations'].every(s=>profile.sectionCaps[s]!==undefined),'missing section word cap');
  for(const n of [profile.totalWords,profile.maxDisplays,profile.maxReferences,...Object.values(profile.sectionCaps)])requireThat(Number.isSafeInteger(n)&&n>0,'invalid venue cap');
  const required=['title','abstract','introduction','methods','results','verification','discussion','limitations','data-availability','code-availability','ai-use-disclosure','author-contributions','competing-interests','funding','ethics','acknowledgments','references','supplement','summary-of-findings',...profile.summaryLayers];
  requireThat(new Set(sections.map(s=>s.id)).size===sections.length&&required.every(id=>sections.some(s=>s.id===id&&s.markdown.trim())),'missing or duplicate required section');
  for(const id of ['introduction','methods','results','discussion','limitations'])requireThat(Number.isSafeInteger(profile.sectionMinimums[id])&&profile.sectionMinimums[id]!>0&&profile.sectionMinimums[id]!<=profile.sectionCaps[id]!,`invalid section minimum: ${id}`);
  requireThat(Number.isSafeInteger(profile.minDistinctNarrativeSentences)&&profile.minDistinctNarrativeSentences>0,'invalid narrative diversity minimum');
  for(const section of sections){
    requireThat(wordCount(section.markdown)>=(profile.sectionMinimums[section.id]??0),`section below minimum: ${section.id}`);
    if(['introduction','discussion'].includes(section.id)){
      const distinct=new Set(section.drafts.flatMap(d=>d.sentences.map(s=>s.text.toLowerCase().replace(/[^\p{L} ]/gu,'').trim())).filter(Boolean));
      requireThat(distinct.size>=profile.minDistinctNarrativeSentences,`insufficient distinct narrative sentences: ${section.id}`);
    }
    const cap=profile.sectionCaps[section.id];requireThat(cap===undefined||wordCount(section.markdown)<=cap,`section over word limit: ${section.id}`);}
  const main=sections.filter(s=>!['supplement','references','authors','ai-use-disclosure','author-contributions','competing-interests','funding','ethics','acknowledgments','data-availability','code-availability','research-scope'].includes(s.id));
  const total=main.reduce((n,s)=>n+wordCount(s.markdown),0);
  requireThat(total<=profile.totalWords&&!(profile.format==='short-note'&&total>1500),'manuscript over total word limit');
  requireThat(displays<=profile.maxDisplays&&!(profile.format==='short-note'&&displays>2),'display cap exceeded');
  requireThat(references<=profile.maxReferences,'reference cap exceeded');
}
export function softwareText(s:Section):string {
  let text=s.markdown;for(const draft of s.drafts)text=text.replace(plain(draft.text),'[prose]');return text;
}
function skeleton(sections:readonly Section[],paperHash:string,displayHashes:string[],citationHash:string):string {
  return canonicalSha256({paperHash,displayHashes,citationHash,sections:sections.map(s=>({id:s.id,sourceHashes:s.sourceHashes,
    // Software text is immutable; prose uses PW1's per-sentence skeleton.
    software:canonicalSha256(softwareText(s)),
    drafts:s.drafts.map(d=>d.sha256)}))});
}
export function assembleManuscript(input:ManuscriptInputs,blind:BlindArtifact,raw:unknown):Manuscript {
  const {ctx,registry,methods,matter,profile}=input;
  const short=profile.format==='short-note';
  assertContext(ctx);assertMethods(ctx,methods);assertMatter(ctx,matter);verifyBlind(ctx.input,blind,input.temporal);
  requireThat(methods.ready,'missing Methods-completeness piece');
  exactKeys(raw as object,['summary','results','discussion','partB'],'results output');
  const draft=structuredClone(raw) as ResultsDraft;
  for(const k of ['summary','results','discussion'] as const)requireThat(typeof draft[k]==='string'&&draft[k].trim(),'missing results prose');
  requireThat(Array.isArray(draft.partB),'missing Limitations Part B');
  validateBlind(blindProjection(ctx.input),{introduction:blind.introduction,methods:blind.methods},registry);
  const intro=renderDraft(ctx,blind.introduction,'introduction',registry),glue=renderDraft(ctx,blind.methods,'methods',registry,methods);
  const summary=renderDraft(ctx,draft.summary,'plain-summary',registry),results=renderDraft(ctx,draft.results,'results',registry),discussion=renderDraft(ctx,draft.discussion,'discussion',registry);
  assertNarrativeQuality(draft.discussion,registry);
  const partA=limitationsPartA(ctx),partB=limitationsPartB(ctx,draft.partB,registry);
  const sources=[ctx.input.sha256,canonicalSha256(ctx.input.lockedPlan),canonicalSha256(ctx.input.runMetadata),canonicalSha256(ctx.input.stagerManifests),canonicalSha256(ctx.input.frozenLiteratureIndex),...ctx.input.certifications.map(c=>canonicalSha256(c.certificate))];
  const pieces=readPW5Receipt(ctx,input.pieces,'omb-drafter/study-pieces@1',input.verify);
  requireThat(Array.isArray(pieces)&&new Set(pieces.map(p=>p.id)).size===pieces.length,'invalid study pieces');
  for(const p of pieces){exactKeys(p,['id','text','sourceHash'],'study piece');requireThat(typeof p.text==='string'&&p.text.trim()&&sources.includes(p.sourceHash),'study piece lacks authenticated source');}
  const required=requiredStructure(ctx);
  requireThat([...required.pieces,...profile.requiredPieces].every(id=>pieces.some(p=>p.id===id)), 'missing study-type piece');
  requireThat(required.checklists.every(name=>input.checklists[name]),'missing study-type checklist');
  const citationInput=readPW5Receipt(ctx,input.citations,'omb-drafter/citations@1',input.verify);
  const citations=citationInput.rows.length?paperBundle(citationInput.rows,citationInput.signoff):null;
  requireThat(ctx.quotes.every(q=>citations?.references.some(r=>r.id===citationInput.keys[q.key])),'missing frozen bibliography entry');
  const frozenEntries=(record(ctx.input.frozenLiteratureIndex).entries as unknown[]).map(record);
  requireThat(citationInput.rows.every(row=>frozenEntries.some(e=>e.auditRowHash===row.rowHash&&e.quote===row.input.quote))&&ctx.quotes.every(q=>frozenEntries.some(e=>e.key===q.key&&e.bibliographyKey===citationInput.keys[q.key]&&citationInput.rows.some(row=>row.rowHash===e.auditRowHash))),'citation audit is not pinned in the frozen literature index');
  const pending=[...matter.pending,...citations&&!citations.ownerApproved?['citation owner sign-off']:[]];
  const sections:Section[]=[];
  const add=(id:string,heading:string,markdown:string,hashes:string[]=sources,drafts:RenderedDraft[]=[])=>sections.push({id,heading,markdown,sourceHashes:hashes,drafts,words:wordCount(markdown)});
  const primary=ctx.claims.find(c=>c.id===ctx.input.plannedFound.primaryClaimId);requireThat(primary,'missing primary claim');
  const primaryDraft=renderDraft(ctx,`[claim:${primary.id}].`,'abstract',registry);
  const planned=ctx.claims.filter(c=>ctx.input.plannedFound.plannedClaimIds.includes(c.id));
  const counts=claimCountSentence(ctx);
  const question=`The question concerns ${primary.plan.exposure} and ${primary.plan.outcome}.`;
  add('title','Title',plain(renderTitle(ctx)));
  add('authors','Authors',matter.authorBlock);
  const lock=String(record(ctx.input.timestamps[0]).at??'unavailable');
  const registration=`Plan ${canonicalSha256(ctx.input.lockedPlan)}; locked ${lock}; recorded looks: ${ctx.input.looks.length}.`;
  const design=record(ctx.input.lockedPlan.reporting).design;
  requireThat(typeof design==='string'&&design.length>0,'abstract needs the locked study design');
  const abstract=`**Background.** ${plain(question)}\n\n**Methods.** This was a ${plain(String(design))} analysis using archived data and the analysis plan fixed before the confirming data were examined.\n\n**Results.** ${plain(primaryDraft.text)}\n\n${plain(counts)}\n\n**Conclusions.** ${plain(outcomeText(ctx,primary))}.`;
  add('abstract','Abstract',abstract,sources,[primaryDraft]);
  if(profile.summaryLayers.includes('plain-summary'))add('plain-summary','Plain summary',plain(summary.text),sources,[summary]);
  if(profile.summaryLayers.includes('key-points'))add('key-points','Key Points',`${plain(question)}\n\n${plain(primaryDraft.text)}\n\n${plain(counts)}\n\n${plain(outcomeText(ctx,primary))}.`,sources,[primaryDraft]);
  if(profile.summaryLayers.includes('author-summary'))add('author-summary','Author Summary',plain(summary.text),sources,[summary]);
  const order=[primary.id,...ctx.input.plannedFound.plannedClaimIds.filter(id=>id!==primary.id),...ctx.claims.filter(c=>!ctx.input.plannedFound.plannedClaimIds.includes(c.id)).map(c=>c.id)];
  add('summary-of-findings','Summary of findings','| Claim | Result | Evidence label |\n| --- | --- | --- |\n'+order.map(id=>{const c=ctx.claims.find(c=>c.id===id)!;return `| ${plain(String(c.plan.plain_statement??c.plan.statement??`${c.plan.exposure} and ${c.plan.outcome}`))} | ${plain(ctx.slots.get(`m:${id}.result`)?.display??outcomeText(ctx,c))} | ${plain(threePartLabel(ctx,id).full)} |`;}).join('\n'));
  const aims=ctx.claims.filter(c=>planned.includes(c)).map(c=>`${c.id===primary.id?'Primary':'Secondary'} aim: ${c.plan.exposure} and ${c.plan.outcome}; ${c.plan.direction==='two-sided'?'two-sided hypothesis':`direction ${c.plan.direction}`}.`).join(' ');
  add('introduction','Introduction',`${plain(intro.text)}\n\n${plain(aims+' These aims were fixed before the confirming data were analysed; the registration record appears in Declarations.')}`,sources,[intro]);
  const ai=matter.regions.find(r=>r.heading==='AI use in Methods')!;
  const fullMethods=`${methods.markdown.replace(/^## Methods\s*/u,'')}\n\n${plain(glue.text)}\n\nSee Verification and robustness analyses for the software checks.\n\n### Use of AI systems\n\n${ai.text}`;
  const shortMethods=[plain(glue.text),plain(methods.slots.get(`proc:${primary.id}.methods.estimand`)!.display),plain(methods.slots.get(`proc:${primary.id}.methods.procedure`)!.display),plain(matter.aiUse),'Full Methods and the AI-use table are in the supplement. See Verification and robustness analyses for the software checks.'].join('\n\n');
  add('methods','Methods',short?shortMethods:fullMethods,sources,[glue]);
  add('results','Results',`${renderResults(ctx)}\n\n${plain(results.text)}`,sources,[results]);
  add('verification','Verification and robustness analyses',ctx.claims.map(c=>`${plain(String(c.plan.exposure))}: ${plain(threePartLabel(ctx,c.id).checks)}. Passing these checks does not establish biological importance or remove uncertainty.`).join('\n\n'));
  add('abandoned','Analyses abandoned, and why',`${plain(ctx.input.plannedFound.abandonedAnalyses.length?canonicalJson(ctx.input.plannedFound.abandonedAnalyses):'No abandoned analyses were recorded.')}\n\n${plain(ctx.input.plannedFound.registeredHypotheses===null?'The number of hypotheses previously tested on these data is not known.':`Programme-wide registered hypotheses: ${ctx.input.plannedFound.registeredHypotheses}.`)}`);
  const interpretation=record(record(ctx.input.ownerConfiguration).interpretation);
  let ownerText='';
  if(typeof interpretation.text==='string'&&interpretation.text.trim()) {
    requireThat(interpretation.actor===record(ctx.input.ownerConfiguration).ownerActor&&typeof interpretation.evidenceHash==='string'&&sources.includes(interpretation.evidenceHash),'owner interpretation lacks recorded evidence');
    ownerText=plain(renderDraft(ctx,interpretation.text,'discussion',registry).text);
  } else pending.push('owner interpretation paragraph');
  add('discussion','Discussion',`${plain(discussion.text)}${ownerText?'\n\n'+ownerText:''}`,sources,[discussion]);
  add('limitations','Limitations',renderProtected(partA)+'\n\n'+(short?'Study-specific limitations detailed in the supplement: '+plain([...new Set(draft.partB.map(e=>e.item))].join('; '))+'.':partB));
  add('conclusions','Conclusions',plain(outcomeText(ctx,primary))+'.');
  add('registration','Pre-registration',plain(registration));
  const matterSections:Record<string,string>={'Data availability':'data-availability','Code availability':'code-availability','AI-use disclosure':'ai-use-disclosure','Author contributions (CRediT)':'author-contributions','Competing interests':'competing-interests','Funding':'funding','Ethics statement':'ethics','Acknowledgments':'acknowledgments','Research scope':'research-scope'};
  for(const region of matter.regions)if(matterSections[region.heading])add(matterSections[region.heading]!,region.heading,region.text);
  const refs=ctx.quotes.map((quote,index)=>{
    const ref=citations!.references.find(ref=>ref.id===citationInput.keys[quote.key])!;
    const authors=(Array.isArray(ref.author)?ref.author:[]).map(a=>String(record(a).family)).join('; ');
    const dates=record(ref.issued)['date-parts'] as number[][];
    return plain(`[${index+1}] ${authors} (${dates[0]![0]}). ${ref.title}. ${ref['container-title']}. DOI: ${ref.DOI??'unavailable'}; PMID: ${ref.PMID??'unavailable'}.`);
  }).join('\n\n');
  add('references','References',[refs,...matter.regions.filter(r=>r.heading==='Software references').map(r=>r.text)].filter(Boolean).join('\n\n'));
  const displayHashes:string[]=[];const displayArtifacts:unknown[]=[];const displayText:string[]=[];
  for(const display of input.displays){
    if(display.type==='figure'){const out=renderFigure(display.spec,display.store);requireThat(verifyFigure(out.svg,display.spec,display.store).ok,'figure failed verification');requireThat(out.provenance.certificateHashes.every(hash=>sources.includes(hash)),'figure belongs to another paper');displayHashes.push(canonicalSha256(out));displayArtifacts.push(out);displayText.push(`Figure: ${plain(display.spec.id)}. Source CSV hash: ${canonicalSha256(out.sourceCsv)}.`);}
    else{const out=renderTable(display.spec,display.store);requireThat(verifyTable(out,display.spec,display.store).ok,'table failed verification');displayHashes.push(canonicalSha256(out));displayArtifacts.push(out);displayText.push(out.markdown);}
  }
  const producers={methods,matter,...input.setting?{setting:input.setting}:{}};
  const checklistAppendices:string[]=[];
  for(const name of required.checklists){
    const slots=input.checklists[name]!;
    const evidence=renderChecklistEvidence(ctx,name,reportingChecklist(name).items.filter(i=>slots[i.id]?.kind==='software').map(i=>i.id),producers);
    // Render actual evidence before assigning anchors. No fabricated checklist completion.
    const sectionId=`checklist-${name}`;
    const sentences=evidence;
    for(const sentence of sentences){const target=sections.find(s=>s.id===sentence.section);if(target){target.markdown+='\n\n'+plain(sentence.text);target.words=wordCount(target.markdown);}}
    const paper=input.sign(PAPER_RENDER_DOMAIN,{sections:[...new Set(sentences.map(s=>s.section))].map(id=>({id,sentences:sentences.filter(s=>s.section===id).map(s=>({id:s.sentence,text:s.text}))}))});
    const anchors=input.sign(ANCHOR_DOMAIN,renderFinalAnchors(ctx,name,sentences,paper));
    const filled=fillChecklist(ctx,name,slots,anchors,input.verify,producers);
    pending.push(...filled.rows.filter(r=>!r.verified).map(r=>`${name}:${r.item}`));
    checklistAppendices.push(`### ${name}\n\n${sentences.map(s=>plain(s.text)).join('\n\n')}\n\n${exportChecklistAnchors(ctx,name,slots,anchors,input.verify,producers)}`);
  }
  add('supplement','Supplement',[...short?[`### Full Methods\n\n${fullMethods}`,`### Study-specific limitations\n\n${partB}`]:[],...pieces.map(p=>`### ${plain(p.id)}\n\n${plain(p.text)}`),...displayText,`### Deviations\n\n${deviationsTable(ctx)}`,`### Changes to the introduction after results\n\nThe frozen Introduction is unchanged.`,derivationsTable(ctx),...checklistAppendices,...citations?[citations.concordanceMarkdown]:[]].join('\n\n'));
  const effective=structuredClone(profile);
  for(const claim of ctx.claims){
    const mins=profile.studyTypeMinimums[claim.kind];requireThat(mins,'missing study-type minimums');
    for(const id of ['introduction','methods','results','discussion','limitations']){requireThat(Number.isSafeInteger(mins[id])&&mins[id]!>0,'invalid study-type minimum');effective.sectionMinimums[id]=Math.max(effective.sectionMinimums[id]!,mins[id]!);}
  }
  checkVenue(effective,sections,input.displays.filter(d=>d.spec.placement!=='supplement').length+1,citations?.references.length??0);
  const markdown=sections.map(s=>`## ${s.heading}\n\n${s.markdown}`).join('\n\n')+'\n';
  verifyProtectedText(partA,sections.find(s=>s.id==='limitations')!.markdown);
  const citationHash=canonicalSha256(citationInput);
  const numberTrace=sections.map(s=>({section:s.id,values:extractNumericValues(visibleText(s.markdown)),sourceHashes:s.sourceHashes}));
  const body={paperHash:ctx.input.sha256,blindHash:blind.sha256,profileHash:canonicalSha256(profile),sections,markdown,skeletonHash:skeleton(sections,ctx.input.sha256,displayHashes,citationHash),pending:[...new Set(pending)],numberTrace,displayHashes,displayArtifacts,citationHash,draft};
  return {...body,sha256:canonicalSha256(body)};
}
export function assertManuscript(manuscript:Manuscript):void {
  const {sha256,...body}=manuscript;requireThat(sha256===canonicalSha256(body),'manuscript changed outside orchestration');
}
