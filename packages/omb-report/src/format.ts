import { finite, requireThat, refuse } from './common.ts';
export type NumberKind='effect'|'ci'|'p'|'percent'|'count'|'parameter';
const side=(x:number,t:number)=>Math.sign(x-t);
function significant(value:number,digits:number):string{return Number(value.toPrecision(digits)).toString();}
export function formatNumber(value:number,kind:NumberKind,thresholds:readonly number[]=[]):string{
 requireThat(finite(value)&&thresholds.every(finite),'non-finite display number');
 if(kind==='count'){requireThat(Number.isSafeInteger(value)&&value>=0,'invalid count');return value.toLocaleString('en-US',{useGrouping:true,maximumFractionDigits:0});}
 if(kind==='percent'){requireThat(value>=0&&value<=100,'invalid percent');let digits=value<10?1:0;while(digits<=15){const s=value.toFixed(digits);if(thresholds.every(t=>side(Number(s),t)===side(value,t)))return s+'%';digits++;}return value+'%';}
 for(let digits=kind==='p'?2:3;digits<=17;digits++){const s=significant(value,digits);if(thresholds.every(t=>side(Number(s),t)===side(value,t)))return s;}
 return refuse('cannot preserve numeric decision');
}
export function formatP(value:number,alpha:number):string{
 requireThat(finite(value)&&value>=0&&value<=1&&finite(alpha)&&alpha>0&&alpha<1,'invalid p or alpha');
 // A bound is used only when it preserves the actual decision against alpha.
 if(value<0.001&&alpha>=0.001)return 'p < 0.001';
 return `p = ${formatNumber(value,'p',[alpha])}`;
}
export interface BundleNumbers {
 measure:string;estimate:number;ci:readonly [number,number];ciLevel:number;n:number;adjustment:string;
 nullValue:number;mei:number|null;p:number|null;effectiveAlpha:number;familySize:number;looks:number;
 oneSided:boolean;twoSidedCI?:readonly [number,number];oneSidedJustification?:string;
}
export function formatBundle(b:BundleNumbers):string{
 requireThat(b.measure.trim()&&b.adjustment.trim()&&b.ci.every(finite)&&b.ci[0]<=b.ci[1]&&b.ciLevel>0&&b.ciLevel<1,'incomplete result bundle');
 validateBundleBounds(b);
 const thresholds=[b.nullValue,...b.mei===null?[]:[b.nullValue-b.mei,b.nullValue+b.mei]];
 const values=[b.estimate,...b.ci];let digits=3;
 while(digits<17&&!values.every(v=>thresholds.every(t=>side(Number(significant(v,digits)),t)===side(v,t))))digits++;
 const display=(v:number)=>significant(v,digits);
 let text=`${b.measure} was ${display(b.estimate)} (${formatNumber(b.ciLevel*100,'percent')} CI ${display(b.ci[0])}–${display(b.ci[1])}; ${b.adjustment}; n = ${formatNumber(b.n,'count')}`;
 if(b.p!==null)text+=`; ${formatP(b.p,b.effectiveAlpha)}${b.familySize>1?`, adjusted for ${formatNumber(b.familySize,'count')} tests`:''}${b.familySize>1||b.looks>1?`; effective alpha = ${formatNumber(b.effectiveAlpha,'parameter')}`:''}`;
 if(b.oneSided){validateOneSidedBundle(b);text+=`; two-sided interval ${formatNumber(b.twoSidedCI[0],'ci',thresholds)} to ${formatNumber(b.twoSidedCI[1],'ci',thresholds)}; one-sided alpha = ${b.effectiveAlpha}: ${b.oneSidedJustification}`;}
 return text+')';
}

/** Separate validation boundaries permit isolated partial-deletion probes. */
export function validateBundleBounds(b:BundleNumbers):void{
 requireThat(finite(b.estimate)&&finite(b.nullValue),'non-finite estimate or null');
 requireThat(Number.isSafeInteger(b.familySize)&&b.familySize>=1&&Number.isSafeInteger(b.looks)&&b.looks>=1,'invalid family or looks');
 requireThat(b.mei===null||finite(b.mei)&&b.mei>0,'invalid MEI');
}
export function validateOneSidedBundle(b:BundleNumbers):asserts b is BundleNumbers&{twoSidedCI:readonly [number,number];oneSidedJustification:string}{
 requireThat(b.twoSidedCI&&b.twoSidedCI.every(finite)&&b.twoSidedCI[0]<=b.twoSidedCI[1]&&b.oneSidedJustification?.trim(),'one-sided result needs a two-sided interval and plan justification');requireThat(b.effectiveAlpha<=0.025,'one-sided alpha exceeds policy');
}

/** Column alignment, not a claim about measurement precision. Never rounds a stored value.
 * Prefer at least two decimal places; widen the whole column until every value round-trips.
 * Extreme magnitudes use a shared exact scientific-notation precision instead. */
export function formatExactColumn(values:readonly number[]):string[]{
 requireThat(values.every(finite),'non-finite table number');
 const same=(text:string,value:number)=>Number(text)===value;
 for(let places=2;places<=8;places++){
  const rendered=values.map(v=>v.toFixed(places));
  if(values.every((v,i)=>Math.abs(v)<1e21&&same(rendered[i]!,v)))return rendered;
 }
 for(let places=1;places<=16;places++){
  const rendered=values.map(v=>v.toExponential(places));
  if(values.every((v,i)=>same(rendered[i]!,v)))return rendered;
 }
 return refuse('table display cannot round-trip to certified values');
}
