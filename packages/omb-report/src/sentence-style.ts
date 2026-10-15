/** Conservative casing for contract values, never a rewrite of a proper name.
 * Unknown words and pinned symbols retain their source spelling. */
const common = new Set('synthetic adult adults healthy participant participants patient patients community population male female human blood serum plasma tissue cross-sectional longitudinal observational age sex years months days units standardised standardized measured adjusted unadjusted'.split(' '));
const protectedPrefix=(text:string,names:readonly string[])=>names.some(name=>text===name||text.startsWith(name+' ')||text.startsWith(name+','));
export function sentencePositionValue(value:string,position:'start'|'middle',names:readonly string[]=[]):string {
 if(protectedPrefix(value,names))return value;
 if(position==='start')return value.replace(/^(?:[0-9]|1[0-9]|20)(?=\s|$)/u,n=>smallNumber(Number(n))).replace(/^\p{Ll}/u,c=>c.toUpperCase());
 let prefix=true;return value.replace(/^[\p{L}-]+(?:\s+[\p{L}-]+)*/u,phrase=>phrase.split(/(\s+)/u).map(word=>{if(!word.trim())return word;if(!common.has(word.toLowerCase())||names.includes(word)){prefix=false;return word;}return prefix&&/^[A-Z][a-z-]+$/u.test(word)?word.toLowerCase():word;}).join(''));
}
export function insertedValueCaseIssue(value:string,position:'start'|'middle',names:readonly string[]=[]):boolean {
 return position==='middle'&&sentencePositionValue(value,position,names)!==value;
}
export const smallNumber=(n:number):string=>['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty'][n]??String(n);
export function checksSentence(passed:number,total:number):string {
 if(passed===total&&passed>0)return 'All required checks passed.';
 if(passed<=20)return `${sentencePositionValue(smallNumber(passed),'start')} of ${smallNumber(total)} required checks passed.`;
 return `The analysis passed ${passed} of ${total} required checks.`;
}
/** Punctuation added by the reading template, outside the authenticated value. */
export const statementStop=(text:string):string=>/[.!?][”"']?\s*$/u.test(text)?'':'.';
