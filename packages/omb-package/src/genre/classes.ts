import { readFileSync } from 'node:fs';
import { canonicalSha256 } from '../common.ts';
import type { Entry } from './types.ts';
const policy=JSON.parse(readFileSync(new URL('../../genre-rule-classes.json',import.meta.url),'utf8')) as {standardRules:string[];standardSectionIds:string[];standardDisplayIds:string[]};
export const RULE_CLASS_POLICY_HASH=canonicalSha256(policy);
export function ruleClass(rule:string,target:string,entry?:Entry):'CONVENTION'|'AMANI-STANDARD' {
 if(entry?.basis==='guideline'||policy.standardRules.includes(rule))return 'AMANI-STANDARD';
 const section=target.match(/^sections\[([^\]]+)\]/)?.[1],display=target.match(/^display_items\[([^\]]+)\]/)?.[1];
 if(section&&policy.standardSectionIds.includes(section)||display&&policy.standardDisplayIds.includes(display))return 'AMANI-STANDARD';
 return 'CONVENTION';
}
