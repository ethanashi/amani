import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { assertCheckout, checkoutIdentity, installGateRuntime } from './checkout.ts';
import { git } from './guards.ts';
import { CHECKPOINT_ADAPTER } from './repair-api.ts';

/** A gate receives base-owned tests/configuration and the exact accepted source.
 * Never copy a working directory: archives omit ignored/untracked author scratch.
 * Each invocation owns its source, tools, HOME and scratch and destroys them on exit.
 * Regression side effects therefore cannot cross into another gate or resume. */
export function gateCheckout(accepted:string,base:string,parent:string,regressions=false) {
  if(!/^[a-f0-9]{40}$/.test(base))throw new Error('gate requires full base commit');
  const identity=checkoutIdentity(accepted,git(accepted,['rev-parse','HEAD']).trim());
  git(accepted,['merge-base','--is-ancestor',base,identity.commit]);
  const root=realpathSync(mkdtempSync(path.join(parent,'disposable-'))),repo=path.join(root,'repo');
  mkdirSync(repo);
  try{
    const archive=execFileSync('git',['-C',accepted,'archive',base],{maxBuffer:128*1024*1024});
    execFileSync('/usr/bin/tar',['-xf','-','-C',repo],{input:archive});
    // Prior accepted repairs may already have authored regressions in the base.
    // They remain historical evidence, never authoritative gate inputs.
    for(const file of git(accepted,['ls-tree','-r','--name-only',base]).trim().split('\n'))
      if(/^packages\/omb-amani\/test\/medic-regression-[a-z0-9-]+\.test\.ts$/.test(file))rmSync(path.join(repo,file));
    const tests=git(accepted,['diff','--diff-filter=A','--name-only',base,identity.commit]).trim().split('\n')
      .filter(f=>/^packages\/omb-amani\/test\/medic-regression-[a-z0-9-]+\.test\.ts$/.test(f));
    // The sole eligible production API has an empty executable dependency closure.
    // No authored config, helpers, imports or other source can enter the base gate.
    for(const file of [CHECKPOINT_ADAPTER,...(regressions?tests:[])]){
      if(!identity.files[file])throw new Error('gate input missing from accepted identity');
      mkdirSync(path.dirname(path.join(repo,file)),{recursive:true});
      copyFileSync(path.join(accepted,file),path.join(repo,file));
      if(!readFileSync(path.join(repo,file)).equals(readFileSync(path.join(accepted,file))))throw new Error('gate source copy differs');
    }
    assertCheckout(accepted,identity);
    git(repo,['init','-q']);git(repo,['config','user.name','Medic gate host']);git(repo,['config','user.email','medic-gate@example.invalid']);
    git(repo,['add','--force','--all']);git(repo,['commit','-qm','Base tests with accepted source projection']);
    installGateRuntime(path.join(accepted,'node_modules'),repo);
    for(const relative of ['packages/bio-baseline/.pixi','packages/omb-investigate/format-runtime/.pixi'])if(existsSync(path.join(accepted,relative)))
      symlinkSync(realpathSync(path.join(accepted,relative)),path.join(repo,relative),'dir');
    return{root,repo,tests,identity,base,dispose:()=>{execFileSync('/usr/bin/chflags',['-R','-P','nouchg',root]);rmSync(root,{recursive:true,force:true});}};
  }catch(error){rmSync(root,{recursive:true,force:true});throw error;}
}
