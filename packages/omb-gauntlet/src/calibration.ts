/** Alpha-aware form of the 200/600 diagnostic. Keep the original tail probabilities
 * (and exactly its .05 integer boundaries); never calibrate a .01 claim at .05. */
export function binomialCDF(k:number,n:number,p:number):number {
  if(k<0)return 0;if(k>=n)return 1;
  let term=Math.pow(1-p,n),sum=term;
  for(let i=1;i<=k;i++){term*=((n-i+1)/i)*(p/(1-p));sum+=term;}return Math.min(1,sum);
}
function quantile(q:number,n:number,p:number):number{for(let k=0;k<=n;k++)if(binomialCDF(k,n,p)>=q)return k;return n;}
export function calibrationBounds(alpha:number):{passMax:number;failMin:number;failMinTotal:number}{
  if(!(alpha>0&&alpha<=.05))throw new Error('invalid calibration alpha');
  if(alpha===.05)return {passMax:14,failMin:20,failMinTotal:42};
  return {passMax:quantile(binomialCDF(14,200,.05),200,alpha),failMin:quantile(binomialCDF(19,200,.05),200,alpha)+1,
    failMinTotal:quantile(binomialCDF(41,600,.05),600,alpha)+1};
}
export function decideCalibration(alpha:number,first:number,extension?:number):'pass'|'fail'|'extend'|'invalid'{
  if(!Number.isInteger(first)||first<0||first>200||!(alpha>0&&alpha<=.05)||extension!==undefined&&(!Number.isInteger(extension)||extension<0||extension>400))return 'invalid';
  const b=calibrationBounds(alpha);
  if(first<=b.passMax)return 'pass';if(first>=b.failMin)return 'fail';
  return extension===undefined?'extend':first+extension>=b.failMinTotal?'fail':'pass';
}
/** G5b-recovery (amendment 4: coverage >= 1 - alpha - tolerance). Judged on the observed coverage of
 * the planted draws; a Wilson lower bound above nominal - tolerance would fail exactly calibrated
 * intervals about half the time (an exact 95% interval needs 96/100 covered). */
export const G5B_COVERAGE_METHOD = "design-matched coverage point estimate";
export function coverageMeetsNominal(coverage:number,nominal:number,tolerance=0.05):boolean {
  return Number.isFinite(coverage)&&Number.isFinite(nominal)&&coverage>=nominal-tolerance-1e-12;
}
