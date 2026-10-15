import { assertDevelopmentAuthorization } from '../medic-authorization.ts';
// Optional development utility. Never called by the investigation run path.
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { TabularStager } from '../../../omb-investigate/src/tabular.ts';
import { cardStager } from '../card-stager.ts';
import { loadTask } from '../task.ts';
import { atomicJson, inventory } from './checkpoint.ts';
export async function buildStandIn(taskDir:string,out:string):Promise<string> {
  assertDevelopmentAuthorization();
  const task=loadTask(taskDir),base=path.join(out,'staging');
  mkdirSync(out,{recursive:true,mode:0o700});
  const stager=cardStager(new TabularStager({hostRoot:path.join(base,'host'),shareRoot:path.join(base,'share')}),task);
  const staged=await stager.stage({investigationId:'stand-in',datasetId:task.datasetId,dataRoot:task.dataRoot,route:'P',publicText:task.prompt,contract:null,expectedManifestHash:task.expectedManifestHash??null});
  const data=await stager.synthesize({staged,seed:randomUUID(),investigationId:'stand-in',outcomes:[]});
  const check=await stager.verifyPractice!({staged,data,kind:'synthetic'});
  if(!check.ok)throw new Error('stand-in practice structure/format parity failed');
  const before=Object.keys(inventory(task.dataRoot)).sort(),after=Object.keys(inventory(data.dir)).sort();
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('stand-in refuses omitted or unsupported physical files');
  const dest=path.join(out,'task');mkdirSync(dest);
  // Copy public task instructions/contracts/templates, then only the synthesized data tree.
  for(const f of readdirSync(task.dir))if(f!=='data'&&f!=='manifest.json')cpSync(path.join(task.dir,f),path.join(dest,f),{recursive:true});
  cpSync(data.dir,path.join(dest,'data'),{recursive:true});
  const original=existsSync(path.join(task.dir,'manifest.json'))?JSON.parse(readFileSync(path.join(task.dir,'manifest.json'),'utf8')):{};
  atomicJson(path.join(dest,'manifest.json'),{...original,files:inventory(dest)});
  atomicJson(path.join(out,'synthesis.json'),{schema:'omb-amani/stand-in@1',check,files:after,synthetic:true});
  // The real source copy and physical codec templates never leave the host staging scope.
  rmSync(base,{recursive:true,force:true});
  loadTask(dest);return dest;
}
