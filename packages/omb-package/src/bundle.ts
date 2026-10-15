import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, cpSync, rmSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { sign, type KeyObject } from 'node:crypto';
import { assert, canonicalJson, canonicalSha256, safePath, sha256 } from './common.ts';
import type { BundleManifest, PackageCertificate } from '@omerta-bio/certificate';
import { softwareCitations } from './provenance.ts';
import { command, ROOT, type Toolchain } from './toolchain.ts';
import type { GateResult, PackageRequest, Submission } from './types.ts';
export function write(root:string,name:string,bytes:string|Uint8Array):void {const dest=path.join(root,safePath(name));mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,bytes);}
export function inventory(root:string):Record<string,string>{
  const out:Record<string,string>={};
  const visit=(relative:string)=>{for(const name of readdirSync(path.join(root,relative)).sort()){const rel=relative?`${relative}/${name}`:name;const file=path.join(root,rel);const stat=lstatSync(file);assert(!stat.isSymbolicLink(),'symlink in bundle');if(stat.isDirectory())visit(rel);else{assert(stat.isFile(),'non-regular bundle file');out[rel]=sha256(readFileSync(file));}}};visit('');return out;
}
export function assembleBundle(root:string,s:Submission,templates:Record<string,string>):void {
  const plan=s.reproduction,seen=new Set<string>();
  for(const f of plan.files){safePath(f.path);assert(/^(?:code|data|environment)\//.test(f.path),'reproduction file outside allowed directories');assert(!seen.has(f.path),'duplicate reproduction file');seen.add(f.path);assert(sha256(f.bytes)===f.sha256,'reproduction file hash mismatch');write(root,f.path,f.bytes);}
  assert(seen.has(plan.entrypoint)&&plan.entrypoint.startsWith('code/'),'analysis entrypoint missing');
  assert(seen.has('environment/pixi.toml')&&seen.has('environment/pixi.lock'),'analysis environment lockfiles missing');
  assert(sha256(readFileSync(path.join(root,'environment/pixi.lock')))===plan.environmentLock,'analysis environment lock hash mismatch');
  for(const d of plan.data){assert(d.access==='public'&&d.license.trim(),'data pointer lacks public licence');assert(seen.has(d.path)&&d.path.startsWith('data/'),'data must be fetched and hash-checked before offline packaging');assert(sha256(readFileSync(path.join(root,d.path)))===d.sha256,'data pointer hash mismatch');}
  assert(plan.data.length>0,'data inventory empty');assert(plan.license.trim(),'bundle licence missing');
  write(root,'LICENSE',plan.license+'\n');
  const {transcripts:_transcripts,...publicPlan}=plan;
  write(root,'reproduction.json',canonicalJson({...publicPlan,files:plan.files.map(f=>({path:f.path,sha256:f.sha256})),pythonVersion:[3,13,9]})+'\n');
  write(root,'reproduce.py',readFileSync(path.join(ROOT,'scripts/reproduce.py')));
  write(root,'reproduce','#!/bin/sh\nset -eu\ncd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec pixi run --locked --manifest-path environment/pixi.toml python "$PWD/reproduce.py" "$@"\n');chmodSync(path.join(root,'reproduce'),0o755);
  write(root,'run_all.sh','#!/bin/sh\nset -eu\nexec "$(dirname -- "$0")/reproduce" "$@"\n');chmodSync(path.join(root,'run_all.sh'),0o755);
  write(root,'software-citations.json',canonicalJson(softwareCitations(s))+'\n');
  write(root,'data-pointers.json',canonicalJson(plan.data)+'\n');
  write(root,'seeds.json',canonicalJson(plan.seeds)+'\n');
  write(root,'paper-input.json',canonicalJson(s.input)+'\n');
  write(root,'locked-plan.json',canonicalJson({plan:s.input.lockedPlan,lock:s.input.lock,timestamps:s.input.timestamps,looks:s.input.lookLedger})+'\n');
  write(root,'citation-snapshots.json',canonicalJson(s.manuscript.references)+'\n');
  write(root,'gate-ledger.json',canonicalJson(s.input.certifications.map(c=>({id:c.id,gates:c.certificate.gates})))+'\n');
  write(root,'top-table.json',canonicalJson(s.manuscript.checklists.find(c=>c.name==='TOP 2025'))+'\n');
  for(const [name,text] of Object.entries(templates))write(root,name==='internal-review.html'?'internal/internal-review.html':name,text);
  for(const [i,d] of plan.data.entries())write(root,`datasheets/data-${i+1}.json`,canonicalJson({...d,intendedUse:'Research only; no clinical use.',subgroups:'not available in source data'})+'\n');
  for(const d of s.manuscript.displays){write(root,`tables/${d.id}.csv`,d.csv);write(root,`tables/${d.id}.dictionary.csv`,d.dictionary);if(d.svg)write(root,`source-figures/${d.id}.svg`,d.svg);}
  for(const c of s.manuscript.checklists)write(root,`checklists/${c.name.replace(/[^a-zA-Z0-9_-]/g,'-')}.json`,canonicalJson(c)+'\n');
  write(root,'README.txt','Local reproducibility package. Run ./reproduce (pixi required; first run provisions the locked environment). Analysis runs without network in Seatbelt on macOS or bubblewrap on Linux. No original repository is needed. Authenticate certificate-public.pem against the author\'s trusted public-key fingerprint before relying on provenance. The signature proves origin, not scientific validity. The gate ledger records all results, including failures. PW10 gate recomputation is a separate interface and is not claimed by this package.\n');
}
export function sealBundle(root:string,r:PackageRequest,gates:GateResult[],key:KeyObject,extra:Record<string,unknown>):Record<string,unknown>{
  const manifest:BundleManifest={schema:'omb/bundle-manifest@1',files:inventory(root)};
  write(root,'bundle-manifest.json',canonicalJson(manifest)+'\n');
  const certificate:PackageCertificate={schema:'omb/package-certificate@1',paperInputHash:r.submission.input.sha256,skeletonHash:r.submission.manuscript.skeletonHash,bundleHash:canonicalSha256(manifest),gauntletVersion:r.submission.framework.gauntletVersion,calibrationId:r.submission.framework.calibrationId,gateResults:r.submission.input.certifications.map(c=>({id:c.id,gates:c.certificate.gates})),packagingGates:gates,endorsement:r.endorsement,review:r.review,...extra};
  const payload=Buffer.from(canonicalJson(certificate));write(root,'certificate.payload.json',payload);write(root,'certificate.sig',sign(null,payload,key));
  const publicKey=key.type==='private'?requirePublic(key):key;
  write(root,'certificate-public.pem',publicKey.export({format:'pem',type:'spki'}).toString());
  return certificate;
}
import { createPublicKey } from 'node:crypto';
function requirePublic(key:KeyObject):KeyObject{return createPublicKey(key);}
export { verifyBundle } from '@omerta-bio/verifier';
export async function freshSandbox(root:string,tc:Toolchain):Promise<Record<string,unknown>>{
  const scratchRoot=path.join(ROOT,'.tmp');mkdirSync(scratchRoot,{recursive:true});const fresh=mkdtempSync(path.join(scratchRoot,'reproduce-'));
  try{
    cpSync(root,path.join(fresh,'bundle'),{recursive:true,filter:source=>!path.relative(root,source).split(path.sep).some(part=>part==='.pixi'||part==='.reproduction')});
    const result=await command(tc.python,[path.join(fresh,'bundle/reproduce.py')],fresh);
    const receipt=JSON.parse(result) as Record<string,unknown>;assert(receipt.network==='denied'&&receipt.expectedOutputsVisibleToAnalysis===false,'fresh sandbox receipt missing isolation');return receipt;
  }finally{rmSync(fresh,{recursive:true,force:true});}
}
