// Run serially: one precisely scoped guard mutation, restored in finally. Syntax/runtime
// crashes are not kills; Vitest must report an assertion failure in a targeted regression.
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const pkg='packages/omb-certify/';
const mutants=[
 ['binding','src/auth.ts','canonicalJson(v.binding) !== canonicalJson(binding)','false','test/auth.test.ts'],
 ['hmac','src/auth.ts',"!timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(this.mac(payload), 'hex'))",'false','test/auth.test.ts'],
 ['adopt','src/certify.ts','const adopted=request.adopt===true||request.lock===null;','const adopted=false;','test/certify.test.ts'],
 ['work-limit','src/permutation.ts',"status: PermutationResult['status']='unresolved'","status: PermutationResult['status']='reject'",'test/permutation.test.ts'],
 ['permutation-ties','src/permutation.ts','score(stat) >= observed - 1e-12*Math.max(1,Math.abs(observed))','score(stat) > observed + 1e-12*Math.max(1,Math.abs(observed))','test/permutation.test.ts'],
 ['alpha-calibration','src/producers.ts','if(entry.p<=claim.alpha)rejected++','if(entry.p<=.05)rejected++','test/producers.test.ts'],
 ['signed-mei','src/producers.ts',"const effect=claim.direction==='less'?-claim.mei:claim.mei",'const effect=claim.mei','test/producers.test.ts'],
 ['joint-rank','src/producers.ts',"catch{joint='aligned';}","catch{joint='estimable';}",'test/producers.test.ts'],
 ['cache-hash','src/stage.ts','canonicalSha256(treeManifest(directory))!==receipt.staged.effectiveManifestHash','false','test/stage.test.ts'],
 ['unresolved-fallback','src/certify.ts',"p:result.status==='unresolved'?null:result.p??result.pUpper", "p:result.status==='unresolved'?entry.p:result.p??result.pUpper",'test/certify.test.ts'],
];
const results=[];
for(const [name,file,needle,replacement,test] of mutants){
 const target=pkg+file,source=readFileSync(target,'utf8');if(!source.includes(needle)||source.split(needle).length!==2)throw new Error(`mutation boundary drift: ${name}`);
 try{
  writeFileSync(target,source.replace(needle,replacement));
  const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',pkg+test,'--reporter=json'],{encoding:'utf8',timeout:9000,maxBuffer:5e6});
  let report;try{report=JSON.parse(run.stdout.slice(run.stdout.indexOf('{')));}catch{report=null;}
  const failures=(report?.testResults??[]).flatMap(t=>t.assertionResults??[]).filter(t=>t.status==='failed'&&(t.failureMessages??[]).some(m=>/AssertionError/.test(m)));
  results.push({name,file,killed:run.status!==0&&failures.length>0,assertions:failures.map(f=>f.fullName)});
  process.stdout.write(`${name}: ${results.at(-1).killed?'killed':'SURVIVED / non-assertion failure'}\n`);
 }finally{writeFileSync(target,source);}
}
writeFileSync(pkg+'GUARD-MUTATIONS.json',JSON.stringify({mutations:results,killed:results.filter(r=>r.killed).length,total:results.length},null,2)+'\n');
if(results.some(r=>!r.killed))process.exitCode=1;
