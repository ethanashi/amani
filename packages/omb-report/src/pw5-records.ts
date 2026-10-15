import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { type ReportContext, assertContext } from './context.ts';
import { record, requireThat } from './common.ts';
import { pw5Text, pw5Hash } from './pw5-evidence.ts';
/** These typed projections are read only from the PW0 host-verified PaperInput.
 * They are not additional drafter inputs or authorities. Missing fields fail closed. */
export interface DataSourceRecord { accession:string; release:string; licence:string; sha256:string; accessClass:'public-deidentified'; source:string }
export interface LockedSoftware { name:string;version:string;ecosystem:string;doi:string|null }
export function identifier(value:unknown,label:string): asserts value is string {
 pw5Text(value,label);requireThat(/^[\p{L}\p{N}@][\p{L}\p{N} ._+/@:(),;& #=~>\-]{0,159}$/u.test(value),`invalid ${label} identifier`);
}
export function count(value:unknown,label:string): asserts value is number {requireThat(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0,`invalid ${label} count`);}
export function doi(value:unknown,label:string): void {requireThat(value===null||typeof value==='string'&&/^10\.\d{4,9}\/[^\s]+$/u.test(value),`invalid ${label} DOI slot`);}
export function dataSources(ctx:ReportContext):DataSourceRecord[] {
 assertContext(ctx);requireThat(ctx.input.stagerManifests.length>0,'missing stager manifests');
 const rows=ctx.input.stagerManifests.map(raw=>{
  const d=record(raw);for(const key of ['accession','release','licence','source'])identifier(d[key],`data ${key}`);
  pw5Hash(d.sha256,'data checksum');requireThat(d.accessClass==='public-deidentified','ethics template incompatible with data access class');
  return {accession:d.accession,release:d.release,licence:d.licence,source:d.source,sha256:d.sha256,accessClass:d.accessClass} as DataSourceRecord;
 });
 requireThat(new Set(rows.map(d=>`${d.source}:${d.accession}:${d.release}`)).size===rows.length,'duplicate data source');return rows;
}
export function lockedSoftware(ctx:ReportContext):LockedSoftware[] {
 assertContext(ctx);const env=record(ctx.input.environmentLock),raw=env.packages;
 requireThat(Array.isArray(raw)&&raw.length>0,'missing software packages in environment lock');
 const rows=raw.map(raw=>{const p=record(raw);for(const key of ['name','version','ecosystem'])identifier(p[key],`software ${key}`);doi(p.doi,'software');return {name:p.name,version:p.version,ecosystem:p.ecosystem,doi:p.doi} as LockedSoftware;});
 requireThat(new Set(rows.map(p=>`${p.ecosystem}:${p.name}`)).size===rows.length,'duplicate environment package');
 // If a legacy version inventory is present, it must agree with the package lock.
 if(env.versions!==undefined)requireThat(env.versions!==null&&typeof env.versions==='object'&&!Array.isArray(env.versions),'invalid version inventory');
 if(env.versions!==undefined)for(const [name,version]of Object.entries(record(env.versions)))requireThat(rows.some(p=>p.name===name&&p.version===version),'environment version inventories disagree');
 return rows;
}
export function evidenceInContext(ctx:ReportContext,hash:string):void {
 pw5Hash(hash,'evidence hash');
 const records=[ctx.input.lockedPlan,ctx.input.runMetadata,ctx.input.environmentLock,ctx.input.frozenLiteratureIndex,ctx.input.stagerManifests,...ctx.input.stagerManifests,ctx.input.sandboxExecutionLogs,...ctx.input.sandboxExecutionLogs,...ctx.input.certifications.map(c=>c.certificate)];
 requireThat(records.some(r=>canonicalSha256(r)===hash)||ctx.sources.some(s=>s.id===hash),'evidence hash absent from context');
}

/** The host supplies one typed record per attempted sandbox analysis, including
 * failed attempts. Unknown log records cannot silently become zero analyses. */
export interface PW5AnalysisLog { runId:string;kind:'analysis';classification:'exploratory'|'confirmatory';status:'completed'|'failed' }
export function exploratoryCount(ctx:ReportContext):number {
 assertContext(ctx);const logs=ctx.input.sandboxExecutionLogs.map(record).filter(log=>{
  // Installation events are not analysis attempts and need no analysis identity.
  if(log.kind==='install'){requireThat(log.status===undefined||log.status==='completed'||log.status==='failed','unavailable installation provenance');return false;}
  return true;
 });
 requireThat(new Set(logs.map(l=>l.runId)).size===logs.length,'duplicate sandbox analysis run');
 for(const log of logs){identifier(log.runId,'sandbox run'); requireThat(log.kind==='analysis'&&(log.classification==='exploratory'||log.classification==='confirmatory')&&(log.status==='completed'||log.status==='failed'),'unavailable sandbox analysis provenance');}
 const value=logs.filter(l=>l.kind==='analysis'&&l.classification==='exploratory').length;
 requireThat(record(ctx.input.runMetadata).exploratoryAnalysisCount===value,'exploratory count differs from sandbox logs');
 return value;
}
