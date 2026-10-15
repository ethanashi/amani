// Run all repository tests with bounded workers. Existing lease-using fixtures set
// BIO_GRADING_ROOT to private temporary roots; do not override simulated live-env tests.
import {writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const env={...process.env,PYTHONDONTWRITEBYTECODE:'1',OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1',MKL_NUM_THREADS:'1',VECLIB_MAXIMUM_THREADS:'1'};
// The pilot's dry tests inject BIO_GRADING_ROOT around actual leases; simulated live
// environment-validation tests correctly reject that override. Defaults, where tested,
// do not acquire the shared lease. Preserve HOME for sealed-fixture and sandbox tests.
for(const k of ['BIO_GRADING_ROOT','BIO_LIVE_ARMC','BIO_LIVE_CLAUDE','BIO_LIVE_REPLICATOR','BIO_LIVE_CODEX','OMB_W0_DATA'])delete env[k];
const results=[];
async function run(args,tag){
 const started=performance.now();let output='';
 const child=spawn('pnpm',args,{env,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 const file=`packages/omb-certify/${tag}.log`;writeFileSync(file,output);
 const result={command:['pnpm',...args].join(' '),code,elapsedSeconds:(performance.now()-started)/1000,sha256:createHash('sha256').update(output).digest('hex'),summary:output.split('\n').filter(l=>/Test Files|Tests  |Duration /.test(l))};results.push(result);
 process.stdout.write(`${tag}: exit ${code}; ${result.elapsedSeconds.toFixed(2)}s\n${result.summary.join('\n')}\n`);
 if(code!==0)throw new Error(`root validation failed: ${file}`);
}
try{
 for(let i=1;i<=2;i++){await run(['typecheck'],`root-typecheck-${i}`);await run(['test','--maxWorkers=4'],`root-test-${i}`);}
}finally{
 writeFileSync('packages/omb-certify/V2B-ROOT-VALIDATION.json',JSON.stringify({isolation:'test-owned private BIO_GRADING_ROOT lease fixtures, no opt-in live arms',runs:results},null,2)+'\n');
}
