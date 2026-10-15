/** Regression mutations for the owner calibration decision; production still blocks standards. */
import { readFileSync,writeFileSync,rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../src/toolchain.ts';
import { genreFixture,markdownAst } from '../test/genre-fixture.ts';
import { attributes } from '../src/genre/ast.ts';
import { loadProfile } from '../src/genre/profiles.ts';
const AE='sr-ma-adverse-events-rct';
const cases:{id:string;file:string;from:string;to:string;check:(m:any)=>boolean}[]=[
 {id:'amani-classification',file:'classes.ts',from:"policy.standardRules.includes(rule)",to:'false',check:m=>m.ruleClass('L1','limitations')==='AMANI-STANDARD'},
 {id:'compound-panels',file:'ast.ts',from:'kind,kinds,type,caption',to:'kind,kinds:kinds.slice(0,1),type,caption',check:m=>m.displays(markdownAst('![PRISMA flow diagram and forest plot panels](test.svg)').blocks,loadProfile(AE)!.profile)[0].kinds.length===2},
 {id:'typical-never-fails',file:'structure.ts',from:"if(entry?.level==='typical'&&(severity==='FAIL'||severity==='FAIL-W'))severity='WARN';",to:'',check:m=>{const f=genreFixture(AE),item=loadProfile(AE)!.profile.display_items.find(x=>x.level==='typical')!;f.manifest.push(...Array.from({length:30},(_,i)=>({title:'Typical item',kind:item.id,path:'supplement-'+i})));const findings=m.lintStructure(f).findings.filter((x:any)=>x.target===`display_items[${item.id}].count`);return findings.length>0&&findings.every((x:any)=>x.severity==='WARN');}}
];
cases.push({id:'unheaded-limitations-content',file:'structure.ts',from:'report.limitationsContent={headed:!!headedLimitations,present:!!limitations}',to:'report.limitationsContent={headed:!!headedLimitations,present:!!headedLimitations}',check:m=>{const f=genreFixture(AE);f.ast.blocks=f.ast.blocks.filter(n=>!(n.t==='Header'&&attributes(n).kv['section-id']==='limitations'));return m.lintStructure(f).limitationsContent.present===true;}});
cases.push({id:'jats-statements',file:'ast.ts',from:"ast.meta['jats-statements']?.c??[]",to:'[]',check:m=>{const ast=markdownAst('# Discussion\n\nDiscussion.');ast.meta['jats-statements']={t:'MetaList',c:[{t:'MetaMap',c:{id:{t:'MetaString',c:'funding'},text:{t:'MetaString',c:'Research Council award.'},source:{t:'MetaString',c:'funding-group'}}}]};return m.sections(ast,loadProfile(AE)!.profile).some((s:any)=>s.id==='funding'&&s.prose.includes('Council'));}});
const results=[];
for(const [i,t] of cases.entries()){
 const original=path.join(ROOT,'src/genre',t.file),source=readFileSync(original,'utf8');if(!source.includes(t.from))throw Error('missing target '+t.id);
 const baseline=t.check(await import(pathToFileURL(original).href));const file=path.join(ROOT,'src/genre',`.calibration-mutant-${i}.ts`);writeFileSync(file,source.replace(t.from,t.to));
 try{const mutation=t.check(await import(pathToFileURL(file).href));results.push({id:t.id,baselinePass:baseline,mutantPass:mutation,killed:baseline&&!mutation});}finally{rmSync(file);}
}
const report={total:results.length,killed:results.filter(x=>x.killed).length,results};writeFileSync(path.join(ROOT,'reports/genre-calibration-mutations-round3.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.total!==report.killed)process.exitCode=1;
