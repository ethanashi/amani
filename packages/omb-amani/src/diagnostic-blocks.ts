import type { Evidence, Json } from './results.ts';
import type { CertifyResult } from '../../omb-investigate/src/ports.ts';
import { enforceDiagnostics, type DiagnosticIntegrity } from '../../omb-investigate/src/diagnostics.ts';
export interface DiagnosticEvidence {
 diagnosticIntegrity?:DiagnosticIntegrity;
 fieldSources?:Record<string,string[]>;
 reportBindings?:Record<string,{source:string;value:Json}>;
}
const overlaps=(a:string,b:string)=>a===b||a.startsWith(b+'.')||b.startsWith(a+'.');
/** Runs before draft resolution and frozen fallback can publish a field. */
export function diagnosticField(at:string,draft:Json|undefined,evidence:Evidence):{value:Json;source:string;issue?:string}|null {
 const blocks=evidence.diagnosticIntegrity?.blocked.flatMap(d=>d.blocks)??[];
 const invalid=(key:string,seen=new Set<string>()):boolean=>blocks.some(b=>overlaps(key,b))||seen.has(key)||(evidence.fieldSources?.[key]??[]).some(s=>s!==key&&invalid(s,new Set([...seen,key])));
 const binding=evidence.reportBindings?.[at];
 // Host bindings name already-guarded alternatives, never raw worker output.
 if(binding && !invalid(binding.source))return {value:binding.value,source:`certified:${binding.source}`};
 const ref=draft&&typeof draft==='object'&&!Array.isArray(draft)?draft:null;
 const selected=typeof ref?.$metric==='string'?ref.$metric:typeof ref?.$output==='string'&&typeof ref.pointer==='string'?`output:${ref.$output}#${ref.pointer}`:null;
 if(invalid(`report:${at}`)||invalid(`output:task-results.json#${at}`)||selected&&invalid(selected)||binding)
   return {value:null,source:'diagnostic:withheld',issue:'trusted diagnostic blocks this field; no computed allowed alternative'};
 // Posterior result fields are reserved for the trusted coloc procedure, including replay
 // without an interpret turn or without any worker-declared coloc claim.
 if(/\/(?:coloc|colocalisation|colocalization)(?:\/|$)/i.test(at)&&/\/(?:pp_h[0-4]|verdict|method)$/.test(at))
   return {value:null,source:'diagnostic:withheld',issue:'coloc field requires a locked trusted procedure binding'};
 if(/\/(?:surrogacy|surrogate_evaluation|adverse_events|adverse-events|meta_analysis|meta-analysis)(?:\/|$)/i.test(at)&&/\/(?:primary|r2|regression|robustR2|robustRegression|ste|validated|classification|inference)$/.test(at))
   return {value:null,source:'diagnostic:withheld',issue:'Tier C result field requires a locked trusted procedure binding'};
 return null;
}
/** Capture the guarded port, not pre-guard metrics. Also redact frozen aliases before
 * the interpret packet is constructed, keeping unrelated fields available. */
export function certifiedEvidence(prior:Evidence,raw:CertifyResult):Evidence {
 const c=enforceDiagnostics(raw);
 const evidence:Evidence={...prior,metrics:c.metrics,claims:c.claims,outputs:{...prior.outputs,...c.outputs},
   ...(c.diagnosticIntegrity?{diagnosticIntegrity:c.diagnosticIntegrity}:{}),...(c.fieldSources?{fieldSources:c.fieldSources}:{}),...(c.reportBindings?{reportBindings:c.reportBindings}:{}),
   // Copy each fact's certified output from the enforced result: a blocked output cannot back a fact.
   ...(c.integrityFacts?{procedureIntegrity:{facts:c.integrityFacts as unknown as Json[],outputs:Object.fromEntries(c.integrityFacts.flatMap(f=>c.outputs&&Object.hasOwn(c.outputs,f.output)?[[f.output,c.outputs[f.output]!]]:[]))}}:{})};
 const redact=(v:Json,at:string):Json=>{
   const guarded=diagnosticField(at,undefined,evidence);if(guarded)return guarded.value;
   if(Array.isArray(v))return v.map((x,i)=>redact(x,`${at}/${i}`));
   if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,redact(x,`${at}/${k.replace(/~/g,'~0').replace(/\//g,'~1')}`)]));
   return v;
 };
 if(evidence.outputs['task-results.json'])evidence.outputs['task-results.json']=redact(evidence.outputs['task-results.json'],'');
 return evidence;
}

/** An absent interpret turn must not erase independent categorical task results.
 * The normal resolver still checks membership and rejects certification labels. */
export function recoverDiagnosticDraft(template:Json,draft:Json|undefined,evidence:Evidence):Json {
 if(!evidence.diagnosticIntegrity?.blocked.length)return draft??null;
 const object=(v:Json|undefined):v is Record<string,Json>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const walk=(t:Json,d:Json|undefined,f:Json|undefined):Json=>{
   if(object(t))return Object.fromEntries(Object.entries(t).map(([k,v])=>[k,walk(v,object(d)?d[k]:undefined,object(f)?f[k]:undefined)]));
   if(d!==undefined&&d!==null)return d;
   if(typeof t==='string'&&t.includes(' | ')&&typeof f==='string'&&t.split(/\s*\|\s*/).includes(f)&&!['confirmed','replicated','passed'].includes(f))return f;
   return d??null;
 };
 return walk(template,draft,evidence.outputs['task-results.json']);
}
