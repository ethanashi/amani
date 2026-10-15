/** PW6 readability alarms (design 9, "Metrics as alarms only"). The pinned formulas are
 * logged and advisory, with one blocking rule from the design: the build fails if the plain
 * summary is no easier than the abstract. There is no grade-level target. */
import { requireThat } from './common.ts';
import { canonicalText } from './normalise.ts';

export const READABILITY_VERSION='omb-paper/readability@1';
/** Advisory thresholds. Crossing one is logged as an alarm; it never fails the build. */
export const ALARM_THRESHOLDS=Object.freeze({sentenceWords:30,meanSentenceWords:22,nesting:3,passiveDensity:0.4});
export interface SentenceMetrics {index:number;words:number;syllables:number;polysyllables:number;nesting:number;passive:boolean}
export interface RegionMetrics {region:string;sentences:number;words:number;syllables:number;polysyllables:number;meanSentenceLength:number;maxSentenceLength:number;fleschReadingEase:number;smog:number;passiveDensity:number;maxNesting:number;perSentence:SentenceMetrics[]}
export type AlarmKind='sentence-length'|'mean-sentence-length'|'nesting'|'passive-density';
export interface ReadabilityAlarm {region:string;kind:AlarmKind;value:number;threshold:number;sentence?:number}

/** Sentence ends are ., ! or ? followed by whitespace; decimals and "p < 0.001" stay whole. */
export function splitSentences(text:string):string[] {return canonicalText(text).split(/(?<=[.!?])\s+/u).map(s=>s.trim()).filter(s=>/\p{L}/u.test(s));}
/** Words are letter runs, with internal apostrophes or hyphens; numbers are not words. */
export function words(sentence:string):string[] {return sentence.match(/\p{L}+(?:['’-]\p{L}+)*/gu)??[];}
/** Pinned vowel-group heuristic (silent final e, -es and -ed; -ted and -ded keep their
 * syllable); a hyphenated word is the sum of its parts. Deterministic, not a dictionary. */
export function syllables(word:string):number {
 const parts=word.split(/['’-]/u).filter(Boolean);
 if(parts.length>1)return parts.reduce((n,p)=>n+syllables(p),0);
 let w=word.toLowerCase().replace(/[^a-z]/gu,'');
 if(!w)return 1;
 if(w.length<=3)return 1;
 w=w.replace(/(?:[^laeiouy]es|[^laeiouytd]ed|[^laeiouy]e)$/u,'').replace(/^y/u,'');
 return Math.max(1,(w.match(/[aeiouy]{1,2}/gu)??[]).length);
}
const IRREGULAR_PARTICIPLES='made|done|found|seen|shown|known|given|taken|built|kept|held|set|put|run|chosen|drawn|split|left|told|thought|brought|sent|led|met|paid|read|said|sold|spent|won|written|begun|grown|hidden|stolen';
export function isPassive(sentence:string):boolean {return new RegExp(`\\b(?:am|is|are|was|were|be|been|being)\\s+(?:\\p{L}+ly\\s+)?(?:\\p{L}+ed|\\p{L}+en|${IRREGULAR_PARTICIPLES})\\b`,'iu').test(sentence);}
/** Nesting = deepest bracket level plus relative or concessive clause markers. */
export function nesting(sentence:string):number {
 let depth=0,max=0;for(const c of sentence){if(c==='('||c==='['){depth++;max=Math.max(max,depth);}else if((c===')'||c===']')&&depth>0)depth--;}
 return max+(sentence.match(/\b(?:which|who|whom|whose|although|whereas|unless)\b/giu)??[]).length;
}
export function measureText(region:string,text:string):RegionMetrics {
 const perSentence=splitSentences(text).map((s,index)=>{const ws=words(s);const syl=ws.map(syllables);return {index,words:ws.length,syllables:syl.reduce((a,b)=>a+b,0),polysyllables:syl.filter(n=>n>=3).length,nesting:nesting(s),passive:isPassive(s)};});
 const sentences=perSentence.length,wordCount=perSentence.reduce((n,s)=>n+s.words,0),syl=perSentence.reduce((n,s)=>n+s.syllables,0),poly=perSentence.reduce((n,s)=>n+s.polysyllables,0);
 requireThat(sentences>0&&wordCount>0,`no measurable text in ${region}`);
 const round=(x:number)=>Math.round(x*1000)/1000;
 return {region,sentences,words:wordCount,syllables:syl,polysyllables:poly,
  meanSentenceLength:round(wordCount/sentences),maxSentenceLength:Math.max(...perSentence.map(s=>s.words)),
  fleschReadingEase:round(206.835-1.015*(wordCount/sentences)-84.6*(syl/wordCount)),
  smog:round(1.043*Math.sqrt(poly*30/sentences)+3.1291),
  passiveDensity:round(perSentence.filter(s=>s.passive).length/sentences),maxNesting:Math.max(...perSentence.map(s=>s.nesting)),perSentence};
}
/** Advisory only: returned for the log, never thrown. */
export function readabilityAlarms(m:RegionMetrics,thresholds=ALARM_THRESHOLDS):ReadabilityAlarm[] {
 const alarms:ReadabilityAlarm[]=[];
 for(const s of m.perSentence){
  if(s.words>thresholds.sentenceWords)alarms.push({region:m.region,kind:'sentence-length',value:s.words,threshold:thresholds.sentenceWords,sentence:s.index});
  if(s.nesting>thresholds.nesting)alarms.push({region:m.region,kind:'nesting',value:s.nesting,threshold:thresholds.nesting,sentence:s.index});
 }
 if(m.meanSentenceLength>thresholds.meanSentenceWords)alarms.push({region:m.region,kind:'mean-sentence-length',value:m.meanSentenceLength,threshold:thresholds.meanSentenceWords});
 if(m.passiveDensity>thresholds.passiveDensity)alarms.push({region:m.region,kind:'passive-density',value:m.passiveDensity,threshold:thresholds.passiveDensity});
 return alarms;
}
/** The one blocking readability rule. "Easier" must hold on both pinned formulas, since they
 * disagree (Wang 2013): a higher Flesch Reading Ease and a lower SMOG than the abstract. */
export function assertPlainEasierThanAbstract(plain:RegionMetrics,abstract:RegionMetrics):void {
 requireThat(plain.fleschReadingEase>abstract.fleschReadingEase,'plain summary is no easier than the abstract (Flesch Reading Ease)');
 requireThat(plain.smog<abstract.smog,'plain summary is no easier than the abstract (SMOG)');
}
