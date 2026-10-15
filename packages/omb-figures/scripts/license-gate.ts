/** Equivalent to license-checker: walk the actual installed transitive dependency graph.
 * Unknown metadata, missing inventory, changed version/licence, and copyleft fail closed.
 */
import { createRequire } from 'node:module';
import { readFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
export interface Dependency {name:string;version:string;license:string}
const permissive = new Set(['MIT','MIT-CMU','BSD-2-Clause','BSD-3-Clause','BSD-3-Clause-Clear','ISC','Apache-2.0','CC0-1.0','OFL-1.1','0BSD']);
const blocked = /gwaslab|metafor|survminer|enhancedvolcano|ggsci|scikit-survival|citeproc|graphviz|viz-js|elkjs|sakana|paperbanana|academic-research-skills/iu;
export function licenceAllowed(d:Dependency):boolean {
  if(blocked.test(d.name))return false;
  // Explicitly requested existing matplotlib PSF-based licence; not a generic PSF exception.
  if(d.name==='matplotlib'&&d.license==='LicenseRef-Matplotlib')return true;
  const tokens=d.license.replace(/[()]/gu,'').split(/\s+(?:AND|OR)\s+/u);
  return tokens.length>0&&tokens.every(token=>permissive.has(token));
}
export function nodeInventory(root:string):Dependency[]{
  const visited=new Set<string>(),found:Dependency[]=[];
  function scan(dir:string,top=false){
    dir=realpathSync(dir);if(visited.has(dir))return;visited.add(dir);
    const pkg=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));
    if(!top)found.push({name:pkg.name,version:pkg.version,license:pkg.license??'UNKNOWN'});
    const names=Object.keys({...pkg.dependencies,...(top?pkg.devDependencies:{}),...pkg.optionalDependencies}).sort();
    for(const name of names){
      let base=dir,target:string|undefined;
      while(true){const p=join(base,'node_modules',name,'package.json');if(existsSync(p)){target=dirname(p);break;}const parent=dirname(base);if(base===parent)break;base=parent;}
      if(!target){if(Object.hasOwn(pkg.optionalDependencies??{},name))continue;throw new Error(`Missing installed dependency ${name}`);}
      scan(target);
    }
  }
  scan(root,true);return found.sort((a,b)=>a.name.localeCompare(b.name,'en'));
}
export function checkInventory(actual:Dependency[],locked:Dependency[]):string[]{
  const errors:string[]=[];
  for(const d of actual){if(!licenceAllowed(d))errors.push(`${d.name}: forbidden or unknown licence ${d.license}`);if(!locked.some(l=>l.name===d.name&&l.version===d.version&&l.license===d.license))errors.push(`${d.name}: unreviewed dependency/version/licence`);}
  return errors;
}
export function checkAssets(root:string):string[]{
  const manifest=JSON.parse(readFileSync(join(root,'LICENSES/assets.json'),'utf8')) as {path:string;license:string;sha256:string}[];
  const errors:string[]=[];
  // Narrow, digest-bound exception for the explicitly requested official PRISMA template.
  const officialPrisma=(item:{path:string;license:string;sha256:string})=>item.path==='vendor/specs/prisma-official-new-reviews.json'&&item.license==='CC-BY-4.0'&&item.sha256==='771d0dbf5328dc96595aa2573ea2a96ac70a22050ce471d1680168fe7a19a058';
  for(const item of manifest){if(!officialPrisma(item)&&!licenceAllowed({name:item.path,version:'asset',license:item.license}))errors.push(`Forbidden asset licence: ${item.path}`);if(createHash('sha256').update(readFileSync(join(root,item.path))).digest('hex')!==item.sha256)errors.push(`Asset changed: ${item.path}`);}
  function visit(dir:string){for(const e of readdirSync(join(root,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())visit(p);else if(!manifest.some(a=>a.path===p))errors.push(`Unreviewed asset: ${p}`);}}
  visit('vendor');
  return errors;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL('../',import.meta.url));
  const locked=JSON.parse(readFileSync(join(root,'LICENSES/dependencies.json'),'utf8')) as Dependency[];
  const errors=[...checkInventory(nodeInventory(root),locked),...checkAssets(root)];
  if(errors.length){process.stderr.write(errors.join('\n')+'\n');process.exitCode=1;}else process.stdout.write('Node dependencies and vendored assets: PASS\n');
}
