import {readFileSync,existsSync,cpSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {canonicalSha256} from '../../bio-core/src/index.ts';
import {replayAmani} from '../src/replay.ts';
import {pointer,type Json} from '../src/results.ts';
import {equalIntegrity} from '../src/integrity-union.ts';
import {loadTask} from '../src/task.ts';
import {computeCardIntegrity} from '../src/card-integrity.ts';
import {sha256} from '../../omb-certify/src/contract-verifier.ts';
import {ABSENCE_UNCERTIFIED} from '../src/integrity-scope.ts';
import {normalizeLegacyReportArrays,diagnosticReplayBaseline} from './replay-baseline.ts';
const [base,outDir,python]=process.argv.slice(2) as [string,string,string];
const policy=process.env.SCOPED_NEGATIVES==='false'?'P0':'P1';
let failed=false;
function check(name:string,ok:boolean){console.log(`${ok?'PASS':'FAIL'} ${policy} ${name}`);if(!ok)failed=true;}
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
for(const card of ['c3','c5']){
 const root=path.join(base,'tierb-'+card),task=path.join(root,'served'),attempt=path.join(root,'attempt');
 const r=replayAmani({task,attempt,out:path.join(outDir,`${card}-${policy}.json`)}),v=r.integrity.value as any,l=v?.linkage,identities=r.integrityIdentities?.observations;
 check(`${card} provenance`,r.integrity.source==='replay-recomputed'&&v?.status==='observed'&&l?.status==='observed'&&v.provenance.contractSource==='served-card-translation'&&v.provenance.authenticated===false&&/^[a-f0-9]{64}$/.test(v.provenance.contractHash));
 const oracle=JSON.parse(execFileSync(python,[new URL('./card-integrity-oracle.py',import.meta.url).pathname,task],{encoding:'utf8'}));
 check(`${card} complete pair diagnostics`,l?.pairsTruncated===false);
 const countKey:Record<string,string>={'exact-profile':'exactProfilePairCount','shared-unit':'sharedUnitPairCount','repeated-observation':'repeatedObservationPairCount',union:'pairCount'};
 for(const reason of Object.keys(countKey)){
  const selected=(l?.pairs??[]).filter((p:any)=>reason==='union'||p.reasons.includes(reason));
  const tokens=[...new Set<string>(selected.flatMap((p:any)=>[p.a,p.b]))];
  const records=(token:string)=>{const e=identities?.[token];if(!e||e.identifiers.length!==1)throw new Error('identity resolution incomplete');return [e.recordSet,e.identifiers[0]!]};
  const pairs=selected.map((p:any)=>[records(p.a),records(p.b)].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))).sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const values:Record<string,unknown>={count:l?.[countKey[reason]!],pairs,datasets:[...new Set(tokens.map(t=>records(t)[0]))].sort(),identifiers:[...new Set(tokens.map(t=>records(t)[1]))].sort()};
  for(const [name,value] of Object.entries(values))check(`${card} ${reason}.${name}`,canonicalSha256(value)===oracle[reason+'.'+name]);
 }
 check(`${card} complete union membership`,canonicalSha256([...(l?.observations??[])].sort())===canonicalSha256([...new Set((l?.pairs??[]).flatMap((p:any)=>[p.a,p.b]))].sort()));
 const saved=read(path.join(attempt,'report.json')),grade=read(path.join(root,'grade.json')),contract=read(path.join(task,'DATA-CONTRACT.json')).public.content;
 const criteria=contract.report.filter((c:any)=>c.report.startsWith('/data_integrity/'));
 for(const c of criteria){
  const p=c.report,scope=r.integrityScope[p],value=pointer(r.report,p),expected=pointer(saved,p);
  check(`${card} ${p} saved grade`,grade.criteria.some((g:any)=>g.name===c.name&&g.passed===true));
  if(card==='c5'&&policy==='P0')check(`${card} ${p} absence withheld`,value===null&&r.issues.some(x=>x.startsWith(p+':')&&x.includes(ABSENCE_UNCERTIFIED)));
  else{
   check(`${card} ${p} saved agreement`,value!==undefined&&expected!==undefined&&equalIntegrity(value,expected));
   check(`${card} ${p} bound scope`,!!r.sources[p]&&scope?.corroboration==='equal'&&!r.issues.some(x=>x.startsWith(p+':'))&&!r.warnings.some(w=>w.path===p&&w.kind==='integrity-disagreement'));
   if(card==='c5')check(`${card} ${p} negative wording`,typeof scope?.negativeWording==='string'&&scope.negativeWording.includes('within the declared coverage'));
  }
 }
 if(card==='c3')check(`${card} incomplete restored`,pointer(r.report,'/incomplete')===saved.incomplete);
}
for(const card of ['c1','c2-r2','c4-r2']){
 const root=path.join(base,'tierb-'+card),r=replayAmani({task:path.join(root,'served'),attempt:path.join(root,'attempt'),out:path.join(outDir,`${card}-${policy}.json`)}),v=r.integrity.value as any;
 check(`${card} expected inventory`,card==='c2-r2'?v?.status==='observed':v?.status==='unavailable'&&v.limitations.includes('no unit namespace'));
 const oldFile=path.join(path.dirname(outDir),`tierb-${card}-round2.json`);
 check(`${card} baseline available`,existsSync(oldFile));
 if(existsSync(oldFile)){const old=diagnosticReplayBaseline(card,read(oldFile));for(const key of ['report','issues','sources','warnings'] as const)check(`${card} ${card==='c1'?'diagnostic withholding; otherwise unchanged':'unchanged'} ${key}${key==='report'?' (legacy array shape normalized)':''}`,canonicalSha256(r[key])===canonicalSha256(key==='report'?normalizeLegacyReportArrays(old[key],r[key]):old[key]));}
}
// Negative control is temporary, never changes the burned source or saved report.
if(policy==='P1'){
 const scratch=mkdtempSync(path.join(outDir,'negative-control-'));
 try{
  const source=path.join(base,'tierb-c5/served'),copy=path.join(scratch,'served');cpSync(source,copy,{recursive:true});
  const envelope=read(path.join(copy,'DATA-CONTRACT.json')),table=envelope.public.content.tables.find((t:any)=>t.layout==='matrix');
  const file=path.join(copy,table.path),bytes=readFileSync(file),start=bytes.indexOf(10)+1,cell=bytes.indexOf(9,start)+1;
  // Change one measurement digit, preserving the TSV grammar.
  let digit=cell;while(digit<bytes.length&&(bytes[digit]!<48||bytes[digit]!>57))digit++;
  if(digit===bytes.length)throw new Error('negative control digit unavailable');bytes[digit]=bytes[digit]===57?56:57;writeFileSync(file,bytes);
  let refused=false;try{loadTask(copy);}catch{refused=true;}check('c5 changed byte refused',refused);
  table.sha256=sha256(bytes);envelope.public.hash=canonicalSha256(envelope.public.content);
  const encoded=JSON.stringify(envelope);writeFileSync(path.join(copy,'DATA-CONTRACT.json'),encoded);
  const manifest=read(path.join(copy,'manifest.json'));manifest.files[table.path]=sha256(bytes);manifest.files['DATA-CONTRACT.json']=sha256(encoded);manifest.publicContractHash=envelope.public.hash;writeFileSync(path.join(copy,'manifest.json'),JSON.stringify(manifest));
  const task=loadTask(copy),result=computeCardIntegrity({publicContract:task.publicContract??null,dataDir:task.dataRoot,key:Buffer.alloc(32)});
  check('c5 consistent forgery remains observed (Option A limitation)',result.integrity.status==='observed'&&result.integrity.provenance.authenticated===false);
  const original=loadTask(source),originalResult=computeCardIntegrity({publicContract:original.publicContract??null,dataDir:original.dataRoot,key:Buffer.alloc(32)});
  check('c5 forged bytes change pinned provenance',result.inputManifestHash!==originalResult.inputManifestHash&&result.contractHash!==originalResult.contractHash);
 }finally{rmSync(scratch,{recursive:true,force:true});}
}
process.exitCode=failed?1:0;
