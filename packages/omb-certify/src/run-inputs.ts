import { declaredTable, type StageDeclarations } from './declared-stage.ts';
import { chmodSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { ClaimData } from './producers.ts';
import type { PlanClaim } from '../../omb-gauntlet/src/index.ts';
import { parseStageTable } from './stage-parser.ts';

/** Same serializer, mode, file write order and numeric precision for the look and every twin.
 * Staging retains original tokens as evidence; execution uses a canonical copy in every role. */
export function normalizeRunInputs(raw:string,declarations?:StageDeclarations):void {
  for(const name of readdirSync(raw).sort()){
    if(name==='units.tsv'||! /\.(csv|tsv|json)$/i.test(name))continue;
    const file=path.join(raw,name),table=declarations?.[name]?declaredTable(name,readFileSync(file),{...declarations[name]!,acknowledgeContentDuplicates:true}):parseStageTable(name,readFileSync(file));
    const rows=table.rows;
    const sep=name.endsWith('.csv')?',':'\t',escape=(s:string)=>s.includes(sep)||/["\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;
    const bytes=name.endsWith('.json')?JSON.stringify(rows.map(r=>Object.fromEntries(table.header.map((h,i)=>[h,r[i]]))))+'\n':[table.header,...rows].map(r=>r.map(escape).join(sep)).join('\n')+'\n';
    chmodSync(file,0o600);writeFileSync(file,bytes);chmodSync(file,0o400);
  }
}

/** Match column precision, including scientific notation. Mixed fixed decimal columns use
 * their finest observed decimal place; source tokens are retained for unchanged values. */
export function columnFormatter(tokens:readonly string[]):(value:number)=>string {
  if(!tokens.length)return String; // host-only numeric fixtures have no serialized table
  const originals=new Map(tokens.map(t=>[Number(t),t]));
  const scientific=tokens.some(t=>/[eE]/.test(t));
  const decimals=Math.max(...tokens.map(t=>(t.split(/[eE]/)[0]!.split('.')[1]??'').length));
  const exponentTokens=tokens.filter(t=>/[eE]/.test(t)).map(t=>t.split(/[eE]/)[1]!);
  const exponentWidth=Math.max(1,...exponentTokens.map(t=>t.replace(/^[+-]/,'').length));
  const exponentSign=exponentTokens.some(t=>t.startsWith('+')),exponentCase=tokens.some(t=>t.includes('E'))?'E':'e';
  const digits=Math.max(...tokens.map(t=>t.split(/[eE]/)[0]!.replace(/^[+-]?0*\.?0*/, '').replace('.','').length),1);
  if(decimals>100||digits>100)throw new Error('unsupported numeric token precision');
  return input=>{
    if(!Number.isFinite(input))throw new Error('nonfinite simulation');
    const value=input===0?0:input; // never a negative zero token
    const original=originals.get(value);if(original!==undefined)return original;
    if(!scientific){if(Math.abs(value)>=1e21)throw new Error('simulation exceeds fixed decimal grammar');const fixed=value.toFixed(decimals);return /^-0(?:\.0*)?$/.test(fixed)?fixed.slice(1):fixed;}
    const [mantissa,exponent]=value.toExponential(digits-1).split('e'),power=Number(exponent);
    return mantissa!+exponentCase+(power<0?'-':exponentSign?'+':'')+String(Math.abs(power)).padStart(exponentWidth,'0');
  };
}
export function roundedSample(data:ClaimData,claim:PlanClaim,sample:{x:readonly number[];y:readonly number[]}):{x:number[];y:number[]} {
  const round=(name:string|null,values:readonly number[])=>{
    const col=data.header.indexOf(name??''),format=columnFormatter(col<0?[]:data.rows.map(r=>r[col]!));
    return values.map(v=>Number(format(v)));
  };
  return {x:round(claim.exposure,sample.x),y:round(claim.outcome,sample.y)};
}
