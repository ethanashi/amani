/** Local synthetic demonstration of all output profiles; never submits anything. */
import path from 'node:path';
import { cpSync,mkdirSync,writeFileSync,readFileSync,existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { packagePaper } from '../src/package.ts';
import { fixture,fixturePorts,authority,KEYPAIR,NOW,reseal } from '../test/fixture.ts';
import { ROOT,toolchain,command } from '../src/toolchain.ts';
import { sha256,assert } from '../src/common.ts';
const output=process.argv[2]?path.resolve(process.argv[2]):path.join(ROOT,'examples/sample');
assert(!existsSync(output),'sample directory already exists');mkdirSync(output,{recursive:true});
const tc=await toolchain(),exec=promisify(execFile),poppler=process.env.PW9_PDFTOPPM??'/opt/homebrew/bin/pdftoppm';
const version=await exec(poppler,['-v']),profiles=[];
for(const name of ['twocol','arxiv','review'] as const){
 const r=fixture(name==='review'?'plos-one':'research-note');r.submission.outputProfile=name==='review'?'journal-review':name==='arxiv'?'arxiv-source':'preprint-two-column';
 const request=reseal(r),result=await packagePaper(request,{authority,certificateKey:KEYPAIR.privateKey,ports:fixturePorts(request.submission),output:path.join(output,'bundles',name),now:NOW});
 const pdf=path.join(output,`paper-${name}.pdf`);cpSync(path.join(result.directory,'paper.pdf'),pdf);
 if(name==='arxiv')cpSync(path.join(result.directory,'paper-arxiv.tar.gz'),path.join(output,'paper-arxiv.tar.gz'));
 if(name==='twocol')for(const file of ['paper.pdf','paper.docx','supplement.pdf'])cpSync(path.join(result.directory,file),path.join(output,file));
 const prefix=path.join(output,`paper-${name}-page-1`);await exec(poppler,['-f','1','-singlefile','-r','144','-png',pdf,prefix]);
 const info=JSON.parse(await command(tc.python,[path.join(ROOT,'scripts/normalize.py'),'inspect-pdf',pdf]));
 const regeneration=JSON.parse(readFileSync(path.join(result.directory,'regenerate-and-hash.json'),'utf8'));
 profiles.push({name,outputProfile:r.submission.outputProfile,bundle:path.relative(ROOT,result.directory),pdf:path.relative(ROOT,pdf),png:path.relative(ROOT,prefix+'.png'),pages:info.pages,pdfSha256:sha256(readFileSync(pdf)),pngSha256:sha256(readFileSync(prefix+'.png')),deterministic:regeneration.comparison.every((x:any)=>x.identical),rawDifferences:regeneration.comparison.filter((x:any)=>x.rawFirst!==x.rawSecond).map((x:any)=>({name:x.name,rawFirst:x.rawFirst,rawSecond:x.rawSecond})),fonts:info.fonts});
}
writeFileSync(path.join(output,'README.txt'),'SYNTHETIC FIXTURES, NOT A SCIENTIFIC MANUSCRIPT OR REAL OWNER ENDORSEMENT.\nNamed PDFs/PNGs are convenience copies. Complete signed bundles: bundles/twocol, bundles/arxiv, bundles/review.\nRun bundles/twocol/reproduce to reproduce every analytical number.\nThe arXiv source archive selects XeLaTeX on TeX Live 2025.\n');
writeFileSync(path.join(ROOT,'reports/sample-build-round3.json'),JSON.stringify({fixture:true,poppler:(version.stdout+version.stderr).trim(),profiles},null,2)+'\n');
console.log(output);
