import { readFileSync } from 'node:fs';
import { assert,canonicalJson,canonicalSha256 } from '../common.ts';
import type { Submission,VenueProfile } from '../types.ts';
import type { GenreDeclaration,LintInput,Pandoc,OwnerWaiverAction,SupplementItem } from './types.ts';
export const CHECKLIST_MAPPING=JSON.parse(readFileSync(new URL('../../genre-checklists.json',import.meta.url),'utf8')) as Record<string,string>;
export const checklistPath=(name:string)=>`checklists/${name.replace(/[^a-zA-Z0-9_-]/g,'-')}.json`;
/** Read only the PW0-authenticated locked plan. A drafter genre field has no effect.
 * Legacy paper_set string arrays intentionally produce the single P4 warning. */
export function lockedGenre(s:Submission):GenreDeclaration {
 const raw=s.input.lockedPlan.paperSet??s.input.lockedPlan.paper_set;
 const claims=(s.input.lockedPlan.claims??[]) as {id:string;kind:string}[];
 const claim_kinds=claims.filter(c=>s.manuscript.claimIds.includes(c.id)).map(c=>c.kind);
 if(raw===undefined)return {claim_kinds};
 assert(canonicalJson(raw)===canonicalJson(s.input.paperSet),'locked paper_set differs from PaperInput');
 const entries=Array.isArray(raw)?raw:[];
 const records=entries.filter(e=>e&&typeof e==='object'&&!Array.isArray(e)) as Record<string,unknown>[];
 if(!records.length)return {claim_kinds};
 const candidates=records.filter(e=>Array.isArray(e.claim_ids)&&canonicalJson([...e.claim_ids].sort())===canonicalJson([...s.manuscript.claimIds].sort())||e.id===s.input.plannedFound.primaryClaimId);
 const entry=candidates.length===1?candidates[0]:records.length===1?records[0]:undefined;
 assert(entry,'ambiguous paper_set genre selection; identify paper by claim_ids or primary claim id');
 assert(entry.genre===undefined||typeof entry.genre==='string','genre must be one slug');
 assert(entry.secondary_genres===undefined||Array.isArray(entry.secondary_genres)&&entry.secondary_genres.every(x=>typeof x==='string'),'secondary genres must be slugs');
 assert(entry.design_flags===undefined||entry.design_flags&&typeof entry.design_flags==='object'&&!Array.isArray(entry.design_flags)&&Object.values(entry.design_flags).every(v=>typeof v==='boolean'),'locked design flags must be boolean');
 assert(entry.study_variant===undefined||typeof entry.study_variant==='string','study variant must be a string');
 return {claim_kinds,...(entry.genre?{genre:entry.genre as string}:{}),...(entry.secondary_genres?{secondary_genres:entry.secondary_genres as string[]}:{}),...(entry.design_flags?{design_flags:entry.design_flags as Record<string,boolean>}:{}),...(entry.study_variant?{study_variant:entry.study_variant as string}:{})};
}
export function ownerActions(s:Submission):OwnerWaiverAction[] {return s.input.ownerDeclarations.filter(a=>a.action==='structure-waiver'&&a.evidence).map(a=>({receipt:canonicalSha256(a),actor:a.actor,action:'structure-waiver',at:a.at,waiver_hash:a.evidence!}));}
export function displayKind(s:Submission,id:string):string|undefined {const d=s.manuscript.displays.find(x=>x.id===id)!;return d.genreKind??(id==='summary-of-findings'?'results_table':id==='study-design'?(lockedGenre(s).genre==='ai-research-agent-methods'?'architecture_schematic':'study_design_schematic'):undefined);}
export function supplementManifest(s:Submission):SupplementItem[] {return [...s.manuscript.supplement.map(x=>({title:x.heading,path:`supplement.pdf#${x.id}`,...(x.genreItem?{genre_item:x.genreItem}:{})})),...s.manuscript.displays.filter(d=>d.placement==='supplement').map(d=>({title:d.title,caption:d.caption,path:`supplement.pdf#${d.kind==='figure'?'fig':'tab'}-${d.id}`,...(displayKind(s,d.id)?{kind:displayKind(s,d.id)!}:{})}))];}
export function structureInput(s:Submission,p:VenueProfile,ast:Pandoc,supplementAst:Pandoc,asOf:string):LintInput {return {ast,supplementAst,declaration:lockedGenre(s),venue:{id:p.id,summaryLayers:p.summaryLayers,displayCap:p.caps.displays,abstractFormat:'structured',limitationsPlacement:'top-level',...(p.id==='research-note'?{shortFormat:true,keptSections:['title','abstract','introduction','methods','results','discussion','limitations','data_availability','code_availability','references','supplement']}:{}),...(p.sectionOrder?{sectionOrder:p.sectionOrder}:{}),...(p.abstractHeadingFamily?{abstractHeadingFamily:p.abstractHeadingFamily}:{})},manifest:supplementManifest(s),checklists:Object.fromEntries(s.manuscript.checklists.map(c=>[checklistPath(c.name),c])),checklistMapping:CHECKLIST_MAPPING,limitations:s.manuscript.limitationsPartB??[],waivers:s.structureWaivers??[],ownerActions:ownerActions(s),ownerActor:s.owner.record.ownerActor,asOf};}
