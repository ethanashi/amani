/** Reproducible acceptance probes against the actual synthetic released bytes. */
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {readZip,verifyTex,tarInventory} from '../packages/omb-report/src/reverify/index.ts';
import {forest} from '../packages/omb-report/test/pw8-fixture.ts';
import {writeZip} from '../packages/omb-report/test/pw8-tamper.ts';
const dir=path.resolve(process.argv[2]!),bundle=path.join(dir,'release');
const certificate=JSON.parse(readFileSync(path.join(dir,'release-record.json'),'utf8'));
const profile=JSON.parse(readFileSync(path.join(bundle,'release-profile.json'),'utf8'));
const manuscript=JSON.parse(readFileSync(path.join(dir,'pw8-pw9/verified-manuscript.json'),'utf8'));
const verify=(root:string)=>{const p=spawnSync(process.execPath,['--experimental-transform-types','packages/omb-report/scripts/verify-release.ts',root,path.join(dir,'release-record.json'),path.join(dir,'release-public.pem'),certificate.record.paperInputHash,certificate.record.buildId],{encoding:'utf8'});return {exit:p.status,...JSON.parse(p.stdout||p.stderr)};};
const positive=verify(bundle);if(positive.exit!==0||!positive.ok)throw Error(JSON.stringify(positive));
const root=path.join(dir,process.env.PAPER_REFUSAL_DIR??'refusals');mkdirSync(root);const results:unknown[]=[];
function probe(name:string,file:string,changed:Uint8Array,extra:Record<string,unknown>={}){
 const copy=path.join(root,name);cpSync(bundle,copy,{recursive:true});writeFileSync(path.join(copy,file),changed);
 const result=verify(copy);if(result.exit!==1||result.ok)throw Error('tamper accepted: '+name);
 results.push({case:name,file,...result,...extra});
}
const tex=readFileSync(path.join(bundle,'paper.tex'),'utf8');let edited=false;
const changedTex=tex.replace(/(\\ombval\{[^{}]+\}\{)([^{}]*)(\})/gu,(s,prefix:string,value:string,suffix:string)=>{if(edited||!/[0-9]/u.test(value))return s;edited=true;return prefix+value.replace(/[0-9]/u,d=>d==='9'?'8':'9')+suffix;});
if(!edited)throw Error('no bound TeX number');let texRefusal='';try{verifyTex(changedTex,manuscript,profile.tex);}catch(e){texRefusal=String(e);}if(!texRefusal)throw Error('TeX semantic edit passed');
probe('edited-tex-number','paper.tex',Buffer.from(changedTex),{texRefusal});
const docx=readZip(readFileSync(path.join(bundle,'paper.docx')));let changed=false;
const xml=Buffer.from(docx.get('word/document.xml')!).toString('utf8');const newXml=xml.replace(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/gu,s=>{if(changed||!/[0-9]/u.test(s))return s;changed=true;return s.replace(/[0-9]/u,d=>d==='9'?'8':'9');});
if(!changed)throw Error('no DOCX visible number');docx.set('word/document.xml',Buffer.from(newXml));probe('edited-docx-number','paper.docx',writeZip(docx));
probe('swapped-figure','figures/data-flow.svg',Buffer.from(forest.svg));
const archive=readFileSync(path.join(bundle,'paper-arxiv.tar.gz')),tar=gunzipSync(archive);let offset=0;
while(tar.subarray(offset,offset+512).some(x=>x!==0)){const size=parseInt(tar.subarray(offset+124,offset+136).toString().replace(/\0.*$/su,'').trim(),8);offset+=512+Math.ceil(size/512)*512;}
const header=Buffer.alloc(512),contents=Buffer.from('unlisted file\n');header.write('UNLISTED.txt');header.write('0000644\0',100);header.write('0000000\0',108);header.write('0000000\0',116);header.write(contents.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header.write('0',156);header.write('ustar\0',257);header.write('00',263);header.write([...header].reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);
const changedTar=gzipSync(Buffer.concat([tar.subarray(0,offset),header,contents,Buffer.alloc(512-contents.length),Buffer.alloc(1024)]));if(!tarInventory(changedTar)['UNLISTED.txt'])throw Error('bad tar probe');
probe('unlisted-tar-member','paper-arxiv.tar.gz',changedTar,{unlisted:'UNLISTED.txt'});
const result={positiveFreshProcess:positive,refusals:results};writeFileSync(path.join(dir,'refusals.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
