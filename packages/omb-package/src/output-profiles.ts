import { readFileSync } from 'node:fs';
import { assert } from './common.ts';
import type { Submission,VenueProfile } from './types.ts';
export type OutputProfileId='preprint'|'preprint-two-column'|'arxiv-source'|'journal-review';
export interface OutputProfile {id:OutputProfileId;name:string;engine:'tectonic'|'chromium';columns:1|2;fontSizePt:number;fontFamily:string;marginInches:number;lineNumbers:boolean;doubleSpacing:boolean;watermark:boolean;marginNotes:boolean;sourceArchive:boolean}
export function validateOutputProfile(p:OutputProfile,venue:VenueProfile):void {
 assert(['preprint','preprint-two-column','arxiv-source','journal-review'].includes(p.id),'unknown output profile');
 assert([1,2].includes(p.columns)&&p.marginInches>=1&&p.fontSizePt>=10&&p.fontSizePt<=14,'output font/margin/column policy');
 assert(p.id!=='preprint'||p.columns===1,'default preprint requires one column');
 assert(p.id!=='preprint-two-column'||p.columns===2,'reading preprint requires two columns');
 assert(!p.watermark&&!p.marginNotes,'watermarks and margin notes are forbidden');
 if(p.id==='journal-review')assert(p.engine==='chromium'&&p.columns===1&&p.lineNumbers&&p.doubleSpacing&&venue.defaultOutputProfile==='journal-review','review format requires a journal review venue');
 else assert(p.engine==='tectonic'&&!p.lineNumbers&&!p.doubleSpacing&&p.fontFamily==='Source Serif 4','preprint/arXiv must be single-spaced LaTeX without line numbers');
 assert(p.sourceArchive===(p.id==='arxiv-source'),'arXiv source archive required');
}
export function outputProfile(s:Submission,venue:VenueProfile):OutputProfile {
 const id=s.outputProfile??venue.defaultOutputProfile;
 assert(['preprint','preprint-two-column','arxiv-source','journal-review'].includes(id),'unknown output profile');
 const p=JSON.parse(readFileSync(new URL(`../output-profiles/${id}.json`,import.meta.url),'utf8')) as OutputProfile;
 validateOutputProfile(p,venue);return p;
}
