/** Delete/downgrade production lint guards, then run their actual negative controls. */
import { readFileSync,writeFileSync,rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../src/toolchain.ts';
import { lintStructure,blocksPackaging } from '../src/genre/structure.ts';
import { genreFixture,markdownAst } from '../test/genre-fixture.ts';
import { attributes,allNodes } from '../src/genre/ast.ts';
import type { LintInput } from '../src/genre/types.ts';
const AE='sr-ma-adverse-events-rct',MR='cis-mr-colocalisation-drug-target',AGENT='ai-research-agent-methods';
const original=readFileSync(path.join(ROOT,'src/genre/structure.ts'),'utf8');
const tests:{id:string;slug:string;from:string;to:string;change:(f:LintInput)=>void}[]=[];
const add=(id:string,slug:string,from:string,to:string,change:(f:LintInput)=>void)=>tests.push({id,slug,from,to,change});
function range(f:LintInput,id:string){const a=f.ast.blocks.findIndex(n=>n.t==='Header'&&attributes(n).kv['section-id']===id);let b=f.ast.blocks.findIndex((n,i)=>i>a&&n.t==='Header'&&n.c[0]===1);return [a,b<0?f.ast.blocks.length:b] as const;}
function remove(f:LintInput,kind:string){f.ast.blocks=f.ast.blocks.filter(n=>!allNodes(n).some(x=>attributes(x).kv.kind===kind));f.manifest=f.manifest.filter(m=>m.kind!==kind);}
add('S1-required-section',AE,"level(rule,'FAIL')","'WARN'",f=>{const [a]=range(f,'funding');f.ast.blocks[a]!.c[1][2]=[['section-id','acknowledgements']];f.ast.blocks[a]!.c[2]=[{t:'Str',c:'Acknowledgements'}];});
add('S3-order',AE,"add('S3','FAIL'","add('S3','WARN'",f=>{const [a,b]=range(f,'results'),[c,d]=range(f,'discussion');const r=f.ast.blocks.slice(a,b),v=f.ast.blocks.slice(c,d);f.ast.blocks.splice(a,d-a,...v,...r);});
add('W1-hard-band',AGENT,"hard&&!onlyWarn?'FAIL-W'","hard&&!onlyWarn?'WARN'",f=>{const [a,b]=range(f,'methods'),copy=f.ast.blocks.slice(a+1,b);f.ast.blocks.splice(b,0,...structuredClone(copy),...structuredClone(copy));});
add('A1-format',AE,"input.venue.abstractFormat?'INFO':'FAIL'","'INFO'",f=>{const d=f.ast.blocks.find(n=>attributes(n).kv['section-id']==='abstract')!;d.c[1]=d.c[1].filter((n:any)=>n.t!=='Header');});
add('D1-forest',AE,"level(d,'FAIL')","'WARN'",f=>remove(f,'forest_plot'));
add('D1-regional',MR,"add('D1','FAIL','display_items[regional_association_plot]'","add('D1','WARN','display_items[regional_association_plot]'",f=>remove(f,'regional_association_plot'));
add('S6-prediction-band','trial-level-surrogate-evaluation',"add('S6','FAIL-W','display_items[surrogacy_scatter].prediction_band'","add('S6','WARN','display_items[surrogacy_scatter].prediction_band'",f=>{for(const n of allNodes(f.ast.blocks))if(n.t==='Str'&&/prediction/.test(n.c))n.c='undocumented';});
add('T1-code',AGENT,"level(st,'FAIL')","'WARN'",f=>{const [a,b]=range(f,'code_availability');f.ast.blocks.splice(a+1,b-a-1,{t:'Para',c:[{t:'Str',c:'Undocumented release.'}]});});
add('C1-file',MR,"if(!complete&&c.level!=='optional')","if(false)",f=>{delete f.checklists[f.checklistMapping['STROBE-MR']!];});
add('C3-mapping',MR,"add('C3','FAIL'","add('C3','WARN'",f=>{delete f.checklistMapping['STROBE-MR'];});
add('U1-supplement',AE,"level(s,'FAIL')","'WARN'",f=>{const item=f.manifest.find(m=>m.genre_item)!;f.manifest=f.manifest.filter(m=>m!==item);});
add('L1-limitations',AE,"add('L1','FAIL'","add('L1','WARN'",f=>{const [a,b]=range(f,'limitations');f.ast.blocks.splice(a,b-a);});
add('L3-part-b',AE,"if(!valid)add('L3'","if(false)add('L3'",f=>{f.limitations=[];});
add('P2-certificate-pin',AE,"add('P2','FAIL','profile.sha256'","add('P2','WARN','profile.sha256'",f=>{f.expectedProfileHashes={[AE]:'0'.repeat(64)};});
add('P2-genre-removal',AE,"add('P2','FAIL','profile.set'","add('P2','WARN','profile.set'",f=>{f.expectedProfileHashes={[AE]:lintStructure(f).profile!.sha256};delete f.declaration.genre;});
add('P5-compatibility',MR,"add('P5','FAIL-W'","add('P5','WARN'",f=>{f.declaration.claim_kinds=['single-cell'];});
add('waiver-authentication','trial-level-surrogate-evaluation','ownerWaiverValid(w,input)','true',f=>{for(const n of allNodes(f.ast.blocks))if(n.t==='Str'&&/prediction/.test(n.c))n.c='undocumented';const finding=lintStructure(f).findings.find(x=>x.severity==='FAIL-W')!;f.waivers=[{rule:finding.rule,target:finding.target,profile_sha256:finding.profile_sha256!,reason:'Forged owner waiver.',owner_action_receipt:'forged',date:'2026-10-13'}];f.supplementAst=markdownAst('# Departures\n\nForged owner waiver.');});
const results=[];
for(const [i,t] of tests.entries()){
 if(!original.includes(t.from))throw Error('mutation target missing: '+t.id);
 const f=genreFixture(t.slug);t.change(f);const baselineBlocked=blocksPackaging(lintStructure(f));
 const file=path.join(ROOT,`src/genre/.mutant-${i}.ts`);writeFileSync(file,original.replace(t.from,t.to));
 try{const m=await import(pathToFileURL(file).href);const mutantBlocked=blocksPackaging(m.lintStructure(f));results.push({id:t.id,baselineBlocked,mutantBlocked,killed:baselineBlocked&&!mutantBlocked});}finally{rmSync(file);}
}
const report={total:results.length,killed:results.filter(r=>r.killed).length,results};writeFileSync(path.join(ROOT,'reports/genre-mutations-round2.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.total!==report.killed)process.exitCode=1;
