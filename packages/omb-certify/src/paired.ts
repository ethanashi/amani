import { centered, stableSum, studentized } from './numeric.ts';
import { monteCarlo, randomStream, type MonteCarloSettings } from './monte-carlo.ts';
import type { Direction, PermutationResult } from './permutation.ts';
/** Equal-weight mean of independent cluster contrasts. All rows in a cluster flip together. */
export function signFlipTest(differences:readonly number[], units:readonly string[], direction:Direction, alpha:number, seed:string, settings?:MonteCarloSettings):PermutationResult {
  if(differences.length<3||units.length!==differences.length||new Set(units).size!==units.length||differences.some(v=>!Number.isFinite(v))||units.some(u=>!u.trim())||!(alpha>0&&alpha<=.05))throw new Error('invalid independent cluster contrasts');
  const n=differences.length,mean=stableSum(differences)/n;
  const score=(v:number)=>direction==='greater'?v:direction==='less'?-v:Math.abs(v),observed=score(studentized(differences)),total=2n**BigInt(n);
  if(total<=1024n){let extreme=0;for(let mask=0;mask<Number(total);mask++){const stat=studentized(differences.map((d,i)=>((mask>>i)&1?d:-d)));if(score(stat)>=observed-1e-12*Math.abs(observed))extreme++;}const p=extreme/Number(total);return {status:p<=alpha?'reject':'retain',p,pLower:p,pUpper:p,evaluated:Number(total),total:String(total),extreme,estimate:mean,statistic:studentized(differences),scheme:'sign-flip',alpha,guarantee:'exact under exchangeability',stopping:'exhaustive'};}
  const rng=randomStream(seed),mc=monteCarlo(observed,()=>score(studentized(differences.map(d=>rng.integer(2)?d:-d))),alpha,settings);
  return {status:mc.decisionP<=alpha?'reject':'retain',p:mc.p,decisionP:mc.decisionP,pLower:Math.max(0,mc.p-3*mc.mcSE),pUpper:Math.min(1,mc.p+3*mc.mcSE),evaluated:mc.evaluated,total:String(total),extreme:mc.extreme,estimate:mean,statistic:studentized(differences),scheme:'sign-flip',alpha,guarantee:'exact under exchangeability',stopping:mc.stopping,monteCarlo:mc};
}

/** Actual within-unit relabeling group, preserving each unit's condition counts. */
export function withinUnitTest(x:readonly number[], y:readonly number[], units:readonly string[], direction:Direction, alpha:number, seed:string, settings?:MonteCarloSettings):PermutationResult {
  const groups=new Map<string,number[]>();units.forEach((u,i)=>{const g=groups.get(u)??[];g.push(i);groups.set(u,g);});
  const clusters=[...groups.values()], counts=clusters.map(g=>g.filter(i=>x[i]===1).length);
  if(clusters.length<3||x.length!==y.length||units.length!==x.length||x.some(v=>v!==0&&v!==1)||y.some(v=>!Number.isFinite(v))||counts.some((k,i)=>k===0||k===clusters[i]!.length))throw new Error('invalid within-unit randomization');
  const values=new Map<number,number>();for(const g of clusters){const c=centered(g.map(i=>y[i]!));g.forEach((i,j)=>values.set(i,c[j]!));}
  const contrast=(g:number[],selected:readonly number[])=>{
    const one=new Set(selected);return stableSum(selected.map(i=>values.get(i)!))/selected.length-stableSum(g.filter(i=>!one.has(i)).map(i=>values.get(i)!))/(g.length-selected.length);
  };
  const observedContrasts=clusters.map(g=>contrast(g,g.filter(i=>x[i]===1))),mean=stableSum(observedContrasts)/clusters.length;
  const score=(v:number)=>direction==='greater'?v:direction==='less'?-v:Math.abs(v),observed=score(studentized(observedContrasts));
  const choose=(n:number,k:number)=>{let v=1n;for(let i=1;i<=k;i++)v=v*BigInt(n-i+1)/BigInt(i);return v;};
  const total=clusters.reduce((s,g,i)=>s*choose(g.length,counts[i]!),1n);
  const choices=clusters.map((g,j)=>{if(choose(g.length,counts[j]!)>4096n)return null;const out:number[]=[];const visit=(start:number,a:number[])=>{if(a.length===counts[j]){out.push(contrast(g,a));return;}for(let i=start;i<g.length;i++)visit(i+1,[...a,g[i]!]);};visit(0,[]);return out;});
  if(total<=1024n){
    let extreme=0;const visit=(j:number,values:number[])=>{if(j===choices.length){if(score(studentized(values))>=observed-1e-12*Math.abs(observed))extreme++;return;}for(const v of choices[j]!)visit(j+1,[...values,v]);};visit(0,[]);
    const p=extreme/Number(total);return {status:p<=alpha?'reject':'retain',p,pLower:p,pUpper:p,evaluated:Number(total),total:String(total),extreme,estimate:mean,statistic:studentized(observedContrasts),scheme:'labels',alpha,guarantee:'exact under exchangeability',stopping:'exhaustive'};
  }
  const rng=randomStream(seed),mc=monteCarlo(observed,()=>score(studentized(clusters.map((g,j)=>{if(choices[j])return choices[j]![rng.integer(choices[j]!.length)]!;const order=[...g];for(let k=order.length-1;k>0;k--){const l=rng.integer(k+1);[order[k],order[l]]=[order[l]!,order[k]!];}return contrast(g,order.slice(0,counts[j]));}))),alpha,settings);
  return {status:mc.decisionP<=alpha?'reject':'retain',p:mc.p,decisionP:mc.decisionP,pLower:Math.max(0,mc.p-3*mc.mcSE),pUpper:Math.min(1,mc.p+3*mc.mcSE),evaluated:mc.evaluated,total:String(total),extreme:mc.extreme,estimate:mean,statistic:studentized(observedContrasts),scheme:'labels',alpha,guarantee:'exact under exchangeability',stopping:mc.stopping,monteCarlo:mc};
}
