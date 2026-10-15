import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const c='packages/omb-certify/',g='packages/omb-gauntlet/';
const mutants=[
 ['mc-plus-one',c+'src/monte-carlo.ts','(1 + extreme) / (1 + draws)','extreme / draws',c+'test/v2b-monte-carlo.test.ts'],
 ['mc-extension-validity',c+'src/monte-carlo.ts','Math.max(first.p,last.p)','last.p',c+'test/v2b-monte-carlo.test.ts'],
 ['declared-identity',c+'src/declared-stage.ts',"const present=t.header.includes('unit_id')","t.rows=t.rows.slice(0,1); const present=t.header.includes('unit_id')",c+'test/v2b-staging-facts.test.ts'],
 ['unit-exchangeability',c+'src/producers.ts',"if(claim.permutationLevel!=='unit')throw",'if(false)throw',c+'test/v2b-staging-facts.test.ts'],
 ['row-accounting-reasons',c+'src/facts.ts','reasons.every(r=>spec.allowedReasons!.includes(r))','true',c+'test/v2b-staging-facts.test.ts'],
 ['hc3-leverage',c+'src/robust.ts','xr[i]!*e/(1-h)/xx','xr[i]!*e/xx',c+'test/v2b-performance.test.ts'],
 ['bernoulli-plasmode',c+'src/producers.ts','binary?probabilities.map(p=>rng.uniform()<p?1:0)','false?probabilities.map(p=>rng.uniform()<p?1:0)',c+'test/v2b-performance.test.ts'],
 ['b7-table',c+'src/integrity.ts',"flags.push('CI excludes its own estimate')","void 0",c+'test/v2b-performance.test.ts'],
 ['shared-lock',g+'src/plan.ts','...(plan.sharedKnobs===undefined?{}:{sharedKnobs:plan.sharedKnobs}),','',g+'test/v2b.test.ts'],
 ['material-boundary',g+'src/decision.ts','ci[0]>bounds[1]:claim.direction','ci[0]>=bounds[1]:claim.direction',g+'test/v2b.test.ts'],
 ['deterministic-only-recovery',g+'src/labels.ts',"kind==='reproduction' && claim.estimand==='deterministic fact'","kind==='reproduction'",g+'test/v2b.test.ts'],
 ['claim-isolation',c+'src/certify.ts',"||gates[i]!.gate==='G4'&&gates[i]!.claimId===claim.id)","||gates[i]!.gate==='G4')",c+'test/v2b-integration.test.ts'],
];
const results=[];
for(const [name,file,needle,replacement,test] of mutants){
 const source=readFileSync(file,'utf8');if(source.split(needle).length!==2)throw new Error(`boundary drift: ${name}`);
 try{writeFileSync(file,source.replace(needle,replacement));
  const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',test,'--maxWorkers=1','--reporter=json'],{encoding:'utf8',timeout:15000,maxBuffer:5e6});
  let report;try{report=JSON.parse(run.stdout.slice(run.stdout.indexOf('{')));}catch{report=null;}
  const failures=(report?.testResults??[]).flatMap(t=>t.assertionResults??[]).filter(t=>t.status==='failed'&&(t.failureMessages??[]).some(m=>/AssertionError/.test(m)));
  const result={name,file,killed:run.status!==0&&failures.length>0,assertions:failures.map(f=>f.fullName)};results.push(result);process.stdout.write(`${name}: ${result.killed?'killed':'SURVIVED or non-assertion failure'}\n`);
 }finally{writeFileSync(file,source);}
}
writeFileSync(c+'V2B-GUARD-MUTATIONS.json',JSON.stringify({mutations:results,total:results.length,killed:results.filter(r=>r.killed).length},null,2)+'\n');
if(results.some(r=>!r.killed))process.exitCode=1;
