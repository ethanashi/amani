import { normalise,lexicalForms,lexicalKey } from './normalise.ts';
import { requireThat } from './common.ts';
/** No whole-English dictionary: unfamiliar narrative vocabulary is permitted.
 * This pinned data set exempts medical acronyms from quantity interpretations. */
export const MEDICAL_ACRONYMS=Object.freeze(['LDL','MCI','CVD','DM','CD','ALS','HDL','BMI','DNA','RNA','GWAS','MR','CI','AUC','OR','CAUSE']);
const quantity=/\b(?:single|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twenties|thirty|thirties|forty|forties|fourty|fifty|sixty|seventy|eighty|ninety|ninty|hundred|thousand|million|billion|trillion|quadrillion|dozen|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|twentieth|thirtieth|fortieth|fiftieth|hundredth|thousandth|once|twice|thrice|doubl\w*|tripl\w*|halv\w*|quadruple|quintuple|sextuple|naught|nought|nil|zilch|aught|score|couple|pair|duo|trio|decile|quartile|quintile|tertile|bimodal|triplicate|duplicate|percent|percentage|per cent|quarter|fold)(?:s|fold|th|ths)?\b/iu;
export function checkEnglish(text:string,_legacyProcedure=false):void {
 // Temporal discourse and methodological names have no numerical assertion.
 normalise(text);
 const idioms = text
  .replace(/^\s*One possible explanation is selection bias\.(?=\s*$)/iu, 'A possible explanation is selection bias.')
  .replace(/^\s*Selection bias is one of the possible explanations\.(?=\s*$)/iu, 'Selection bias is a possible explanation.')
  .replace(/^\s*A single interpretation is not warranted\.(?=\s*$)/iu, 'A unique interpretation is not warranted.')
  .replace(/^\s*Samples were processed in a single batch\.(?=\s*$)/iu, 'Samples were processed together.')
  .replace(/^\s*A single assessment cannot fully characterize a changing clinical condition\.(?=\s*$)/iu, 'An isolated assessment cannot fully characterize a changing clinical condition.')
  .replace(/^\s*On the one hand,\s*/iu, '');
 const prose=idioms.replace(/\b((?:should|would|could|can|to) )pair (?=[^.!?]*\bwith\b)/giu,'$1match ').replace(/\bin duplicate\b/giu,'using technical replicates').replace(/\*/gu,'').replace(/^\s*First,\s*/iu,'').replace(/^\s*Once (?=(?:the|a|we|files|samples)\b)/giu,'When ').replace(/\b(?:one|two)-sided\b|\bsecond-generation\b/giu,'methodological');
 for(const form of lexicalForms(prose)){
  requireThat(!/[0-9]/u.test(form),'typed number in normalized or skeleton prose');
  requireThat(!quantity.test(form),'quantity vocabulary requires a software slot');
 }
 // Acronyms remain available as data, not blanket Roman-numeral exceptions.
 for(const word of prose.match(/\b[A-Z]{2,}\b/gu)??[])if(/^[IVXLCDM]+$/u.test(word))requireThat(MEDICAL_ACRONYMS.some(x=>lexicalKey(x)===lexicalKey(word))||word==='I','unregistered numeral-like acronym');
}
