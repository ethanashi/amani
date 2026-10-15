/** ggsurvfit conventions only; no R implementation copied. Certified event/risk series
 * supply arithmetic controls. This renderer does not estimate survival from patient data. */
import { Canvas, drawAxis, group, legendEntry, line, polyline, templateFragments } from '../draw.ts';
import { coord, tickText, fixedText } from '../format.ts';
import { SERIES_COLOURS, SERIES_DASHES } from '../palette.ts';
import { refuse } from '../refusal.ts';
import { makeScale, niceLinear, UNIT_AXIS } from '../scale.ts';
import type { KaplanMeierSpec } from '../spec.ts';
import type { FactStore } from '../store.ts';
import { T } from '../templates.ts';
import { resolveTemplate, stat, type Segment } from '../text.ts';
import { el } from '../xml.ts';
import { captionSegs, nonEmptyArray, requireClaim, sameLength, scalarSegs, unitSeg, useContext, type FigureDraft, SERIES_LETTERS } from './common.ts';
export function renderKaplanMeier(spec: KaplanMeierSpec, store: FactStore): FigureDraft {
  const ctx=useContext(spec,[spec.claimId]); requireClaim(store,spec.claimId,ctx.where);
  const groups=nonEmptyArray(spec.groups,'survival groups',4);
  const canvas=new Canvas(spec.kind,spec.id,360,templateFragments([...groups.map(g=>g.label),spec.caption.message,spec.caption.shortLabel]));
  const data=groups.map(g=> {
    const n=canvas.useFact(store.fact(g.n,ctx,['count']),'group-n');
    const time=canvas.useSeries(store.series(g.time,ctx,['effect']),'time');
    const survival=canvas.useSeries(store.series(g.survival,ctx,['probability']),'survival');
    const lower=canvas.useSeries(store.series(g.lower,ctx,['ci']),'survival-lower');
    const upper=canvas.useSeries(store.series(g.upper,ctx,['ci']),'survival-upper');
    const risk=canvas.useSeries(store.series(g.risk,ctx,['count']),'risk');
    const events=canvas.useSeries(store.series(g.events,ctx,['count']),'events');
    const censored=canvas.useSeries(store.series(g.censored,ctx,['count']),'censored');
    const length=sameLength(ctx.where,time,survival,lower,upper,risk,events,censored);
    if(length<2 || length>8 || !time.unit || time.values[0]!==0 || time.values.some((t,i)=>i>0&&t<=time.values[i-1]!)) refuse('inconsistent-data','survival time needs units and two to eight strictly increasing knots starting at zero');
    if(n.value<=0 || risk.values[0]!==n.value || events.values[0]!==0 || censored.values[0]!==0) refuse('inconsistent-data','baseline survival/risk counts inconsistent');
    if(lower.ciLevel!==upper.ciLevel || !lower.method || lower.method!==upper.method) refuse('inconsistent-data','survival interval level and method required and must agree');
    let estimate=1;
    for(let i=0;i<length;i++) {
      const r=risk.values[i]!, d=events.values[i]!, c=censored.values[i]!;
      if(r<=0 || d+c>r || (i>0 && r!==risk.values[i-1]!-events.values[i-1]!-censored.values[i-1]!)) refuse('inconsistent-data','risk/events/censor arithmetic failed');
      estimate*=1-d/r;
      if(Math.abs(estimate-survival.values[i]!)>1e-10) refuse('inconsistent-data','Kaplan–Meier product-limit arithmetic failed');
      if(lower.values[i]!<0 || upper.values[i]!>1 || lower.values[i]!>survival.values[i]! || upper.values[i]!<survival.values[i]!) refuse('inconsistent-data','survival CI must bracket survival in [0,1]');
    }
    return {g,n,time,survival,lower,upper,risk,events,censored};
  });
  if(data.some(d=>d.time.unit!==data[0]!.time.unit)) refuse('inconsistent-data','survival groups mix time units');
  // Shared risk grid avoids a misleading table whose columns refer to different times.
  if(data.some(d=>JSON.stringify(d.time.values)!==JSON.stringify(data[0]!.time.values))) refuse('inconsistent-data','survival groups require the same risk grid');
  const times=data[0]!.time.values, end=times.at(-1)!;
  const timeAxis=niceLinear(0,end,4);
  const sx=makeScale('linear',timeAxis.domain,[95,340],timeAxis.ticks);
  const sy=makeScale('linear',UNIT_AXIS.domain,[175,15],UNIT_AXIS.ticks);
  const riskNodes=[canvas.text(8,220,[stat(T.kmRisk)])];
  times.forEach(t=>riskNodes.push(canvas.text(sx.map(t),233,[{kind:'bound',text:tickText(t),source:{type:'axis',id:'x',sourceRecordId:null,grade:null}}],{anchor:'middle'})));
  data.forEach((d,i)=> {
    const colour=SERIES_COLOURS[i]!, dash=SERIES_DASHES[i]!, letter=SERIES_LETTERS[i]!;
    const step=(values:readonly number[])=>times.flatMap((t,k)=>k===0?[[sx.map(t),sy.map(values[k]!)] as const]:[[sx.map(t),sy.map(values[k-1]!)] as const,[sx.map(t),sy.map(values[k]!)] as const]);
    const pts=[...step(d.upper.values),...step(d.lower.values).reverse()];
    canvas.nodes.push(el('polygon',[['class',`band ${letter}`],['points',pts.map(p=>`${coord(p[0])},${coord(p[1])}`).join(' ')],['fill',colour],['fill-opacity','0.15'],['stroke','none']]));
    const encodings=times.flatMap((_,k)=>[{factId:d.time.id,index:k,axis:'x' as const,scale:sx,vertex:k*2},{factId:d.survival.id,index:k,axis:'y' as const,scale:sy,vertex:k*2}]);
    canvas.nodes.push(canvas.bindMark(polyline(step(d.survival.values),{stroke:colour,dash,cls:`mark series-line ${letter}`}),encodings));
    times.forEach((t,k)=> {
      if(d.censored.values[k]!>0) canvas.nodes.push(line(sx.map(t),sy.map(d.survival.values[k]!)-3,sx.map(t),sy.map(d.survival.values[k]!)+3,{stroke:colour,cls:'censor'}));
      riskNodes.push(canvas.text(sx.map(t),247+i*14,[{kind:'bound',text:fixedText(d.risk.values[k]!,0),source:{type:'fact',id:d.risk.id,sourceRecordId:d.risk.sourceRecordId,grade:d.risk.grade}}],{anchor:'middle'}));
    });
    const label=resolveTemplate(d.g.label,store,ctx);
    riskNodes.push(canvas.text(8,247+i*14,label));
    canvas.nodes.push(legendEntry(canvas,95,260+data.length*14+i*13,{line:{stroke:colour,dash}},[...label,stat(T.openParen),stat(T.nEq),...scalarSegs(store,d.n),stat(T.closeParen)]));
  });
  canvas.nodes.push(group('risk-table',riskNodes));
  canvas.nodes.push(drawAxis(canvas,{orient:'x',scale:sx,at:175,title:[stat(T.kmX),stat(T.openParen),unitSeg(data[0]!.time)!,stat(T.closeParen)]}));
  canvas.nodes.push(drawAxis(canvas,{orient:'y',scale:sy,at:95,title:[stat(T.kmY)]}));
  const interval=data[0]!.lower;
  if(data.some(d=>d.lower.ciLevel!==interval.ciLevel || d.lower.method!==interval.method)) refuse('inconsistent-data','survival groups mix interval methods');
  const intervalText:Segment={kind:'bound',text:`${store.formatter.ciLevel(interval.ciLevel!)} CI; ${interval.method}`,source:{type:'fact',id:interval.id,sourceRecordId:interval.sourceRecordId,grade:interval.grade}};
  const description=[stat(T.titleKm),stat(T.periodSpace),stat(T.kmCap),stat(T.space),intervalText];
  return {canvas,height:270+data.length*27,title:[stat(T.titleKm)],alt:description,caption:captionSegs(store,ctx,spec.caption,description)};
}
