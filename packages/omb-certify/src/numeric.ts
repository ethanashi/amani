/** Canonical Neumaier summation. Center/scale before calling for statistics. */
export function stableSum(values:readonly number[]):number {
  const ordered=[...values].sort((a,b)=>Math.abs(a)-Math.abs(b)||a-b);let sum=0,error=0;
  for(const v of ordered){const next=sum+v;error+=Math.abs(sum)>=Math.abs(v)?(sum-next)+v:(v-next)+sum;sum=next;}return sum+error;
}
export function centered(values:readonly number[]):number[] {
  const origin=values[0]??0,d=values.map(v=>v-origin),mean=stableSum(d)/d.length;return d.map(v=>v-mean);
}
export function studentized(values:readonly number[]):number {
  const scale=Math.max(...values.map(Math.abs));if(scale===0)return 0;
  let sum=0,correction=0,squares=0;
  for(const value of values){const v=value/scale,next=sum+v;correction+=Math.abs(sum)>=Math.abs(v)?(sum-next)+v:(v-next)+sum;sum=next;squares+=v*v;}
  sum+=correction;
  if(Math.abs(sum)<=32*Number.EPSILON*Math.sqrt(squares*values.length))sum=0;
  const mean=sum/values.length,variance=Math.max(0,squares-sum*mean)/(values.length-1)/values.length;
  return variance===0?(mean===0?0:Math.sign(mean)*1e100):mean/Math.sqrt(variance);
}
export function welchStatistic(x:readonly number[],y:readonly number[]):number {
  const a=y.filter((_,i)=>x[i]===0),b=y.filter((_,i)=>x[i]===1);if(a.length<2||b.length<2)throw new Error('studentization needs two observations per condition');
  const am=stableSum(a)/a.length,bm=stableSum(b)/b.length;
  const variance=stableSum(a.map(v=>(v-am)**2))/(a.length-1)/a.length+stableSum(b.map(v=>(v-bm)**2))/(b.length-1)/b.length;
  return variance===0?(bm===am?0:Math.sign(bm-am)*1e100):(bm-am)/Math.sqrt(variance);
}
/** No absolute scale floor. JSON numbers lose trailing zeroes, so fewer than three
 * printed digits use a minimum three-digit rounding grid; exact values remain acceptable. */
export function numericAgreement(reported:number,trusted:number):boolean {
  if(!Number.isFinite(reported)||!Number.isFinite(trusted))return false;
  if(reported===trusted)return true;
  if(Math.abs(reported-trusted)<=1e-8*Math.max(Math.abs(reported),Math.abs(trusted)))return true;
  const digits=reported.toExponential().split('e')[0]!.replace(/[^0-9]/g,'').length;
  return Number(trusted.toPrecision(Math.max(3,digits)))===reported;
}
