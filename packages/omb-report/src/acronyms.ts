import {assertContext,type ReportContext} from './context.ts';
import {record} from './common.ts';
/** PW6 acronym rules (design 9): acronyms come from the registry whitelist, are spelled out
 * at first use in each reading scope, and never appear in the title, Key Points, plain
 * summary or idea-in-brief box. Approved gene, protein, cell-line and platform symbols tagged
 * by the pinned entity registry are names, not acronyms; registry aliases, registered acronym
 * forms and disease or trait abbreviations are acronyms. */
import { confusableSkeleton } from './normalise.ts';
import { requireThat } from './common.ts';
import { tagEntities, type EntityRegistry } from './entities.ts';
import { extractNumericValues } from './numeric-matchers.ts';
import { assertTermRegistry, isAcronymShape, partText, type AcronymEntry, type PaperPart, type ReadableRegion, type TermRegistry } from './glossary.ts';

export type AcronymScope='strict'|'abstract'|'body'|'glossary-box';
export const STRICT_ACRONYM_REGIONS:readonly ReadableRegion[]=Object.freeze(['title','key-points','plain-summary','plain-summary-context','plain-summary-results','idea-in-brief']);
export const ABSTRACT_ACRONYM_REGIONS:readonly ReadableRegion[]=Object.freeze(['abstract','abstract-background','abstract-methods','abstract-results','abstract-conclusions']);
export function acronymScope(region:ReadableRegion):AcronymScope {
 if(STRICT_ACRONYM_REGIONS.includes(region))return 'strict';
 if(ABSTRACT_ACRONYM_REGIONS.includes(region))return 'abstract';
 return region==='glossary-box'?'glossary-box':'body';
}
export const NAME_SOURCES=Object.freeze(['HGNC','miRBase','UniProt','Cellosaurus','panel','platform']);
export interface AcronymHit {token:string;start:number;end:number;entry:AcronymEntry|null}
const detectionKey=(text:string)=>confusableSkeleton(text.normalize('NFKD').toLowerCase()).replace(/[\p{M}\p{Default_Ignorable_Code_Point}]/gu,'').toLowerCase();
function lookup(terms:TermRegistry,token:string):AcronymEntry|null {
 token=detectionKey(token);
 return terms.pack.acronyms.find(a=>a.forms.some(f=>detectionKey(f)===token))??(token.endsWith('s')?terms.pack.acronyms.find(a=>a.forms.some(f=>detectionKey(f)===token.slice(0,-1)))??null:null);
}
/** Every acronym-like token, in order. A registered form (including a registered lowercase
 * form such as a software bundle's measure name) is a hit even when not capitalised. */
export function findAcronyms(text:string,terms:TermRegistry,registry:EntityRegistry):AcronymHit[] {
 assertTermRegistry(terms);
 // Only an approved symbol written exactly as registered is a name. An alias such as a
 // protein abbreviation (PSA for KLK3) or a registered acronym form is still an acronym.
 const names=tagEntities(text,registry).filter(e=>NAME_SOURCES.includes(e.source)&&text.slice(e.start,e.end)===e.label);
 const registeredName=(start:number,end:number,token:string,entry:AcronymEntry|null)=>entry!==null&&names.some(e=>e.start<=start&&end<=e.end)&&!entry.forms.includes(token)&&!entry.forms.some(f=>f+'s'===token);
 const hits:AcronymHit[]=[];
 // Detection only: preserve display offsets through Unicode decomposition/skeletons.
 let folded='';const offsets:number[]=[],ends:number[]=[];
 for(let i=0;i<text.length;){const char=String.fromCodePoint(text.codePointAt(i)!);const key=detectionKey(char);folded+=key;for(let j=0;j<key.length;j++){offsets.push(i);ends.push(i+char.length);}i+=char.length;}
 for(const entry of terms.pack.acronyms)for(const form of entry.forms){
  const letters=detectionKey(form);if(!/^[a-z]+$/u.test(letters))continue;
  const pattern=new RegExp(`(?<![\\p{L}\\p{N}])${[...letters].join('[\\s\\p{P}\\p{S}]{0,3}')}(?:s)?(?![\\p{L}\\p{N}])`,'gu');
  for(const m of folded.matchAll(pattern)){
   const start=offsets[m.index]!;let end=ends[m.index+m[0].length-1]!;
   while(end<text.length&&/[\p{M}\p{Default_Ignorable_Code_Point}]/u.test(String.fromCodePoint(text.codePointAt(end)!)))end+=String.fromCodePoint(text.codePointAt(end)!).length;
   if(registeredName(start,end,text.slice(start,end),entry))continue;
   if(!hits.some(h=>h.start===start&&h.end===end))hits.push({token:text.slice(start,end),start,end,entry});
  }
 }

 for(const m of text.matchAll(/[\p{L}\p{N}]+/gu)){
  const end=m.index+m[0].length;const found=lookup(terms,m[0]);const entry=registeredName(m.index,end,m[0],found)?null:found;
  if(!hits.some(h=>h.start<=m.index&&end<=h.end)&&(entry||isAcronymShape(m[0])&&!names.some(e=>e.start<=m.index&&end<=e.end)))hits.push({token:m[0],start:m.index,end,entry});
 }
 for(const m of text.matchAll(/(?<![\p{L}\p{N}])(?:\p{Lu}\.){2,}/gu))if(!hits.some(h=>h.start<=m.index&&h.end>=m.index+m[0].length-1))hits.push({token:m[0],start:m.index,end:m.index+m[0].length,entry:null});
 return hits.sort((a,b)=>a.start-b.start);
}
const escapeRE=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
/** First-use form: "<expansion> (<ACRONYM>)", "(<ACRONYM>;" or "(<ACRONYM>,". */
export function isDefinition(text:string,hit:AcronymHit):boolean {
 if(!hit.entry||!hit.entry.forms.includes(hit.token))return false;
 const expansion=escapeRE(hit.entry.expansion).replace(/(?:\\ |-|\s)+/gu,'[\\s-]+');
 return new RegExp(`(?<![\\p{L}\\p{N}])${expansion}\\s*\\(\\s*$`,'iu').test(text.slice(0,hit.start))&&/^\s*[);,]/u.test(text.slice(hit.end));
}
/** Software identifier slots (data, entity, version, registration, literature and citation
 * values: accessions, genome builds, cohort names) are names, not acronyms. Result bundles
 * and glossary definitions stay in scope: they are prose a reader must decode. */
export const IDENTIFIER_SLOT_KINDS=Object.freeze(['d','e','v','r','c','l']);
export function maskIdentifierSlots(part:PaperPart):string {
 const text=partText(part);if(!part.draft)return text;
 return part.draft.sentences.map(s=>{
  let t=s.text;
  for(const f of s.orderedFacts){if(!IDENTIFIER_SLOT_KINDS.includes(f.key.slice(0,f.key.indexOf(':'))))continue;const at=t.indexOf(f.value);if(at>=0)t=t.slice(0,at)+' '.repeat(f.value.length)+t.slice(at+f.value.length);}
  return t;
 }).join('\n');
}
export interface AcronymReport {used:{scope:AcronymScope;acronym:string;uses:number}[];advisories:{scope:AcronymScope;acronym:string;kind:'used-once'}[]}
/** Blocking acronym rules over the assembled paper, in reading order. */
export function checkAcronyms(parts:readonly PaperPart[],terms:TermRegistry,registry:EntityRegistry):AcronymReport {
 assertTermRegistry(terms);const state=new Map<AcronymScope,Map<string,number>>();
 for(const part of parts){
  const text=maskIdentifierSlots(part);const scope=acronymScope(part.region);const hits=findAcronyms(text,terms,registry);
  if(scope==='strict'){requireThat(hits.length===0,`acronym in ${part.region}: ${hits[0]?.token}`);continue;}
  const seen=state.get(scope)??new Map<string,number>();state.set(scope,seen);
  for(const hit of hits){
   requireThat(hit.entry,`unregistered acronym: ${hit.token}`);
   requireThat(hit.entry.forms.includes(hit.token)||hit.entry.forms.some(f=>f+'s'===hit.token),`acronym ${hit.entry.acronym} must use its canonical form`);
   const key=hit.entry.acronym;const definition=isDefinition(text,hit);
   if(!seen.has(key))requireThat(definition,`acronym ${key} must be spelled out at first use`);
   else requireThat(!definition,`acronym ${key} is defined more than once`);
   seen.set(key,(seen.get(key)??0)+1);
  }
 }
 const used=[...state].flatMap(([scope,seen])=>[...seen].map(([acronym,uses])=>({scope,acronym,uses})));
 return {used,advisories:used.filter(u=>u.uses===1).map(u=>({scope:u.scope,acronym:u.acronym,kind:'used-once' as const}))};
}
/** Software-owned text only: spell out each whitelisted acronym at its first use. */
export function defineAtFirstUse(text:string,terms:TermRegistry,registry:EntityRegistry,defined:Set<string>=new Set()):string {
 const inserts:{start:number;end:number;entry:AcronymEntry}[]=[];
 for(const hit of findAcronyms(text,terms,registry)){
  requireThat(hit.entry,`software text uses an unregistered acronym: ${hit.token}`);
  if(defined.has(hit.entry.acronym))continue;defined.add(hit.entry.acronym);
  if(!isDefinition(text,hit))inserts.push({start:hit.start,end:hit.end,entry:hit.entry});
 }
 for(const i of inserts.reverse())text=`${text.slice(0,i.start)}${i.entry.expansion} (${text.slice(i.start,i.end)})${text.slice(i.end)}`;
 return text;
}
/** Software-owned text only: replace every whitelisted acronym with its plain form for the
 * strict regions. Numbers are audited: the ordered numeric values must not change. */
export function plainify(text:string,terms:TermRegistry,registry:EntityRegistry,sentenceInitial=true):string {
 let out=text;
 for(const hit of findAcronyms(text,terms,registry).reverse()){if(!hit.entry)continue;let word=hit.entry.plain??hit.entry.expansion;const prefix=text.slice(0,hit.start);if(hit.start===0?sentenceInitial:/[.!?]\s+$/u.test(prefix))word=word.replace(/^\p{Ll}/u,c=>c.toUpperCase());out=out.slice(0,hit.start)+word+(detectionKey(hit.token).replace(/[\s\p{P}\p{S}]/gu,'')===detectionKey(hit.entry.acronym)+'s'?'s':'')+out.slice(hit.end);}
 requireThat(JSON.stringify(extractNumericValues(out))===JSON.stringify(extractNumericValues(text)),'plain replacement changed a number');
 return out;
}

/** Only exact DOI identifiers from the sealed frozen bibliography are names.
 * Typed, invented and DOI-shaped prose retain the ordinary acronym checks. */
export function maskBibliographicIdentifiers(ctx:ReportContext,text:string):string {
 assertContext(ctx);const entries=record(ctx.input.frozenLiteratureIndex).entries;
 for(const row of Array.isArray(entries)?entries:[]){const doi=record(record(row).bibliography).doi;if(typeof doi!=='string'||!/^10\.\d{4,9}\/\S+$/u.test(doi))continue;
  text=text.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRE(doi)}(?![A-Za-z0-9])`,'gu'),m=>' '.repeat(m.length));
 }return text;
}
