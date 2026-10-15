import {lexicalKey} from './normalise.ts';
/** Identity equality only; owner authentication determines who may author. */
export function nameKey(value:string):string {return lexicalKey(value).replace(/[^\p{L}\p{N}]/gu,'');}
