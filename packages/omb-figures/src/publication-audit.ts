/** Geometry audit adapted from nature-skills' collision/font/panel checks (Apache-2.0).
 * Modified: audit final-size SVG text using vendored Liberation metrics, not PyMuPDF (AGPL).
 * Five-state contract deliberately separates errors, absent execution and unauditable geometry.
 * See LICENSES/nature-skills.txt and vendor/specs for the pinned upstream references.
 */
import { readFileSync } from 'node:fs';
import { attr, classes, ownText, parseSvg, walk, type ParsedElement } from './xml.ts';
import { validatePalette } from './palette.ts';
export const AUDIT_EXIT = { PASS:0, FAIL:1, ERROR:2, NOT_RUN:3, NOT_AUDITABLE:4 } as const;
export type AuditState = keyof typeof AUDIT_EXIT;
export interface AuditFinding { readonly code:string; readonly detail:string }
export interface PublicationAudit { readonly state:AuditState; readonly exitCode:number; readonly findings:readonly AuditFinding[] }
const report=(state:AuditState,findings:AuditFinding[]=[]):PublicationAudit=>({state,exitCode:AUDIT_EXIT[state],findings});
interface Box { x:number;y:number;w:number;h:number;label:string }
const luminance=(hex:string)=>{const channels=hex.match(/^#([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/iu);if(!channels)return null;const rgb=channels.slice(1).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*rgb[0]!+.7152*rgb[1]!+.0722*rgb[2]!;};
const overlap=(a:Box,b:Box)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>0.5&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>0.5;
const inherit=(e:ParsedElement,key:string):string|undefined=>attr(e,key)??(e.parent?inherit(e.parent,key):undefined);
/** Affine SVG transforms; skew/perspective and malformed syntax stay unauditable. */
type Matrix = readonly [number,number,number,number,number,number];
const identity:Matrix=[1,0,0,1,0,0];
function multiply(a:Matrix,b:Matrix):Matrix{return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
const point=(m:Matrix,x:number,y:number):[number,number]=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
function transform(e:ParsedElement):Matrix|null {
 const parent=e.parent?transform(e.parent):identity;if(!parent)return null;
 const raw=attr(e,'transform');if(!raw)return parent;let local=identity,rest=raw;
 for(const match of raw.matchAll(/(translate|scale|matrix|rotate)\(([^)]+)\)/gu)){
  rest=rest.replace(match[0],'');const a=match[2]!.trim().split(/[ ,]+/u).map(Number);if(a.some(v=>!Number.isFinite(v)))return null;let next:Matrix;
  if(match[1]==='translate'&&(a.length===1||a.length===2))next=[1,0,0,1,a[0]!,a[1]??0];
  else if(match[1]==='scale'&&(a.length===1||a.length===2))next=[a[0]!,0,0,a[1]??a[0]!,0,0];
  else if(match[1]==='matrix'&&a.length===6)next=a as unknown as Matrix;
  else if(match[1]==='rotate'&&(a.length===1||a.length===3)){
   const theta=a[0]!*Math.PI/180,c=Math.cos(theta),d=Math.sin(theta),cx=a[1]??0,cy=a[2]??0;
   next=[c,d,-d,c,cx-c*cx+d*cy,cy-d*cx-c*cy];
  }else return null;
  local=multiply(local,next);
 }
 if(rest.trim())return null;const m=multiply(parent,local);return Math.abs(m[0]*m[3]-m[1]*m[2])>1e-10?m:null;
}
function transformedBox(m:Matrix,b:Box):Box{
 const corners=[point(m,b.x,b.y),point(m,b.x+b.w,b.y),point(m,b.x,b.y+b.h),point(m,b.x+b.w,b.y+b.h)];
 const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);const x=Math.min(...xs),y=Math.min(...ys);return {x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y,label:b.label};
}
export function auditPublicationSvg(svg:string|undefined,options:{readonly printedWidthMm?:number;readonly minimumFontPt?:number}={}):PublicationAudit {
  if(svg===undefined)return report('NOT_RUN');
  try{
    const parsed=parseSvg(svg);if(!parsed.root||parsed.issues.length)return report('ERROR',[{code:'malformed-svg',detail:parsed.issues.map(i=>i.detail).join('; ')}]);
    const root=parsed.root;const vb=(attr(root,'viewBox')??'').split(/\s+/u).map(Number);
    const physical=attr(root,'width')??'';const mm=options.printedWidthMm??(physical.endsWith('mm')?Number(physical.slice(0,-2)):physical.endsWith('pt')?Number(physical.slice(0,-2))*25.4/72:NaN);
    if(vb.length!==4||!vb.every(Number.isFinite)||!(vb[2]!>0)||!(mm>0))return report('NOT_AUDITABLE',[{code:'physical-size',detail:'positive viewBox and final width in mm required'}]);
    const factor=mm*72/25.4/vb[2]!;const all=[...walk(root)],findings:AuditFinding[]=[],unknown:AuditFinding[]=[],boxes:Box[]=[];
    const metrics=JSON.parse(readFileSync(new URL('../vendor/fonts/liberation-metrics.json',import.meta.url),'utf8')) as {widths:Record<string,number>;bounds:Record<string,readonly [number,number,number,number]>};
    const add=(code:string,detail:string)=>findings.push({code,detail});
    for(const e of all.filter(e=>e.tag==='text')){
      const t=transform(e),raw=inherit(e,'font-size')??'',size=Number(raw.replace(/pt$/u,''))*(raw.endsWith('pt')?4/3:1),value=ownText(e);
      if(!t||!Number.isFinite(size)||size<=0||e.children.some(c=>'tag' in c)||attr(e,'style')||!['Liberation Sans'].includes(inherit(e,'font-family')??'')){
        unknown.push({code:'text-geometry',detail:'unsupported font, style, transform or nested text'});continue;
      }
      const light=luminance(inherit(e,'fill')??'#000000');if(light===null)unknown.push({code:'text-colour',detail:'unsupported text colour'});else if(1.05/(light+.05)<4.5)add('text-contrast',value);
      const norm=t[0]**2+t[1]**2+t[2]**2+t[3]**2,det=t[0]*t[3]-t[1]*t[2];const smallest=Math.sqrt(Math.max(0,(norm-Math.sqrt(Math.max(0,norm**2-4*det**2)))/2));const printed=size*smallest*factor;if(printed<(options.minimumFontPt??6))add('font-too-small',`${value}: ${printed.toFixed(2)} pt printed`);
      if([...value].some(c=>metrics.widths[c]===undefined)){unknown.push({code:'glyph-metrics',detail:`unmapped glyph in ${value}`});continue;}
      const width=[...value].reduce((sum,c)=>sum+metrics.widths[c]!,0)*size;
      const x=Number(attr(e,'x')??0),y=Number(attr(e,'y')??0);
      const anchor=inherit(e,'text-anchor')??'start';let advance=0;const glyphs=[...value].map(c=>{const b=metrics.bounds[c]!;const ink={x:advance+b[0],y:-b[3],w:b[2]-b[0],h:b[3]-b[1]};advance+=metrics.widths[c]!;return ink;});
      const left=Math.min(...glyphs.map(b=>b.x)),top=Math.min(...glyphs.map(b=>b.y)),right=Math.max(...glyphs.map(b=>b.x+b.w)),bottom=Math.max(...glyphs.map(b=>b.y+b.h));
      const box=transformedBox(t,{x:x-(anchor==='middle'?width/2:anchor==='end'?width:0)+left*size,y:y+top*size,w:(right-left)*size,h:(bottom-top)*size,label:value});
      if(![box.x,box.y,box.w,box.h].every(Number.isFinite)){unknown.push({code:'text-geometry',detail:'nonfinite text box'});continue;}
      if(box.x<vb[0]!-0.5||box.y<vb[1]!-0.5||box.x+box.w>vb[0]!+vb[2]!+0.5||box.y+box.h>vb[1]!+vb[3]!+0.5)add('text-clipped',value);
      const node=attr(e,'data-node');
      if(node){const frame=all.find(r=>attr(r,'data-node-box')===node);if(!frame)add('missing-node-box',value);else{const bx=Number(attr(frame,'x')),by=Number(attr(frame,'y')),bw=Number(attr(frame,'width')),bh=Number(attr(frame,'height'));if(box.x<bx+3||box.y<by+3||box.x+box.w>bx+bw-3||box.y+box.h>by+bh-3)add('node-text-overflow',value);}}
      boxes.push(box);
    }
    if(!boxes.length)unknown.push({code:'no-auditable-text',detail:'no text geometry'});
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)if(overlap(boxes[i]!,boxes[j]!))add('text-overlap',`${boxes[i]!.label} / ${boxes[j]!.label}`);
    const marks=all.filter(e=>['circle','rect','polygon','path'].includes(e.tag)&&!!attr(e,'data-fact'));
    const colours=[...new Set(marks.map(e=>inherit(e,'fill')??''))];findings.push(...validatePalette(colours));
    const kind=attr(root,'data-publication-kind');
    if(['meta-forest','mr-leave-one-out','funnel','surrogacy'].includes(kind??'')){
      const nulls=all.filter(e=>e.tag==='line'&&classes(e).includes('null-line')&&attr(e,'stroke')!=='none'&&Number(attr(e,'stroke-width')??1)>0&&((attr(e,'x1')!==attr(e,'x2'))||(attr(e,'y1')!==attr(e,'y2'))));
      if(nulls.length<(kind==='surrogacy'?2:1))add('missing-null-line',`${kind} requires visible null/reference lines`);
    }
    const panels=all.filter(e=>classes(e).includes('panel'));
    for(const key of ['data-row','data-column']){
      const groups=new Map<string,ParsedElement[]>();panels.forEach(e=>{const id=attr(e,key);if(id)groups.set(id,[...(groups.get(id)??[]),e]);});
      for(const es of groups.values()){
        const horizontal=key==='data-row';const props=horizontal?['y','height']:['x','width'];
        for(const prop of props){const vs=es.map(e=>{const t=transform(e);const raw=attr(e,prop);if(!t||raw===undefined)return NaN;const b=transformedBox(t,{x:Number(attr(e,'x')),y:Number(attr(e,'y')),w:Number(attr(e,'width')),h:Number(attr(e,'height')),label:''});return prop==='x'?b.x:prop==='y'?b.y:prop==='width'?b.w:b.h;});if(vs.some(v=>!Number.isFinite(v)))unknown.push({code:'panel-geometry',detail:'missing panel dimension'});else if(Math.max(...vs)-Math.min(...vs)>0.75)add('panel-alignment',`${key}: unequal ${prop}`);}
      }
    }
    return report(findings.length?'FAIL':unknown.length?'NOT_AUDITABLE':'PASS',[...findings,...unknown]);
  }catch(error){return report('ERROR',[{code:'audit-error',detail:String(error)}]);}
}
