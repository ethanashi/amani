import { readFileSync } from 'node:fs';
import type { StudyKind, VenueId, VenueProfile } from './types.ts';
import { assert } from './common.ts';
export const STUDY_CHECKLISTS: Record<StudyKind, string[]> = {
  'out-of-sample': ['TRIPOD+AI','TRIPOD+AI Abstracts','DOME','REFORMS'],
  diagnostic: ['STARD 2015','STARD-AI'], prognostic: ['REMARK'],
  'causal-genetic': ['STROBE-MR'], observational: ['STROBE','STREGA','RECORD'],
  'data-integrity': ['Amani data-integrity'], reproduction: ['Original-study guideline'],
  synthesis: ['PRISMA 2020','PRISMA-trAIce'],
};
export const STUDY_PIECES: Record<StudyKind, string[]> = {
  'out-of-sample': ['split-counts','calibration','decision-curves','subgroup-table','sample-size','model-card'],
  diagnostic: ['threshold-table','alternative-diagnoses'], prognostic:['marker-model'],
  'causal-genetic':['assumptions','variants','mr-plots','sample-overlap','controls','instruments'],
  observational:['adjusted-estimates','covariate-reasons','e-value'],
  'data-integrity':['integrity-explanations'], reproduction:['published-vs-recomputed'],
  synthesis:['queries','search-flow'],
};
export function venueProfile(id: VenueId = 'preprint'): VenueProfile {
  assert(['preprint','plos-one','research-note'].includes(id), 'unsupported venue (Frontiers excluded)');
  return JSON.parse(readFileSync(new URL(`../profiles/${id}.json`,import.meta.url),'utf8')) as VenueProfile;
}
export function requiredChecklists(profile: VenueProfile, kinds: StudyKind[]): string[] {
  return [...new Set([...profile.checklists,...kinds.flatMap(k=>{assert(k in STUDY_CHECKLISTS,'unknown study kind');return STUDY_CHECKLISTS[k];})])];
}
