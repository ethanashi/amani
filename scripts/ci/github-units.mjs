// Conservative offline/Linux selector: trace local imports, exclude native/live transitive code.
// This is the inexpensive public-snapshot check, not a replacement for local full CI.
import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root=process.cwd();
const tracked=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const files=new Set(tracked);
const tests=tracked.filter(f=>/^(packages|apps)\/.*\.(test|spec)\.[cm]?[jt]sx?$/.test(f));
const reasons=new Map();
function resolve(from,spec) {
  const base=path.normalize(path.join(path.dirname(from),spec));
  return [base,base.replace(/\.js$/,'.ts'),base+'.ts',base+'.tsx',base+'.js',base+'/index.ts'].find(p=>files.has(p));
}
function unsafe(file, seen=new Set()) {
  if(seen.has(file))return null;
  seen.add(file);
  const text=readFileSync(file,'utf8');
  if(/(^|[/.-])live([/.-]|$)/i.test(file))return 'live suite';
  if(/child_process|sandbox-exec|\.pixi|Rscript|BIO_LIVE|OMB_LIVE|darwin|\/oneshot\/tierb|omerta-bio-heldout/.test(text))return 'native, analysis, provider or host fixture dependency';
  for(const m of text.matchAll(/(?:from\s*|import\s*\(|require\s*\(|import\s*)['"]([^'"]+)['"]/g)) {
    const spec=m[1];
    if(spec.startsWith('.')) {
      const target=resolve(file,spec);
      if(!target) return `unresolved local import: ${spec}`;
      if(/\.[cm]?[jt]sx?$/.test(target)) {const why=unsafe(target,seen);if(why)return why;}
    } else if(!spec.startsWith('node:') && !['vitest','typescript'].includes(spec)) return `requires package-specific environment: ${spec}`;
  }
  return null;
}
const selected=tests.filter(f=>{const why=unsafe(f);if(why)reasons.set(f,why);return !why;});
console.log(JSON.stringify({selected,excluded:Object.fromEntries(reasons)},null,2));
if(!selected.length)throw Error('No portable unit suites discovered');
if(process.argv.includes('--list'))process.exit(0);
const temp=mkdtempSync(path.join(root,'.ci-portable-'));
try {
  const config=path.join(temp,'vitest.config.mjs');
  writeFileSync(config,`export default ${JSON.stringify({test:{include:selected,maxWorkers:2,fileParallelism:true,testTimeout:10000,hookTimeout:10000}})};\n`);
  const r=spawnSync('pnpm',['exec','vitest','run','--config',config],{stdio:'inherit',env:{...process.env,CI:'true'}});
  process.exitCode=r.status??1;
} finally {rmSync(temp,{recursive:true,force:true});}
