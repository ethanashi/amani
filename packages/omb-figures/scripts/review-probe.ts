/** Fail-first proof for test-only review defects; restores the exact source in finally. */
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const [manifest]=process.argv.slice(2);
const mutants=JSON.parse(readFileSync(manifest!,'utf8')) as {id:string;file:string;from:string;to:string;test:string}[];
for(const m of mutants) {
 if(!/^packages\/omb-(figures|citations)\/src\//.test(m.file)) throw Error('outside assignment');
 const original=readFileSync(m.file,'utf8');
 if(original.split(m.from).length!==2) throw Error('anchor not unique: '+m.id);
 try {
  writeFileSync(m.file,original.replace(m.from,m.to));
  const r=spawnSync('nice',['-n','10',process.execPath,'node_modules/vitest/vitest.mjs','run',m.test,'--reporter=json'],{encoding:'utf8',timeout:8000,maxBuffer:8000000});
  const j=JSON.parse(r.stdout);
  if(r.error||!j.numTotalTests||!j.numFailedTests) throw Error('regression did not kill '+m.id+' '+r.stderr);
  process.stdout.write(m.id+': regression failed ('+j.numFailedTests+' assertions)\n');
 } finally {writeFileSync(m.file,original);}
}
