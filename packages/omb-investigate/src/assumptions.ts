import type { PlanIssue } from './plan-check.ts';

/** Registry decisions are trusted; a planner's description is advisory evidence only. */
export interface MethodAssumption {
  id: string; assumption: string; mandatory?: boolean; diagnostic?: string;
  blocks?: readonly string[]; valid_alternatives?: readonly string[];
  default_rule?: { on_fail: readonly string[]; on_not_evaluable: 'not-estimable' };
}
export type AssumptionAction = { method: string; output: string } | { answer: 'inconclusive' | 'not-estimable' };
export interface AssumptionDecision {
  id: string; diagnostic: string; pass: AssumptionAction; fail: AssumptionAction; 'not-evaluable': AssumptionAction;
}
export interface LockedDecision {
  id: string; diagnostic: string; mandatory: boolean; blocks: string[];
  on_fail: string[]; on_not_evaluable: 'not-estimable';
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const ASSUMPTION_REPAIR = 'Registry decision rules are attached automatically. Plan prose is advisory; registry rules determine the official answer.';
/** No lexical plan gate. Kept as a compatibility API for callers. */
export function assumptionIssues(_record: unknown, _registry: readonly MethodAssumption[] = []): PlanIssue[] { return []; }

export function registryDecisionRules(record: unknown, registry: readonly MethodAssumption[]): LockedDecision[] {
  const shared = object(record) && object(record.sharedKnobs) ? record.sharedKnobs : {};
  const proposals = Array.isArray(shared.assumption_decisions) ? shared.assumption_decisions : [];
  return [...new Map(registry.map(a => [a.id,a])).values()].map(a => {
    const allowed = a.valid_alternatives ?? [];
    let alternatives = [...(a.default_rule?.on_fail ?? allowed)].filter(x=>allowed.includes(x));
    const matching = proposals.filter(p=>object(p) && p.id===a.id);
    // Only a unique, registry-bound choice can tighten the default. Everything else is advisory.
    const p = matching.length===1 && object(matching[0]) ? matching[0] : null;
    if (p && object(p.fail)) {
      if (p.fail.answer==='inconclusive' || p.fail.answer==='not-estimable') alternatives=[];
      else if (p.diagnostic===a.diagnostic && typeof p.fail.output==='string' && alternatives.includes(p.fail.output)) alternatives=[p.fail.output];
    }
    return {id:a.id,diagnostic:a.diagnostic??a.id,mandatory:a.mandatory!==false,blocks:[...a.blocks??[]],
      on_fail:alternatives,on_not_evaluable:'not-estimable'};
  });
}

/** Broad triage deliberately avoids deciding scientific validity from vocabulary.
 * All declared decisions and assumption-related text, including array strings and keys,
 * go to the reviewer. False-positive triage cannot stop a lock or change an answer. */
export function assumptionAdvisories(record: unknown): PlanIssue[] {
  const out: PlanIssue[]=[];
  const related=/assum|single.causal|\b(?:ph|cox|coloc|abf)\b|signal|homogeneity|normality|proportional.hazard/i;
  const walk=(v:unknown,at:string)=>{
    if(typeof v==='string') { if(related.test(v))out.push({code:'assumption-advisory',path:at,evidence:v.slice(0,1000),message:'Assumption-related plan text requires advisory review; registry decisions take precedence.'});return; }
    if(Array.isArray(v)){v.forEach((x,i)=>walk(x,`${at}[${i}]`));return;}
    if(!object(v))return;
    for(const [k,x] of Object.entries(v)) {
      if(k==='registry_decisions')continue;
      if(k==='assumption_decisions') {out.push({code:'assumption-decision-advisory',path:`${at}.${k}`,evidence:JSON.stringify(x).slice(0,1000),message:'Planner decisions may only narrow registry alternatives; unbound or weaker choices are ignored.'});continue;}
      if(related.test(k))out.push({code:'assumption-advisory',path:`${at}.${k}`,message:'Registry rule takes precedence over this plan declaration.'});
      walk(x,`${at}.${k}`);
    }
  };
  walk(record,'$');return out;
}
