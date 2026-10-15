import { excludesMedicRuntime, releaseSource } from './medic-release-policy.mjs';
import { packageDependencies } from './package-dependencies.mjs';
import { packageCodecRuntime } from './package-codec-runtime.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function buildRelease(repo,out){
  mkdirSync(out,{recursive:false});
  const files=execFileSync('git',['-C',repo,'ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
  for(const file of files){
    if(excludesMedicRuntime(file)||file.includes('/test/')||file.includes('/integration/'))continue;
    const dest=path.join(out,file);mkdirSync(path.dirname(dest),{recursive:true});if(/\.(?:ts|mjs|js|json)$/.test(file))writeFileSync(dest,releaseSource(file,readFileSync(path.join(repo,file),'utf8')));
    else copyFileSync(path.join(repo,file),dest);
  }
  execFileSync(process.execPath,[path.join(repo,'scripts/publish/apply-exclusions.mjs'),out,path.join(repo,'scripts/publish/exclude.txt')]);
  for(const folder of ['apps','.github'])rmSync(path.join(out,folder),{recursive:true,force:true});
  packageDependencies(repo,out,files);
  packageCodecRuntime(repo,out);
  copyFileSync(path.join(out,'packages/omb-amani/src/release-cli.ts'),path.join(out,'packages/omb-amani/src/cli.ts'));
  const pkg=path.join(out,'packages/omb-amani/package.json'),manifest=JSON.parse(readFileSync(pkg,'utf8'));
  manifest.bin={amani:'./src/release-cli.ts'};writeFileSync(pkg,JSON.stringify(manifest,null,2)+'\n');
}
if(process.argv[1]===fileURLToPath(import.meta.url))buildRelease(path.resolve(process.argv[2]??'.'),path.resolve(process.argv[3]));
