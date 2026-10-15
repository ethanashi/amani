import { readFileSync } from 'node:fs';
import { requireThat } from './common.ts';
// Unicode TR39 data pinned in vendor/ (Unicode license). Skeleton is for checks only;
// it is never substituted into gene symbols or the displayed manuscript.
const mappings=new Map<string,string>();
for(const line of readFileSync(new URL('../vendor/confusables.txt',import.meta.url),'utf8').split('\n')){
 const [a,b]=line.split('#')[0]!.split(';').map(s=>s.trim());
 if(a&&b)mappings.set(String.fromCodePoint(...a.split(' ').map(x=>parseInt(x,16))),String.fromCodePoint(...b.split(' ').map(x=>parseInt(x,16))));
}
export function confusableSkeleton(text:string):string{return [...text.normalize('NFD')].map(c=>mappings.get(c)??c).join('').normalize('NFD');}
const scripts=[/\p{Script=Latin}/u,/\p{Script=Greek}/u,/\p{Script=Cyrillic}/u,/\p{Script=Han}/u,/\p{Script=Hiragana}/u,/\p{Script=Katakana}/u,/\p{Script=Arabic}/u,/\p{Script=Hebrew}/u,/\p{Script=Devanagari}/u];
/** Display normalization precedes every check; lexical comparisons additionally fold
 * case and use the pinned TR39 skeleton. White_Space includes NEL and separators. */
export function canonicalText(text:string):string{requireThat(!/\p{Default_Ignorable_Code_Point}/u.test(text),'default-ignorable character');return text.normalize('NFKC').replace(/[\p{White_Space}]+/gu,' ').replace(/[‐‑‒–—−]/gu,'-').trim();}
export function lexicalKey(text:string):string{return confusableSkeleton(canonicalText(text).toLowerCase().replace(/ß/gu,'ss').replace(/ς/gu,'σ')).toLowerCase();}
export function lexicalForms(text:string):string[]{const folded=canonicalText(text).toLowerCase().replace(/ß/gu,'ss').replace(/ς/gu,'σ');return [folded,lexicalKey(text),confusableSkeleton(canonicalText(text))];}
export function normalise(text:string):string{
 requireThat(typeof text==='string'&&text.length<=200_000,'missing or oversized drafter text');
 const clean=canonicalText(text);
 for(const variant of [text,clean]){
  requireThat(!/\p{Cf}|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u0084\u0086-\u009f]/u.test(variant),'format or control character');
  requireThat(![...variant].some(c=>/\p{N}/u.test(c)&&!/[0-9]/u.test(c)),'non-ASCII numeric character');
  requireThat(!/[\p{Script=Han}\u20e3🔟]/u.test(variant),'Han or keycap outside the English drafting grammar');
  requireThat(!/&/u.test(variant),'HTML entities and ampersands are outside the grammar');
 }
 assertSingleScript(clean);
 assertVisible(text);
 requireThat(![...clean].some(c=>c.codePointAt(0)!>127&&!scientificLetter(c)&&/[A-Za-z0-9 ]/u.test(confusableSkeleton(c))),'noncanonical lookalike character');
 return clean;
}

export function assertSingleScript(text:string):void {for(const token of text.match(/[\p{L}\p{M}\p{N}_]+/gu)??[])requireThat(scripts.filter(r=>r.test(token)).length<=1,'mixed-script token');}

export function assertVisible(text:string):void {requireThat(!/[\u115f\u1160\u3164\uffa0\u2800]/u.test(text),'invisible filler character');}

function scientificLetter(c:string):boolean {
 return /^[A-Za-z][\p{M}]+$/u.test(c.normalize('NFD'))||'αβγδεκλμπτω'.includes(c);
}
