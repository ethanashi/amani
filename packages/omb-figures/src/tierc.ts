import {summaryOfFindings} from './summary-of-findings.ts';
/** Host adapter: recompute from staged trial inputs, apply registry blocks, then sign PW3 records.
 * It accepts a previously authenticated claim context; it never promotes the claim's label. */
import {canonicalSha256} from '../../bio-core/src/index.ts';
import {certifyMetaAnalysis,certifySurrogacy} from '../../omb-certify/src/tierc.ts';
import type {MetaAnalysisInput,MetaAnalysisResult,MetaEstimate} from '../../omb-procedures/src/meta-analysis.ts';
import {surrogatePrediction,type SurrogacyInput,type SurrogacyResult,type WeightedFit} from '../../omb-procedures/src/surrogacy.ts';
import {HmacRecordAuthority,type CertifiedClaim,type CertifiedRecord,type CertifiedFact,type CertifiedSeries,type CertifiedEntity,type FactKind} from './port.ts';
import type {FigureSpec,ClaimResultsTableSpec} from './spec.ts';
export function tiercFigureBundle(kind:'adverse-events'|'trial-surrogacy',input:MetaAnalysisInput|SurrogacyInput,claim:CertifiedClaim,authority:HmacRecordAuthority){
 if(!authority.verify(claim))throw new Error('authenticated claim required');
 const cert=kind==='adverse-events'?certifyMetaAnalysis(input as MetaAnalysisInput):certifySurrogacy(input as SurrogacyInput),official=cert.official,certHash=canonicalSha256({official,inputHash:cert.inputHash,registryHash:cert.registryHash}),sourceRecordId=canonicalSha256(['tierc',cert.inputHash,cert.registryHash]),records:CertifiedRecord[]=[claim],figures:FigureSpec[]=[],tables:ClaimResultsTableSpec[]=[];
 const common={sourceRecordId,certHash,claimId:claim.id,grade:'kernel' as const,producerGate:cert.procedure,method:cert.procedure,unit:null};
 const scalar=(id:string,value:number,kind:FactKind)=>{if(!Number.isFinite(value))throw new Error('nonfinite Tier C figure datum');records.push(authority.sign<CertifiedFact>({...common,recordType:'fact',id,value,kind,deciding:'companion',ciLevel:kind==='ci'?.95:null}));return id;};
 const series=(id:string,values:number[],kind:FactKind)=>{records.push(authority.sign<CertifiedSeries>({...common,recordType:'series',id,values,kind,ciLevel:kind==='ci'?.95:null}));return id;};
 const entity=(id:string,text:string)=>{records.push(authority.sign<CertifiedEntity>({sourceRecordId,certHash,recordType:'entity',id,entityKind:'other',texts:[text]}));return `[e:${id}]`;};
 const caption={message:kind==='adverse-events'?'Trial effects.':'Trial-level association.'};
 if(kind==='adverse-events'){
 const m=(input as MetaAnalysisInput).measure;if(claim.scale!==(m==='RD'?'difference':'ratio')||claim.nullValue!==(m==='RD'?0:1))throw new Error('meta-analysis claim scale/null mismatch');
 const primary=('selectedPrimary' in cert&&cert.selectedPrimary?official[cert.selectedPrimary]:undefined) as MetaEstimate|undefined,forest=official['ae.forest'] as MetaAnalysisResult['forest']|undefined;
 if(primary&&forest){const factKind=m==='RD'?'difference':m==='OR'?'or':'rr';const row=(id:string,name:string,e:number,ci:[number,number])=>({label:entity(`${id}.name`,name),estimate:scalar(`${id}.estimate`,e,factKind),lower:scalar(`${id}.lower`,ci[0],'ci'),upper:scalar(`${id}.upper`,ci[1],'ci')});
 const rows=forest.filter(t=>t.estimate!==null&&t.ci!==null&&[t.estimate,...t.ci].every(Number.isFinite)).map((t,i)=>row(`ae.trial${i}`,t.id,t.estimate!,t.ci!));
 if([primary.estimate,...primary.ci].every(Number.isFinite)){const summary=row('ae.summary',primary.method,primary.estimate,primary.ci);rows.push(summary);tables.push({id:'ae-summary',kind:'claim-results',placement:'results',rows:[{...summary,claimId:claim.id,p:scalar('ae.summary.p',primary.p,'p'),n:scalar('ae.summary.k',primary.k,'count')}]});}
 if(rows.length)figures.push({kind:'forest',id:'ae-forest',placement:'results',caption,claimId:claim.id,rows});
 const funnel=official['ae.funnel'] as {effect:number;se:number}[]|undefined;if(funnel?.length&&Number.isFinite(primary.estimate)&&primary.estimate!==0)figures.push({kind:'funnel',id:'ae-funnel',placement:'results',caption,claimId:claim.id,effects:series('ae.funnel.effects',funnel.map(t=>t.effect),'effect'),standardErrors:series('ae.funnel.se',funnel.map(t=>t.se),'se'),center:scalar('ae.funnel.center',m==='RD'?primary.estimate:Math.log(primary.estimate),'effect')});
 }
 }else{
 const fit=('selectedFields' in cert&&cert.selectedFields.regression?official[cert.selectedFields.regression]:undefined) as WeightedFit|undefined,scatter=official['surrogacy.scatter'] as SurrogacyResult['scatter']|undefined;
 if(fit&&scatter){const range:[number,number]=[Math.min(...scatter.map(t=>t.surrogate)),Math.max(...scatter.map(t=>t.surrogate))],grid=Array.from({length:41},(_,i)=>range[0]+(range[1]-range[0])*i/40),band=grid.map(x=>surrogatePrediction(fit,x,fit.typicalOutcomeSE,range));
 figures.push({kind:'surrogacy-scatter',id:'surrogacy-scatter',placement:'results',caption,claimId:claim.id,surrogate:series('surrogacy.x',scatter.map(t=>t.surrogate),'effect'),outcome:series('surrogacy.y',scatter.map(t=>t.outcome),'effect'),seSurrogate:series('surrogacy.sx',scatter.map(t=>t.seSurrogate),'se'),seOutcome:series('surrogacy.sy',scatter.map(t=>t.seOutcome),'se'),grid:series('surrogacy.grid',grid,'effect'),fitted:series('surrogacy.fit',band.map(p=>p.predicted),'effect'),lower:series('surrogacy.lower',band.map(p=>p.lower),'ci'),upper:series('surrogacy.upper',band.map(p=>p.upper),'ci')});
 }
 }
 const summaryOfFindingsTable=kind==='adverse-events'?summaryOfFindings(official,'selectedPrimary' in cert?cert.selectedPrimary:null,claim.id,{scalar,entity}):null;
 return {records,figures,tables,summaryOfFindings:summaryOfFindingsTable,official,diagnostics:cert.diagnostics,certHash,omissions:kind==='adverse-events'?'Individual effects or intervals unavailable without correction are retained in the report but omitted from numeric forest/funnel marks.':'Blocked regression/scatter fields produce no figure.'};
}
