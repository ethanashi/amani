import { readFileSync } from 'node:fs';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { record, requireThat } from '../../omb-report/src/index.ts';
import type { VenueProfile } from './manuscript.ts';
export interface GenreWords { min:number; typical:number; max:number }
export interface GenreSection { id:string; level:string; words:GenreWords|null; elements:{id:string;level:string}[] }
/** Validated projection of genre-profile/1. Descriptive fields and detector regexes
 * are not executable configuration; required elements need host evidence receipts. */
export interface GenreProfile { schema_version:'genre-profile/1'; genre:string; sections:GenreSection[]; sourceHash:string }
export function loadGenreProfile(file:string):GenreProfile {
 const raw=JSON.parse(readFileSync(file,'utf8')),r=record(raw);
 requireThat(r.schema_version==='genre-profile/1'&&typeof r.genre==='string'&&/^[a-z0-9-]+$/u.test(r.genre),'invalid genre schema');
 requireThat(Array.isArray(r.sections)&&r.sections.length>0,'missing genre sections');
 const sections=r.sections.map(value=>{
  const s=record(value);requireThat(typeof s.id==='string'&&s.id.length>0&&['required','typical','optional'].includes(String(s.level)),'invalid genre section');
  const words=s.words===null?null:record(s.words) as unknown as GenreWords;
  if(words)requireThat([words.min,words.typical,words.max].every(n=>Number.isSafeInteger(n)&&n>=0)&&words.min<=words.typical&&words.typical<=words.max,'invalid genre word range');
  requireThat(Array.isArray(s.elements),'invalid genre elements');
  const elements=s.elements.map(value=>{const e=record(value);requireThat(typeof e.id==='string'&&e.id.length>0&&['required','typical','optional'].includes(String(e.level)),'invalid genre element');return {id:String(e.id),level:String(e.level)};});
  requireThat(new Set(elements.map(e=>e.id)).size===elements.length,'duplicate genre element');
  return {id:String(s.id),level:String(s.level),words,elements};
 });
 requireThat(new Set(sections.map(s=>s.id)).size===sections.length,'duplicate genre section');
 return {schema_version:'genre-profile/1',genre:String(r.genre),sections,sourceHash:canonicalSha256(raw)};
}
export function withGenreProfile(base:VenueProfile,genre:GenreProfile):VenueProfile {
 requireThat(base.format==='research-article','article genre measurements cannot set short-format limits');
 const profile=structuredClone(base);profile.id+=`/${genre.genre}`;profile.genreHash=genre.sourceHash;
 for(const s of genre.sections)if(Object.hasOwn(profile.sectionMinimums,s.id)&&s.words){
  profile.sectionMinimums[s.id]=Math.max(profile.sectionMinimums[s.id]!,s.words.min);
  profile.sectionCaps[s.id]=Math.max(profile.sectionCaps[s.id]!,s.words.max);
 }
 profile.requiredPieces=[...base.requiredPieces,...genre.sections.flatMap(s=>s.elements.filter(e=>e.level==='required').map(e=>`genre:${s.id}:${e.id}`))];
 return profile;
}
