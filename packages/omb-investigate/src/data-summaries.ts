import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { twoSidedP } from '../../omb-procedures/src/coloc-ld.ts';
import type { Json } from './types.ts';
/** Host computation over staged input, never worker diagnostics or output estimates.
 * Marginal counts explicitly do not claim to count independent LD signals. */
export function trustedDataSummaries(root:string):Record<string,Json> {
 const result:Record<string,Json>={};
 const visit=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name),name=path.relative(root,file),st=lstatSync(file);
  if(st.isSymbolicLink())continue;if(st.isDirectory()){visit(file);continue;}
  if(!/\.(tsv|csv)$/i.test(name))continue;
  if(st.size>50_000_000){result[name]={status:'not-evaluable',reason:'summary input exceeds 50 MB'};continue;}
  const lines=readFileSync(file,'utf8').trimEnd().split(/\r?\n/),sep=name.endsWith('.tsv')?'\t':',',header=lines.shift()!.split(sep),rows=lines.map(l=>l.split(sep));
  const beta=header.indexOf('beta'),se=header.indexOf('standard_error');
  let valid=0,signals=0;const information:number[]=[];
  if(beta>=0&&se>=0)for(const row of rows){const b=Number(row[beta]),s=Number(row[se]);if(!row[beta]||!row[se]||!Number.isFinite(b)||!Number.isFinite(s)||s<=0)continue;valid++;if(twoSidedP(b/s)<=5e-8)signals++;const f=Number(row[header.indexOf('effect_allele_frequency')]);if(f>0&&f<1)information.push(1/(s*s*2*f*(1-f)));}
  information.sort((a,b)=>a-b);
  const cols=header.flatMap((v,i)=>/^ind\d+$/.test(v)?[i]:[]);
  let ld:Json=null;
  if(cols.length>=3){
    const selected=rows.slice(0,256).map(row=>cols.map(i=>Number(row[i]))).filter(row=>row.every(v=>Number.isFinite(v)&&v>=0&&v<=2));
    const centered=selected.map(row=>{const mean=row.reduce((a,b)=>a+b,0)/row.length;const x=row.map(v=>v-mean),norm=Math.sqrt(x.reduce((a,b)=>a+b*b,0));return norm?x.map(v=>v/norm):null;}).filter((v):v is number[]=>v!==null);
    let pairs=0,high=0,max=0;for(let i=0;i<centered.length;i++)for(let j=0;j<i;j++){const r=centered[i]!.reduce((s,v,k)=>s+v*centered[j]![k]!,0);pairs++;high+=Number(r*r>=.8);max=Math.max(max,r*r);}
    ld={reference_samples:cols.length,variants_summarized:centered.length,pairs,high_ld_pairs:high,max_r2:max,truncated:rows.length>256};
  }
  result[name]={rows:rows.length,columns:header,valid_summary_rows:valid,marginal_significant_variants:signals,signal_threshold:5e-8,independent_signal_count:null,
   information_ratio_95_to_5:information.length?information[Math.floor(.95*(information.length-1))]!/information[Math.floor(.05*(information.length-1))]!:null,ld};
 }};visit(root);return result;
}
