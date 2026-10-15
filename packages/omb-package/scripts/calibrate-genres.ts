/** Real-paper acceptance audit. Stores counts/findings only, never exemplar prose. */
import { readFileSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/toolchain.ts';
import { PINS,loadProfile } from '../src/genre/profiles.ts';
import { sections,countWords,allNodes,inlinesText,classifyCaption } from '../src/genre/ast.ts';
import { lintExemplar } from '../src/genre/structure.ts';
import { genreFixture } from '../test/genre-fixture.ts';
const counter:any[]=[],positive:any[]=[],loo:any[]=[],guideline:any[]=[];
for(const slug of Object.keys(PINS)){
 const p=loadProfile(slug)!.profile;
 for(const e of p.exemplars){
  const ast=JSON.parse(readFileSync(path.join(ROOT,'.cache/genre-exemplars',e.pmcid+'.ast.json'),'utf8'));
  const raw=JSON.parse(readFileSync(path.join(ROOT,'genres',e.measurement_file),'utf8'));
  const measuredAst=structuredClone(ast);
  // Counter calibration uses the extractor's canonical section names, independently
  // of profile aliases (the agent profile also aliases Conclusions to Discussion).
  for(const n of allNodes(measuredAst.blocks))if(n.t==='Header'&&n.c[0]===1&&/^(?:\d+\s+)?conclusions?$/i.test(inlinesText(n.c[2])))n.c[1][2].push(['section-id','conclusions']);
  const ss=sections(measuredAst,p),checks:any[]=[];
  for(const id of ['introduction','methods','results','discussion']){
   const expected=raw.section_word_totals[id];if(expected===undefined)continue;
   const found=ss.filter(s=>s.id===id||(id==='results'&&s.id==='results_discussion'&&!raw.section_word_totals.results_discussion));
   const observed=found.reduce((n,s)=>n+s.words,0),tolerance=Math.max(15,.03*expected);
   checks.push({section:id,expected,observed,tolerance,pass:Math.abs(observed-expected)<=tolerance});
  }
  const ab=raw.abstracts?.find((x:any)=>x.type==='main')??raw.abstracts?.[0],observed=ss.find(s=>s.id==='abstract')?.words??0;
  if(ab)checks.push({section:'abstract',expected:ab.words,observed,tolerance:.05*ab.words,pass:Math.abs(observed-ab.words)<=.05*ab.words});
  counter.push({genre:slug,id:e.id,pmcid:e.pmcid,checks,pass:checks.every(c=>c.pass)});
  const input=genreFixture(slug);input.ast=ast;input.supplementAst={blocks:[],meta:{},'pandoc-api-version':[1,23,1]};input.venue={id:e.journal,summaryLayers:[],displayCap:100};input.limitations=[];input.checklists={};input.waivers=[];
  const desc=e.citation+' '+(e.measured.corrections??'');const surrogateIpd=slug==='trial-level-surrogate-evaluation'&&['E3','E5','E8'].includes(e.id); // companion profile table identifies these three IPD studies
 input.declaration.design_flags={systematic_search:['sr-ma-adverse-events-rct','trial-level-surrogate-evaluation'].includes(slug)&&!(slug==='trial-level-surrogate-evaluation'&&e.id==='E5'),ipd:surrogateIpd||/individual (participant|patient) data|\bIPD\b/i.test(desc),network_ma:/network meta/i.test(desc),multi_instrument:slug==='cis-mr-colocalisation-drug-target'&&['E1','E2'].includes(e.id),proteome_wide:slug==='cis-mr-colocalisation-drug-target'&&['E4','E6','E7'].includes(e.id)||/proteome-wide/i.test(desc),drug_selectivity_claim:false,new_wet_lab_data:false};
  input.manifest=(e.measured.supplement_types??[]).map((title:string,i:number)=>({title,path:'supplement-'+i,kind:classifyCaption(title,p).join(' ')}));
  const report=lintExemplar(input);
  positive.push({genre:slug,id:e.id,flagSource:'Profile companion identifies surrogacy IPD E3/E5/E8; JSON notes identify E5 without search, MR proteome-wide E4/E6/E7 and multi-instrument E1/E2. Remaining flags use citation/correction wording; drug-selectivity/new-wet-lab default false pending individual design review.',flags:input.declaration.design_flags,summary:report.summary,findings:report.findings.filter(f=>!['S7','D7','G1'].includes(f.rule)).map(({rule,severity,target,basis,ruleClass})=>({rule,severity,target,basis,ruleClass})),frequencyFails:report.findings.filter(f=>f.severity==='FAIL'&&f.ruleClass==='CONVENTION').length,guidelineFindings:report.findings.filter(f=>f.basis==='guideline').map(f=>({rule:f.rule,severity:f.severity,target:f.target,classification:'below guideline'}))});
  for(const [id,value] of Object.entries(e.measured.section_words??{})){
   const others=p.exemplars.filter(x=>x!==e).map(x=>x.measured.section_words?.[id]).filter((x:any)=>typeof x==='number') as number[];
   if(others.length<2)continue;const min=Math.min(...others),max=Math.max(...others);loo.push({genre:slug,id:e.id,section:id,words:value,min,max,pass:(value as number)>=.5*min&&(value as number)<=1.5*max});
  }
 }
 for(const statement of p.required_statements.filter(s=>s.basis==='guideline')){const fraction=statement.frequency?.match(/^(\d+)\/(\d+)/);if(!fraction)continue;const eligible=positive.filter(x=>x.genre===slug&&(!statement.applies_when||x.flags[statement.applies_when]!==false)).length;const expected=eligible-Number(fraction[1]);const observed=positive.filter(x=>x.genre===slug&&x.findings.some((f:any)=>f.rule==='T1'&&f.target===`required_statements[${statement.id}]`)).length;guideline.push({genre:slug,target:`required_statements[${statement.id}]`,frequency:statement.frequency,eligible,expectedAbsent:expected,observedT1:observed,pass:observed===expected,note:statement.applies_when?'Conditional design flags reduce the eligible denominator; reported occurrences remain fixed.':undefined});}
}
const rates:any[]=[];
for(const slug of Object.keys(PINS)){const papers=positive.filter(p=>p.genre===slug);const rules=[...new Set(papers.flatMap(p=>p.findings.map((f:any)=>f.rule)))];for(const rule of rules){const counts=Object.fromEntries(['FAIL','FAIL-W','WARN'].map(severity=>[severity,papers.filter(p=>p.findings.some((f:any)=>f.rule===rule&&f.severity===severity&&['frequency','both'].includes(f.basis))).length]));rates.push({genre:slug,rule,total:papers.length,...counts});}}
const standardRates=positive.map(p=>({genre:p.genre,id:p.id,fail:p.findings.filter((f:any)=>f.ruleClass==='AMANI-STANDARD'&&f.severity==='FAIL').length,waivable:p.findings.filter((f:any)=>f.ruleClass==='AMANI-STANDARD'&&f.severity==='FAIL-W').length,warn:p.findings.filter((f:any)=>f.ruleClass==='AMANI-STANDARD'&&f.severity==='WARN').length}));
const report={classificationPolicy:'owner-decision-2026-10-13-round3',amaniStandardRates:standardRates,guidelineStatementFrequencies:guideline,counter:{passed:counter.filter(c=>c.pass).length,total:counter.length,results:counter},positive:{results:positive,rates,frequencyFailMedian:positive.map(p=>p.frequencyFails).sort((a,b)=>a-b)[Math.floor(positive.length/2)],maxFrequencyFail:Math.max(...positive.map(p=>p.frequencyFails)),overQuarterRules:rates.filter(r=>['FAIL','FAIL-W','WARN'].some(s=>r[s]/r.total>.25))},leaveOneOut:{passed:loo.filter(x=>x.pass).length,total:loo.length,fraction:loo.filter(x=>x.pass).length/loo.length,results:loo}};
console.log(JSON.stringify({counter:[report.counter.passed,report.counter.total],counterFailures:counter.filter(x=>!x.pass).map(x=>({genre:x.genre,id:x.id,checks:x.checks.filter((c:any)=>!c.pass)})),positive:{median:report.positive.frequencyFailMedian,max:report.positive.maxFrequencyFail,overQuarterRules:report.positive.overQuarterRules.length},leaveOneOut:report.leaveOneOut.fraction},null,2));

const perGenre=Object.keys(PINS).map(genre=>{const counts=positive.filter(p=>p.genre===genre).map(p=>p.frequencyFails).sort((a,b)=>a-b);const mid=Math.floor(counts.length/2);return {genre,median:counts.length%2?counts[mid]:(counts[mid-1]+counts[mid])/2,max:Math.max(...counts)};});
const acceptance={eachGenre:perGenre.every(p=>p.median===0&&p.max<=2),counter:report.counter.passed===53&&report.counter.total===53,positiveFrequencyFails:report.positive.frequencyFailMedian===0&&report.positive.maxFrequencyFail<=2,leaveOneOut:report.leaveOneOut.fraction>=.9};
const outcome={...report,perGenre,acceptance,accepted:Object.values(acceptance).every(Boolean)};
writeFileSync(path.join(ROOT,'reports/genre-calibration-round3.json'),JSON.stringify(outcome,null,2)+'\n');
console.log(JSON.stringify({acceptance,accepted:outcome.accepted},null,2));
if(!outcome.accepted)process.exitCode=1;
