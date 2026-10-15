import {insertedValueCaseIssue} from './sentence-style.ts';
/** Deterministic editorial checks. These detect bounded failure patterns, not
 * scientific truth; all assertion, citation and numerical guards still apply. */
import {requireThat} from './common.ts';
import {parseDraft} from './grammar.ts';
import type {EntityRegistry} from './entities.ts';
export interface TextIssue {sentence:string;rule:string}
const placeholder=/\b(?:TODO|TBD|FIXME|lorem ipsum|placeholder|(?:method|reference|citation)[-_](?:ref|key|here)|synthetic[-_]seed)\b|\[INSERT\b/iu;
const finiteVerb=/\b(?:am|is|are|was|were|be|been|being|has|have|had|do|does|did|can|cannot|could|may|might|must|shall|should|will|would|requires?|remains?|supports?|concerns?|provides?|compares?|compared|describes?|described|includes?|included|reflects?|limits?|differs?|address(?:es)?|depends?|distinguishes?|emphasizes?|emphasises?|examines?|reports?|reported|suggests?|needs?|names?|follows?|follow|uses?|used|applies|apply|determines?|determine|tests?|tested|links?|raises?|raise|illustrates?|illustrate|represents?|represent|allows?|allow|preserves?|preserve|adds?|add|frames?|frame|matters?|matter|offers?|offer|identifies|identified|enables?|enable|demonstrates?|shows?|show|focuses|focus|establishes?|establish|leaves?|leave|permits?|permit|motivates?|motivate|warrants?|warrant|helps?|help|informs?|inform|retains?|retain|separates?|separate|serves?|serve|holds?|held|passed|failed|calls?|deserves?|depends?|reflects?|concerns?|requires?|remains?|continues?|contributes?|relates?|indicates?|involves?|emerges?|occurs?|persists?|provides?|encompasses?|clarifies|clarify|distinguish(?:es)?|emphasizes?|permits?|precludes?|motivates?|accommodates?|seeks?|sought|represents?|warrants?|qualifies|qualify|avoids?|prevents?|extends?|underlines?|underscores?|encourages?|prioritizes?|resolves?|resolved|explores?|explored|assesses?|assessed|considers?|considered|poses?|vary|varies|differ|differed|contains?|contain|kept|discuss(?:es|ed)?|gave|provided|runs?|measures?|adjusted|collected|predicted|helped|searched|took|mix(?:es|ed)?|staged|showed|linked|causes?|designed|evaluated|obtained|reads?|writes?|summarises?|summarizes?|recorded|stops?|ends?|rests?|makes?|made|takes?|brings?|yields?|permits?|precedes?|follows?|examined|evaluates?|constrains?|changes?|changed|defines?|defined|addresses|indicates|consists|arises|arise|differs|differ|clarifies|clarify)\b/iu;
export function finalTextIssues(text:string,allowedStarts:readonly string[]=[],prose=true):TextIssue[]{
 const issues:TextIssue[]=[];
 if(placeholder.test(text))issues.push({sentence:text,rule:'unresolved placeholder-like token'});
 if(!prose)return issues;
 const segments=text.split(/(?<=[.!?])\s+/u),sentences:string[]=[];
 for(const part of segments){if(sentences.length&&/\b(?:e\.g|i\.e|Dr|Prof|vs|al)\.$/u.test(sentences.at(-1)!))sentences[sentences.length-1]+=' '+part;else sentences.push(part);}
 for(const item of sentences){
  const sentence=item.trim();if(!sentence)continue;
  const start=sentence.replace(/^[\s“"'‘(*]+/u,'');
  if(/^\p{N}/u.test(start)&&!allowedStarts.some(t=>start===t||start.startsWith(t+' ')))issues.push({sentence,rule:'sentence must not begin with a digit; spell out a small count or recast the sentence'});
  for(const match of sentence.matchAll(/\b(?:was|were|in|for|of|with|among)\s+([\p{L}-]+(?:\s+[\p{L}-]+)*)/gu))if(insertedValueCaseIssue(match[1]!,'middle',allowedStarts))issues.push({sentence,rule:'capitalized common word in a mid-sentence contract value'});
  if(!/^[\p{Lu}\p{N}]/u.test(start)&&!allowedStarts.some(t=>start===t||start.startsWith(t+' ')))issues.push({sentence,rule:'sentence must begin with a capital, digit or registered symbol'});
  // Closed metadata/table labels are not prose; callers classify those separately.
  if(/[.!?]$/u.test(sentence)&&!finiteVerb.test(sentence)&&(sentence.match(/[\p{L}]+/gu)??[]).length<=6&&!/^\d+(?:\s+of\s+\d+)?\s+.*checks passed/u.test(sentence))issues.push({sentence,rule:'bare fragment: running prose needs a finite predicate'});
 }
 return issues;
}
export function assertFinalText(text:string,allowedStarts:readonly string[]=[],prose=true):void {const issues=finalTextIssues(text,allowedStarts,prose);requireThat(!issues.length,'final text: '+issues.map(i=>`${i.rule}: “${i.sentence}”`).join('; '));}
const abstractWords=new Set('interpretation relationship question uncertainty context meaning scope framework conceptual concept account inquiry distinction comparison boundary boundaries purpose explanation discussion understanding consideration'.split(' '));
export function narrativeIssues(raw:string,registry:EntityRegistry):TextIssue[]{
 const sentences=parseDraft(raw,registry),issues:TextIssue[]=repeatedSentenceIssues(sentences.filter(s=>!s.placeholders.length).map(s=>s.text).join(' ')),grams=new Map<string,{paragraph:number;sentence:string}>();
 for(const s of sentences){
  // Exact frozen citations and host slots are not model padding. Their own guards
  // authenticate them, and repeated claim requests have independent checks.
  if(s.placeholders.length)continue;
  const words=s.prose.toLowerCase().match(/[\p{L}]+/gu)??[];
  const abstract=words.filter(w=>abstractWords.has(w)).length;
  const concrete=/\b(?:blood|serum|plasma|assay|assays|specimen|specimens|neuron|neurons|motor|survival|diagnosis|prognosis|clinic|clinics|recruitment|biomarker|biomarkers|neurofilament|sampling|measurement|measurements|patient|patients|tissue|tissues|covariate|confounding|threshold|interval|intervals|cohort|cohorts|laboratory|laboratories|instrument|instruments|missingness|selection|transportability|predictive|probabilities|parameter|marker|markers)\b/iu.test(s.prose)||s.entities.length>0;
  if(abstract>=3&&!concrete)issues.push({sentence:s.text,rule:'empty conceptual sentence: identify a concrete question, literature finding, measurement or limitation'});
  for(let i=0;i+8<=words.length;i++){const gram=words.slice(i,i+8).join(' '),prior=grams.get(gram);if(prior&&prior.paragraph!==s.paragraph){issues.push({sentence:s.text,rule:`repeated eight-word phrase from “${prior.sentence}”: ${gram}`});break;}grams.set(gram,{paragraph:s.paragraph,sentence:s.text});}
 }
 return issues;
}
export function assertNarrativeQuality(raw:string,registry:EntityRegistry):void {const issues=narrativeIssues(raw,registry);requireThat(!issues.length,'narrative quality: '+issues.map(i=>`${i.rule}: “${i.sentence}”`).join('; '));}

/** Exact sentence repetition also catches short boilerplate within one paragraph.
 * Apply per reading section; tables/protected audit records are separate containers. */
export function repeatedSentenceIssues(text:string):TextIssue[]{
 const seen=new Set<string>(),issues:TextIssue[]=[];
 for(const sentence of text.split(/(?<=[.!?])\s+/u).map(s=>s.trim()).filter(Boolean)){
  const key=sentence.toLocaleLowerCase('en').replace(/\s+/gu,' ');
  if(seen.has(key))issues.push({sentence,rule:'same sentence repeated within the section'});else seen.add(key);
 }return issues;
}
export function assertNoRepeatedSentences(text:string):void{const issues=repeatedSentenceIssues(text);requireThat(!issues.length,issues.map(i=>`${i.rule}: “${i.sentence}”`).join('; '));}
