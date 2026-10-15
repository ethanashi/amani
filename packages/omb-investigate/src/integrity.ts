// Host-only projection of verified input bytes. Never consumes worker output or changes labels.
import {collectLinkage, emptyLinkage, emptyIdentities, type Linkage, type LinkageOptions, type ContractSource, type IntegrityIdentities} from './integrity-linkage.ts';
export type {IntegrityIdentities, Linkage, LinkageOptions} from './integrity-linkage.ts';
import {createHash} from 'node:crypto';
import {canonicalSha256} from '../../bio-core/src/index.ts';
import {claimContractUnits,unitToken} from '../../omb-certify/src/contract-stage.ts';
import type {StagedInputs} from '../../omb-certify/src/stage.ts';
import type {DetectorReport} from '../../omb-certify/src/contract-detectors.ts';
import type {VerifiedTable} from '../../omb-certify/src/contract-verifier.ts';
import type {PlanClaim} from '../../omb-gauntlet/src/index.ts';

export type IntegrityFinding={id:string;kind:string;units:string[];tables:string[];count:number;admission:'observed'|'advisory';detail:string;scope?:{countUnit:'pairs';coverage:'duplicate-or-overlap-union'}};
export type TrustedIntegrity={
 schema:'omb-investigate/integrity@1';status:'observed'|'unavailable';
 provenance:{inputHash:string|null;contractHash:string|null;authenticated:boolean;contractSource:ContractSource};
 linkage:Linkage;
 duplicates:{status:'observed'|'not-run';pairCount:number|null;matrixBackedPairCount:number|null;tabularOnlyPairCount:number|null;excessUnits:number|null;groups:IntegrityFinding[]};
 problems:IntegrityFinding[];
 unitsOfAnalysis:{claimId:string;table:string|null;level:string|null;count:number|null;tokens:string[];usedCount:number|null;usedTokens:string[];status:'observed'|'unavailable'}[];
 tables:{table:string;axis:string;records:number;units:number;tokens:string[]}[];
 limitations:string[];
};
export function unavailableIntegrity(reason='Trusted integrity inventory unavailable'):TrustedIntegrity{return {
 schema:'omb-investigate/integrity@1',status:'unavailable',provenance:{inputHash:null,contractHash:null,authenticated:false,contractSource:'certify'},linkage:emptyLinkage(),
 duplicates:{status:'not-run',pairCount:null,matrixBackedPairCount:null,tabularOnlyPairCount:null,excessUnits:null,groups:[]},problems:[],unitsOfAnalysis:[],tables:[],limitations:[reason],
};}
type Part={table:VerifiedTable;index:number;columns:number[];digest:string;observed:number};
function* cells(p:Part):Generator<string>{
 if(p.table.definition.orientation.unit_axis==='rows'){for(const j of p.columns)yield p.table.rows[p.index]![j]!;}
 else{const j=p.columns[p.index]!;for(const r of p.table.rows)yield r[j]!;}
}
function equal(a:Part[],b:Part[]):boolean{
 if(a.length!==b.length)return false;
 for(let i=0;i<a.length;i++){
  if(a[i]!.table.definition.id!==b[i]!.table.definition.id)return false;
  const x=cells(a[i]!),y=cells(b[i]!);for(;;){const l=x.next(),r=y.next();if(l.done!==r.done||l.value!==r.value)return false;if(l.done)break;}
 }return true;
}
/** Exact fingerprints are only candidate indices: every candidate is compared cell by cell.
 * Matrix entities share feature ordering from the verified table. All linked companion tables
 * contribute, excluding only contract-declared identifier/unit columns. No approximate match is
 * promoted to an exact duplicate, and no duplicate observation asserts biological identity. */
export type IntegrityInput = Pick<StagedInputs,'verifiedContract'|'contractUnitKey'|'inputManifestHash'|'contractAuthenticated'>;
export function buildTrustedIntegrity(input:IntegrityInput|null,claims:readonly PlanClaim[],advisory:DetectorReport|null=null,analysisUnits:Readonly<Record<string,readonly string[]>>={}):TrustedIntegrity {
 return buildTrustedIntegrityWithIdentities(input,claims,advisory,analysisUnits).integrity;
}
export function buildTrustedIntegrityWithIdentities(input:IntegrityInput|null,claims:readonly PlanClaim[],advisory:DetectorReport|null=null,analysisUnits:Readonly<Record<string,readonly string[]>>={},options:LinkageOptions={}):{integrity:TrustedIntegrity;identities:IntegrityIdentities} {
 let integrity:TrustedIntegrity;
 try {integrity=collectTrustedIntegrity(input,claims,advisory,analysisUnits);} catch {integrity=unavailableIntegrity('Trusted integrity projection failed; no clean-data conclusion is available');}
 integrity.provenance.contractSource=options.contractSource??'certify';
 if(integrity.status!=='observed'||!input)return {integrity,identities:emptyIdentities()};
 try {
  const result=collectLinkage(input,options);integrity.linkage=result.linkage;
  if(result.finding)integrity.problems.push(result.finding);
  integrity.problems.sort((a,b)=>a.id.localeCompare(b.id));return {integrity,identities:result.identities};
 } catch {integrity.limitations.push('Trusted linkage projection not run: incomplete record sets or unavailable observation identities.');return {integrity,identities:emptyIdentities()};}
}
function collectTrustedIntegrity(staged:IntegrityInput|null,claims:readonly PlanClaim[],advisory:DetectorReport|null,analysisUnits:Readonly<Record<string,readonly string[]>>):TrustedIntegrity{
 const v=staged?.verifiedContract,key=staged?.contractUnitKey;
 if(!v||!key)return unavailableIntegrity();
 const floor=v.resolver.hierarchy.floor!;
 const token=(u:string)=>unitToken(v.resolver.atLevel(v.layer,u,floor),key);
 const out:TrustedIntegrity={...unavailableIntegrity(),status:'observed',provenance:{inputHash:staged.inputManifestHash,contractHash:v.contract.public.hash,authenticated:staged.contractAuthenticated===true,contractSource:'certify'},duplicates:{status:'observed',pairCount:0,matrixBackedPairCount:0,tabularOnlyPairCount:0,excessUnits:0,groups:[]},limitations:['Exact matching content does not establish that two records are the same biological unit. Counts do not alter contract units or raise labels.',...(advisory?.limitations??[])]};
 const add=(list:IntegrityFinding[],kind:string,units:string[],tables:string[],count:number,detail:string,admission:'observed'|'advisory'='observed')=>{
  const base={kind,units:[...new Set(units)].sort(),tables:[...new Set(tables)].sort(),count,admission,detail};
  list.push({id:'if_'+canonicalSha256(base),...base});
 };
 const publicTables=new Map(v.contract.public.content.structure.tables.map(t=>[t.id,t]));
 const visibleTables=[...v.tables.values()].filter(t=>publicTables.get(t.definition.id)?.file.path===t.definition.file.path);
 const profiles=new Map<string,Part[]>(),tableSets=new Map<string,Set<string>>();
 for(const t of visibleTables.sort((a,b)=>a.definition.id.localeCompare(b.definition.id))){
  const table=t.definition.file.path,axis=t.definition.orientation.unit_axis;
  const declared=publicTables.get(t.definition.id)!;
  const columns=axis==='rows'?t.definition.columns.flatMap((c,i)=>declared.columns.some(d=>d.name===c.name&&!['identifier','unit'].includes(d.structural_kind))?[i]:[]):t.entityHeaders.map(h=>t.header.indexOf(h));
  const ids=t.units.map(token),set=new Set(ids);tableSets.set(table,set);
  out.tables.push({table,axis,records:ids.length,units:set.size,tokens:[...set].sort()});
  const missingUnits=new Set<string>();let missingCells=0;
  const nesting=new Map<string,number>();ids.forEach(u=>nesting.set(u,(nesting.get(u)??0)+1));
  for(const [u,n] of nesting)if(n>1)add(out.problems,'unit-nesting',[u],[table],n,'Multiple input records map to the same contract independence unit.');
  for(let i=0;i<t.units.length;i++){
   const p:Part={table:t,index:i,columns,digest:'',observed:0},hash=createHash('sha256');
   let j=0,cellCount=0;for(const value of cells(p)){
    cellCount++;
    hash.update(JSON.stringify(value)+'\n');
    const codes=axis==='rows'?t.definition.columns[columns[j++]!]!.missingness_codes:t.definition.columns[columns[i]!]!.missingness_codes;
    if(!codes.includes(value)&&value!=='')p.observed++;
   }
   if(p.observed<cellCount){missingUnits.add(ids[i]!);missingCells+=cellCount-p.observed;}
   p.digest=hash.digest('hex');const parts=profiles.get(ids[i]!)??[];parts.push(p);profiles.set(ids[i]!,parts);
   if(p.observed===0)add(out.problems,'sparse-record',[ids[i]!],[table],1,'Every non-identifier value in this record is missing.');
  }
  if(missingCells)add(out.problems,'missing-cells',[...missingUnits],[table],missingCells,'Input cells carry a contract missingness code or are empty.');
 }
 const candidates=new Map<string,string[]>();
 for(const [id,parts] of profiles){
  parts.sort((a,b)=>a.table.definition.id.localeCompare(b.table.definition.id)||a.digest.localeCompare(b.digest));
  if(parts.every(p=>p.observed===0))continue;
  const signature=canonicalSha256(parts.map(p=>[p.table.definition.id,p.digest]));const ids=candidates.get(signature)??[];ids.push(id);candidates.set(signature,ids);
 }
 for(const ids of candidates.values()){
  const exact:string[][]=[];for(const id of ids){const group=exact.find(g=>equal(profiles.get(g[0]!)!,profiles.get(id)!));if(group)group.push(id);else exact.push([id]);}
  for(const group of exact)if(group.length>1){add(out.duplicates.groups,'exact-content-duplicates',group,profiles.get(group[0]!)!.map(p=>p.table.definition.file.path),group.length,'All compared non-identifier cells match exactly across the linked profile.');const pairs=group.length*(group.length-1)/2;out.duplicates.pairCount!+=pairs;
   if(profiles.get(group[0]!)!.some(p=>p.table.definition.orientation.unit_axis==='columns'))out.duplicates.matrixBackedPairCount!+=pairs;else out.duplicates.tabularOnlyPairCount!+=pairs;out.duplicates.excessUnits!+=group.length-1;}
 }
 const tables=[...tableSets];for(let i=0;i<tables.length;i++)for(let j=i+1;j<tables.length;j++){
  const [a,as]=tables[i]!,[b,bs]=tables[j]!,overlap=[...as].filter(u=>bs.has(u));
  if(overlap.length)add(out.problems,'table-overlap',overlap,[a,b],overlap.length,'Tables contain the same contract units; overlap is descriptive and may be intended.');
  for(const [own,other,os,ts] of [[a,b,as,bs],[b,a,bs,as]] as const){const absent=[...os].filter(u=>!ts.has(u));if(absent.length&&overlap.length)add(out.problems,'unmatched-table-units',absent,[own,other],absent.length,'Units in the first table are absent from the companion table; this does not assert an invalid join.');}
 }
 for(const f of advisory?.findings??[]){
  if(!f.tables.every(id=>publicTables.has(id)))continue;
  const units=f.units.map(token).filter(u=>profiles.has(u));
  if(units.length!==f.units.length)continue;
  add(out.problems,f.detector,units,f.tables.map(id=>publicTables.get(id)!.file.path),units.length,f.detail,'advisory');
 }
 out.unitsOfAnalysis=claims.map(c=>{
  const base={claimId:c.id,table:typeof c.knobs.table==='string'?c.knobs.table:null,level:c.unit??null};
  try{const tokens=[...new Set(claimContractUnits(v,c,key))].sort();const supplied=analysisUnits[c.id];const used=supplied&&supplied.every(u=>tokens.includes(u))?[...new Set(supplied)].sort():null;return {...base,count:tokens.length,tokens,usedCount:used?.length??null,usedTokens:used??[],status:'observed' as const};}
  catch{return {...base,count:null,tokens:[],usedCount:null,usedTokens:[],status:'unavailable' as const};}
 });
 out.duplicates.groups.sort((a,b)=>a.id.localeCompare(b.id));out.problems.sort((a,b)=>a.id.localeCompare(b.id));return out;
}
export function integrityMetrics(i:TrustedIntegrity):Record<string,number>{return i.status==='observed'?{
 'integrity.matrix_duplicate_pairs':i.duplicates.matrixBackedPairCount!,'integrity.tabular_only_duplicate_pairs':i.duplicates.tabularOnlyPairCount!,'integrity.duplicate_pairs':i.duplicates.pairCount!,'integrity.duplicate_groups':i.duplicates.groups.length,'integrity.excess_units':i.duplicates.excessUnits!,'integrity.problems':i.problems.length,
}:{};}
export function renderIntegrityReference(i:TrustedIntegrity,id:string):string|null{
 const f=[...i.duplicates.groups,...i.problems].find(f=>f.id===id);
 return f?`${f.kind}: ${f.units.join(', ')} (${f.count}; ${f.admission})`:null;
}
export function renderIntegrity(i:TrustedIntegrity):string{
 const lines=['## Integrity (software-owned)','',`Status: ${i.status}.`,''];
 if(i.status==='observed'){
  lines.push(`Duplicates found: ${i.duplicates.pairCount} exact duplicate pairs in ${i.duplicates.groups.length} groups (${i.duplicates.excessUnits} excess records across distinct declared units).`,`${i.duplicates.matrixBackedPairCount} pairs include an exact matrix profile and all available companion data; ${i.duplicates.tabularOnlyPairCount} pairs match tabular metadata only. Metadata-only matches do not establish duplicated biological units.`,'');
  for(const f of i.duplicates.groups)lines.push(`- ${renderIntegrityReference(i,f.id)}. Tables: ${f.tables.join(', ')}.`);
  lines.push('','Other data-quality observations (full token membership in integrity.json):');
  const kinds=new Map<string,number>();for(const f of i.problems)kinds.set(`${f.kind} (${f.admission})`,(kinds.get(`${f.kind} (${f.admission})`)??0)+1);
  for(const [kind,n] of kinds)lines.push(`- ${kind}: ${n} findings.`);
  lines.push('','Units of analysis used:');
  for(const u of i.unitsOfAnalysis)lines.push(`- ${u.claimId}: ${u.usedCount??'not verified'} units used by trusted computation; ${u.count??'unavailable'} contract ${u.level??'unknown level'} units available; ${u.table??'unknown table'} (${u.status}).`);
 }
 lines.push('',...i.limitations.map(l=>`- ${l}`));return lines.join('\n');
}
