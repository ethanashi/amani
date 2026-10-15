// Lanczos log-gamma and continued-fraction regularized beta, including fractional
// Welch-Satterthwaite degrees of freedom. Fixed work bounds, no dependency on clocks.
function logGamma(z:number):number {
 const c=[676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-.13857109526572012,9.984369578019572e-6,1.5056327351493116e-7];
 if(z<.5)return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*z))-logGamma(1-z);
 z--;let x=.99999999999980993;for(let i=0;i<c.length;i++)x+=c[i]!/(z+i+1);const t=z+7.5;return .5*Math.log(2*Math.PI)+(z+.5)*Math.log(t)-t+Math.log(x);
}
function betaFraction(a:number,b:number,x:number):number {
 const tiny=1e-300;let c=1,d=1-(a+b)*x/(a+1);if(Math.abs(d)<tiny)d=tiny;d=1/d;let h=d;
 for(let m=1;m<=200;m++){for(const aa of [m*(b-m)*x/((a+2*m-1)*(a+2*m)),-(a+m)*(a+b+m)*x/((a+2*m)*(a+2*m+1))]){d=1+aa*d;if(Math.abs(d)<tiny)d=tiny;c=1+aa/c;if(Math.abs(c)<tiny)c=tiny;d=1/d;const change=d*c;h*=change;if(aa<0&&Math.abs(change-1)<3e-14)return h;}}throw new Error('beta convergence unavailable');
}
export function fractionalStudentCDF(t:number,df:number):number {
 if(!Number.isFinite(t)||!Number.isFinite(df)||!(df>0))throw new Error('invalid Welch statistic');if(t===0)return .5;
 const x=df/(df+t*t),a=df/2,b=.5,bt=x===0||x===1?0:Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log1p(-x));
 const ib=x===1?1:x===0?0:x<(a+1)/(a+b+2)?bt*betaFraction(a,b,x)/a:1-bt*betaFraction(b,a,1-x)/b;
 return t>0?1-ib/2:ib/2;
}
/** Evaluate the small tail directly. Never recover it as 1 - a rounded CDF. */
export function studentP(t:number,df:number,direction:'two-sided'|'less'|'greater'):number {
 const tail=fractionalStudentCDF(-Math.abs(t),df);
 return direction==='two-sided'?2*tail:direction==='less'?(t<=0?tail:1-tail):(t>=0?tail:1-tail);
}
