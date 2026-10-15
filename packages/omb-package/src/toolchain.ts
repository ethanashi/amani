import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { assert, sha256, canonicalSha256 } from './common.ts';
export const ROOT=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const exec=promisify(execFile);
export async function command(bin:string,args:string[],cwd=ROOT):Promise<string>{
  const {stdout}=await exec(bin,args,{cwd,timeout:60_000,maxBuffer:32*1024*1024,env:{...process.env,SOURCE_DATE_EPOCH:'946684800',TZ:'UTC',PYTHONHASHSEED:'0',TECTONIC_CACHE_DIR:path.join(ROOT,'.cache/tectonic'),XDG_CACHE_HOME:path.join(ROOT,'.cache/xdg')}});return stdout;
}
export async function commandBytes(bin:string,args:string[],cwd=ROOT):Promise<Buffer>{
  const {stdout}=await exec(bin,args,{cwd,timeout:60_000,maxBuffer:32*1024*1024,encoding:'buffer',env:{...process.env,SOURCE_DATE_EPOCH:'946684800',TZ:'UTC'}});return stdout;
}
export interface Toolchain { tectonic:string; texBundle:string; pandoc:string; python:string; chromium:string; identity:Record<string,string> }
export async function toolchain():Promise<Toolchain>{
  const pandoc=path.join(ROOT,'.pixi/envs/default/bin/pandoc'),python=path.join(ROOT,'.pixi/envs/default/bin/python');
  assert(existsSync(pandoc)&&existsSync(python),'run pixi install --locked --manifest-path packages/omb-package/pixi.toml');
  const pin=JSON.parse(readFileSync(path.join(ROOT,'chromium.lock.json'),'utf8')) as {relativePath:string;version:string;sha256:string};
  const chromium=process.env.PW9_CHROMIUM??path.join(homedir(),'Library/Caches/ms-playwright',pin.relativePath);
  assert(existsSync(chromium)&&sha256(readFileSync(chromium))===pin.sha256,'Chromium binary differs from pinned Playwright cache');
  const pv=(await command(pandoc,['--version'])).split('\n')[0]!;
  assert(pv==='pandoc 3.9.0.2','unexpected pixi pandoc version');
  const py=JSON.parse(await command(python,['-c','import sys,json,pypdf;print(json.dumps({"python":sys.version.split()[0],"pypdf":pypdf.__version__}))']));
  assert(py.python==='3.13.9'&&py.pypdf==='6.1.1','Python/pypdf version differs from pixi lock');
  const cv=(await command(chromium,['--version'])).trim();assert(cv===pin.version,'Chromium version mismatch');
  const manifest=JSON.parse(readFileSync(path.join(ROOT,'vendor/manifest.json'),'utf8')) as {path:string;sha256:string}[];
  for(const a of manifest)assert(sha256(readFileSync(path.join(ROOT,'vendor',a.path)))===a.sha256,`vendored asset changed: ${a.path}`);
  const tectonic=path.join(ROOT,'.pixi/envs/default/bin/tectonic'),texBundle=path.join(ROOT,'vendor/tex/pw9-bundle.zip');
  const texPin=JSON.parse(readFileSync(path.join(ROOT,'tectonic.lock.json'),'utf8'));
  assert((await command(tectonic,['--version'])).trim()===texPin.version,'Tectonic engine differs from pin');
  assert(sha256(readFileSync(texBundle))===texPin.bundle.sha256,'Tectonic bundle differs from pin');
  return {tectonic,texBundle,pandoc,python,chromium,identity:{tectonic:texPin.version,texBundleSha256:texPin.bundle.sha256,python:py.python,pypdf:py.pypdf,rendererSha256:canonicalSha256(['scripts/journal-fonts.py','src/journal-fonts.ts','output-profiles/preprint.json','src/pw8-render.ts','src/pw8-review.ts','scripts/pw8-pdf-tags.py','output-profiles/preprint-two-column.json','output-profiles/arxiv-source.json','output-profiles/journal-review.json','scripts/tex-bundle.py','src/render.ts','src/latex.ts','src/latex-checks.ts','src/output-profiles.ts','latex/article.tex','latex/structure.lua','src/chromium.ts','src/templates.ts','scripts/paginate.js','src/genre/ast.ts','src/genre/structure.ts','src/genre/records.ts','src/genre/profiles.ts','src/genre/packaging.ts','src/genre/canon.json','src/genre/classes.ts','genre-rule-classes.json','genre-normalization.json','genre-checklists.json','genre-pins.json'].map(f=>({path:f,sha256:sha256(readFileSync(path.join(ROOT,f)))}))),pandoc:pv,chromium:cv,chromiumSha256:pin.sha256,pixiLockSha256:sha256(readFileSync(path.join(ROOT,'pixi.lock'))),assetsSha256:sha256(readFileSync(path.join(ROOT,'vendor/manifest.json'))),normalizerSha256:sha256(readFileSync(path.join(ROOT,'scripts/normalize.py')))}};
}
