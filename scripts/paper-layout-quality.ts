/** Final-size diagnostic report; it does not replace PW8 release verification. */
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {extractPdf} from '../packages/omb-report/src/reverify/index.ts';
const root=path.resolve('..','_logs');
const results=['paper-layout-sample','paper-layout-figures'].map(stem=>{
 const file=path.join(root,stem+'.pdf'),pdf=extractPdf(readFileSync(file));
 const fonts=execFileSync('pdffonts',[file],{encoding:'utf8'}),images=execFileSync('pdfimages',['-list',file],{encoding:'utf8'});
 const fontLines=fonts.trim().split('\n').slice(2);if(fontLines.some(s=>/Type 3/u.test(s)||/\sno\s+(?:yes|no)\s+(?:yes|no)\s+\d+/u.test(s)))throw Error('font embedding/type policy');
 if(pdf.runs.some(r=>r.invisible||r.offPage))throw Error('invisible or off-page text');
 const min=Math.min(...pdf.runs.filter(r=>r.text.trim()).map(r=>r.size));if(min<8)throw Error('placed text below eight PDF points');
 if(images.trim().split('\n').length>2)throw Error('generated chart unexpectedly contains raster images');
 const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'}),pages=text.split('\f'),wordCount=text.match(/\S+/gu)?.length??0;
 const firstCallouts=Array.from({length:pdf.visualSha256.length},(_,i)=>({figure:i+1,page:pages.findIndex(s=>new RegExp(`Figure\\s+${i+1}(?:\\D|$)`,'u').test(s))+1}));
 const result={file,pages:pdf.pages.length,wordCount,minimumTextPt:min,offPage:0,invisible:0,fonts:fontLines.length,figureForms:pdf.visualSha256.length,firstCallouts,taggedFigureAlternatives:pdf.structure.filter(x=>x.key==='Alt').length,limitations:['Figure tags are associated with actual Form invocations. Full body/heading/table semantic tagging and screen-reader certification remain incomplete.','Colour simulation is checked by the figure palette tests; this report is not a perceptual accessibility certificate.']};
 writeFileSync(path.join(root,stem+'-fonts.txt'),fonts);writeFileSync(path.join(root,stem+'-images.txt'),images);return result;
});
writeFileSync(path.join(root,'paper-layout-quality.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
