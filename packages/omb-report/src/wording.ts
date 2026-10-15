import {assertMethodNarrative,type MethodNarrativeReview} from './methods-narrative.ts';
import { checkStructure } from './boundaries.ts';
import { hasAssertion, checkNarrative, procedureAssertion } from './prose.ts';
import { CONNECTIVES, PROCEDURE_TEMPLATES, LITERATURE_TEMPLATES, CLAIM_TEMPLATES, BLIND_INPUT_TEMPLATES } from './templates.ts';
import { validLock } from './lock.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { type ClaimView, type ReportContext, type Region, assertContext } from './context.ts';
import { lexicalKey, canonicalText, confusableSkeleton } from './normalise.ts';
import { type Sentence } from './grammar.ts';
import { record, requireThat, finite } from './common.ts';
export const WORDING_VERSION='paper-wording@1';
export const PHRASE_TABLE=CLAIM_TEMPLATES;
// Design 6.4 taxonomy for diagnostics and audit only. Authorization uses templates below, never these word lists.
export const LEXICONS:Readonly<Record<number,string>>=Object.freeze({
 1:'show(?:s|ed)?|find(?:s|ing)?|found|demonstrat(?:e[sd]?|ing)|reveal(?:s|ed)?|identif(?:ies|ied|y)|implicat(?:e[sd]?|ing)|underl(?:ies|y)|driv(?:e[sn]?|ing)|mediat(?:e[sd]?|ing)|regulat(?:e[sd]?|ing)|contributes? to|plays? a role|is involved in|is responsible for|triggers?|induces?|determines?|predict(?:s|ed)?|risk factor|driver',
 2:'adjusted for|excluded|removed|normali[sz]ed|filtered|imputed|corrected|split|matched|weighted|stratified|permuted|bootstrapped',
 3:'pre-registered|pre-specified|registered|locked|blind(?:ed)?|held-out|external|independent(?:ly)?|prospective(?:ly)?|replicat(?:ed|e|ion)|reproduced|validated|validation|confirmatory|a priori|out-of-sample|unbiased|verified|certified|rigorous|model family',
 4:'higher|lower|increased?|decreased?|more|less|positive|inverse|protective|elevated|reduced',
 5:'than|versus|compared with|outperform(?:ed|s)?|improv(?:e[sd]?|ing)|rose|fell|stronger|weaker|but not|only in|whereas|unlike',
 6:'large|small|modest|substantial|strong|weak|marked|dramatic|negligible|near-perfect|excellent',
 7:'risk|likely|times',
 8:'first|for the first time|novel|new|unprecedented|previously unknown|unexplored|no (?:prior|previous) study|to our knowledge|unique',
 9:'promising|remarkable|striking|breakthrough|powerful|crucial|key|paves the way|holds promise|therapeutic potential',
 10:'trend toward significance|marginally|approached|nominally|borderline|highly significant',
 11:'no (?:relationship|link|difference|evidence|association)|not (?:related|linked|predictive)|lacks?(?: of)?|absent|irrelevant|(?:did|does) not (?:affect|predict)|refuted|disproved|no effect|no association|did not differ|similar|comparable|unrelated|not associated|independent of|unchanged|equivalent|ruled out|null',
 12:'impact|influence|determinant|role|risk factor|driver|effect on|attributable|linked to|tied to|behind|key to|fuels|blocks',
 13:'taken together|collectively|consistently|robust(?: to)?|consistent across|stable(?: across)?',
 14:'due to|because|likely reflects|probably reflects|underpowered|low power',
 15:'therapeutic|therap(?:y|ies)|treatment|drug|medication|repurpos\\w*|druggable|target(?:ing)?|intervention|prevent\\w*|clinical trial|patients should|dose|cholesterol-lowering medicines|statins?|fibrates?|lipid-lowering (?:agents|medicines)|antihypertensives?|antidepressants?',
 16:'trend|dose-response|separate|cluster|plateau|clear|striking|sharp',
 17:'we hypothesi[sz]ed|we predicted|we expected|as expected|as predicted|as hypothesi[sz]ed|our hypothesis',
});
export const SPIN_TAXONOMY=Object.freeze({version:WORDING_VERSION,selectiveReporting:[5,8,10,13],overinterpretation:[1,4,6,7,11,12,14],clinicalExtrapolation:[15],misleadingPresentation:[2,3,9,16,17],sources:['Yavchitz 2016','Chiu 2017']});
const has=(s:Sentence,kind:string,key:string)=>s.placeholders.some(p=>p.kind===kind&&p.key===key);
export interface BoundSentence {sentence:Sentence;claims:ClaimView[];quoteKeys:string[]}
export function bindSentence(ctx:ReportContext,s:Sentence,region:Region,methodReview?:MethodNarrativeReview):BoundSentence{
 assertContext(ctx);if(methodReview)assertMethodNarrative(ctx,methodReview,s.prose);checkStructure(ctx,s,region,methodReview?.adjustmentMatched===true);const explicit=s.placeholders.filter(p=>p.kind==='claim').map(p=>p.key);const quotes=s.placeholders.filter(p=>p.kind==='c').map(p=>p.key);
 requireThat(!(explicit.length&&quotes.length),'a sentence cannot be both finding and background');requireThat(new Set(explicit).size===explicit.length,'duplicate claim tag');
 for(const id of explicit)requireThat(ctx.claims.some(c=>c.id===id),'unknown claim tag');
 const ids=new Set(explicit);
 // Whole entity labels, including nondigit population/exposure/outcome terms.
 const mentioned=ctx.claims.filter(c=>c.entities.some(e=>s.entities.some(x=>x.id===e||x.label.toLowerCase()===e.toLowerCase())||new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRE(e)}(?![\\p{L}\\p{N}_-])`,'iu').test(s.prose)));
 if(!quotes.length&&!explicit.length)mentioned.filter(c=>{const key=lexicalKey(s.prose);const pair=[c.plan.exposure,c.plan.outcome].every(e=>typeof e==='string'&&key.includes(lexicalKey(e)));return pair||hasAssertion(s.prose)||entityPredicate(s.prose,c);}).forEach(c=>ids.add(c.id));
 const bound=ctx.claims.filter(c=>ids.has(c.id));
 requireThat(!s.placeholders.some(p=>p.kind==='e')||bound.length>0,'entity slot needs a claim');
 for(const c of bound){
  for(const e of s.entities)requireThat(c.entities.some(v=>v===e.id||v.toLowerCase()===e.label.toLowerCase()),'entity outside claim record');
  for(const p of s.placeholders.filter(p=>p.kind==='e')){const entity=ctx.input.entities.find(e=>e.id===p.key);requireThat(entity&&entity.claimIds.includes(c.id),'entity slot outside claim record');}
 }
 const drugs=ctx.input.entities.filter(e=>e.kind==='drug'&&(s.placeholders.some(p=>p.kind==='e'&&p.key===e.id)||new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRE(e.canonicalForm)}(?![\\p{L}\\p{N}_-])`,'iu').test(s.prose)));
 if(drugs.length){requireThat(bound.length>0,'drug entity requires claim scope');for(const c of bound)if(c.scope==='S1'||c.rung<3)requireThat(has(s,'p',`${c.id}.risk-scope`),'drug entity requires the risk-scope line');}
 const refs=s.placeholders.filter(p=>p.kind==='m');
 requireThat(!refs.length||bound.length>0&&!quotes.length,'decision metric in an unbound/background sentence');
 for(const p of refs){const f=ctx.slots.get(`m:${p.key}`)??(p.key.endsWith('.label')&&ctx.claims.some(c=>`${c.id}.label`===p.key)?{claimId:p.key.slice(0,-6)}:undefined);requireThat(f,'unknown or non-prose-safe metric slot');
  for(const c of bound){requireThat(f.claimId===c.id||c.companions.includes(f.claimId??''),'metric belongs to another claim');if(f.claimId!==c.id){const deciding=s.placeholders.find(x=>x.kind==='m'&&x.key===`${c.id}.result`);requireThat(deciding&&deciding.start<p.start&&p.key===`${f.claimId}.result`,'companion must follow deciding bundle');}}
 }
 if(region==='introduction'||region==='background'){requireThat(!refs.length,'Introduction metrics require a claim template');for(const c of mentioned)requireThat(c.registered,'Introduction names exploratory entity');}
 if(['title','key-points','abstract','plain-summary'].includes(region)&&bound.length)requireThat(bound.every(c=>c.id===ctx.input.plannedFound.primaryClaimId&&validLock(ctx,c.id)),'primary claim must lead strict summary regions');
 for(const key of quotes){const q=ctx.quotes.find(q=>q.key===key);requireThat(q&&['fulltext-verified','abstract-supported'].includes(q.status)&&q.approvedSentenceHashes.includes(canonicalSha256(s.text)),'citation sentence lacks an approved verified quote');}
 return {sentence:s,claims:bound,quoteKeys:quotes};
}
/** A copular predicate about a study entity remains an assertion even when its
 * adjective is unknown. Neutral topic/mention frames do not evaluate a result. */
function entityPredicate(prose:string,c:ClaimView):boolean {
 const text=canonicalText(prose).toLowerCase();
 return [c.plan.exposure,c.plan.outcome].some(value=>{
  if(typeof value!=='string')return false;
  const match=new RegExp(`(?:^|[^a-z])${escapeRE(value.toLowerCase())}\\s+((?:is|are|was|were|has|have|had)\\b.*)$`,'u').exec(text);
  if(!match)return false;
  const predicate=match[1]!;
  const topic=/^(?:is|was) the (?:focus|topic|subject) of (?:the )?(?:recruitment|research|discussion|protocol)(?: materials| section| rationale)?[.!?]$/u.test(predicate);
  const mention=/^(?:is|was) (?:considered|discussed|mentioned)(?: in the (?:protocol|methods|introduction|recruitment materials))?[.!?]$/u.test(predicate);
  return !topic&&!mention;
 });
}
function escapeRE(text:string):string{return text.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');}
export function lintWording(ctx:ReportContext,bound:BoundSentence,region:Region,methodReview?:MethodNarrativeReview):void{
 if(methodReview)assertMethodNarrative(ctx,methodReview,bound.sentence.prose);
 lintWordingCore(ctx,bound,region,methodReview);
}
/** Blind prose has no results context and cannot supply a Methods-proof exemption. */
export function lintBlindWording(ctx:Pick<ReportContext,'quotes'>,bound:BoundSentence,region:'introduction'|'methods'):void {
 requireThat(bound.claims.length===0&&bound.sentence.placeholders.every(p=>p.kind==='c'),'blind wording cannot contain results or procedure slots');
 lintWordingCore(ctx,bound,region);
}
function lintWordingCore(ctx:Pick<ReportContext,'quotes'>,bound:BoundSentence,region:Region,methodReview?:MethodNarrativeReview):void {
 const {sentence:s,claims,quoteKeys}=bound;
 if(quoteKeys.length){
  requireThat(!procedureAssertion(s.prose),'procedure facts require proc slots even in cited prose');
  requireThat(!/\b(?:our|we|this study|this analysis|the present study)\b/iu.test(lexicalKey(s.prose)),'literature cannot assert this study finding');
  requireThat(!s.placeholders.some(p=>!['c','l','e'].includes(p.kind)),'result language in literature sentence');
  // Exact approved source prose, not an approval hash alone, is the exemption.
  const quoteKey=(value:string)=>canonicalText(value).toLowerCase().replace(/ß/gu,'ss').replace(/ς/gu,'σ');
  const prose=quoteKey(s.prose.replace(/[.!?]+$/u,''));
  requireThat(ctx.quotes.filter(q=>quoteKeys.includes(q.key)).some(q=>quoteKey(q.quote.replace(/[.!?]+$/u,''))===prose),'literature sentence must reproduce the approved quote');
  return;
 }
 if(!claims.length){checkNarrative(s.text,s.prose,region,methodReview?.methodFact===true);return;}
 requireThat(claims.length===1,'sentence must request a claim template or a permitted procedure');
 requireThat(s.placeholders.length===1&&s.placeholders[0]!.kind==='claim','claim sentence must request its software template');
 requireThat(CONNECTIVES.some(c=>lexicalKey(c)===lexicalKey(s.prose.replace(/[.!?]+$/u,''))),`claim connective exceeds ${claims[0]!.status} template`);
}
/** Compatibility query: narrative no longer receives an exact-template exemption. */
export function isProcedure(s:Sentence,_ctx:ReportContext,region:Region):boolean {
 try {checkNarrative(s.text,s.prose,region);return !s.placeholders.some(p=>p.kind==='claim'||p.kind==='m');}catch{return false;}
}
export const PLAIN_REPLACEMENTS:Readonly<Record<string,string>>=Object.freeze({'heterogeneity':'differences between studies','etiology':'origin of disease','aetiology':'origin of disease'});
export function applyPlainReplacements(text:string):string{for(const [term,replacement]of Object.entries(PLAIN_REPLACEMENTS))text=text.replace(new RegExp(`\\b${term}\\b`,'giu'),replacement);return text;}
