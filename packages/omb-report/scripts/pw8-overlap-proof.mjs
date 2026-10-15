/** Demonstrate masking: either guard alone refuses, removing both admits the
 * controlled malicious fixture. This is evidence of overlap, not three kills. */
import {execFile} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const results=[];
for(const kind of ['annotation','textbox','owner'])for(const layer of ['primary','secondary','both']){
 const p=await new Promise(resolve=>execFile(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','packages/omb-report/scripts/pw8-overlap.config.mjs','--reporter=json'],{env:{...process.env,PW8_OVERLAP_CASE:kind,PW8_OVERLAP_LAYER:layer},maxBuffer:8*1024*1024,timeout:30000},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
 const report=JSON.parse(p.stdout),failures=report.testResults.flatMap(s=>s.assertionResults.filter(a=>a.status==='failed').map(a=>a.fullName));
 if(!p.stderr.includes('APPLIED OVERLAP')||p.error?.killed||report.numTotalTests!==3||report.numPendingTests!==0)throw Error('invalid overlap probe');
 if(layer==='both'?(report.numFailedTests!==1||!failures[0]?.startsWith(kind)):(!!p.error||report.numPassedTests!==3))throw Error('unexpected overlap result '+JSON.stringify({kind,layer,failures}));
 results.push({kind,layer,passed:report.numPassedTests,failed:report.numFailedTests,failures,interpretation:layer==='both'?'both guards removed: malicious input accepted; assertion correctly fails':'one guard removed: remaining guard still refuses'});
 console.log(kind,layer,'expected result');
}
writeFileSync('packages/omb-report/pw8-overlap-results.json',JSON.stringify({schema:'omb/pw8/overlapping-guard-proof@1',productSourcesModified:false,results},null,2)+'\n');
