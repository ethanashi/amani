import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, readFileSync, realpathSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { git } from './guards.ts';
import { assertRepairAPI, CHECKPOINT_ADAPTER } from './repair-api.ts';
export interface ExecutableIdentity { commit:string; tree:string; files:Record<string,string>; runtimeRoot:string|null; runtimeFiles:Record<string,string>; digest:string }
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function regularBytes(repo:string,file:string):Buffer {
  const full=path.join(repo,file);
  for(let p=full;p!==repo;p=path.dirname(p)){
    const stat=lstatSync(p);
    if(stat.isSymbolicLink()||p===full&&(!stat.isFile()||stat.nlink!==1))throw new Error(`linked executable path: ${file}`);
  }
  if(realpathSync(full)!==full)throw new Error(`noncanonical executable path: ${file}`);
  return readFileSync(full);
}
/** Bind the whole committed source tree, including package/config resolution inputs.
 * Repair source has no imports; therefore the resume closure is exactly this adapter. */
export function checkoutIdentity(repo:string,commit:string):ExecutableIdentity {
  if(git(repo,['rev-parse','HEAD']).trim()!==commit||git(repo,['status','--porcelain','--untracked-files=no']).trim())throw new Error('checkout is not the exact clean accepted commit');
  const files:Record<string,string>={};
  for(const entry of git(repo,['ls-tree','-rz',commit]).split('\0').filter(Boolean)){
    const [meta,file]=entry.split('\t');
    if(!file||!/^100(?:644|755) blob /.test(meta!))throw new Error('nonregular committed source');
    const bytes=regularBytes(repo,file);
    if(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')!==meta!.split(' ')[2])throw new Error(`committed bytes differ: ${file}`);
    files[file]=hash(bytes);
  }
  assertRepairAPI(regularBytes(repo,CHECKPOINT_ADAPTER).toString('utf8'));
  const tree=git(repo,['rev-parse',`${commit}^{tree}`]).trim();
  const runtimeRoot=existsSync(path.join(repo,'node_modules'))?realpathSync(path.join(repo,'node_modules')):null;
  const runtimeFiles:Record<string,string>={};
  if(runtimeRoot){
    const walk=(dir:string)=>{for(const name of readdirSync(dir).sort()){
      if(['.vite','.vite-temp','.cache'].includes(name))continue;
      const full=path.join(dir,name),stat=lstatSync(full),rel=path.relative(runtimeRoot,full);
      if(stat.isSymbolicLink()){
        const resolved=realpathSync(full);
        if(!resolved.startsWith(runtimeRoot+path.sep))throw new Error('dependency escapes pinned runtime');
        runtimeFiles[rel]='link:'+path.relative(runtimeRoot,resolved);
      }else if(stat.isDirectory())walk(full);
      else if(stat.isFile())runtimeFiles[rel]=hash(readFileSync(full));
      else throw new Error('nonregular runtime dependency');
    }};walk(runtimeRoot);
  }
  return{commit,tree,files,runtimeRoot,runtimeFiles,digest:hash(JSON.stringify({tree,files,runtimeFiles}))};
}
export function assertCheckout(repo:string,identity:ExecutableIdentity):void {
  const current=checkoutIdentity(repo,identity.commit);
  if(current.digest!==identity.digest)throw new Error('executable bytes changed after review');
}
/** Load the exact bytes just revalidated, without a filesystem loader or module cache.
 * There is no require/import, host global, search path, or scratch resolution capability. */
export function loadAcceptedAdapter(repo:string,identity:ExecutableIdentity):(write:()=>void)=>void {
  assertCheckout(repo,identity);
  const bytes=regularBytes(repo,CHECKPOINT_ADAPTER);
  if(hash(bytes)!==identity.files[CHECKPOINT_ADAPTER])throw new Error('adapter changed immediately before loading');
  assertRepairAPI(bytes.toString('utf8'));
  const code=ts.transpileModule(bytes.toString('utf8'),{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText.replace('export function','function');
  return new vm.Script(`${code}\npersistCheckpoint;`).runInNewContext(Object.create(null),{timeout:1000,contextCodeGeneration:{strings:false,wasm:false}});
}

/** Copy the host-installed tools into the gate checkout, preserving only internal links.
 * Workspace links into the mutable development tree are not gate dependencies. */
export function installGateRuntime(source:string,checkout:string):void {
  if(!existsSync(source))return;
  const root=realpathSync(source);
  // A workspace install's .pnpm store also holds unrelated app dependencies.
  // Only packages reachable from this runtime's root entries belong to the gate.
  // Keep the original layout/links so Node resolution and byte attestation agree.
  const packages=new Set<string>(),links=new Set<string>();
  const add=(entry:string)=>{
    const target=realpathSync(entry);
    if(!target.startsWith(root+path.sep))throw new Error('unapproved external runtime dependency');
    links.add(entry);
    if(packages.has(target))return;
    packages.add(target);
    const manifest=JSON.parse(readFileSync(path.join(target,'package.json'),'utf8'));
    const required=manifest.dependencies??{};
    for(const name of new Set([...Object.keys(required),...Object.keys(manifest.optionalDependencies??{}),...Object.keys(manifest.peerDependencies??{})])){
      let dir=target,found:string|undefined;
      while(dir.startsWith(root+path.sep)||dir===root){
        const candidate=path.join(dir,'node_modules',name);
        if(existsSync(candidate)){found=candidate;break;}
        if(dir===root)break;dir=path.dirname(dir);
      }
      if(!found&&existsSync(path.join(root,name)))found=path.join(root,name);
      if(found)add(found);
      else if(name in required&&!(name in (manifest.optionalDependencies??{})))throw new Error(`missing gate runtime dependency: ${name}`);
    }
  };
  for(const name of readdirSync(root)){
    if(name.startsWith('.')||['@omerta-bio','@amani'].includes(name))continue;
    const entry=path.join(root,name);
    if(name.startsWith('@'))for(const child of readdirSync(entry))add(path.join(entry,child));
    else if(existsSync(path.join(entry,'package.json')))add(entry);
  }
  const selected=[...packages,...links,path.join(root,'.bin')];
  cpSync(root,path.join(checkout,'node_modules'),{recursive:true,verbatimSymlinks:true,filter:from=>{
    if(path.relative(root,from).split(path.sep).some(n=>['.vite','.vite-temp','.cache','@omerta-bio','@amani'].includes(n)))return false;
    if(from!==root&&!selected.some(p=>from===p||from.startsWith(p+path.sep)||p.startsWith(from+path.sep)))return false;
    const stat=lstatSync(from);
    if(stat.isSymbolicLink()&&!realpathSync(from).startsWith(root+path.sep))throw new Error('unapproved external runtime dependency');
    return true;
  }});
}
