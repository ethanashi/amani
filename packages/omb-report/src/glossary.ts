/** PW6 (design 9): the kernel-owned, versioned term registry, inline `[g:]` definitions
 * and the per-paper inline limit. Registry text is vetted software text; the drafter
 * only requests a definition by ID and never writes one. */
import { readFileSync } from 'node:fs';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { requireThat } from './common.ts';
import { canonicalText, lexicalKey, normalise } from './normalise.ts';
import type { Region, ResolvedFact } from './context.ts';
import type { RenderedDraft } from './render.ts';

export const TERM_REGISTRY_SCHEMA='omb-paper/term-registry@1';
/** Only `field` terms may be defined inline. Statistics, check and label terms live in the
 * glossary box: defining a p-value inline reads as patronising to specialists (design 9). */
export type TermClass='field'|'statistics'|'check'|'label';
export interface TermEntry {id:string;term:string;aliases:readonly string[];class:TermClass;definition:string;source:string;acronym?:string;gates?:readonly string[]}
export interface AcronymEntry {acronym:string;expansion:string;plain?:string;forms:readonly string[]}
export const ANALOGY_TRIGGERS=Object.freeze(['plan-lock','planted-effects','multiplicity','negative-controls','bias-budget'] as const);
export type AnalogyTrigger=typeof ANALOGY_TRIGGERS[number];
export interface AnalogyEntry {id:string;trigger:AnalogyTrigger;text:string;source:string}
export interface DesignEntry {kind:string;text:string}
export interface TermPack {schema:string;version:string;sha256:string;terms:readonly TermEntry[];acronyms:readonly AcronymEntry[];analogies:readonly AnalogyEntry[];designs:readonly DesignEntry[]}
export interface TermRegistry {readonly pack:TermPack}

/** A bounded token with at least two capitals that make up at least half of its letters:
 * ALS, pQTL, mRNA and COVID qualify; DeLong, McDonald and Figure do not. */
export function isAcronymShape(token:string):boolean {
 const letters=[...token].filter(c=>/\p{L}/u.test(c));const upper=letters.filter(c=>/\p{Lu}/u.test(c));
 return upper.length>=2&&upper.length*2>=letters.length;
}
export function acronymShapedTokens(text:string):string[] {return (text.match(/[\p{L}\p{N}]+/gu)??[]).filter(isAcronymShape);}

const registries=new WeakSet<TermRegistry>();
function deepFreeze<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value;}
/** Registry prose is vetted software text: canonical, digit-free (digits only ever come from
 * signed software slots) and free of markup or slot syntax. */
export function vettedText(text:unknown,field:string):string {
 requireThat(typeof text==='string'&&text.trim().length>0&&text.length<=400,`term registry ${field} must be nonempty text`);
 requireThat(normalise(text)===text,`term registry ${field} must be canonical`);
 requireThat(!/\p{N}/u.test(text),`term registry ${field} must be digit-free`);
 requireThat(!/[\[\]{}<>`*_|#\\@&]/u.test(text),`term registry ${field} contains markup`);
 return text;
}
export function buildTermRegistry(pack:TermPack):TermRegistry {
 const copy=structuredClone(pack);const {sha256,...content}=copy;
 requireThat(copy.schema===TERM_REGISTRY_SCHEMA,'unknown term registry schema');
 requireThat(typeof copy.version==='string'&&/^[a-z0-9][a-z0-9._@-]*$/u.test(copy.version),'invalid term registry version');
 requireThat(canonicalSha256(content)===sha256,'term registry hash mismatch');
 const acronyms=new Map<string,AcronymEntry>();const forms=new Set<string>();
 for(const a of copy.acronyms){
  requireThat(isAcronymShape(vettedText(a.acronym,'acronym'))&&/^[\p{L}\p{N}]+$/u.test(a.acronym),'acronym entry must be acronym-shaped');
  vettedText(a.expansion,'acronym expansion');if(a.plain!==undefined)vettedText(a.plain,'plain acronym replacement');
  requireThat([a.expansion,a.plain??''].every(t=>acronymShapedTokens(t).length===0),'acronym expansions must be acronym-free');
  requireThat(Array.isArray(a.forms)&&a.forms.includes(a.acronym),'acronym forms must include the acronym');
  for(const form of a.forms){requireThat(/^[\p{L}\p{N}]+$/u.test(form)&&(form===a.acronym||form===a.acronym.toLowerCase()),'acronym form must be the acronym or its lowercase');requireThat(!forms.has(form),'duplicate acronym form');forms.add(form);}
  acronyms.set(a.acronym,a);
 }
 const ids=new Set<string>();const names=new Set<string>();
 for(const t of copy.terms){
  requireThat(typeof t.id==='string'&&/^[a-z][a-z0-9-]*$/u.test(t.id)&&!ids.has(t.id),'term IDs must be unique lowercase slugs');ids.add(t.id);
  requireThat(['field','statistics','check','label'].includes(t.class),'unknown term class');
  requireThat(Array.isArray(t.aliases),'term aliases must be a list');
  for(const name of [t.term,...t.aliases]){vettedText(name,'term');const key=lexicalKey(name);requireThat(!names.has(key),'ambiguous term name');names.add(key);}
  vettedText(t.definition,'definition');vettedText(t.source,'source');
  for(const token of acronymShapedTokens(t.definition+' '+t.term))requireThat(acronyms.has(token),'registry text uses an unregistered acronym');
  if(t.acronym!==undefined){const a=acronyms.get(t.acronym);requireThat(a&&lexicalKey(a.expansion)===lexicalKey(t.term),'term acronym must expand to the term');}
  if(t.gates!==undefined)requireThat(Array.isArray(t.gates)&&t.gates.every(g=>typeof g==='string'&&/^[A-Za-z0-9-]+$/u.test(g)),'invalid term gate trigger');
 }
 const triggers=new Set<string>();
 for(const a of copy.analogies){requireThat((ANALOGY_TRIGGERS as readonly string[]).includes(a.trigger)&&!triggers.has(a.trigger),'analogy triggers must be unique and known');triggers.add(a.trigger);vettedText(a.text,'analogy');vettedText(a.source,'analogy source');for(const token of acronymShapedTokens(a.text))requireThat(acronyms.has(token),'registry text uses an unregistered acronym');}
 const kinds=new Set<string>();
 for(const d of copy.designs){requireThat(typeof d.kind==='string'&&d.kind.length>0&&!kinds.has(d.kind),'design kinds must be unique');kinds.add(d.kind);vettedText(d.text,'design');requireThat(acronymShapedTokens(d.text).length===0,'idea-in-brief design text must be acronym-free');}
 const registry=deepFreeze({pack:copy});registries.add(registry);return registry;
}
export function assertTermRegistry(terms:TermRegistry|undefined):asserts terms is TermRegistry {requireThat(terms!==undefined&&registries.has(terms),'term registry must be built from the pinned pack');}

/** The kernel-owned file and its pinned hash: a changed file is refused, not adopted. */
export const DEFAULT_TERM_PACK_SHA256='d4386937282db5f1f16d175c40d3241330645f6494f94dd755c09c8c39b8ca59';
export function loadPinnedTermRegistry(pack:TermPack,pinned:string=DEFAULT_TERM_PACK_SHA256):TermRegistry {
 requireThat(pack?.sha256===pinned,'term registry differs from its pinned hash');
 return buildTermRegistry(pack);
}
export function loadDefaultTermRegistry():TermRegistry {return loadPinnedTermRegistry(JSON.parse(readFileSync(new URL('../vendor/pw6-terms.json',import.meta.url),'utf8')) as TermPack);}

export function termEntry(terms:TermRegistry,id:string):TermEntry {assertTermRegistry(terms);const entry=terms.pack.terms.find(t=>t.id===id);requireThat(entry,`unknown glossary term: ${id}`);return entry;}
export function acronymEntry(terms:TermRegistry,acronym:string):AcronymEntry {const a=terms.pack.acronyms.find(a=>a.acronym===acronym);requireThat(a,`unknown acronym: ${acronym}`);return a;}
/** The inline rendering is software text. An acronym term doubles as its first-use definition. */
export function inlineDefinition(terms:TermRegistry,id:string):string {
 const t=termEntry(terms,id);
 requireThat(t.class==='field','only field-specific terms are defined inline; statistics, check and label terms belong in the glossary box');
 return t.acronym?`${t.term} (${t.acronym}; ${t.definition})`:`${t.term} (${t.definition})`;
}
/** Inline definitions belong in the technical body, never in summaries, the abstract or results. */
export const GLOSSARY_REGIONS:readonly Region[]=Object.freeze(['introduction','background','methods','discussion','limitations','caption']);
export function glossaryFact(terms:TermRegistry|undefined,id:string,region:Region):ResolvedFact {
 assertTermRegistry(terms);requireThat(GLOSSARY_REGIONS.includes(region),'inline glossary definitions belong in the technical body');
 const entry=termEntry(terms,id);
 return {key:id,claimId:null,display:inlineDefinition(terms,id),raw:entry,grade:'input',producerGate:'term-registry',factIds:[canonicalSha256({version:terms.pack.version,entry})],certHash:null};
}

const escapeRE=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
/** Whole-token mention: the term or an alias (case-folded) or an acronym form (exact case). */
export function mentionsTerm(text:string,t:TermEntry,terms:TermRegistry):boolean {
 const folded=canonicalText(text).toLowerCase();
 if([t.term,...t.aliases].some(name=>new RegExp(`(?<![\\p{L}\\p{N}])${escapeRE(canonicalText(name).toLowerCase()).replace(/[ -]+/gu,'[\\s-]+')}(?![\\p{L}\\p{N}])`,'u').test(folded)))return true;
 if(!t.acronym)return false;
 const forms=acronymEntry(terms,t.acronym).forms;
 return (text.match(/[\p{L}\p{N}]+/gu)??[]).some(token=>forms.includes(token)||token.endsWith('s')&&forms.includes(token.slice(0,-1)));
}

export type ReadableRegion=Region|'idea-in-brief'|'glossary-box';
/** One rendered piece of the assembled paper, in reading order. Drafter regions carry the
 * RenderedDraft that produced them; software-only parts carry text alone. */
export interface PaperPart {region:ReadableRegion;text:string;draft?:RenderedDraft}
export function partText(p:PaperPart):string {requireThat(typeof p.text==='string'&&(!p.draft||p.draft.text===p.text),'paper part text differs from its rendered draft');return p.text;}
/** Design 9: about ten inline definitions per paper. A caller may set a stricter limit, never a looser one. */
export const GLOSSARY_INLINE_LIMIT=10;
export interface InlineUse {id:string;region:ReadableRegion;sentenceId:string}
export function inlineGlossaryUse(parts:readonly PaperPart[],terms:TermRegistry,limit=GLOSSARY_INLINE_LIMIT):InlineUse[] {
 assertTermRegistry(terms);
 requireThat(Number.isSafeInteger(limit)&&limit>=1&&limit<=GLOSSARY_INLINE_LIMIT,'inline glossary limit must be between one and the design limit of ten');
 const uses:InlineUse[]=[];
 for(const p of parts){partText(p);for(const s of p.draft?.sentences??[])for(const f of s.orderedFacts)if(f.key.startsWith('g:'))uses.push({id:f.key.slice(2),region:p.region,sentenceId:s.id});}
 requireThat(new Set(uses.map(u=>u.id)).size===uses.length,'glossary term defined more than once');
 requireThat(uses.length<=limit,`more than ${limit} inline glossary terms`);
 for(const u of uses){requireThat((GLOSSARY_REGIONS as readonly string[]).includes(u.region),'inline glossary definitions belong in the technical body');requireThat(termEntry(terms,u.id).class==='field','only field-specific terms are defined inline');}
 // The inline definition must be the term's first appearance in the technical body.
 for(const u of uses){
  const t=termEntry(terms,u.id);let before='';
  for(const p of parts){
   if(!(BODY_REGIONS as readonly string[]).includes(p.region))continue;
   const index=p.draft?.sentences.findIndex(s=>s.id===u.sentenceId&&s.orderedFacts.some(f=>f.key===`g:${u.id}`))??-1;
   if(index>=0){before+=' '+p.draft!.sentences.slice(0,index).map(s=>s.text).join(' ');break;}
   before+=' '+p.text;
  }
  requireThat(!mentionsTerm(before,t,terms),`glossary term ${u.id} is used before its inline definition`);
 }
 return uses;
}
/** Regions of the technical body, in which inline definitions apply to later text. */
export const BODY_REGIONS:readonly ReadableRegion[]=Object.freeze(['introduction','background','methods','results','discussion','limitations','caption','alt','conclusion']);
