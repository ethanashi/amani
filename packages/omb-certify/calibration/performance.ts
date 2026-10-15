// Section A A12 probe designs, original independent RNG streams. No live workers.
import { performanceKernel,randomStream } from '../src/index.ts';
import { claimOf,wilson } from './common.ts';
const n=Number(process.argv[2]??2000);
for(const [metric,N,PI,U,threshold] of [['net-benefit',400,10/400,14,.001],['net-benefit',137,15/137,10,.01],['brier',800,.05,12,.5],['brier',400,.075,12,.5]] as const){
 let passed=0,rejected=0,errors=0;const start=performance.now();
 for(let r=0;r<n;r++){
  const ry=randomStream('y:'+r),rp=randomStream(metric==='brier'?'p:'+r:'noskill:'+r),y=Array.from({length:N},(_,i)=>metric==='brier'?Number(ry.uniform()<PI):Number(i<Math.round(N*PI))),mean=y.reduce((s,v)=>s+v,0)/N;
  const idx=Array.from({length:N},(_,i)=>i);for(let i=N-1;i>0;i--){const j=rp.integer(i+1);[idx[i],idx[j]]=[idx[j]!,idx[i]!];}const low=new Set(idx.slice(0,U));
  const p=y.map((_,i)=>metric==='brier'?(low.has(i)?mean/2:Math.min(.99,Math.max(.001,mean+.0005*(rp.uniform()-.5)))):low.has(i)?threshold/2:.5+.001*rp.uniform());
  try{const k=performanceKernel(claimOf({kind:'out-of-sample'}),{units:y.map((_,i)=>'u'+i),outcome:y,probability:p,simpleRule:y.map(()=>.5),trainingUnits:['train1','train2'],trainingPrevalence:.5},{metric,thresholds:[threshold],threshold,bins:10,bootstrapDraws:999,monteCarlo:{draws:999,maxDraws:3996}},(metric==='brier'?'s:':'seed:')+r);if(k.gate.outcome==='passed')passed++;if(k.entry.p!<=.05&&k.entry.estimate!>0)rejected++;}catch{errors++;}
 }
 console.log(JSON.stringify({experiment:`A12 ${metric} N=${N} PI=${PI}`,nulls:n,passed,rejected,rate:passed/n,wilson95:wilson(passed,n),errors,seconds:(performance.now()-start)/1000}));
}
