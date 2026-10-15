import { redactBlockedOutputs } from './output-redaction.ts';
import { transportTierc } from './tierc-transport.ts';
import { factLeaf, type ProcedureIntegrityFact } from './procedure-integrity.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { dosageLD } from '../../omb-procedures/src/coloc-ld.ts';
import { harmoniseColoc } from '../../omb-procedures/src/coloc-harmonise.ts';
import type { ProcedureDiagnostic, ProcedureResult } from '../../omb-procedures/src/types.ts';
import type { Plan } from '../../omb-gauntlet/src/plan.ts';
import { certifyColoc } from './certify.ts';
import { colocPlanSpecs, readColocInput } from './coloc-plan.ts';
import type { Json } from '../../omb-investigate/src/types.ts';
export interface DiagnosticTransport {
 diagnostics:ProcedureDiagnostic[]; outputs:Record<string,Json>; fieldSources:Record<string,string[]>; claimSources:Record<string,string[]>;
 reportBindings:Record<string,{source:string;value:Json}>; dataSummaries:Record<string,Json>;
 /** Registry-declared integrity facts certified by a procedure that ran on host-built input. */
 integrityFacts:ProcedureIntegrityFact[];
}
/** Host-only projection. claim links and qualified fields travel together through every port. */
export function diagnosticTransport(plan:Plan, rawDir:string, results:Record<string,ProcedureResult>, metrics:Readonly<Record<string,unknown>>, runColoc=true):DiagnosticTransport {
 const out:DiagnosticTransport={diagnostics:[],outputs:{},fieldSources:{},claimSources:{},reportBindings:{},dataSummaries:{},integrityFacts:[]};
 for(const c of plan.claims)out.claimSources[c.id]=[`claim:${c.id}`];
 for(const key of Object.keys(metrics))out.fieldSources[key]=[`claim:${plan.claims.find(c=>key.startsWith(c.id+'.'))?.id??key}`];
 for(const [id,r] of Object.entries(results)) {
   out.outputs[id]=JSON.parse(JSON.stringify(r)) as Json;
   out.claimSources[id]=[`${id}.estimate`,`${id}.p`,`${id}.ci`];
   for(const field of ['estimate','p','ci'])out.fieldSources[`${id}.${field}`]=[`input:${id}`];
   const claim=plan.claims.find(c=>c.id===id);
   for(const metric of Object.keys(metrics))for(const stem of [id,claim?.metric].filter((x):x is string=>typeof x==='string'))if(metric.startsWith(stem+'.')) {
     const field=metric.slice(stem.length+1);out.fieldSources[metric]=[`${id}.${field}`];
   }
   for(const d of r.diagnostics??[])out.diagnostics.push({...d,id:`${id}:${d.id}`,blocks:d.blocks.map(f=>`${id}.${f}`),valid_alternatives:d.valid_alternatives.map(f=>`${id}.${f}`)});
 }
 for(const spec of colocPlanSpecs(plan.sharedKnobs)) {
   try {
   if(!runColoc)throw new Error('coloc requires a verified pre-look plan and input binding');
   const input=readColocInput(rawDir,spec),rules=plan.sharedKnobs?.registry_decisions;
   const certified=certifyColoc(input,Array.isArray(rules)?rules as unknown as {id:string;on_fail:string[]}[]:undefined);
   const prefix=(key:string)=>`${spec.id}.${key}`;
   const qualifyRedactions=(value:Json):Json=>{
     if(Array.isArray(value))return value.map(qualifyRedactions);
     if(value && typeof value==='object') {
       if(value.redacted===true && typeof value.outputId==='string' && typeof value.blockingDiagnosticId==='string')return {...value,outputId:prefix(value.outputId),blockingDiagnosticId:`${spec.id}:${value.blockingDiagnosticId}`};
       return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,qualifyRedactions(v)]));
     }
     return value;
   };
   for(const [key,value] of Object.entries(certified.official))out.outputs[prefix(key)]=qualifyRedactions(JSON.parse(JSON.stringify(value)) as Json);
   out.diagnostics.push(...certified.diagnostics.map(d=>({...d,id:`${spec.id}:${d.id}`,blocks:d.blocks.map(prefix),valid_alternatives:d.valid_alternatives.map(prefix)})));
   // Bind aliases as well as claims. A failed coloc check cannot contaminate independent MR claims.
   for(const id of spec.claim_ids)out.claimSources[id]=[prefix('coloc.single')];
   const aligned=harmoniseColoc(input),ld=aligned.reference.ld??dosageLD(aligned.reference.dosages!);
   const instrument=aligned.exposure.find(v=>v.id.split(',').includes(spec.instrument));
   const idx=instrument?aligned.reference.ids.indexOf(instrument.id):-1;
   const pairs=certified.official['coloc.per_signal'] as {exposure_lead:string;outcome_lead:string;pp_h4:number|null;verdict:string}[]|undefined;
   const tagged=pairs?.filter(p=>{const i=aligned.reference.ids.indexOf(p.exposure_lead);return idx>=0&&i>=0&&ld[idx]![i]!**2>=.5;});
   const selected=tagged?.length===1?tagged[0]:undefined;
   const single=certified.official['coloc.single'] as {pp_h4:number;verdict:string}|undefined;
   const official=single??selected;
   const source=prefix(single?'coloc.single':'coloc.per_signal');
   for(const field of ['pp_h4','verdict'] as const) {
     const at=`${spec.report_path}/${field}`,value=official?.[field]??(field==='verdict'?'inconclusive':null);
     out.reportBindings[at]={source,value};
     out.fieldSources[`output:task-results.json#${at}`]=[prefix('coloc.single')];
     out.fieldSources[`report:${at}`]=[prefix('coloc.single')];
   }
   out.dataSummaries[spec.id]={procedure:certified.procedure,inputHash:certified.inputHash,planSettingsHash:canonicalSha256(spec),signal_counts:certified.audit.coloc.signal_counts,leads:certified.audit.coloc.leads,ld:certified.audit.coloc.ld_check as unknown as Json};
   }catch(error){
     const field=`${spec.id}.coloc.single`;
     out.diagnostics.push({id:`${spec.id}:coloc.input-validity`,mandatory:true,assumption:'locked readable harmonisable inputs',status:'not-evaluable',blocks:[field],valid_alternatives:[],detail:String(error)});
     for(const id of spec.claim_ids)out.claimSources[id]=[field];
     for(const name of ['pp_h4','verdict']){const at=`${spec.report_path}/${name}`;out.reportBindings[at]={source:field,value:null};out.fieldSources[`report:${at}`]=[field];out.fieldSources[`output:task-results.json#${at}`]=[field];}
   }
 }
 transportTierc(out,plan,rawDir,runColoc);
 out.outputs=redactBlockedOutputs(out.outputs,out.diagnostics) as Record<string,Json>;
 // A fact survives only while its certified output leaf is still published unredacted.
 out.integrityFacts=out.integrityFacts.filter(f=>factLeaf(out.outputs[f.output],f.pointer)===f.value);
 return out;
}
