// One source guard at a time. Only assertion failures count; timeouts/crashes are inconclusive.
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const policy='packages/omb-adapters/src/provider-policy.ts',test='packages/omb-adapters/test/providers.test.ts',service='packages/omb-investigate/src/engine-service.ts',serviceTest='packages/omb-investigate/test/provider-service.test.ts';
const cases=[
 ['cli-family-aliases','packages/omb-adapters/src/providers.ts','|opus|sonnet|haiku','','packages/omb-adapters/test/providers.test.ts'],
 ['vendor-family-normalization','packages/omb-adapters/src/providers.ts',"if(vendors[part])return vendors[part]!;","if(false)return vendors[part]!;",'packages/omb-adapters/test/provider-review.test.ts'],
 ['cross-family',policy,'chain=chain.filter(e=>modelFamily(e.model)!==INDETERMINATE&&modelFamily(e.model)!==modelFamily(input.againstModel!));','chain=chain;',test],
 ['refusal-bytes',policy,"// Refusal is terminal for this provider. The next call uses input.request byte-for-byte.","input.request+=' rewritten';",test],
 ['retry-cap',policy,'++retries<p.retry.maxAttempts','++retries<1',test],
 ['circuit-open',policy,'if(circuit&&circuit.until>now())continue;','if(false)continue;',test],
 ['cooldown',policy,'p.circuitBreaker.cooldownMinutes*60_000','0',test],
 ['auth-disable',policy,'this.disabled.add(entry.provider);','void 0;',test],
 ['repair-cap',policy,'repairs++<p.repairNudges','repairs++<0',test],
 ['fresh-handoff',policy,'restarts++<1','restarts++<0',test],
 ['exhausted-inbox',policy,'h.needsYou(exhausted.message,attempts);','void 0;',test],
 ['disagreement-triage',policy,"else if(o.type==='disagreement')decision='triage';","else if(o.type==='disagreement')decision='failover';",test],
 ['stall-boundary',policy,'this.now()-this.last>=this.stallMs','this.now()-this.last>this.stallMs',test],
 ['secret-redaction','packages/omb-adapters/src/provider-secrets.ts',"text=text.split(form).join('[REDACTED]')","text=text",'packages/omb-adapters/test/api-adapter.test.ts'],
 ['owner-plan-hash',service,"item.payload.planHash!==p.planHash","false",serviceTest],
 ['assistant-readonly',service,"const ranked=rows.map", "this.journal.append(`inv:${id}`,'assistant-mutation',{question});const ranked=rows.map",serviceTest],
 ['partial-pause','packages/omb-investigate/src/turns.ts','if(policyError)throw providerPause(policyError)??policyError;','if(false)throw policyError;',serviceTest],
 ['answer-text-guard','packages/omb-adapters/src/provider-error.ts',"const details=(input.error||input.status!==undefined&&input.status>=400)?text:'';","const details=text;",test],
 ['reviewer-tools','packages/omb-adapters/src/providers.ts',"role==='reviewer'&&!r.chain.some","false&&!r.chain.some",'packages/omb-adapters/test/provider-review.test.ts'],
 ['empty-tools-inbox',policy,'h.needsYou(error.message,[]);throw error;}\n  if(input.requireCrossFamily','throw error;}\n  if(input.requireCrossFamily','packages/omb-adapters/test/provider-review.test.ts'],
 ['unknown-family','packages/omb-adapters/src/providers.ts',"return INDETERMINATE;\n}","return m;\n}",'packages/omb-adapters/test/provider-review.test.ts'],
 ['prefer-continuity',policy,"input.againstModel&&['reviewer','referee'].includes(input.role)&&p.crossFamily==='prefer'","input.againstModel&&p.crossFamily==='prefer'",'packages/omb-adapters/test/provider-review.test.ts'],
 ['retry-circuit',policy,'if(active&&active.until>now())break;','if(false)break;','packages/omb-adapters/test/provider-review.test.ts'],
 ['max-attempts-bound','packages/omb-adapters/src/providers.ts','maxAttempts:10','maxAttempts:1e12','packages/omb-adapters/test/provider-review.test.ts'],
 ['model-option-guard','packages/omb-adapters/src/providers.ts',"!/^\\s*-|[\\x00-\\x1f\\x7f]/.test(model)","!/[\\x00-\\x1f\\x7f]/.test(model)",'packages/omb-adapters/test/provider-review.test.ts'],
 ['broker-token','packages/omb-adapters/src/provider-broker.ts','!timingSafeEqual(auth,wanted)','false','packages/omb-adapters/test/api-adapter.test.ts'],
 ['broker-origin','packages/omb-adapters/src/provider-broker.ts','req.headers.origin!==undefined','false','packages/omb-adapters/test/api-adapter.test.ts'],
 ['broker-host','packages/omb-adapters/src/provider-broker.ts','req.headers.host!==expected','false','packages/omb-adapters/test/api-adapter.test.ts'],
 ['broker-model','packages/omb-adapters/src/provider-broker.ts','JSON.parse(body).model!==o.model','false','packages/omb-adapters/test/api-adapter.test.ts'],
 ['runtime-family-repair','packages/omb-investigate/src/provider-runtime.ts',"type:'family-violation'","type:'non-compliance'",serviceTest],
 ['assistant-citations',service,'!ranked.some(r=>r.seq===seq)','false',serviceTest],

];
const saved=new Map(cases.map(c=>[c[1],readFileSync(c[1],'utf8')]));for(const [id,f,n]of cases){const s=saved.get(f);if(s.split(n).length!==2)throw Error('Nonunique mutation '+id);}
const run=tests=>spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',...tests,'--maxWorkers=2'],{encoding:'utf8',timeout:60000,maxBuffer:4000000,env:{...process.env,BIO_GRADING_ROOT:undefined}});
const baseline=run([...new Set(cases.map(c=>c[4]))]);if(baseline.status!==0)throw Error('Baseline failed: '+baseline.stdout+baseline.stderr);
const results=[];try{for(const [name,file,needle,replacement,testFile]of cases){writeFileSync(file,saved.get(file).replace(needle,replacement));let r;try{r=run([testFile]);}finally{writeFileSync(file,saved.get(file));}const output=r.stdout+r.stderr,failedTests=[...output.matchAll(/^ FAIL +[^>]+> (.+)$/gm)].map(m=>m[1]);const status=r.error||/Test timed out|Hook timed out/.test(output)?'inconclusive':r.status===0?'survived':failedTests.length?'killed':'inconclusive';results.push({name,file,status,failedTests});process.stdout.write(name+': '+status+'\n');}}finally{for(const[f,s]of saved)writeFileSync(f,s);}
const report={sourceSha256:Object.fromEntries([...saved].map(([f,s])=>[f,createHash('sha256').update(s).digest('hex')])),total:results.length,killed:results.filter(r=>r.status==='killed').length,results};writeFileSync('validation/providers/mutations.json',JSON.stringify(report,null,2)+'\n');if(report.killed!==report.total)process.exitCode=1;
