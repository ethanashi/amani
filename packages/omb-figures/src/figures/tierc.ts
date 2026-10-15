import {Canvas,drawAxis,line,marker,polyline,templateFragments,STROKE} from '../draw.ts';
import {NEUTRAL,OKABE_ITO} from '../palette.ts';
import {makeScale,niceLinear} from '../scale.ts';
import type {FunnelSpec,SurrogacyScatterSpec} from '../spec.ts';
import type {FactStore} from '../store.ts';
import {T} from '../templates.ts';
import {stat} from '../text.ts';
import {captionSegs,requireClaim,sameLength,useContext,type FigureDraft} from './common.ts';
import {refuse} from '../refusal.ts';
export function renderFunnel(spec:FunnelSpec,store:FactStore):FigureDraft {
 const ctx=useContext(spec,[spec.claimId]);requireClaim(store,spec.claimId,ctx.where);const canvas=new Canvas('funnel',spec.id,360,templateFragments([spec.caption.message]));
 const x=canvas.useSeries(store.series(spec.effects,ctx,['effect','beta','difference']),'effect'),se=canvas.useSeries(store.series(spec.standardErrors,ctx,['se']),'standard-error'),center=canvas.useFact(store.fact(spec.center,ctx,['effect','beta','difference']),'pooled-effect');sameLength(ctx.where,x,se);if(!x.values.length||se.values.some(v=>v<=0))refuse('inconsistent-data','funnel requires estimable positive SEs');
 const max=Math.max(...se.values)*1.08,xa=niceLinear(Math.min(...x.values,center.value-1.96*max),Math.max(...x.values,center.value+1.96*max)),ya=niceLinear(0,max),sx=makeScale('linear',xa.domain,[50,340],xa.ticks),sy=makeScale('linear',ya.domain,[15,205],ya.ticks);
 canvas.nodes.push(line(sx.map(center.value),15,sx.map(center.value),205,{stroke:NEUTRAL.grey,dash:'3 2',cls:'null-line'}));
 for(const sign of [-1,1])canvas.nodes.push(line(sx.map(center.value),sy.map(0),sx.map(center.value+sign*1.96*max),sy.map(max),{stroke:NEUTRAL.grey,dash:'3 2',cls:'ref-threshold'}));
 x.values.forEach((v,i)=>canvas.nodes.push(canvas.bindMark(marker('circle',sx.map(v),sy.map(se.values[i]!),2.5,OKABE_ITO.blue,'sa'),[{factId:x.id,index:i,axis:'x',scale:sx},{factId:se.id,index:i,axis:'y',scale:sy}])));
 canvas.nodes.push(drawAxis(canvas,{orient:'x',scale:sx,at:205,title:[stat(T.tiercEffect)]}),drawAxis(canvas,{orient:'y',scale:sy,at:50,title:[stat(T.tiercSE)]}));
 return {canvas,height:260,title:[stat(T.titleFunnel)],alt:[stat(T.altFunnel)],caption:captionSegs(store,ctx,spec.caption,[stat(T.capFunnel)])};
}
export function renderSurrogacyScatter(spec:SurrogacyScatterSpec,store:FactStore):FigureDraft {
 const ctx=useContext(spec,[spec.claimId]);requireClaim(store,spec.claimId,ctx.where);const canvas=new Canvas('surrogacy-scatter',spec.id,360,templateFragments([spec.caption.message]));
 const x=canvas.useSeries(store.series(spec.surrogate,ctx,['effect','beta']),'surrogate'),y=canvas.useSeries(store.series(spec.outcome,ctx,['effect','beta']),'outcome'),xs=canvas.useSeries(store.series(spec.seSurrogate,ctx,['se']),'surrogate-se'),ys=canvas.useSeries(store.series(spec.seOutcome,ctx,['se']),'outcome-se');sameLength(ctx.where,x,y,xs,ys);
 const grid=canvas.useSeries(store.series(spec.grid,ctx,['effect','beta']),'prediction-x'),fit=canvas.useSeries(store.series(spec.fitted,ctx,['effect','beta']),'prediction-mean'),lo=canvas.useSeries(store.series(spec.lower,ctx,['ci']),'prediction-lower'),hi=canvas.useSeries(store.series(spec.upper,ctx,['ci']),'prediction-upper');sameLength(ctx.where,grid,fit,lo,hi);
 if(!x.values.length||grid.values.length<2||[...xs.values,...ys.values].some(v=>v<=0)||grid.values.some((v,i)=>i>0&&v<=grid.values[i-1]!)||lo.values.some((v,i)=>v>fit.values[i]!||hi.values[i]!<fit.values[i]!))refuse('inconsistent-data','invalid surrogacy series or band');
 const xa=niceLinear(Math.min(0,...x.values.map((v,i)=>v-xs.values[i]!)),Math.max(0,...x.values.map((v,i)=>v+xs.values[i]!))),ya=niceLinear(Math.min(0,...lo.values,...y.values.map((v,i)=>v-ys.values[i]!)),Math.max(0,...hi.values,...y.values.map((v,i)=>v+ys.values[i]!))),sx=makeScale('linear',xa.domain,[50,340],xa.ticks),sy=makeScale('linear',ya.domain,[205,15],ya.ticks);
 canvas.nodes.push(line(50,sy.map(0),340,sy.map(0),{stroke:NEUTRAL.grey,dash:'3 2',cls:'null-line'}));
 for(const values of [lo,hi,fit])canvas.nodes.push(canvas.bindMark(polyline(grid.values.map((v,i)=>[sx.map(v),sy.map(values.values[i]!)]),{stroke:OKABE_ITO.blue,width:STROKE.mark,...(values===fit?{}:{dash:'3 2'}),cls:'ci'}),grid.values.flatMap((_,i)=>[{factId:grid.id,index:i,axis:'x' as const,scale:sx,vertex:i},{factId:values.id,index:i,axis:'y' as const,scale:sy,vertex:i}])));
 x.values.forEach((v,i)=>{canvas.nodes.push(line(sx.map(v-xs.values[i]!),sy.map(y.values[i]!),sx.map(v+xs.values[i]!),sy.map(y.values[i]!),{stroke:NEUTRAL.grey,cls:'ci'}),line(sx.map(v),sy.map(y.values[i]!-ys.values[i]!),sx.map(v),sy.map(y.values[i]!+ys.values[i]!),{stroke:NEUTRAL.grey,cls:'ci'}),canvas.bindMark(marker('circle',sx.map(v),sy.map(y.values[i]!),2.5,OKABE_ITO.blue,'sa'),[{factId:x.id,index:i,axis:'x',scale:sx},{factId:y.id,index:i,axis:'y',scale:sy}]));});
 canvas.nodes.push(drawAxis(canvas,{orient:'x',scale:sx,at:205,title:[stat(T.tiercSurrogate)]}),drawAxis(canvas,{orient:'y',scale:sy,at:50,title:[stat(T.tiercOutcome)]}));
 return {canvas,height:260,title:[stat(T.titleSurrogacy)],alt:[stat(T.altSurrogacy)],caption:captionSegs(store,ctx,spec.caption,[stat(T.capSurrogacy)])};
}
