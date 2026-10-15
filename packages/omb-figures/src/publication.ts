/** Fixed publication templates. Layouts are code reviewed; input carries only certified IDs.
 * Conventions: forestploter, TwoSampleMR, PRISMA2020, locuszoom.js (MIT).
 * No fitting, clustering, embedding computation, dynamic code, or network access.
 */
import dagre from '@dagrejs/dagre';
import {toCsv,type CsvColumn,type CsvCell} from './csv.ts';
import { niceLinear } from './scale.ts';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FactStore } from './store.ts';
import type { CertifiedRecord, FactKind } from './port.ts';
import type { PublicationSpec } from './publication-spec.ts';
import { embeddedFonts, embedPublicationFonts } from './font-assets.ts';
import { renderFigure, type RenderedFigure } from './render.ts';
import type { FigureSpec } from './spec.ts';
import { refuse } from './refusal.ts';
import { auditPublicationSvg } from './publication-audit.ts';

export const LD_BREAKS = [0, 0.2, 0.4, 0.6, 0.8] as const;
/** Five cividis samples: owner-approved replacement for locuszoom's Turbo rainbow. */
export const LD_PALETTE = ['#00224e', '#434e6c', '#7d7c78', '#bcae6c', '#fee838'] as const;
const PRISMA = JSON.parse(readFileSync(new URL('../vendor/specs/prisma-official-new-reviews.json',import.meta.url),'utf8'));
const INK = '#202124', BLUE = '#0072b2';
const esc = (s: string) => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const n = (v: number) => { if (!Number.isFinite(v)) refuse('inconsistent-data','nonfinite geometry'); return Number(v.toFixed(3)).toString(); };
// Axis labels retain significant digits even when the unit scale is very small.
const tick = (v:number) => Number(v.toPrecision(12)).toString();
const requireData = (ok: boolean, why: string) => { if (!ok) refuse('inconsistent-data', why); };
const scale = (lo: number, hi: number, a: number, b: number) => (v: number) => a+(v-lo)/(hi-lo || 1)*(b-a);
const extent = (v: readonly number[], zero=false): [number,number] => {
  requireData(v.length>0&&v.length<=100000,'template needs one to 100000 values');
  let lo=Math.min(...v, ...(zero?[0]:[])), hi=Math.max(...v,...(zero?[0]:[]));
  const pad=(hi-lo || Math.abs(lo) || 1)*0.1; lo-=pad;hi+=pad;return [lo,hi];
};
export interface PublicationFigure { readonly id: string; readonly kind: string; readonly svg: string; readonly sha256: string; readonly sourceRecords: readonly CertifiedRecord[]; readonly sourceCsv:string; readonly sourceCsvSha256:string; readonly alt: string }

/** Reject executable values/accessors before traversing or serializing agent-authored specs. */
function referenceOnly(value:unknown,seen=new Set<object>()):void {
  if(value===null||value===undefined||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value!=='object')refuse('invalid-spec','publication specs contain references, never numbers or executable values');
  if(seen.has(value))refuse('invalid-spec','cyclic publication spec');seen.add(value);
  const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null&&proto!==Array.prototype)refuse('invalid-spec','plain publication spec required');
  for(const [key,d]of Object.entries(Object.getOwnPropertyDescriptors(value))){
    if(Array.isArray(value)&&key==='length')continue;
    if(d.get||d.set)refuse('invalid-spec','publication spec accessors are forbidden');referenceOnly(d.value,seen);
  }
  seen.delete(value);
}
export function renderPublicationFigure(spec: PublicationSpec, store: FactStore): PublicationFigure {
  referenceOnly(spec);
  requireData(/^[a-z][a-z0-9-]{0,63}$/u.test(spec.id), 'invalid publication ID');
  const ctx={placement:'results' as const,claims:new Set(spec.claimIds),where:spec.id};
  spec.claimIds.forEach(id=>store.claim(id,spec.id));
  const records=new Map<string,CertifiedRecord>();
  const keep=<T extends CertifiedRecord>(r:T):T=>{records.set(r.recordType+':'+r.id,r);return r;};
  const f=(id:string,kinds?:readonly FactKind[])=>keep(store.fact(id,ctx,kinds)).value;
  const s=(id:string,kinds?:readonly FactKind[])=>[...keep(store.series(id,ctx,kinds)).values];
  const labels=(id:string)=>keep(store.entity(id,spec.id)).texts;
  const label=(id:string)=>{const a=labels(id);requireData(a.length===1,'single entity label required');return a[0]!;};
  const align=(...arrays:readonly (readonly unknown[])[])=>requireData(arrays[0]!.length>0&&arrays.every(a=>a.length===arrays[0]!.length),'empty or unaligned certified vectors');
  const unit=(id:string)=>{const r=store.series(id,ctx);requireData(!!r.unit,`${id}: unit required`);return r.unit!;};
  const ordered=(a:number[])=>requireData(a.every((x,i)=>i===0||x>a[i-1]!), 'coordinates must increase strictly');
  const title=label(spec.title); let height=450,width=760;const out:string[]=[];
  const text=(x:number,y:number,value:string,anchor='start',size=11,attrs='')=>out.push(`<text x="${n(x)}" y="${n(y)}" font-size="${n(Math.max(size,12.1))}" text-anchor="${anchor}" ${attrs}>${esc(value)}</text>`);
  const line=(x1:number,y1:number,x2:number,y2:number,cls='',colour=INK,dash='')=>out.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${colour}" stroke-width="1" class="${cls}"${dash?` stroke-dasharray="${dash}"`:''}/>`);
  const path=(pts:readonly (readonly [number,number])[],cls='',fill='none',colour=BLUE)=>out.push(`<path d="${pts.map(([x,y],i)=>`${i?'L':'M'}${n(x)},${n(y)}`).join(' ')}${fill==='none'?'':' Z'}" class="${cls}" fill="${fill}" stroke="${colour}" stroke-width="1.5"/>`);
  const circle=(x:number,y:number,r:number,fill=BLUE,ref='')=>out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}" stroke="${INK}" stroke-width="0.5" data-fact="${esc(ref)}"/>`);
  const axes=(xd:[number,number],yd:[number,number],xt:string,yt:string,bottom=390)=>{
    const xa=niceLinear(...xd),ya=niceLinear(...yd);
    const x=scale(...xa.domain,85,705),y=scale(...(yd[0]>yd[1]?[...ya.domain].reverse() as [number,number]:ya.domain),bottom,65);
    line(85,bottom,705,bottom);line(85,65,85,bottom);
    for(const v of xa.ticks){line(x(v),bottom,x(v),bottom+5);text(x(v),bottom+20,tick(v),'middle',11,'class="axis-tick"');}
    for(const v of ya.ticks){line(80,y(v),85,y(v));text(73,y(v)+3,tick(v),'end',11,'class="axis-tick"');}
    text(395,bottom+44,xt,'middle');text(85,49,yt);return {x,y};
  };
  if(spec.kind!=='prisma')text(24,25,title,'start',14);
  switch(spec.kind){
    case 'meta-forest': case 'mr-leave-one-out': {
      const meta=spec.kind==='meta-forest';const rows=[...spec.rows,spec.pooled];
      requireData(spec.rows.length>0&&spec.rows.length<=30,'forest needs one to thirty rows');
      const values=rows.map(r=>{
        const est=f(r.estimate,meta?['rr','or','hr','ratio']:['effect','beta','difference']);
        const lo=f(r.lower,['ci']),hi=f(r.upper,['ci']),w=f(r.weight);
        requireData(lo<=est&&est<=hi&&w>0&&(!meta||lo>0),'invalid forest interval/weight');
        requireData(store.fact(r.lower,ctx).ciLevel===0.95&&store.fact(r.upper,ctx).ciLevel===0.95,'forest requires certified 95% intervals');
        return {r,est,lo,hi,w};});
      const trans=(v:number)=>meta?Math.log2(v):v;
      const raw=extent(values.flatMap(v=>[trans(v.lo),trans(v.hi)]),true);
      const linearAxis=niceLinear(Math.min(raw[0],-.1),raw[1]);
      const domain:[number,number]=meta?[Math.min(-2,Math.floor(raw[0])),Math.max(2,Math.ceil(raw[1]))]:linearAxis.domain;
      const plotLeft=meta?390:235,x=scale(...domain,plotLeft,610),totalWeight=values.slice(0,-1).reduce((sum,v)=>sum+v.w,0);
      const bottom=92+rows.length*31; height=bottom+(meta?106:67);
      text(24,64,meta?'Trial':'Variant omitted');
      if(meta){text(196,57,'Treatment','middle');text(273,57,'Control','middle');text(196,73,'n/N','middle');text(273,73,'n/N','middle');text(342,64,'Weight (%)','middle');}
      text(633,64,'Estimate (95% CI)');line(24,81,742,81);
      if(meta&&spec.rowGridlines)values.forEach((_,i)=>line(24,113+i*31,742,113+i*31,'row-gridline','#e5e5e5'));
      line(x(0),84,x(0),bottom,'null-line',INK,'4 3');
      values.forEach((v,i)=>{const y=99+i*31;text(24,y+4,label(v.r.label));line(x(trans(v.lo)),y,x(trans(v.hi)),y,'interval');
        if(i===rows.length-1)path([[x(trans(v.lo)),y],[x(trans(v.est)),y-6],[x(trans(v.hi)),y],[x(trans(v.est)),y+6]],'pooled-diamond',BLUE);
        else {const size=18*Math.sqrt(v.w/totalWeight);out.push(`<rect class="weight-square" x="${n(x(trans(v.est))-size/2)}" y="${n(y-size/2)}" width="${n(size)}" height="${n(size)}" fill="${BLUE}" data-fact="${esc(v.r.estimate)}"/>`);}
        text(633,y+4,`${v.est.toFixed(2)} (${v.lo.toFixed(2)}–${v.hi.toFixed(2)})`);
        if(meta){text(342,y+4,(i===rows.length-1?100:100*v.w/totalWeight).toFixed(1),'middle');
          if(i<spec.rows.length){const r=spec.rows[i]!;const et=f(r.eventsTreatment,['count']),nt=f(r.totalTreatment,['count']),ec=f(r.eventsControl,['count']),nc=f(r.totalControl,['count']);requireData(et<=nt&&ec<=nc&&nt>0&&nc>0,'arm counts invalid');text(196,y+4,`${et}/${nt}`,'middle');text(273,y+4,`${ec}/${nc}`,'middle');}}
      });
      line(plotLeft,bottom,610,bottom);
      const ticks=meta?Array.from({length:domain[1]-domain[0]+1},(_,i)=>2**(domain[0]+i)):linearAxis.ticks;
      ticks.forEach(v=>{line(x(trans(v)),bottom,x(trans(v)),bottom+5);text(x(trans(v)),bottom+20,tick(v),'middle',11,'class="axis-tick"');});
      if(meta){
        const kinds=values.map(v=>store.fact(v.r.estimate,ctx).kind);requireData(kinds.every(k=>k===kinds[0]),'forest measures must match');
        const measure=({rr:'Risk ratio',or:'Odds ratio',hr:'Hazard ratio',ratio:'Ratio'} as Record<string,string>)[kinds[0]!]!;
        text(500,bottom+41,`${measure} (log scale)`,'middle');
        const direction=label(spec.benefitDirection);requireData(direction==='lower'||direction==='higher','benefit direction must be lower or higher');
        text(x(0)-10,bottom+60,`Favours ${direction==='lower'?'treatment':'control'}`,'end');text(x(0)+10,bottom+60,`Favours ${direction==='lower'?'control':'treatment'}`);
        const i2=f(spec.iSquared,['percent']),tau=f(spec.tauSquared),hp=f(spec.heterogeneityP,['p']);requireData(i2>=0&&i2<=100&&tau>=0,'invalid heterogeneity');
        text(24,bottom+83,`${label(spec.outcome)}; ${label(spec.model)}`);
        text(24,bottom+100,`Heterogeneity: τ² = ${n(tau)}; I² = ${n(i2)}%; P = ${n(hp)}`);
      }else{text((plotLeft+610)/2,bottom+42,'Causal effect estimate','middle');text(24,bottom+61,'Diamond: all variants');}
      break;
    }
    case 'funnel': {
      const e=s(spec.estimates),se=s(spec.standardErrors,['se']);align(e,se);requireData(se.every(v=>v>0),'SE must be positive');
      const pooled=f(spec.pooled),max=niceLinear(0,Math.max(...se)*1.1).domain[1];
      const xd=extent([...e,pooled-1.96*max,pooled+1.96*max]);const {x,y}=axes(xd,[max,0],'Effect estimate','Standard error');
      line(x(pooled),y(0),x(pooled),y(max),'null-line',INK,'4 3');
      path([[x(pooled-1.96*max),y(max)],[x(pooled),y(0)],[x(pooled+1.96*max),y(max)]],'pseudo-ci');
      e.forEach((v,i)=>circle(x(v),y(se[i]!),4,BLUE,spec.estimates));height=475;text(85,462,'Funnel limits: pooled estimate ± 1.96 × SE');break;
    }
    case 'surrogacy': {
      const vx=s(spec.x),vy=s(spec.y),weights=s(spec.weights),fx=s(spec.fitX),fy=s(spec.fitY),cl=s(spec.confidenceLower,['ci']),cu=s(spec.confidenceUpper,['ci']),pl=s(spec.predictionLower,['ci']),pu=s(spec.predictionUpper,['ci']);
      align(vx,vy,weights);align(fx,fy,cl,cu,pl,pu);ordered(fx);requireData(fx.length>=2&&fx[0]!<=Math.min(...vx)&&fx.at(-1)!>=Math.max(...vx),'fit must span the observed surrogate effects');
      requireData(weights.every(v=>v>0),'weights must be positive');
      [spec.confidenceLower,spec.confidenceUpper,spec.predictionLower,spec.predictionUpper].forEach(id=>requireData(store.series(id,ctx).ciLevel===0.95,'bands must be certified 95% intervals'));
      requireData(fy.every((v,i)=>pl[i]!<=cl[i]!&&cl[i]!<=v&&v<=cu[i]!&&cu[i]!<=pu[i]!), 'prediction band must contain confidence band and fit');
      const threshold=f(spec.threshold);requireData(threshold>=fx[0]!&&threshold<=fx.at(-1)!,'threshold outside certified fit domain');const {x,y}=axes(extent([...vx,...fx,threshold],true),extent([...vy,...pl,...pu],true),`Surrogate effect (${unit(spec.x)})`,`Outcome effect (${unit(spec.y)})`);
      const band=(lo:number[],hi:number[],fill:string,cls:string)=>path([...fx.map((v,i)=>[x(v),y(lo[i]!)] as const),...fx.map((v,i)=>[x(v),y(hi[i]!)] as const).reverse()],cls,fill,fill);
      band(pl,pu,'#e5e5e5','prediction-band');band(cl,cu,'#b8dcec','confidence-band');
      for(const bounds of [pl,pu]){path(fx.map((v,i)=>[x(v),y(bounds[i]!)]),'prediction-limit','none','#555555');out[out.length-1]=out.at(-1)!.replace('stroke-width="1.5"','stroke-width="1.5" stroke-dasharray="5 3"');}
      line(x(0),65,x(0),390,'null-line',INK,'4 3');line(85,y(0),705,y(0),'null-line',INK,'4 3');
      path(fx.map((v,i)=>[x(v),y(fy[i]!)]),'weighted-fit');out[out.length-1]=out.at(-1)!.replace('<path ',`<path data-fact="${esc(spec.fitY)}" `);line(x(threshold),65,x(threshold),390,'threshold-effect',INK,'2 3');
      vx.forEach((v,i)=>circle(x(v),y(vy[i]!),10*Math.sqrt(weights[i]!/Math.max(...weights)),BLUE,spec.x));
      const r2=f(spec.rSquared,['proportion']),rlo=f(spec.rSquaredLower,['ci']),rhi=f(spec.rSquaredUpper,['ci']);
      requireData(0<=rlo&&rlo<=r2&&r2<=rhi&&rhi<=1,'invalid trial R squared interval');
      [spec.rSquaredLower,spec.rSquaredUpper].forEach(id=>requireData(store.fact(id,ctx).ciLevel===.95,'R squared needs a 95% CI'));
      text(100,88,`R²trial = ${r2.toFixed(2)} (95% CI, ${rlo.toFixed(2)}–${rhi.toFixed(2)})`);
      text(x(0)-10,120,'No surrogate effect','end');
      text(94,y(0)-8,'No outcome effect');
      text(x(threshold)+10,105,'Surrogate threshold effect');text(x(threshold)+10,122,`= ${n(threshold)}`);
      height=484;text(85,461,`${label(spec.model)}; inner band: 95% confidence; outer band: 95% prediction`);
      text(85,479,'Bubble area proportional to trial weight');break;
    }
    case 'prisma': {
      const d=spec.flow; const count=(id:string)=>f(id,['count']);
      const excluded=(r:readonly {reason:string;count:string}[])=>r.reduce((sum,v)=>sum+count(v.count),0);
      const eq=(a:number,b:number)=>requireData(a===b,'PRISMA count conservation failed');
      eq(count(d.database_results)+count(d.register_results)-count(d.duplicates)-count(d.excluded_automatic)-count(d.excluded_other),count(d.records_screened));
      eq(count(d.records_screened)-count(d.records_excluded),count(d.dbr_sought_reports));
      eq(count(d.dbr_sought_reports)-count(d.dbr_notretrieved_reports),count(d.dbr_assessed));
      requireData(excluded(d.dbr_excluded)<=count(d.dbr_assessed),'database exclusions exceed assessed reports');
      let reports=count(d.dbr_assessed)-excluded(d.dbr_excluded);
      if(d.other){const o=d.other;requireData(o.other_excluded.length<=5,'maximum five other-method exclusion reasons');eq(count(o.website_results)+count(o.organisation_results)+count(o.citations_results),count(o.other_sought_reports));eq(count(o.other_sought_reports)-count(o.other_notretrieved_reports),count(o.other_assessed));requireData(excluded(o.other_excluded)<=count(o.other_assessed),'other exclusions exceed assessed reports');reports+=count(o.other_assessed)-excluded(o.other_excluded);}
      eq(reports,count(d.new_reports));requireData(count(d.new_studies)<=reports,'studies exceed reports');
      if(d.previous)requireData(count(d.previous.previous_studies)<=count(d.previous.previous_reports),'previous studies exceed previous reports');
      eq(count(d.total_studies),count(d.new_studies)+(d.previous?count(d.previous.previous_studies):0));eq(count(d.total_reports),reports+(d.previous?count(d.previous.previous_reports):0));
      requireData(count(d.total_studies)<=count(d.total_reports),'total studies exceed reports');
      requireData(!d.previous,'official new-review template does not accept previous-review counts');
      requireData(!!d.other,'official all-sources template requires other-method counts');
      requireData(d.dbr_excluded.length<=5,'maximum five PRISMA exclusion reasons');
      const wrap=(value:string,max:number)=>{const lines:string[]=[];let current='';for(const word of value.split(' ')){if(current.length+word.length+1>max){lines.push(current);current=word;}else current+=(current?' ':'')+word;}if(current)lines.push(current);return lines;};
      const box=(bx:number,by:number,bh:number,lines:string[])=>{
        const wrapped=lines.flatMap(v=>wrap(v,22));requireData(wrapped.length*14+16<=bh,'PRISMA text exceeds official box; shorten certified exclusion labels');
        out.push(`<rect x="${bx}" y="${by}" width="150" height="${bh}" rx="5" data-node-box="${bx}-${by}" fill="#ffffff" stroke="${INK}"/>`);
        wrapped.forEach((v,i)=>text(bx+9,by+20+i*14,v,'start',10.5,`data-node="${bx}-${by}"`));
      };
      const arrow=(points:[number,number][])=>{path(points,'flow-edge','none',INK);const tip=points.at(-1)!,prev=points.at(-2)!,angle=Math.atan2(tip[1]-prev[1],tip[0]-prev[0]);
        path([[tip[0]-6*Math.cos(angle)+3*Math.sin(angle),tip[1]-6*Math.sin(angle)-3*Math.cos(angle)],tip,[tip[0]-6*Math.cos(angle)-3*Math.sin(angle),tip[1]-6*Math.sin(angle)+3*Math.cos(angle)]],'flow-arrowhead',INK,INK);};
      const nc=(id:string)=>`(n = ${count(id)})`,o=d.other!;
      // Official two search streams, right-hand exclusions and three vertical phase bands.
      [44,410].forEach((bx,i)=>{out.push(`<rect x="${bx}" y="10" width="334" height="38" rx="5" fill="${PRISMA.headerColour}" stroke="${INK}"/>`);wrap(PRISMA.headers[i],49).forEach((v,j)=>text(bx+167,26+j*14,v,'middle',10.5));});
      [[60,180],[252,286],[568,106]].forEach(([by,bh],i)=>{out.push(`<rect x="8" y="${by}" width="22" height="${bh}" rx="5" fill="${PRISMA.phaseColour}" stroke="${INK}"/>`);text(22,by!+bh!/2,PRISMA.phases[i],'middle',11,`transform="rotate(-90 22 ${by!+bh!/2})"`);});
      box(44,60,180,[PRISMA.identified,`Databases ${nc(d.database_results)}`,`Registers ${nc(d.register_results)}`]);
      box(228,60,180,[PRISMA.removed,`${PRISMA.duplicates} ${nc(d.duplicates)}`,`${PRISMA.automatic} ${nc(d.excluded_automatic)}`,`${PRISMA.otherRemoved} ${nc(d.excluded_other)}`]);
      box(410,60,180,[PRISMA.otherIdentified,`Websites ${nc(o.website_results)}`,`Organisations ${nc(o.organisation_results)}`,`Citation searching ${nc(o.citations_results)}`]);
      box(44,252,48,[PRISMA.screened,nc(d.records_screened)]);box(228,252,48,[PRISMA.screenExcluded,nc(d.records_excluded)]);
      box(44,330,62,[PRISMA.sought,nc(d.dbr_sought_reports)]);box(228,330,62,[PRISMA.notRetrieved,nc(d.dbr_notretrieved_reports)]);
      box(410,330,62,[PRISMA.sought,nc(o.other_sought_reports)]);box(594,330,62,[PRISMA.notRetrieved,nc(o.other_notretrieved_reports)]);
      const reasonsHeight=Math.max(104,30+Math.max(d.dbr_excluded.flatMap(v=>wrap(`${label(v.reason)} ${nc(v.count)}`,22)).length,o.other_excluded.flatMap(v=>wrap(`${label(v.reason)} ${nc(v.count)}`,22)).length)*14);
      box(44,426,62,[PRISMA.assessed,nc(d.dbr_assessed)]);box(228,426,reasonsHeight,[PRISMA.excluded,...d.dbr_excluded.map(v=>`${label(v.reason)} ${nc(v.count)}`)]);
      box(410,426,62,[PRISMA.assessed,nc(o.other_assessed)]);box(594,426,reasonsHeight,[PRISMA.excluded,...o.other_excluded.map(v=>`${label(v.reason)} ${nc(v.count)}`)]);
      // Keep an explicitly bounded layout; larger exclusion lists need a separate supplement.
      requireData(reasonsHeight<=112,'PRISMA exclusion list exceeds the fixed layout');
      box(44,568,106,[PRISMA.included,nc(d.new_studies),PRISMA.reports,nc(d.new_reports)]);
      for(const [top,bottom]of [[228,252],[300,330],[392,426],[488,568]])arrow([[119,top!],[119,bottom!]]);
      for(const yy of [144,276,361,457])arrow([[194,yy],[228,yy]]);
      arrow([[485,228],[485,330]]);arrow([[485,392],[485,426]]);
      for(const yy of [361,457])arrow([[560,yy],[594,yy]]);
      arrow([[485,488],[485,607],[194,607]]);
      let foot=710;for(const note of PRISMA.footnotes){for(const part of wrap(note,142)){text(8,foot,part,'start',10.5);foot+=14;}foot+=3;}
      text(8,foot,PRISMA.credit,'start',10.5);height=foot+10;
      break;
    }
    case 'regional': {
      const pos=s(spec.positions,['count']),p=s(spec.pValues,['p']),ld=s(spec.ld),names=labels(spec.variants);align(pos,p,ld,names);ordered(pos);
      requireData(ld.every(v=>v===-1||(v>=0&&v<=1)),'LD must be r² or -1 (unknown)');const lead=f(spec.leadIndex,['count']);requireData(lead<pos.length,'lead variant outside vector');
      requireData(p.every(v=>v>0),'regional P values must be positive');
      const chromosome=label(spec.chromosome);requireData(/^(?:[1-9][0-9]*|X|Y|MT)$/u.test(chromosome),'chromosome must use a numeric or standard sex/mitochondrial identifier');
      const logs=p.map(v=>-Math.log10(v)),xd=extent(pos);const axis=axes([xd[0]/1e6,xd[1]/1e6],[0,Math.max(...logs)*1.15||1],`Chromosome ${chromosome} position (Mb; ${label(spec.genomeBuild)})`,'−log₁₀ P',315);
      const x=(bp:number)=>axis.x(bp/1e6),y=axis.y;
      const rp=s(spec.recombinationPositions,['count']),rr=s(spec.recombinationRates);align(rp,rr);ordered(rp);requireData(rp.length>=2&&rp.every(v=>v>=xd[0]&&v<=xd[1]),'recombination outside window');requireData(unit(spec.recombinationRates)==='cM/Mb','recombination unit must be cM/Mb');requireData(rr.every(v=>v>=0),'negative recombination rate');
      const rateAxis=niceLinear(0,Math.max(...rr)||1),ry=scale(...rateAxis.domain,315,65);
      path(rp.map((v,i)=>[x(v),ry(rr[i]!)]),'recombination','none','#777777');line(705,65,705,315,'recombination-axis');
      rateAxis.ticks.forEach(v=>{line(705,ry(v),710,ry(v));text(716,ry(v)+3,tick(v),'start',11,'class="axis-tick recombination-tick"');});
      text(748,190,'Recombination rate (cM/Mb)','middle',11,'transform="rotate(-90 748 190)"');
      pos.forEach((v,i)=>{const col=ld[i]===-1?'#aaaaaa':LD_PALETTE[Math.min(4,Math.floor(ld[i]!*5))]!;
        if(i===lead)path([[x(v),y(logs[i]!)-7],[x(v)+7,y(logs[i]!)],[x(v),y(logs[i]!)+7],[x(v)-7,y(logs[i]!)]],'lead-variant',col,INK);
        else if(ld[i]===-1){circle(x(v),y(logs[i]!),4,'none',spec.pValues);line(x(v)-3,y(logs[i]!),x(v)+3,y(logs[i]!),'missing-ld','#777777');}
        else circle(x(v),y(logs[i]!),4,col,spec.pValues);});text(x(pos[lead]!),y(logs[lead]!)+24,names[lead]!,'middle');
      height=467+spec.genes.length*32;
      spec.genes.forEach((g,i)=>{const start=f(g.start,['count']),end=f(g.end,['count']),strand=label(g.strand);requireData(start<end&&start>=xd[0]&&end<=xd[1],'gene outside regional window');requireData(strand==='+'||strand==='-','gene strand must be + or -');
        const yy=399+i*32,left=x(start),right=x(end);text((left+right)/2,yy-10,label(g.label),'middle');
        line(left,yy,right,yy,'gene-intron');
        const starts=s(g.exonStarts,['count']),ends=s(g.exonEnds,['count']);align(starts,ends);ordered(starts);
        requireData(starts.every((v,j)=>v>=start&&ends[j]!<=end&&v<ends[j]!&&(j===0||v>ends[j-1]!)),'invalid certified exon coordinates');
        starts.forEach((v,j)=>out.push(`<rect class="gene-exon" x="${n(x(v))}" y="${yy-4}" width="${n(x(ends[j]!)-x(v))}" height="8" fill="${INK}"/>`));
        for(let xx=left+10;xx<right-8;xx+=18){const direction=strand==='+'?1:-1;path([[xx-3*direction,yy-3],[xx+3*direction,yy],[xx-3*direction,yy+3]],'strand-arrow','none',INK);}
      });
      text(85,height-21,`LD reference: ${label(spec.ldPopulation)}`);
      if(ld.includes(-1))text(85,height-66,'Open marks: LD unavailable');
      text(85,height-41,'r²');LD_PALETTE.forEach((c,i)=>{circle(127+i*118,height-45,5,c);text(138+i*118,height-41,`${LD_BREAKS[i]}–${i===4?'1.0':LD_BREAKS[i+1]}`);});break;
    }
    case 'umap': {
      const vx=s(spec.x),vy=s(spec.y),groups=s(spec.groups,['count']),names=labels(spec.groupLabels);align(vx,vy,groups);
      requireData(names.length>0&&names.length<=4&&groups.every(v=>v<names.length),'UMAP supports one to four labelled groups per panel');
      const colours=['#0072b2','#e69f00','#000000','#cc79a7'];const {x,y}=axes(extent(vx),extent(vy),'UMAP 1','UMAP 2');
      vx.forEach((v,i)=>circle(x(v),y(vy[i]!),2.5,colours[groups[i]!]!,spec.x));
      names.forEach((name,g)=>{const inds=groups.flatMap((v,i)=>v===g?[i]:[]);requireData(inds.length>0,'empty embedding group');
        const cx=inds.reduce((sum,i)=>sum+x(vx[i]!),0)/inds.length,top=Math.min(...inds.map(i=>y(vy[i]!)));text(cx,Math.max(78,top-14),name,'middle',11);});
      break;
    }
    case 'architecture': {
      requireData(spec.nodes.length>0&&spec.nodes.length<=20,'architecture needs one to twenty nodes');
      const graph=new dagre.graphlib.Graph().setGraph({rankdir:'LR',nodesep:36,ranksep:45,marginx:24,marginy:60}).setDefaultEdgeLabel(()=>({}));
      const ids=new Set<string>();[...spec.nodes].sort((a,b)=>a.id.localeCompare(b.id,'en')).forEach(node=>{requireData(!ids.has(node.id),'duplicate graph node');ids.add(node.id);const txt=label(node.label);requireData(txt.length<=28,'node label exceeds fixed layout');graph.setNode(node.id,{width:175,height:70,label:txt});});
      const edgeIds=new Set<string>();[...spec.edges].sort((a,b)=>(a.from+'|'+a.to).localeCompare(b.from+'|'+b.to,'en')).forEach(edge=>{requireData(ids.has(edge.from)&&ids.has(edge.to),'unknown graph endpoint');const id=edge.from+'|'+edge.to;requireData(!edgeIds.has(id),'duplicate edge');edgeIds.add(id);graph.setEdge(edge.from,edge.to);});
      requireData(dagre.graphlib.alg.isAcyclic(graph),'study design must be a directed acyclic graph');dagre.layout(graph);
      requireData(graph.graph().width!<=width,'architecture too wide; split into panels');height=graph.graph().height!-40;width=graph.graph().width!;
      graph.edges().forEach((edge: {v:string;w:string})=>{const data=graph.edge(edge);const assumption=spec.edges.find(e=>e.from===edge.v&&e.to===edge.w)?.assumption;const before=out.length;path(data.points.map((p:{x:number;y:number})=>[p.x,p.y]),'flow-edge','none',INK);if(assumption)out[before]=out[before]!.replace('stroke-width="1.5"','stroke-width="1.5" stroke-dasharray="4 3"');const tip=data.points.at(-1)!;path([[tip.x-6,tip.y-4],[tip.x,tip.y],[tip.x-6,tip.y+4]],'arrowhead',INK,INK);});
      [...spec.nodes].sort((a,b)=>a.id.localeCompare(b.id,'en')).forEach(node=>{const p=graph.node(node.id);out.push(`<rect x="${n(p.x-87.5)}" y="${n(p.y-35)}" width="175" height="70" rx="5" fill="#ffffff" stroke="${INK}"/>`);
        requireData(node.icon==='bio'||node.icon==='health','unknown icon');text(p.x,p.y+4,p.label,'middle',14);});break;
    }
    default: refuse('invalid-spec','unknown publication template');
  }
  const sourceRecords=[...records.values()].sort((a,b)=>a.id.localeCompare(b.id,'en'));
  const alt=`${title}. ${spec.kind}; all displayed data originate from authenticated records.${spec.kind==='prisma'?' Official PRISMA 2020 template adapted to SVG. '+PRISMA.credit:''}`;
  const provenance=JSON.stringify({template:'pw3b-v1',spec,records:sourceRecords});
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${n(width*183/760)}mm" height="${n(height*183/760)}mm" viewBox="0 0 ${width} ${height}" data-publication-kind="${spec.kind}" role="img" aria-labelledby="${spec.id}-title ${spec.id}-desc" font-family="Liberation Sans" fill="${INK}"><title id="${spec.id}-title">${esc(title)}</title><desc id="${spec.id}-desc">${esc(alt)}</desc>${embeddedFonts()}${out.join('')}<metadata>${esc(provenance)}</metadata></svg>\n`;
  const audit=auditPublicationSvg(svg);if(audit.state!=='PASS')refuse('figure-lint','publication audit failed',audit.findings.map(f=>`${f.code}: ${f.detail}`));
  const columns:CsvColumn[]=['record_type','record_id','index','value','unit','certificate_hash'].map(name=>({name,type:name==='index'?'integer':'string',unit:'',source:'authenticated figure record'}));
  const rows:CsvCell[][]=sourceRecords.flatMap(r=>{const values=r.recordType==='fact'?[r.value]:r.recordType==='series'?[...r.values]:r.recordType==='entity'?[...r.texts]:[];return values.map((v,i)=>[r.recordType,r.id,i,v,'unit' in r?r.unit:null,r.certHash]);});
  const sourceCsv=toCsv(columns,rows),sourceCsvSha256=createHash('sha256').update(sourceCsv).digest('hex');
  return {id:spec.id,kind:spec.kind,sourceCsv,sourceCsvSha256,svg,sha256:createHash('sha256').update(svg).digest('hex'),sourceRecords,alt};
}
/** Existing PW3 templates retain their complete closed-world and round-trip checks before embedding. */
export function renderEmbeddedFigure(spec: FigureSpec, store: FactStore): RenderedFigure {
  const figure=renderFigure(spec,store),svg=embedPublicationFonts(figure.svg);
  const audit=auditPublicationSvg(svg);if(audit.state!=='PASS')refuse('figure-lint','embedded publication audit failed',audit.findings.map(f=>f.code+': '+f.detail));
  return {...figure,svg,sha256:createHash('sha256').update(svg).digest('hex')};
}
/** Regeneration authenticates every mark, text, metadata, font and icon byte. */
export function verifyPublicationFigure(svg:string,spec:PublicationSpec,store:FactStore):boolean {
  try{return svg===renderPublicationFigure(spec,store).svg;}catch{return false;}
}
