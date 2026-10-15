import {redactedOutput} from './output-redaction.ts';
import {canonicalSha256} from '../../bio-core/src/index.ts';
import type {Plan} from '../../omb-gauntlet/src/plan.ts';
import type {Json} from '../../omb-investigate/src/types.ts';
import type {MetaAnalysisInput} from '../../omb-procedures/src/meta-analysis.ts';
import type {SurrogacyInput} from '../../omb-procedures/src/surrogacy.ts';
import type {DiagnosticTransport} from './diagnostic-transport.ts';
import {tiercPlanSpecs,readTiercInput} from './tierc-plan.ts';
import {procedureIntegrityFacts} from './procedure-integrity.ts';
import {certifyMetaAnalysis,certifySurrogacy,TIERC_REGISTRATIONS} from './tierc.ts';
export function transportTierc(out:DiagnosticTransport,plan:Plan,rawDir:string,verified:boolean):void {
 for(const s of tiercPlanSpecs(plan.sharedKnobs)){
 const registration=TIERC_REGISTRATIONS[s.kind],prefix=(f:string)=>`${s.id}.${f}`,main=s.kind==='adverse-events'?'ae.primary':'surrogacy.validated';
 for(const id of s.claim_ids)out.claimSources[id]=[prefix(main),prefix(s.kind==='adverse-events'?'ae.inference':'surrogacy.inference')];
 try {if(!verified)throw new Error('Tier C requires verified pre-look plan and input binding');if(s.claim_ids.some(id=>!plan.claims.some(c=>c.id===id)))throw new Error('unknown linked claim');
 const {trials,source}=readTiercInput(rawDir,s),rules=plan.sharedKnobs?.registry_decisions,narrow=Array.isArray(rules)?rules as unknown as {id:string;on_fail:string[]}[]:undefined;
 const certified=s.kind==='adverse-events'?certifyMetaAnalysis({...s.settings,trials} as MetaAnalysisInput,narrow):certifySurrogacy({...s.settings,trials} as SurrogacyInput,narrow);
 for(const [key,value] of Object.entries(certified.official))out.outputs[prefix(key)]=value as Json;
 // Retain a commitment for computed-but-blocked fields; audit values never cross transport.
 for(const d of certified.diagnostics)if(d.status==='fail'||d.status!=='pass'&&d.mandatory!==false)for(const field of d.blocks){
  const value=(certified.audit as unknown as Record<string,unknown>)[field.split('.')[1]!],key=prefix(field);
  if(value!==undefined&&!Object.hasOwn(out.outputs,key))out.outputs[key]=redactedOutput(key,value,`${s.id}:${d.id}`);
 }
 out.diagnostics.push(...certified.diagnostics.map(d=>({...d,id:`${s.id}:${d.id}`,blocks:d.blocks.map(prefix),valid_alternatives:d.valid_alternatives.map(prefix)})));
 for(const field of registration.outputFields){const name=field.split('.')[1]!,fallback=(field==='surrogacy.regression'||field==='surrogacy.r2')&&'selectedFields' in certified?(certified.selectedFields[field==='surrogacy.regression'?'regression':'r2']??field):field==='ae.primary'&&'selectedPrimary' in certified?certified.selectedPrimary??field:field,source=prefix(fallback),at=`${s.report_path}/${name}`;out.reportBindings[at]={source,value:field==='ae.primary'&&'selectedPrimary' in certified&&certified.selectedPrimary===null?null:certified.official[fallback] as Json??null};out.fieldSources[`report:${at}`]=[source];out.fieldSources[`output:task-results.json#${at}`]=[source];}
 out.dataSummaries[s.id]={procedure:certified.procedure,inputHash:certified.inputHash,registryHash:certified.registryHash,planSettingsHash:canonicalSha256(s),independentTrials:trials.length,guarantee:certified.guarantee};
 // Registry-declared integrity facts, hash-bound to the Tier C certificate that covers their value.
 if(certified.audit.status==='ok')out.integrityFacts.push(...procedureIntegrityFacts(s.kind,s.id,certified.official,source,{inputHash:certified.inputHash,planSettingsHash:canonicalSha256(s),certificate:canonicalSha256({official:certified.official,inputHash:certified.inputHash,registryHash:certified.registryHash})}));
 }catch(error){const fields=registration.outputFields.map(prefix);out.diagnostics.push({id:`${s.id}:tierc.input-validity`,mandatory:true,assumption:'locked readable valid trial inputs',status:'not-evaluable',blocks:fields,valid_alternatives:[],detail:String(error)});for(const field of registration.outputFields){const at=`${s.report_path}/${field.split('.')[1]}`;out.reportBindings[at]={source:prefix(field),value:null};out.fieldSources[`report:${at}`]=[prefix(field)];out.fieldSources[`output:task-results.json#${at}`]=[prefix(field)];}}
 }
}
