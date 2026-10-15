import {writeFileSync} from 'node:fs';
import {buildManuscript,expectedFlow,extractPdf,verifyPdf} from '../src/reverify/index.ts';
import {basePlan} from '../test/pw8-fixture.ts';
const dir=new URL('../test/pw8-fixtures/review',import.meta.url).pathname;
const small=(parts:any[])=>buildManuscript({...basePlan,sections:[{id:'results',heading:'Results',blocks:[{kind:'software',id:'estimate',paragraphs:[{parts}]}]}]});
const m=small(['Effect ',{key:'m:c1.result'},'.']);
const strings=expectedFlow(m).map(x=>x.kind==='unit'?x.text:'');
const lit=(s:string)=>'('+s.replace(/([\\()])/g,'\\$1').replaceAll('–','\x96')+')';
function stream(s:string,dict=''){return `<< /Length ${Buffer.byteLength(s,'latin1')} ${dict} >>\nstream\n${s}\nendstream`;}
function pdf(objects:string[]){let s='%PDF-1.7\n', offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(s,'latin1'));s+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const start=Buffer.byteLength(s,'latin1');s+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;return Buffer.from(s,'latin1');}
function make(content:string,font='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',extras:string[]=[],pageExtras='',resources=''){
 return pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>',`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 600] /Resources << /Font << /F1 4 0 R >> ${resources} >> /Contents 5 0 R ${pageExtras} >>`,font,stream(content),...extras]);
}
const content=(ss:string[]=strings)=>ss.map((s,i)=>`BT /F1 11 Tf 1 0 0 1 40 ${550-i*30} Tm ${lit(s)} Tj ET`).join('\n');
const rows:any[]=[];
function run(id:string,b:Buffer,expected=m){writeFileSync(dir+'/'+id+'.pdf',b);const r=verifyPdf(b,expected,{figures:'vector'});let extracted;try{extracted=extractPdf(b);}catch(e){extracted={error:String(e)}}rows.push({id,...r,extracted});console.log(id,JSON.stringify(r));}
run('pdf-small-control',make(content()));
// Valid ToUnicode map contradicts visual Helvetica glyphs: encode digit 1 with glyph 9.
const pairs=Array.from({length:95},(_,i)=>{const c=i+32,u=c===57?49:c;return `<${c.toString(16)}> <${u.toString(16).padStart(4,'0')}>`;}).join('\n')+'\n<96> <2013>';
const cmap=`/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Review def /CMapType 2 def 1 begincodespacerange <00> <ff> endcodespacerange 96 beginbfchar\n${pairs}\nendbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
// Preserve other nines with a spare code using Differences so every glyph renders correctly except intended 1 -> 9.
const replaced=strings.map(s=>s.replaceAll('9','~').replaceAll('1','9'));
const cmap2=cmap.replace('<7e> <007e>','<7e> <0039>');
run('pdf-tounicode-lie',make(content(replaced),'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /BaseEncoding /WinAnsiEncoding /Differences [126 /nine] >> /ToUnicode 6 0 R >>',[stream(cmap2)]));
// An extra visible 99 as an image, with no text objects.
const rows9=['11111','10001','10001','11111','00001','00001','11111'];
let pixels='';for(let y=0;y<7;y++)for(let x=0;x<12;x++){const on=x<5?rows9[y][x]==='1':x>=7?rows9[y][x-7]==='1':false;pixels+=String.fromCharCode(on?0:255);}
run('pdf-extra-image-number',make(content()+'\nq 120 0 0 70 40 320 cm /Im1 Do Q',undefined,[stream(pixels,'/Type /XObject /Subtype /Image /Width 12 /Height 7 /ColorSpace /DeviceGray /BitsPerComponent 8')],'','/XObject << /Im1 6 0 R >>'));
// All expected text white; unverified image is the only visible number.
run('pdf-white-decoy-image',make('1 1 1 rg\n'+content()+'\nq 120 0 0 70 40 320 cm /Im1 Do Q',undefined,[stream(pixels,'/Type /XObject /Subtype /Image /Width 12 /Height 7 /ColorSpace /DeviceGray /BitsPerComponent 8')],'','/XObject << /Im1 6 0 R >>'));
// Paint order unchanged; value's geometric placement changed.
const target=strings[2],pieces=target.split('1.42');
const positioned=content(strings.slice(0,2))+`\nBT /F1 11 Tf 1 0 0 1 40 490 Tm ${lit(pieces[0])} Tj 1 0 0 1 600 390 Tm (1.42) Tj 1 0 0 1 135 490 Tm ${lit(pieces[1])} Tj ET`;
run('pdf-value-moved-on-page',make(positioned));
run('pdf-zero-size-control',make(content().replaceAll('/F1 11 Tf','/F1 0 Tf')));
run('pdf-decimal-split',make(content(strings.map(s=>s.replace('1.42','1.4 2')))));
// StandardEncoding 0xae is fi; honest ligature must compare equal to 'fi'.
const lig=small(['A fine result was recorded.']);
const ls=expectedFlow(lig).map(x=>x.kind==='unit'?x.text:'');
run('pdf-honest-standard-ligature',make(content(ls.map(s=>s.replace('fine','\xae'+'ne'))),'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /StandardEncoding >>'),lig);
// Whitespace is legal in ASCIIHex streams; extractor's regex truncates on the first whitespace.
const hex=Buffer.from(content(),'latin1').toString('hex').match(/.{1,64}/g)!.join('\n')+'>';
const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 600] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',stream(hex,'/Filter /ASCIIHexDecode')];
run('pdf-honest-asciihex-whitespace',pdf(objs));
// Annotation appearance draws unverified visible text; no Contents/T/TU/URI strings.
const annot=`<< /Type /Annot /Subtype /Stamp /Rect [40 300 300 380] /F 4 /AP << /N 7 0 R >> >>`;
const ap=stream('BT /F1 40 Tf 1 0 0 1 10 25 Tm (AUC 0.99) Tj ET','/Type /XObject /Subtype /Form /BBox [0 0 260 80] /Resources << /Font << /F1 4 0 R >> >>');
run('pdf-annotation-appearance',make(content(),undefined,[annot,ap],'/Annots [6 0 R]'));
// A legal whitespace boundary hides all following extra text from the in-repo decoder.
const hiddenHex=Buffer.from(content(),'latin1').toString('hex')+'\n'+Buffer.from('\nBT /F1 32 Tf 1 0 0 1 40 350 Tm (Unsupported 78) Tj ET','latin1').toString('hex')+'>';
run('pdf-asciihex-hidden-number',pdf([...objs.slice(0,4),stream(hiddenHex,'/Filter /ASCIIHexDecode')]));
const reverseContent=strings.map((s,i)=>`BT /F1 11 Tf 1 0 0 1 40 ${550-i*30} Tm ${lit(s)} Tj ET`).reverse().join('\n');
run('pdf-honest-reverse-paint-order',make(reverseContent));
writeFileSync(dir+'/pdf-results.json',JSON.stringify(rows,null,2));
