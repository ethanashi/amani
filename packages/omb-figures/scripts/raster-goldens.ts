/** External browser reference rasterization only. No browser dependency in product source. */
import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync } from 'node:fs';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { publicationGallery } from '../test/publication-gallery.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const chrome=process.env.PW3B_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const scratch=resolve('.bio-scratch');mkdirSync(scratch,{recursive:true});
const dir=mkdtempSync(join(scratch,'pw3b-goldens-'));const golden=join(root,'test/goldens');mkdirSync(golden,{recursive:true});
const manifest:Record<string,string>={};
const samples=join(root,'examples-pw3b/png');mkdirSync(samples,{recursive:true});
try{
 for(const [kind,svg]of publicationGallery()){
  const page=join(dir,kind+'.html'),png=join(dir,kind+'.png');
  const vb=svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/u);if(!vb)throw new Error(`${kind}: missing viewBox`);
  const width=2280,height=Math.ceil(Number(vb[2])/Number(vb[1])*width);
  writeFileSync(page,`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:white}svg{display:block;width:${width}px;height:auto}</style></head><body>${svg}</body></html>`);
  execFileSync(chrome,['--headless=new','--disable-gpu','--hide-scrollbars','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(dir,'profile')}`,`--disk-cache-dir=${join(dir,'cache')}`,`--window-size=${width},${height}`,'--virtual-time-budget=1000',`--screenshot=${png}`,pathToFileURL(page).href],{timeout:30000,stdio:'pipe'});
  const actual=readFileSync(png);manifest[kind]=createHash('sha256').update(actual).digest('hex');
  if(process.argv.includes('--write')){writeFileSync(join(golden,kind+'.png'),actual);writeFileSync(join(samples,kind+'.png'),actual);}
  else if(!actual.equals(readFileSync(join(golden,kind+'.png')))||!actual.equals(readFileSync(join(samples,kind+'.png'))))throw new Error(`${kind}: golden PNG differs`);
  process.stdout.write(`${kind}: ${process.argv.includes('--write')?'written':'PASS'}\n`);
 }
 if(process.argv.includes('--write'))writeFileSync(join(golden,'manifest.json'),JSON.stringify({browser:execFileSync(chrome,['--version'],{encoding:'utf8'}).trim(),images:manifest},null,2)+'\n');
}finally{rmSync(dir,{recursive:true,force:true});}
