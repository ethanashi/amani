// Read-only packaged-engine smoke. A hard process guard rejects any privileged subprocess.
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const commands=[];
for(const name of ['spawn','spawnSync','execFile','execFileSync']){const original=cp[name];cp[name]=function(command,...args){commands.push(command);if(path.basename(command)==='sudo')throw Error('Privileged subprocess prohibited');return original.call(this,command,...args);};}syncBuiltinESMExports();
const repo=path.resolve('release/Amani Studio.app/Contents/Resources/resources/engine/repo');
const {createEngine}=await import(pathToFileURL(path.join(repo,'packages/omb-investigate/src/engine-sidecar.ts')).href);
mkdirSync('.runtime',{recursive:true});const root=mkdtempSync(path.resolve('.runtime/packaged-smoke-'));
const service=createEngine(root,path.join(root,'providers.json'),{privilegedAttestation:false});
const status=await service.call('system.status');assert.equal(status.launcher.attested,false);assert.match(status.launcher.reason,/disabled/);assert.deepEqual(await service.call('investigations.list'),[]);
const {assertSourcePolicy,POLICY_PYTHON}=await import(pathToFileURL(path.join(repo,'packages/omb-certify/src/source-policy.ts')).href);assertSourcePolicy('analysis.py','import math\nx = math.sqrt(4)');
const pin=JSON.parse(readFileSync(path.join(repo,'packages/omb-adapters/opencode-pin.json'),'utf8'));const {createHash}=await import('node:crypto');assert.equal(createHash('sha256').update(readFileSync(pin.path)).digest('hex'),pin.sha256);
writeFileSync('screenshots/real/packaged-smoke.json',JSON.stringify({realService:true,investigations:0,launcher:status.launcher,privilegedSubprocesses:commands.filter(c=>path.basename(c)==='sudo'),analysisPolicyParser:POLICY_PYTHON,opencodePinVerified:true},null,2));console.log('Packaged engine, disabled privilege path, analysis parser and OpenCode pin verified');
