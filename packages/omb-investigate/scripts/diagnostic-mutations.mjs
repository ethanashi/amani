// Repository practice: one source mutation at a time; assertion failures kill it, crashes do not.
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root='packages/omb-investigate';
const cases=[];
function mutation(name,file,needle,replacement,test){cases.push({name,file:`${root}/src/${file}.ts`,needle,replacement,testFile:`${root}/test/${test}.test.ts`});}
mutation('declared-assumption-required','assumptions','for (const [id, at] of declarations)','for (const [id, at] of new Map())','assumption-plan');
mutation('failed-method-replaced','assumptions',"r.pass.method === r.fail.method || r.pass.output === r.fail.output",'false','assumption-plan');
mutation('flag-only-narrative','assumptions',"if (failure && weak.test(x) && !(hasDecision && switchesOfficial && !optionalSwitch))",'if (false)','assumption-plan');
mutation('anti-switching-narrative','assumptions',"if (failure && bans.some", "if (false && bans.some",'assumption-plan');
mutation('every-outcome-required','assumptions'," || !action(r['not-evaluable'])",'','assumption-plan');
mutation('plan-check-wired','plan-check','issues.push(...assumptionIssues(record, assumptions));','','assumption-plan');
mutation('no-unresolved-lock-fallback','investigation','if (check.issues.some(i => i.code.startsWith("assumption-")))','if (false)','assumption-plan');
mutation('registry-rechecked-at-lock','investigation','if (assumptionCheck.issues.some(i => i.code.startsWith("assumption-")))','if (false)','assumption-plan');
mutation('failed-diagnostic-blocks','diagnostics',"d.status === 'fail'",'false','diagnostics-publication');
mutation('mandatory-not-evaluable','diagnostics',"a.mandatory === true",'false','diagnostics-publication');
mutation('claims-blocked','diagnostics','if (!blocked || c.voided) return c;','if (true) return c;','diagnostics-publication');
mutation('transitive-field-provenance','diagnostics','result.fieldSources?.[key] ?? []','[]','diagnostics-publication');
mutation('valid-alternatives-used','diagnostics','answers[key] = value','void value','diagnostics-publication');
mutation('all-alternatives-not-best','diagnostics','for (const key of d.valid_alternatives)','for (const key of d.valid_alternatives.slice(0,1))','diagnostics-publication');
mutation('blocked-output-removed','diagnostics',"if (blocks.some(b => key === b || key.startsWith(b + '.'))",'if (false','diagnostics-publication');
mutation('interpretation-gated','investigation','if (certification.diagnosticIntegrity?.blocked.length)','if (false)','diagnostics-publication');
mutation('deliverable-prose-gated','deliverable',' && !publication.diagnosticIntegrity!.blocked.length','','diagnostics-publication');
mutation('worker-signal-detection','methods-validity','return [...new Set(matches)].slice(0,16)','return [].slice(0,16)','methods-validity');
mutation('independent-pass-runs','investigation','()=>this.#methodsValidity(ctx,certification ?? cert.certification)','async()=>({status:"not-evaluable",objections:[],advisory:true})','methods-validity');
mutation('methods-choice-isolation','investigation',"workdir:this.#work('methods-validity')},mounts:[]", "workdir:this.#work('methods-validity')},mounts:[{role:'locked-plan',path:this.#share('locked-plan')}]",'methods-validity');
mutation('implementation-only-label','investigation','...replicator,scope:"implementation-agreement",methodsCorroboration:false','...replicator,scope:"implementation-agreement",methodsCorroboration:true','methods-validity');
mutation('advisory-never-grants-remedy','triage',"if(rule.mode==='audit')",'if(false)','methods-validity');
mutation('flag-with-valid-switch-accepted','assumptions','!(hasDecision && switchesOfficial && !optionalSwitch)','true','assumption-plan');
mutation('valid-alternatives-anti-cherry-picking','assumptions','if (failure && bans.some', 'if (failure && bans.length > 0 || false && bans.some','assumption-plan');
mutation('existing-certified-metric-alternatives','diagnostics','{...result.metrics, ...result.outputs ?? {}}','result.outputs ?? {}','diagnostics-publication');
const requested=process.argv.slice(2);
if(requested.length){for(const name of requested)if(!cases.some(c=>c.name===name))throw Error(`unknown mutant: ${name}`);cases.splice(0,cases.length,...cases.filter(c=>requested.includes(c.name)));}
const original=new Map(cases.map(c=>[c.file,readFileSync(c.file,'utf8')]));
for(const c of cases){const s=original.get(c.file);if(!s.includes(c.needle)||s.indexOf(c.needle)!==s.lastIndexOf(c.needle))throw Error(`nonunique mutant: ${c.name}`);}
const run=tests=>spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',...tests,'--maxWorkers=2'],{encoding:'utf8',timeout:60000,maxBuffer:4000000});
const baseline=run([...new Set(cases.map(c=>c.testFile))]);
if(baseline.status!==0)throw Error('baseline failed: '+baseline.stdout+baseline.stderr);
const results=[];
try{for(const c of cases){
 writeFileSync(c.file,original.get(c.file).replace(c.needle,c.replacement));let r;
 try{r=run([c.testFile]);}finally{writeFileSync(c.file,original.get(c.file));}
 const failedTests=[...(r.stdout+r.stderr).matchAll(/^ FAIL +[^>]+> (.+)$/gm)].map(m=>m[1]);
 const status=r.error || /Test timed out|Hook timed out/.test(r.stdout+r.stderr)?'inconclusive':r.status===0?'survived':failedTests.length?'killed':'inconclusive';
 results.push({name:c.name,file:c.file,status,failedTests});process.stdout.write(`${c.name}: ${status}\n`);
}}finally{for(const [f,s]of original)writeFileSync(f,s);}
const report={operator:'one-at-a-time source guard mutations',sourceSha256:Object.fromEntries([...original].map(([f,s])=>[f,createHash('sha256').update(s).digest('hex')])),total:results.length,killed:results.filter(r=>r.status==='killed').length,results};
writeFileSync(`${root}/integration/diagnostic-mutations${requested.length?"-supplement":""}.json`,JSON.stringify(report,null,2)+'\n');
if(report.killed!==report.total)process.exitCode=1;
