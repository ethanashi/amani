/** Deletes individual production guards in transient modules, then applies adversarial
 * cases. A mutant is killed only when the real guard rejects and its removal accepts. */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fixture, reseal, authority, NOW, KEYPAIR } from '../test/fixture.ts';
import { checkGates } from '../src/gates.ts';
import { signRecord } from '../src/common.ts';
import { ROOT } from '../src/toolchain.ts';
import type { PackageRequest } from '../src/types.ts';
const original=readFileSync(path.join(ROOT,'src/gates.ts'),'utf8');
function eraseGuard(message:string):string{
 const at=original.indexOf(`'${message}'`);if(at<0)throw Error('mutation target not found: '+message);
 const start=original.lastIndexOf('assert(',at);let depth=0,end=start+6,quote='';
 for(;end<original.length;end++){const c=original[end]!;if(quote){if(c==='\\'){end++;continue;}if(c===quote)quote='';continue;}if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if(c==='(')depth++;if(c===')'&&--depth===0){end++;break;}}
 return original.slice(0,start)+'void 0'+original.slice(end);
}
const cases:{id:string;source:()=>string;change:(r:PackageRequest)=>PackageRequest}[]=[];
function guard(id:string,message:string,mutate:(r:PackageRequest)=>void){cases.push({id,source:()=>eraseGuard(message),change:r=>{mutate(r);return reseal(r);}});}
guard('controlled-data','controlled-access data blocked',r=>{r.submission.study.access='controlled';});
guard('one-target','exactly one posting target required',r=>{r.submission.study.targets.push('bioRxiv');});
guard('frontiers','Frontiers excluded',r=>{r.submission.study.targets=['Frontiers'];r.submission.venue='research-note';});
// Frontiers overlaps the short-target guard: mutate that separate guard with an unknown target.
cases.pop();guard('short-target','short format is a local template, target policy requires a specific future profile',r=>{r.submission.study.targets=['Unapproved journal'];});
guard('formulaic-genre','formulaic public-data genre',r=>{r.submission.study.datasetCount=1;});
guard('lineage-coverage','lineage coverage incomplete',r=>{r.submission.manuscript.certificationIds=[];});
guard('email-consent','owner email requires explicit submission consent',r=>{r.submission.owner.record.authors[0]!.email='fixture@example.org';});
guard('ai-authorship','AI cannot be an author',r=>{r.submission.owner.record.authors.push({actor:'ai',name:'Claude',affiliations:['Fixture lab'],corresponding:false,contributions:[]});});
guard('summary-required','Summary of findings required even in short format',r=>{r.submission.manuscript.displays[0]!.id='other-table';r.submission.manuscript.sections[2]!.markdown=r.submission.manuscript.sections[2]!.markdown.replace('#tab-summary-of-findings','#tab-other-table');});
cases.push({id:'display-citations',source:()=>original.replace('const locations=locateDisplays(s.manuscript);','const locations:never[]=[];'),change:r=>{r.submission.manuscript.sections[0]!.markdown='No citation.';return reseal(r);}});
cases.push({id:'individual-caption-cap',source:()=>original.replace('assert(words(display.caption)<=p.caps.caption,`${display.id} caption word cap exceeded`);','void 0;'),change:r=>{r.submission.manuscript.displays[1]!.caption='word '.repeat(151);return reseal(r);}});
guard('combined-caption-cap','combined caption/display-text word cap exceeded',r=>{r.submission.manuscript.displays[0]!.markdown='cell '.repeat(301);});
cases.push({id:'internal-review-lints',source:()=>original.replace('for(const transcript of s.reproduction.transcripts)lintText(`${transcript.name}\\n${transcript.text}`,s.study.perSampleIdentifiers);',''),change:r=>{r.submission.reproduction.transcripts[0]!.text='fixture-private-subject';return reseal(r);}});
guard('number-coverage','reproduction omits manuscript numbers',r=>{r.submission.reproduction.expected={mean:4.5};});
guard('reference-cap','reference cap exceeded',r=>{r.submission.manuscript.references=Array.from({length:21},(_,i)=>({...r.submission.manuscript.references[0]!,cslJson:{...r.submission.manuscript.references[0]!.cslJson,id:'ref-'+i}}));});
cases.push({id:'contact-gate',source:()=>original.replace('contactGate(s,now);',''),change:r=>{r.submission.input.contact.status='pending';r.submission.input.contact.contacts=[];return reseal(r);}});
cases.push({id:'content-lints',source:()=>original.replace('lintText(publicText,s.study.perSampleIdentifiers);',''),change:r=>{r.submission.manuscript.sections[0]!.markdown+='<w:vanish/>';return reseal(r);}});
cases.push({id:'human-comprehension',source:()=>original.replace(",'comprehension-check']",']'),change:r=>{r.submission.input.ownerDeclarations=r.submission.input.ownerDeclarations.filter(a=>a.action!=='comprehension-check');return reseal(r);}});
cases.push({id:'provenance',source:()=>original.replace('checkProvenance(s);',''),change:r=>{r.submission.models[0]!.modelId='invented-version';return reseal(r);}});
cases.push({id:'endorsed-lock',source:()=>eraseGuard('missing authenticated endorsed lock'),change:r=>{r.endorsement.record.state='declined';r.endorsement=signRecord(r.endorsement.record,KEYPAIR.privateKey);return r;}});
cases.push({id:'endorsement-order',source:()=>eraseGuard('endorsement must follow final diff review'),change:r=>{r.endorsement.record.at='2026-10-13T17:00:00Z';r.endorsement=signRecord(r.endorsement.record,KEYPAIR.privateKey);return r;}});
cases.push({id:'policy-freshness',source:()=>eraseGuard('policies must be rechecked at packaging time'),change:r=>{r.policy.record.checkedAt='2026-10-12T17:00:00Z';r.policy=signRecord(r.policy.record,KEYPAIR.privateKey);return r;}});
const results=[];
for(const [i,test] of cases.entries()){
 const mutated=test.source();if(mutated===original)throw Error('unchanged mutant: '+test.id);
 const r=test.change(fixture());let baselineRejected=false;try{checkGates(r,authority,NOW);}catch{baselineRejected=true;}
 const file=path.join(ROOT,`src/.pw9-mutant-${i}.ts`);writeFileSync(file,mutated);
 try{const module=await import(pathToFileURL(file).href);let accepted=false;try{module.checkGates(r,authority,NOW);accepted=true;}catch{}results.push({id:test.id,baselineRejected,mutantAccepted:accepted,killed:baselineRejected&&accepted});}finally{rmSync(file);}
}
const report={schema:'omb/pw9-guard-mutations@1',total:results.length,killed:results.filter(x=>x.killed).length,results};
writeFileSync(path.join(ROOT,'reports/gate-mutations.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
if(report.killed!==report.total)process.exitCode=1;
