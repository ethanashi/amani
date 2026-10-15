import { checkEnglish } from './english.ts';
import { lexicalKey, lexicalForms } from './normalise.ts';
import { normalise, confusableSkeleton } from './normalise.ts';
import { tagEntities, type EntityRegistry, type EntityMatch } from './entities.ts';
import { requireThat } from './common.ts';
export const PLACEHOLDER_KINDS=['m','d','e','v','r','p','c','l','fig','tab','sec','g','claim','proc'] as const;
export type PlaceholderKind=typeof PLACEHOLDER_KINDS[number];
export interface Placeholder {kind:PlaceholderKind;key:string;start:number;end:number}
export interface Sentence {id:string;paragraph:number;text:string;prose:string;placeholders:Placeholder[];entities:EntityMatch[]}
export function placeholders(text:string):Placeholder[]{const out:Placeholder[]=[];const regex=/\[([a-z]+):([A-Za-z0-9][A-Za-z0-9_.#-]*)\]/gu;for(const m of text.matchAll(regex)){requireThat(PLACEHOLDER_KINDS.includes(m[1] as PlaceholderKind),`unknown placeholder: ${m[1]}`);out.push({kind:m[1] as PlaceholderKind,key:m[2]!,start:m.index,end:m.index+m[0].length});}return out;}
export function parseDraft(raw:string,registry:EntityRegistry):Sentence[]{
 normalise(raw); // Validate the entire input before retaining structural paragraph boundaries.
 const text=raw.split(/\r?\n[ \t]*\r?\n/u).map(p=>normalise(p)).filter(Boolean).join('\n\n');requireThat(text,'empty draft');
 requireThat(!/[<>`{}\\@|#~]/u.test(text.replace(/\[[^\]]+\]/gu,''))&&!/^(?:\s*[-+>]|\s*:::)/mu.test(text),'closed grammar: markup');
 const slots=placeholders(text);const masked=text.split('');for(const slot of slots)masked.fill(' ',slot.start,slot.end);
 requireThat(!/[\[\]]/u.test(masked.join('')),'closed grammar: unknown brackets, link or footnote');
 requireThat(![masked.join(''),lexicalKey(masked.join(''))].some(x=>/(?:[a-z]+:\/\/|(?:mailto|doi|javascript|data)\s*:|[a-z]+\.[a-z]{2,}\b)/iu.test(x)),'closed grammar: URL');
 // Emphasis only: balanced delimiters, no crossing paragraphs or empty spans.
 for(const paragraph of text.split(/\n\s*\n/u)){requireThat(!/(?<!\*)(\*{1,2})(?!\*)\s+\1(?!\*)/u.test(paragraph),'empty emphasis');const markers=paragraph.match(/\*{1,}/gu)??[];requireThat(markers.every(m=>m.length<=2)&&markers.length%2===0,'unbalanced emphasis');for(let i=0;i<markers.length;i+=2)requireThat(markers[i]===markers[i+1],'crossed emphasis');}
 const sentences:Sentence[]=[];let begin=0;let paragraph=0;
 for(let i=0;i<text.length;i++){
  if(slots.some(s=>i>=s.start&&i<s.end))continue;
  if(/[.!?]/u.test(text[i]!)&&(i===text.length-1||/\s/u.test(text[i+1]!))){
   const body=text.slice(begin,i+1).trim();if(body){const ps=placeholders(body);let prose=body;for(const p of [...ps].reverse())prose=prose.slice(0,p.start)+' '.repeat(p.end-p.start)+prose.slice(p.end);
    const entities=tagEntities(prose,registry);let naked=prose;for(const e of [...entities].reverse())naked=naked.slice(0,e.start)+' '.repeat(e.end-e.start)+naked.slice(e.end);
    requireThat(!/[%‰‱×÷]|(?:^|\s)[+-](?=\s|$)/u.test(naked),'typed unit or arithmetic decoration outside software slot');
    checkEnglish(naked);
    checkRoman(naked);
    sentences.push({id:`s${sentences.length+1}`,paragraph,text:body,prose,placeholders:ps,entities});
   }begin=i+1;
  }
  if(text[i]==='\n'&&text[i+1]==='\n')paragraph++;
 }
 requireThat(!text.slice(begin).trim(),'each sentence must end with punctuation (tags precede punctuation)');
 return sentences;
}

export function checkRoman(text:string):void {
    for(const variant of lexicalForms(text)){
     const roman=/\b(?:stage|grade|type|phase|class)\s+([ivxlcdm]+)\b|\b([ivxlcdm]+)\s+(?:mg|kg|ml|mm|cm|units|participants|patients)\b/giu;
     requireThat(!roman.test(variant),'Roman numeral in quantity position');
    }
}
