import type { RefusalRecord } from '../../omb-certify/src/source-policy.ts';
import path from 'node:path';
import { ruleFor, DEV_SIGNATURES } from './rules.ts';
export { DEV_SIGNATURES } from './rules.ts';

export function matchesSignatures(p:string,signatures:readonly string[]):boolean {
  if(!p || p.startsWith('/') || p.includes('\\') || /[*?\[\]]/.test(p) || p.split('/').some(x=>!x || x==='.' || x==='..')) return false;
  return signatures.some(signature=>path.matchesGlob(p.toLowerCase(),signature.toLowerCase()));
}
export function devPath(p:string):boolean {return matchesSignatures(p,DEV_SIGNATURES);}
export type Stage1 = {kind:'reject'} | {kind:'guard-error'} | {kind:'drop';paths:string[]} | {kind:'review'};
export function deterministicTriage(r:RefusalRecord,files:readonly string[],hardStop:string|null):Stage1 {
  if(hardStop || ruleFor(r.ruleId).tier==='hard-stop' || !r.repairable) return {kind:'reject'};
  if(r.decision==='guard-error') return {kind:'guard-error'};
  const offending=r.trigger.split(/:|\s/)[0] ?? '';
  const rule=ruleFor(r.ruleId);
  if(rule.allowedVerdicts.includes('false-alarm') && rule.allowedRemedies.includes('drop-dev-files') && r.phase==='pre-look' && matchesSignatures(offending,rule.knownFalseAlarmSignatures) && files.includes(offending)) return {kind:'drop',paths:[offending]};
  return {kind:'review'};
}
