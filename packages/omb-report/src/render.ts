import {sentencePositionValue,insertedValueCaseIssue} from './sentence-style.ts';
import {assertFinalText,assertNoRepeatedSentences} from './text-quality.ts';
import {buildAIProseReview,aiReviewNotice,type AIProseReview} from './ai-review.ts';
import {lockedSoftware} from './pw5-records.ts';
import { checkPW5Narrative, assertMethods, resolveMethodProcedure, type MethodsDocument } from './methods.ts';
import { procedure } from './procedures.ts';
import { validLock } from './lock.ts';
import { lexicalKey, normalise } from './normalise.ts';
import { claimTemplate, honestNullReason, CONNECTIVES } from './templates.ts';
import { tagEntities } from './entities.ts';
import { extractNumericValues, matchSpanlessNumbers } from './numeric-matchers.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { type ReportContext, type Region, type ResolvedFact, assertContext, displayFact, EXEC_FOOTNOTE } from './context.ts';
import { verifyDerivation } from '../../omb-paper/src/index.ts';
import { type EntityRegistry } from './entities.ts';
import { placeholders, parseDraft, type Sentence, type Placeholder } from './grammar.ts';
import { bindSentence, lintWording, applyPlainReplacements } from './wording.ts';
import { threePartLabel, proseEvidenceLabel, resultsEvidencePresentation, registrationValues } from './labels.ts';
import { html, plain, record, requireThat, finite, strings } from './common.ts';
import { glossaryFact, type TermRegistry } from './glossary.ts';
export interface RenderedSentence {id:string;region:Region;claimIds:string[];citationKeys:string[];orderedFacts:{key:string;value:string;factIds:string[]}[];text:string;html:string}
export interface RenderedDraft {sharedResults?:{text:string;claimIds:string[];factIds:string[];provides:string[]};sentences:RenderedSentence[];text:string;html:string;sha256:string;execFootnote:string|null;aiReview:AIProseReview}
const allowedSlots=/^[^.]+\.(?:result|label|direction|magnitude|vs\.[^.]+|n_agree|n_total|sens_agree|sens_total|mei|family_size|expected_false|ci_width|power_n)$/u;
function safeValue(value:unknown):string{requireThat(typeof value==='string'||finite(value),'missing software value');return String(value);}
export function resolvePlaceholder(ctx:ReportContext,p:Placeholder,s:Sentence,methods?:MethodsDocument):ResolvedFact{
 if(p.kind==='proc'){
  if(methods&&p.key.includes('.methods.'))return resolveMethodProcedure(ctx,methods,p.key);
  return procedure(ctx,p.key);
 }
 const key=`${p.kind}:${p.key}`;const existing=ctx.slots.get(key);
 if(p.kind==='m'&&p.key.endsWith('.null_reason')){
  const c=ctx.claims.find(c=>p.key===`${c.id}.null_reason`);requireThat(c,'unknown null claim');
  const reason=honestNullReason(c);requireThat(reason!==null,'claim has a reportable result');
  requireThat(!/[<>\[\]\n\r|]/u.test(reason),'null reason must be plain prose');
  return {key:p.key,claimId:c.id,display:reason,raw:reason,grade:'kernel',producerGate:'referee-label',factIds:[canonicalSha256(c)],certHash:c.certHash};
 }
 if(p.kind==='m'){requireThat(ctx.claims.some(c=>p.key.startsWith(c.id+'.')&&allowedSlots.test('claim.'+p.key.slice(c.id.length+1))),'field-level metric is not prose-safe');if(p.key.endsWith('.label')){const id=p.key.slice(0,-6);const c=ctx.claims.find(c=>c.id===id);requireThat(c,'unknown label');return {key:p.key,claimId:id,display:proseEvidenceLabel(ctx,id),raw:c.status,grade:'kernel',producerGate:'referee-label',factIds:[canonicalSha256(c)],certHash:c.certHash};}}
 if(existing){requireThat(existing.raw!==null&&existing.raw!==undefined,'unavailable software value');return existing;}
 const software=(display:string,source:unknown,claimId:string|null=null):ResolvedFact=>({key:p.key,claimId,display,raw:source,grade:'input',producerGate:'paper-input',factIds:[canonicalSha256(source)],certHash:null});
 if(p.kind==='r'){const values:Record<string,unknown>=registrationValues(ctx);return software(safeValue(values[p.key]),values[p.key]);}
 if(p.kind==='v'){if(record(ctx.input.environmentLock).packages!==undefined)lockedSoftware(ctx);const versions=record(record(ctx.input.environmentLock).versions);return software(safeValue(versions[p.key]),versions[p.key]);}
 if(p.kind==='p'){
  const c=ctx.claims.find(c=>p.key.startsWith(`${c.id}.`));requireThat(c,'unknown procedure claim');
  const slot=p.key.slice(c.id.length+1);let text:string;
  if(slot==='adjustment')text=strings(c.plan.adjustment).length?`The analysis was adjusted for ${strings(c.plan.adjustment).join(' and ')}, as fixed in the plan`:'No covariate adjustment was specified in the plan';
  else if(slot==='risk-scope'){requireThat(c.scope==='S1','scope statement is not applicable');text='risk-scope evidence only; no progression evidence';}
  else throw new Error('unknown procedure slot: Methods producer required');
  return software(text,c.plan,c.id);
 }
 if(p.kind==='c'||p.kind==='l'){
  const key=p.kind==='c'?p.key:p.key.replace(/(?:#.*|\.year)$/u,'');const quote=ctx.quotes.find(q=>q.key===key);
  requireThat(quote&&['fulltext-verified','abstract-supported'].includes(quote.status)&&quote.approvedSentenceHashes.includes(canonicalSha256(s.text)),'unapproved citation pair');
  if(p.kind==='c')return software(`[${ctx.quotes.indexOf(quote)+1}]`,quote);
  requireThat(s.placeholders.some(p=>p.kind==='c'&&p.key===key),'published number needs its citation');
  if(p.key===`${key}.year`){requireThat(quote.year!==null,'missing literature year');return software(String(quote.year),quote);}
  // PW4 quote IDs are part of the frozen entry; a guessed quote ID cannot resolve.
  const entry=(record(ctx.input.frozenLiteratureIndex).entries as unknown[]).map(record).find(e=>e.key===key)!;
  const match=p.key.match(/^([^#]+)#([A-Za-z0-9_-]+)\.(\d+)$/u);requireThat(match&&match[2]===entry.quoteId,'unknown literature quote ID');
  const value=quote.numbers[Number(match[3])];requireThat(finite(value),'missing literature number');return software(`${value} (published value, not recomputed)`,quote);
 }
 throw new Error(`unavailable software placeholder ${key}`);
}
/** PW5 positional Methods remains supported; PW6 options may combine both producers. */
export interface RenderOptions {terms?:TermRegistry;methods?:MethodsDocument}
export function renderDraft(ctx:ReportContext,raw:string,region:Region,registry:EntityRegistry,producer:MethodsDocument|RenderOptions={}):RenderedDraft{
 assertContext(ctx);
 const options:RenderOptions='paperHash' in producer?{methods:producer}:producer;
 requireThat(Object.keys(options).every(key=>key==='methods'||key==='terms'),'unknown render option');
 const methods=options.methods;if(methods)assertMethods(ctx,methods);const parsed=parseDraft(raw,registry);let exec=false;const sentences:RenderedSentence[]=[];
 const resultIds=region==='results'?[...new Set(parsed.flatMap(s=>s.placeholders.filter(p=>p.kind==='claim').map(p=>p.key)))]:[];
 const resultPresentation=resultIds.length?resultsEvidencePresentation(ctx,resultIds):null;
 const aiReview=buildAIProseReview(ctx,parsed.map(s=>({id:s.id,prose:s.prose})));
 const notice=aiReviewNotice(aiReview);
 for(const request of parsed){
  if(region==='introduction' && ctx.input.literatureBrief) for(const p of request.placeholders.filter(p=>p.kind==='c'||p.kind==='l')) {
   const key=p.kind==='c'?p.key:p.key.replace(/(?:#.*|\.year)$/u,'');
   const quote=ctx.quotes.find(q=>q.key===key);
   requireThat(quote && ctx.input.literatureBrief.citations.some(c=>c.key===key && c.audit.input.quote===quote.quote),'Introduction citation must come from the frozen pre-plan brief');
  }
const methodReview=request.placeholders.some(p=>p.kind==='c')?undefined:checkPW5Narrative(ctx,request.prose,region);if(methods)requireThat(!request.placeholders.some(p=>p.kind==='p'),'PW5 Methods require proc slots');const bound=bindSentence(ctx,request,region,methodReview);lintWording(ctx,bound,region,methodReview);
  let s=request;
  if(request.placeholders.some(p=>p.kind==='proc')){requireThat(!request.placeholders.some(p=>p.key.endsWith('.interpretation'))||region==='discussion','interpretation slots are Discussion-only');requireThat(!request.placeholders.some(p=>p.key.includes('.methods.'))||region==='methods','PW5 execution procedures are Methods-only');requireThat(request.placeholders.length===1&&request.prose.trim()==='.','procedure slot must be a complete sentence');if(region==='introduction'||region==='background')requireThat(!request.placeholders.some(p=>/\.(?:validation|archiving)$/u.test(p.key)),'result procedure in blind prose');}
  if(bound.claims.length&&!bound.quoteKeys.length){
   let text=claimTemplate(bound.claims[0]!,CONNECTIVES.find(c=>lexicalKey(c)===lexicalKey(request.prose.replace(/[.!?]+$/u,'')))!,validLock(ctx,bound.claims[0]!.id),['abstract','abstract-results'].includes(region)?'abstract':region==='results'&&resultIds.length>1?'results':'standard');
   if(resultPresentation&&resultPresentation.labels.get(bound.claims[0]!.id)==='')text=text.replace(` [m:${bound.claims[0]!.id}.label]`,'');
   const ps=placeholders(text);let prose=text;for(const p of [...ps].reverse())prose=prose.slice(0,p.start)+' '.repeat(p.end-p.start)+prose.slice(p.end);
   s={...request,text,prose,placeholders:ps,entities:tagEntities(prose,registry)};
  }
  const pieces:{start:number;end:number;text:string;html:string}[]=[];const orderedFacts:RenderedSentence['orderedFacts']=[];
  for(const p of s.placeholders){if(p.kind==='claim'){pieces.push({...p,text:'',html:''});continue;}
   const f=p.kind==='g'?glossaryFact(options.terms,p.key,region):resolvePlaceholder(ctx,p,s,methods);if(p.kind==='d'&&/\bparameter\b/iu.test(s.prose))requireThat(f.classification==='input'&&typeof f.raw==='number','data slot is not a numeric input parameter');if(region==='introduction'||region==='background')requireThat(!(p.kind==='d'&&f.classification==='derived'),'derived data slot in blind Introduction');
   let value=normalise(p.kind==='m'&&p.key.endsWith('.label')&&resultPresentation?resultPresentation.labels.get(f.claimId!)??displayFact(f):displayFact(f));
   const position=!s.text.slice(0,p.start).trim()||/[.!?]$/u.test(s.text.slice(0,p.start).trim())?'start':'middle';
   const names=registry.entries.map(e=>e.entry.label);value=sentencePositionValue(value,position,names);requireThat(!insertedValueCaseIssue(value,position,names),'capitalized common word in inserted value');if(p.kind==='m'&&bound.claims.some(c=>c.id!==f.claimId&&c.companions.includes(f.claimId??'')))value+=' (companion statistic; not used for the decision)';
   if(['v','r'].includes(p.kind)||extractNumericValues(value).length){
    assertNumericSlotAtomic(s.text,p);
    if(!bound.claims.length)assertNumericNeighbours(s.text,p,p.kind==='c');
   }
   const factKey=p.kind==='m'&&p.key.endsWith('.label')&&resultPresentation?.shared?`results-label:${f.claimId}|${resultPresentation.localProvides.get(f.claimId!)!.join('|')}`:`${p.kind}:${p.key}`;
   orderedFacts.push({key:factKey,value,factIds:f.factIds});if(f.grade==='exec')exec=true;
   pieces.push({start:p.start,end:p.end,text:value,html:`<span data-fact="${html(factKey)}">${html(value)}</span>`});
  }
  for(const e of s.entities)pieces.push({start:e.start,end:e.end,text:e.label,html:`<span data-entity="${html(e.id)}">${html(e.label)}</span>`});
  pieces.sort((a,b)=>a.start-b.start);let cursor=0,text='',markup='';
  for(const p of pieces){const gap=applyPlainReplacements(s.text.slice(cursor,p.start));text+=gap+p.text;markup+=emphasis(gap)+p.html;cursor=p.end;}
  const tail=applyPlainReplacements(s.text.slice(cursor));
  const punctuation=tail==='.'&&pieces.at(-1)?.text.endsWith('.')?'':tail;
  text+=punctuation;markup+=emphasis(punctuation);
  // Audit the assembled sentence against software-owned pieces in source order.
  const expected=pieces.flatMap(p=>extractNumericValues(p.text).map(token=>({raw:Number(token),display:token,kind:'number' as const})));
  requireThat(matchSpanlessNumbers(text,expected, true),'rendered numbers differ from ordered software values');
  if(['introduction','methods','discussion','results','abstract','abstract-results'].includes(region))assertFinalText(text,registry.entries.map(e=>e.entry.label));
  sentences.push({id:s.id,region,claimIds:bound.claims.map(c=>c.id),citationKeys:bound.quoteKeys,orderedFacts,text:text.replace(/ +([.!?])/gu,'$1'),html:markup});
 }
 const sharedResults=resultPresentation?.shared?{text:resultPresentation.shared,provides:resultPresentation.sharedProvides,claimIds:resultIds,factIds:resultIds.map(id=>canonicalSha256(ctx.claims.find(c=>c.id===id)!))}:undefined;
 if(region==='results')assertNoRepeatedSentences([sharedResults?.text??'',...sentences.map(s=>s.text)].join(' '));
 const prefix=sharedResults?sharedResults.text+'\n\n':'';
 const text=prefix+sentences.map(s=>s.text).join(region==='results'?'\n\n':'\n')+(notice?'\n'+notice:'');return {...sharedResults?{sharedResults}:{},sentences,text,aiReview,html:(sharedResults?`<p>${html(sharedResults.text)}</p>\n`:'')+sentences.map(s=>`<p>${s.html}</p>`).join('\n')+(notice?`<aside>${html(notice)}</aside>`:''),sha256:canonicalSha256({sharedResults:sharedResults??null,sentences:sentences.map(({text:_,html:__,...s})=>s)}),execFootnote:exec?EXEC_FOOTNOTE:null};
}
function emphasis(text:string):string{return html(text).replace(/\*\*([^*]+)\*\*/gu,'<strong>$1</strong>').replace(/\*([^*]+)\*/gu,'<em>$1</em>');}
/** PW8 seam: sentence ID/region/binding/order/value changes are observable. */
export function assertSameFacts(before:RenderedDraft,after:RenderedDraft):void{requireThat(before.sha256===after.sha256,'sentence fact skeleton changed');}
export function derivationsTable(ctx:ReportContext):string{
 assertContext(ctx);for(const f of ctx.slots.values())if(f.derivation)verifyDerivation(f.derivation,ctx.sources);const rows=[...ctx.slots.values()].filter(f=>f.derivation).map(f=>`| ${plain(f.key)} | ${plain(f.derivation!.formula)} | ${f.derivation!.inputs.map(plain).join(', ')} | ${plain(String(f.derivation!.value))} |`);
 return '| Slot | Formula | Input fact IDs | Value |\n| --- | --- | --- | --- |\n'+rows.join('\n');
}

export function assertNumericSlotAtomic(text:string,p:Pick<Placeholder,'start'|'end'>):void{
    const left=text.slice(0,p.start).replace(/\*+$/u,''),right=text.slice(p.end).replace(/^\*+/u,'');const before=left.at(-1),after=right[0];
    requireThat((before===undefined||/[\s(,!?]/u.test(before))&&(after===undefined||/[\s),!?]/u.test(after)||after==='.'&&(right==='.'||/^\.\s/u.test(right))),'numeric slot must be atomic');
}

/** Free drafting cannot attach units or signed/ratio modifiers to software values.
 * Units belong inside the resolved fact, never in the adjacent drafter span. */
export function assertNumericNeighbours(text:string,p:Pick<Placeholder,'start'|'end'>,citation=false):void {
 const left=text.slice(0,p.start).replace(/\*+$/u,'').trimEnd(),right=text.slice(p.end).replace(/^\*+/u,'').trimStart();
 requireThat(/^(?:$|[.),!?]|\[c:|(?:and|to)\s)/iu.test(right),'numeric slot suffix must be punctuation or an allowed connector');
 const word=left.match(/([\p{L}-]+)$/u)?.[1]?.toLowerCase();
 requireThat(citation||word===undefined||['is','was','are','were','of','at','from','to','and','than','parameter','source','version','equals','kept'].includes(word),'numeric slot prefix is not an allowed connector');
 requireThat(!/[/:;]$/u.test(left),'numeric slot cannot form a ratio');
}
