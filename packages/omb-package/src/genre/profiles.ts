import { readFileSync,existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../common.ts';
import type { LoadedProfile,Profile } from './types.ts';
export const GENRE_ROOT=fileURLToPath(new URL('../../genres/',import.meta.url));
export const PINS=JSON.parse(readFileSync(new URL('../../genre-pins.json',import.meta.url),'utf8')).profiles as Record<string,string>;
export const FLAGS=['systematic_search','ipd','network_ma','multi_instrument','proteome_wide','drug_selectivity_claim','new_wet_lab_data'];
export const SECTION_IDS='title abstract key_points plain_summary introduction methods results results_discussion discussion limitations conclusions data_availability code_availability ethics funding competing_interests contributions acknowledgements ai_disclosure registration references supplement other'.split(' ');
const ok=(yes:unknown,where:string)=>{if(!yes)throw Error(`P1: invalid genre profile: ${where}`);};
const obj=(v:any,w:string)=>{ok(v&&typeof v==='object'&&!Array.isArray(v),w);return v;};
const str=(v:any,w:string)=>ok(typeof v==='string',w);
const arr=(v:any,w:string)=>{ok(Array.isArray(v),w);return v as any[];};
const strings=(v:any,w:string)=>arr(v,w).forEach(x=>str(x,w));
const unique=(xs:any[],w:string)=>ok(new Set(xs).size===xs.length,w);
function range(v:any,w:string,nullable=false){if(v===null&&nullable)return;obj(v,w);for(const k of ['min','typical','max'])ok(typeof v[k]==='number'&&Number.isFinite(v[k])&&v[k]>=0,`${w}.${k}`);ok(v.min<=v.typical&&v.typical<=v.max,w);}
function patterns(v:any,w:string){for(const p of arr(v,w)){str(p,w);ok(!/\(\?[a-z-]|\(\?<|\\Z|(?:[+*?]|\})\+/.test(p),`${w}: incompatible regex dialect`);try{new RegExp(p,'i');}catch{ok(false,`${w}: invalid regex`);}}}
function entry(v:any,w:string){obj(v,w);ok(['required','typical','optional'].includes(v.level),`${w}.level`);ok(['frequency','guideline','both'].includes(v.basis),`${w}.basis`);ok(v.level==='required'||v.basis==='frequency',`${w}.basis/level`);if(v.applies_when!==undefined)ok(FLAGS.includes(v.applies_when),`${w}.applies_when`);if(v.venue_governed!==undefined)ok(typeof v.venue_governed==='boolean',`${w}.venue_governed`);}
export function validateProfile(value:unknown,slug:string):asserts value is Profile {
 const p=obj(value,'root');ok(p.schema_version==='genre-profile/1','schema_version');ok(p.genre===slug,'genre slug');
 for(const k of ['genre','genre_name','scope','built_on','word_count_convention','variation_notes'])str(p[k],k);
 ok(/^\d{4}-\d{2}-\d{2}$/.test(p.built_on)&&Number.isFinite(Date.parse(p.built_on)),'built_on');
 for(const k of ['lint_notes','notes'])strings(p[k],k);
 const ex=arr(p.exemplars,'exemplars');ok(ex.length>=6&&ex.length<=10,'exemplar count');unique(ex.map(e=>e.id),'exemplar ids');unique(ex.map(e=>e.doi.toLowerCase()),'exemplar dois');
 for(const e of ex){for(const k of ['id','citation','doi','url','licence','journal','disease_area','measurement_method']){str(e[k],k);ok(e[k].length>0,k);}ok(/^10\./.test(e.doi),'bare DOI');ok(Number.isInteger(e.year)&&e.year>=2022&&e.year<=2026,'exemplar year');ok(!/osteoarthrit|arthrit|arthropath|joint (disease|replacement|pain)|\bknee\b|\bhip (pain|fracture)|\bgout\b|spondyl|cartilage|amyotrophic|\bALS\b|motor neuron|neurofilament|\bNfL\b|pancrea/i.test(e.citation+' '+e.disease_area),'contamination');obj(e.measured,'measured');for(const k of ['main_text_words','figures_main','tables_main','references'])ok(Number.isFinite(e.measured[k]),`measured.${k}`);}
 const sections=arr(p.sections,'sections');unique(sections.map(s=>s.order),'section orders');unique(sections.map(s=>s.id),'section ids');
 const elements=(es:any,w:string)=>{for(const e of arr(es,w)){entry(e,w);str(e.id,w);str(e.description,w);patterns(e.detect,w);}};
 for(const s of sections){entry(s,s.id);ok(SECTION_IDS.includes(s.id),'section vocabulary');str(s.heading,'heading');strings(s.aliases,'aliases');ok(Number.isInteger(s.order),'section order');range(s.words,s.id,true);for(const sub of arr(s.subsections,'subsections')){entry(sub,'subsection');str(sub.heading,'heading');strings(sub.aliases,'aliases');patterns(sub.aliases_regex,'aliases_regex');range(sub.words,'subsection words',true);}elements(s.elements,'elements');if(['plain_summary','key_points'].includes(s.id))ok(s.venue_governed===true,'venue governed summary');}
 for(const v of arr(p.section_order_variants,'section_order_variants')){str(v.name,'variant name');strings(v.order,'order');ok(v.order.every((id:string)=>SECTION_IDS.includes(id)),'variant ids');strings(v.seen_in,'seen_in');ok(v.seen_in.every((id:string)=>ex.some(e=>e.id===id)),'variant exemplar');}
 range(p.main_text_words,'main_text_words');strings(p.main_text_words.counted,'counted');ok(typeof p.main_text_words.methods_counted==='boolean','methods_counted');str(p.main_text_words.notes,'main notes');
 const ab=obj(p.abstract,'abstract');ok(['structured','unstructured','either'].includes(ab.format),'abstract format');range(ab.words,'abstract words');elements(ab.elements,'abstract elements');arr(ab.extra_summaries,'extra_summaries');ok(ab.checklist===null||typeof ab.checklist==='string','abstract checklist');for(const h of arr(ab.heading_sets,'heading_sets')){str(h.family,'family');strings(h.headings,'headings');strings(h.seen_in,'seen_in');ok(h.seen_in.every((id:string)=>ex.some(e=>e.id===id)),'abstract exemplar');}
 const ds=arr(p.display_items,'display_items');unique(ds.map(d=>d.id),'display ids');unique(ds.map(d=>d.priority),'priorities');for(const d of ds){entry(d,d.id);str(d.id,'display id');str(d.kind,'kind');ok(['figure','table','box'].includes(d.type),'display type');ok(['main','main-or-supplement','supplement'].includes(d.placement),'placement');ok(Number.isInteger(d.priority),'priority');range(d.count,'count');patterns(d.detect,'display detect');if(['key_points_box','highlights_box'].includes(d.id))ok(d.venue_governed===true,'venue governed box');}
 range(p.display_items_main_total,'display total');
 for(const s of arr(p.required_statements,'statements')){entry(s,s.id);str(s.id,'statement id');str(s.label,'statement label');patterns(s.detect,'statement detect');strings(s.placement,'statement placement');ok(s.placement.every((id:string)=>[...SECTION_IDS,'back_matter','title_page','cover_letter','figure_legend'].includes(id)),'statement placement');}
 for(const c of arr(p.checklists,'checklists')){entry(c,c.name);for(const k of ['name','citation','where'])str(c[k],k);ok(c.doi===null||typeof c.doi==='string','checklist doi');ok(['reporting_guideline','appraisal_tool','methods_guidance','venue_form','venue_policy','none'].includes(c.kind),'checklist kind');}
 const sup=arr(p.supplement,'supplement');unique(sup.map(s=>s.id),'supplement ids');for(const s of sup){entry(s,s.id);str(s.id,'supplement id');str(s.item,'supplement item');patterns(s.detect,'supplement detect');ok(s.detect.length>0,'supplement detect empty');}
 range(p.references,'references');const lim=obj(p.limitations,'limitations');str(lim.placement,'limitations placement');strings(lim.conventions,'conventions');range(lim.words,'limitations words',true);const slots=arr(lim.standard_items,'standard_items');ok(slots.length>0,'limitation slots');unique(slots.map(s=>s.id),'limitation ids');for(const s of slots){entry(s,s.id);str(s.id,'limitation id');str(s.text,'limitation text');}
}
export function loadProfile(slug:string,root=GENRE_ROOT):LoadedProfile|null {
 if(!Object.hasOwn(PINS,slug))return null;
 const file=path.join(root,slug+'.json');if(!existsSync(file))throw Error(`P1: missing profile ${slug}`);
 try{const bytes=readFileSync(file),profile:unknown=JSON.parse(bytes.toString());validateProfile(profile,slug);const hash=sha256(bytes);if(hash!==PINS[slug])throw Error('profile differs from pinned source');return {profile,sha256:hash};}catch(e){throw Error(`P1: ${String(e)}`);}
}
