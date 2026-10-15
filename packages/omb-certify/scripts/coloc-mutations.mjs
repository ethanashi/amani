// Serial guard mutations. A crash is not a kill; require a Vitest assertion failure.
// Sources are restored in finally. Only exact child processes are started; no process scans/kills.
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const dirty=spawnSync('git',['status','--porcelain','--','packages/omb-procedures/src','packages/omb-certify/src'],{encoding:'utf8'}).stdout.trim();
if(dirty)throw new Error('commit source edits before mutating');
const p='packages/omb-procedures/src/',c='packages/omb-certify/src/';
const cases=[
 ['directory-gate',c+'certify.ts','certifyProcedureOutputs(reg,procedureResult,',"certifyProcedureOutputs(reg,{diagnostics:[{...reg.assumptions[0],status:'pass',valid_alternatives:[],detail:'mutant'}]},"],
 ['failed-diagnostic',c+'procedure-diagnostics.ts',"d.status === 'fail' ||",'false ||'],
 ['mandatory-not-evaluable',c+'procedure-diagnostics.ts','a.mandatory === true','a.mandatory === false'],
 ['missing-diagnostic',c+'procedure-diagnostics.ts','if (!diagnostics.some(d => d.id === assumption.id))','if (false)'],
 ['blocked-alternative',c+'procedure-diagnostics.ts','!blocked(a) && computed(a)','computed(a)'],
 ['ancestor-block',c+'procedure-diagnostics.ts'," || b.startsWith(a + '.')",''],
 ['metadata-block',c+'procedure-diagnostics.ts','...(metadata.assumptions.find(a => a.id === d.id)?.blocks ?? [])', '...[]',true],
 ['official-reroute',c+'procedure-diagnostics.ts','if (!blocked(field) && computed(field))','if (computed(field))'],
 ['per-variant-SE',p+'coloc-abf.ts','a.map(v=>logABF(v,priors.sd1))','a.map(v=>logABF({...v,se:a[0].se},priors.sd1))'],
 ['distinct-H3',p+'coloc-abf.ts','Math.log(p1)+Math.log(p2)+distinct','-Infinity'],
 ['prior-SD',p+'coloc-abf.ts','(sd/se)**2','sd/se'],
 ['marginal-filter',p+'coloc-ld.ts','if(p<=threshold && twoSidedP(stats[i]!.beta/stats[i]!.se)>threshold)','if(false)'],
 ['collinearity',p+'coloc-ld.ts','if(ri.reduce((sum,x,k)=>sum+x*weights[k]!,0)>=maxR2)','if(false)'],
 ['conditioning-variance',p+'coloc-ld.ts','se:v.se/Math.sqrt(q)','se:v.se'],
 ['conditioning-effect',p+'coloc-ld.ts','beta:v.se*residual/q','beta:v.se*residual'],
 ['rare-rare-mask',p+'coloc.ts',' && Math.max(a[other]!.maf,a[target]!.maf)>=.05',''],
 ['mask-frequency-limit',p+'coloc.ts','(!rarePair||maskR2>maxR2)','true'],
 ['mask-other-signals',p+'coloc.ts','r[k]![lead]!**2<maskR2','true'],
 ['method-sensitive',p+'coloc.ts',"return 'method-sensitive';","return 'shared-variant';"],
 ['ld-screen',p+'coloc-ld.ts','if(twoSidedP(residual)<alpha/Math.max(1,tests))','if(false)'],
 ['multi-signal-diagnostic',p+'coloc.ts',"multiple?'fail':'pass'","multiple?'pass':'pass'"],
 ['cap-refusal',p+'coloc-ld.ts','if(step===maxSignals)return {leads,exhausted:true','if(step===maxSignals)return {leads,exhausted:false'],
 ['nested-invalid-mask',c+'certify.ts',"...(!maskBlocked?{masking}:{})","...({masking})"],
];
const tests=['packages/omb-procedures/test/coloc-abf.test.ts','packages/omb-procedures/test/coloc.test.ts','packages/omb-certify/test/coloc.test.ts','packages/omb-certify/test/procedure-diagnostics.test.ts','packages/omb-certify/test/procedure-diagnostics-route.test.ts'];
const directory='packages/omb-certify/.coloc-mutations';mkdirSync(directory,{recursive:true});
const results=[];
try {
 for(const [name,file,needle,replacement,all] of cases){
  const source=readFileSync(file,'utf8'),count=source.split(needle).length-1;
  if(count!==1&&!all)throw new Error(`${name}: needle count ${count}`);
  const report=`${directory}/${name}.json`;rmSync(report,{force:true});
  let execution;
  try {
   writeFileSync(file,all?source.split(needle).join(replacement):source.replace(needle,replacement));
   execution=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',...tests,'--maxWorkers=2','--reporter=json',`--outputFile=${report}`],{encoding:'utf8',env:process.env});
  } finally {writeFileSync(file,source);}
  let parsed;try{parsed=JSON.parse(readFileSync(report,'utf8'));}catch{}
  const assertions=parsed?.testResults?.flatMap(t=>t.assertionResults??[]).filter(a=>a.status==='failed')??[];
  const result={name,killed:execution.status!==0&&assertions.length>0,failedAssertions:assertions.length,exitCode:execution.status};results.push(result);console.log(JSON.stringify(result));
 }
} finally {
 writeFileSync('packages/omb-certify/calibration/coloc-mutation-results.json',JSON.stringify(results,null,2)+'\n');
 rmSync(directory,{recursive:true,force:true});
}
if(results.some(r=>!r.killed))process.exitCode=1;
