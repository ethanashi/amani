import path from 'node:path';
import { readPhysical } from '../../omb-investigate/src/physical-format.ts';
import { numericalValidity, declaredNonEstimability, type NumericalDiagnostic } from '../../omb-procedures/src/numerical-validity.ts';
import type { Plan } from '../../omb-gauntlet/src/plan.ts';
import type { Execution } from './execution.ts';
const obj=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const parse=(s:string|undefined):any=>{try{return JSON.parse(s??'null');}catch{return null;}};
export interface ScientificOutcome extends NumericalDiagnostic { source:'host-numerical-validity'|'frozen-analysis-diagnostic' }
/** Runs on successful, repeated frozen executions only. A crash never becomes abstention.
 * Worker assertions are explicitly attributed, never elevated to an authenticated G1 fact. */
export function scientificOutcomes(plan:Plan,rawDir:string,first:Execution,rerun:Execution):Record<string,ScientificOutcome> {
 if(first.status!=='ok'||rerun.status!=='ok'||!first.effectiveInputsVerified||!rerun.effectiveInputsVerified)return {};
 const a=parse(first.files['primary.json']),b=parse(rerun.files['primary.json']);
 const ta=parse(first.files['task-results.json'])??a?.task_result,tb=parse(rerun.files['task-results.json'])??b?.task_result;
 const result:Record<string,ScientificOutcome>={};
 for(const claim of plan.claims){
  let host:NumericalDiagnostic|null=null;
  const table=claim.knobs.table;
  if(typeof table==='string'&&!path.isAbsolute(table)&&!table.split('/').includes('..'))try{
   const t=readPhysical(path.join(rawDir,table.split('::')[0]!),table.split('::')[0]!).find(t=>t.file===table);
   if(t&&claim.outcome&&claim.kind!=='data-integrity'){
    const yi=t.header.indexOf(claim.outcome),xi=claim.exposure?t.header.indexOf(claim.exposure):-1;
    if(yi<0)host={status:'non-estimable',reason:'missing-endpoint',detail:`locked endpoint column ${claim.outcome} is absent from ${table}`};
    else if(xi>=0){
     const cols=[xi,...claim.adjustment.map(c=>t.header.indexOf(c))];
     const rows=t.rows.filter(r=>[yi,...cols].every(j=>j>=0&&r[j]?.trim()!==''&&!/^(NA|NaN|null)$/i.test(r[j]!)));
     const y=rows.map(r=>Number(r[yi])),groups=rows.map(r=>r[xi]!);
     const categories=[...new Set(groups)];
     const design=rows.map(r=>[1,...cols.map(j=>j===xi&&categories.length===2?categories.indexOf(r[j]!):Number(r[j]))]);
     const method=[claim.estimand,claim.test].join(' ');
     const ordinary=!/penalized|firth|ridge|lasso|regularized/i.test(method.replace(/unpenalized/gi,''));
     const logistic=ordinary&&/logistic|logit|log.odds/i.test(method);
     const linear=ordinary&&/\bOLS\b|linear.regression|ordinary.least.squares/i.test(method);
     // Rank and separation conditions for an ordinary regression do not
     // establish non-estimability for regularized or unrelated estimands.
     if((logistic||linear)&&y.every(Number.isFinite)&&design.flat().every(Number.isFinite))host=numericalValidity({model:logistic?'logistic':'linear',y,design,...(logistic&&categories.length===2?{groups}:{})});
    }
   }
  }catch{/* Unsupported input is not evidence of non-estimability. */}
  if(host){result[claim.id]={...host,source:'host-numerical-validity'};continue;}
  const left=declaredNonEstimability(a?.claims?.[claim.id]),right=declaredNonEstimability(b?.claims?.[claim.id]);
  if(left&&right&&left.reason===right.reason){result[claim.id]={...left,source:'frozen-analysis-diagnostic'};continue;}
  // An explicit missing-endpoint task outcome is scientific withholding, not a G1 assertion.
  const l=declaredNonEstimability(ta),r=declaredNonEstimability(tb);
  if(l?.reason==='missing-endpoint'&&r?.reason===l.reason&&obj(ta)&&obj(tb)&&ta.endpoint_available===false&&tb.endpoint_available===false)
   result[claim.id]={...l,source:'frozen-analysis-diagnostic'};
 }
 return result;
}
