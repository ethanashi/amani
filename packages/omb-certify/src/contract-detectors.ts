import { createHash } from 'node:crypto';
import { canonicalJson } from '../../bio-core/src/index.ts';
import { decimalParts, isStrictDecimal } from '../../omb-contract/src/index.ts';
import { detectNearDuplicates } from '../../bio-checks/src/validity/duplicates.ts';
import type { VerifiedContract } from './contract-verifier.ts';

export interface ContradictionFinding {
  code:'contract-contradicted'; detector:string; units:string[]; tables:string[];
  admission:'advisory'; score:number|null; detail:string;
}
export interface DetectorReport {findings:ContradictionFinding[];limitations:string[];admission:'advisory';}
export const DETECTOR_LIMITATION='Identity contradiction detectors are advisory: a ≤1% false-block rate on the required real negatives has not been demonstrated. Copies with several fields jittered together are outside the duplicate threat model.';
const canonicalValue=(s:string)=>{if(!isStrictDecimal(s))return s;const p=decimalParts(s);return `${p.coefficient}e${p.exponent}`;};
/** No plan/model/ignore-role argument is accepted: every linked table contributes. Scores
 * are evidence for review, not calibrated probabilities and never alter units or gates. */
export function detectContractContradictions(v:VerifiedContract):DetectorReport{
  const findings:ContradictionFinding[]=[],limitations=[DETECTOR_LIMITATION];
  const profiles=new Map<string,Map<string,string[]>>(),sources=new Map<string,Set<string>>();
  const add=(unit:string,field:string,value:string,table:string)=>{
    const profile=profiles.get(unit)??new Map<string,string[]>(),values=profile.get(field)??[];values.push(canonicalValue(value));profile.set(field,values);profiles.set(unit,profile);
    const tables=sources.get(unit)??new Set<string>();tables.add(table);sources.set(unit,tables);
  };
  const finding=(detector:string,units:string[],tables:string[],detail:string,score:number|null=null)=>findings.push({code:'contract-contradicted',detector,units:[...new Set(units)].sort(),tables:[...new Set(tables)].sort(),admission:'advisory',score,detail});
  for(const t of v.tables.values()){
    const table=t.definition.id;
    if(t.definition.orientation.unit_axis==='rows'){
      // Rank-compatible location/scale normalization detects per-column unit conversion and
      // date offsets across tables; original values also remain in the full linked profile.
      t.definition.columns.forEach((col,j)=>{if(['identifier','unit'].includes(col.structural_kind))return;
        const values=t.rows.map(r=>isStrictDecimal(r[j]!)?Number(r[j]):/^\d{4}-\d{2}-\d{2}$/.test(r[j]!)?Date.parse(r[j]!):NaN);
        if(values.some(n=>!Number.isFinite(n))||new Set(values).size<3)return;const sorted=[...values].sort((a,b)=>a-b),center=sorted[Math.floor(sorted.length/2)]!,scale=sorted[Math.floor(sorted.length*.75)]!-sorted[Math.floor(sorted.length*.25)]!;if(!(scale>0))return;
        values.forEach((value,i)=>add(t.units[i]!,'affine:'+col.name,String(Math.round((value-center)/scale*1e6)/1e6),table));
      });
      t.rows.forEach((row,i)=>t.definition.columns.forEach((col,j)=>{
        if(!['identifier','unit'].includes(col.structural_kind)&&!col.missingness_codes.includes(row[j]!))add(t.units[i]!,col.name,row[j]!,table);
      }));
      // Prefix and low-dimensional groupings are deliberately advisory, including site/sex ties.
      for(const col of t.definition.columns){
        const idx=t.header.indexOf(col.name),groups=new Map<string,Set<string>>();
        t.rows.forEach((r,i)=>{const token=t.definition.row_key.includes(col.name)?r[idx]!.replace(/[-_.:/|\s][^-_.:/|\s]+$/,''):r[idx]!;
          if(!token||col.missingness_codes.includes(token))return;const units=groups.get(token)??new Set<string>();units.add(t.units[i]!);groups.set(token,units);});
        if(groups.size>1&&groups.size<t.rows.length)for(const units of groups.values())if(units.size>1)finding(t.definition.row_key.includes(col.name)?'row-key-prefix':'undeclared-grouping',[...units],[table],'Repeated grouping across resolved units; biological dependence is unestablished.');
      }
    }else{
      // Keep every feature in the fingerprint without one Map/array per matrix cell.
      t.entityHeaders.forEach((h,i)=>{const digest=createHash('sha256'),col=t.header.indexOf(h);for(const [r,row] of t.rows.entries()){digest.update(canonicalJson(canonicalValue(row[col]!))+'\n');const marker=t.keys[r]!.find(k=>/^rs[0-9]+$/i.test(k));if(marker)add(t.units[i]!,marker,row[col]!,table);}add(t.units[i]!,`${table}:complete-profile`,digest.digest('hex'),table);});
      if(t.rows.length>=32){
        const rows=t.entityHeaders.map((h,i)=>({id:String(i),vector:Float64Array.from(t.rows,row=>Number(row[t.header.indexOf(h)]))}));
        const report=detectNearDuplicates({rows,idField:'id',vectorOf:'vector',threshold:.999,maxCandidatePairs:50_000});
        if(report.status==='near-duplicates-found'||report.status==='no-near-duplicates'){
          for(const group of report.identicalGroups){const units=group.map(id=>t.units[Number(id)]!);if(new Set(units).size>1)finding('high-dimensional-profile',units,[table],'Identical high-dimensional profiles across declared units.');}
          for(const pair of report.pairs){const units=pair.ids.map(id=>t.units[Number(id)]!);if(new Set(units).size>1)finding('high-dimensional-correlation',units,[table],'Near-identical high-dimensional profiles across declared units.');}
        }else limitations.push('High-dimensional correlation detector unavailable for a table; this is not a negative finding.');
      }
    }
  }
  const units=[...profiles.keys()].sort(),frequency=new Map<string,Map<string,number>>();
  for(const profile of profiles.values())for(const [field,values] of profile){values.sort();const counts=frequency.get(field)??new Map<string,number>(),token=canonicalJson(values);counts.set(token,(counts.get(token)??0)+1);frequency.set(field,counts);}
  let pairs=0;
  outer:for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++){
    if(++pairs>50_000){limitations.push('Record-linkage pair budget exhausted; unexamined pairs are not verified negatives.');break outer;}
    const a=profiles.get(units[i]!)!,b=profiles.get(units[j]!)!,shared=[...a.keys()].filter(k=>b.has(k));
    let equal=0,round=0,score=0;const ratios:number[]=[],offsets:number[]=[];
    for(const field of shared){const x=a.get(field)!,y=b.get(field)!,same=canonicalJson(x)===canonicalJson(y);
      if(same){equal++;const freq=frequency.get(field)!.get(canonicalJson(x))!;score-=Math.log2(Math.max(1, freq-1)/Math.max(1,units.length-1));}
      const value=(s:string)=>{const m=/^(-?\d+)e(-?\d+)$/.exec(s);return m?Number(m[1])*10**Number(m[2]):NaN;};
      if(x.length===1&&y.length===1){const nx=value(x[0]!),ny=value(y[0]!);if(Number.isFinite(nx)&&Number.isFinite(ny)){
        if(Math.round(nx*100)===Math.round(ny*100))round++;offsets.push(ny-nx);if(nx!==0)ratios.push(ny/nx);
      }}
    }
    const sameScale=ratios.length>=3&&ratios.every(r=>Math.abs(r-ratios[0]!)<=1e-8*Math.max(1,Math.abs(r)));
    const sameShift=offsets.length>=3&&offsets.every(r=>Math.abs(r-offsets[0]!)<=1e-8*Math.max(1,Math.abs(r)));
    const affine=shared.filter(k=>k.startsWith('affine:'));const affineMatch=affine.length>=3&&affine.every(k=>canonicalJson(a.get(k))===canonicalJson(b.get(k)));
    const markers=shared.filter(k=>/(?:^|[:_])rs[0-9]+(?:$|[:_])/i.test(k)&&!k.startsWith('affine:'));
    if(markers.length>=8&&markers.filter(k=>canonicalJson(a.get(k))===canonicalJson(b.get(k))).length/markers.length>=.98)finding('rs-probe-SNP-concordance',[units[i]!,units[j]!],[...sources.get(units[i]!)!,...sources.get(units[j]!)!],'High rs-probe / SNP concordance warrants assay-specific identity review.');
    if(shared.length>=3&&(equal>=shared.length-1||round===shared.length||sameScale||sameShift||affineMatch))finding('full-linked-profile',[units[i]!,units[j]!],[...sources.get(units[i]!)!,...sources.get(units[j]!)!],
      affineMatch?'Per-column location/scale invariant linked profile match.':equal===shared.length?'Canonical exact linked profile match.':equal===shared.length-1?'All but one informative field agrees.':sameScale?'Constant-ratio linked numeric profile.':sameShift?'Constant-offset linked numeric profile.':'Display-rounded linked profile match.',score);
  }
  // Sex fingerprints join through resolver identities across all tables, never row positions.
  const sex=new Map<string,string>(),xist=new Map<string,number>(),yGene=new Map<string,number>();
  for(const t of v.tables.values())if(t.definition.orientation.unit_axis==='rows'){
    const idx=t.header.findIndex(h=>/^(sex|gender)$/i.test(h));if(idx>=0)t.rows.forEach((r,i)=>sex.set(t.units[i]!,r[idx]!.toLowerCase()));
    for(const [name,out] of [['XIST',xist],['RPS4Y1',yGene]] as const){const col=t.header.findIndex(h=>h.toUpperCase()===name);if(col>=0)t.rows.forEach((r,i)=>out.set(t.units[i]!,Number(r[col])));}
  }else for(const [r,key] of t.keys.entries())for(const [name,out] of [['XIST',xist],['RPS4Y1',yGene]] as const)if(key.some(k=>k.toUpperCase()===name))t.entityHeaders.forEach((h,i)=>out.set(t.units[i]!,Number(t.rows[r]![t.header.indexOf(h)])));
  for(const [unit,value] of sex){const x=xist.get(unit),y=yGene.get(unit);if(x===undefined||y===undefined||!Number.isFinite(x)||!Number.isFinite(y))continue;
    if(['female','f'].includes(value)&&y>x||['male','m'].includes(value)&&x>y)finding('sex-expression-fingerprint',[unit],[...sources.get(unit)??[]],'Sex field and XIST/RPS4Y1 expression warrant review; expression is not proof of identity.');}
  if(!sex.size||!xist.size||!yGene.size)limitations.push('Sex-expression fingerprints unavailable where sex or XIST/RPS4Y1 measurements are missing.');
  limitations.push('rs-probe/SNP concordance is screened only where comparable markers are present. Kinship estimation requires reviewed genotype/ancestry metadata and remains unavailable; no negative finding is claimed.');
  return {findings,limitations,admission:'advisory'};
}

/** Propagate across companion tables and the claim's declared coarser inference level. */
export function contradictionsForUnits(v:VerifiedContract,report:DetectorReport,units:readonly string[],level:string):ContradictionFinding[]{
  const canonical=(u:string)=>v.resolver.atLevel(v.layer,u,level);
  try{const affected=new Set(units.map(canonical));return report.findings.filter(f=>f.units.some(u=>affected.has(canonical(u))));}
  catch{const affected=new Set(units);return report.findings.filter(f=>f.units.some(u=>affected.has(u)));}
}
