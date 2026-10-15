// Conservative linked-code gate. GPL analysis tools installed by pixi run out of process.
import {execFileSync} from 'node:child_process';
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
const root=process.argv[2];
const failures=[];
const forbidden = /(?:^|[^A-Za-z])(?:A?GPL|LGPL)(?:[-\s]|$)|GNU (?:AFFERO |LESSER |GENERAL )*PUBLIC LICENSE/i;
import { approvedLicense } from './licence-policy.mjs';
function checkLicense(license, label) {
  if (!approvedLicense(license)) failures.push(`${label}: unapproved or missing licence ${license || '(missing)'}`);
}
const dirs=['.'];
for(const kind of ['apps','packages']) if(existsSync(path.join(root,kind)))
  for(const e of readdirSync(path.join(root,kind))) if(existsSync(path.join(root,kind,e,'package.json'))) dirs.push(`${kind}/${e}`);
const workspaceNames=new Set(dirs.map(d=>JSON.parse(readFileSync(path.join(root,d,'package.json'),'utf8')).name));
for(const d of dirs) {
  const manifest=JSON.parse(readFileSync(path.join(root,d,'package.json'),'utf8'));
  const dependencies={...manifest.dependencies,...manifest.optionalDependencies};
  if(!Object.keys(dependencies).some(name=>!workspaceNames.has(name)))continue;
  const output=execFileSync('pnpm',['licenses','list','--prod','--json'],{cwd:path.join(root,d),encoding:'utf8'});
  // pnpm prints prose for an empty result. That is not evidence for declared external deps.
  if(!output.trim().startsWith('{'))throw Error(`No licence metadata for production dependencies in ${d}`);
  const report=JSON.parse(output);
  for(const [lic, packages] of Object.entries(report)) for(const p of packages) checkLicense(lic,p.name);
}

const own=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
if(own.license !== 'AGPL-3.0-only' || !readFileSync(path.join(root,'LICENSE'),'utf8').includes('GNU AFFERO GENERAL PUBLIC LICENSE')) failures.push('Root AGPL-3.0-only licence missing');
const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
for(const f of tracked) {
  if(!/(?:\/test\/|\/tests\/)/.test(f) && /^(?:license|licence|copying)(?:\.|$)/i.test(path.basename(f))) {
    const text=readFileSync(path.join(root,f),'utf8');
    if(f !== 'LICENSE' && forbidden.test(text)) failures.push(`GPL-family vendored licence requires external-only review: ${f}`);
  }
  if(/\.(?:ts|tsx|js|mjs|rs|c|cc|cpp|h)$/.test(f) && !/(?:\/test\/|\/tests\/|^scripts\/ci\/)/.test(f)) {
    const text=readFileSync(path.join(root,f),'utf8');
    if(/SPDX-License-Identifier:\s*(?:A?GPL|LGPL)/i.test(text)) failures.push(`GPL source: ${f}`);
    if(/(?:ffi|libloading|dlopen|link\s*\().{0,100}(?:libR\b|libgsl\b)/i.test(text)) failures.push(`GPL library linkage: ${f}`);
  }
  if(f.endsWith('Cargo.lock')) {
    // cargo metadata resolves exact locked Rust dependencies, including transitive crates.
    const host=execFileSync('rustc',['-vV'],{encoding:'utf8'}).match(/^host: (.+)$/m)?.[1];
    if(!host)throw Error('Rust host target missing');
    const meta=JSON.parse(execFileSync('cargo',['metadata','--locked','--format-version','1','--filter-platform',host],{cwd:path.join(root,path.dirname(f)),encoding:'utf8',maxBuffer:32*1024*1024}));
    // Cargo's metadata graph unifies build-time features. Its target-specific
    // tree retains those contexts, so use the same runtime boundary as Studio.
    const tree=execFileSync('cargo',['tree','--locked','--offline','--target',host,'--edges','normal,no-proc-macro','--prefix','none','--format','{p}'],{cwd:path.join(root,path.dirname(f)),encoding:'utf8',maxBuffer:32*1024*1024});
    const runtime=new Set(tree.trim().split('\n').map(line=>line.split(' ').slice(0,2).join(' ')));
    for(const p of meta.packages)if(runtime.delete(`${p.name} v${p.version}`))checkLicense(p.license,`Rust ${p.name}`);
    if(runtime.size)throw Error('Runtime Rust dependencies missing licence metadata: '+[...runtime].join(', '));
    console.log(`Rust ${host}: linked runtime checked; build-only tools recorded in Studio third-party notices.`);
  }
}
for(const f of failures) console.error(f);
console.log('GPL tools may only execute as separate programs; no GPL-family linked dependencies accepted.');
process.exitCode=failures.length?1:0;
