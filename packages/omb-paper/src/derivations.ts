import { canonicalJson, canonicalSha256 } from '../../bio-core/src/index.ts';
import type { GradedFact, JsonObject } from './index.ts';

export type FactValue = number | string | boolean | null;
export interface Derivation { formula: string; inputs: string[]; value: FactValue }
export interface SourceFact { id: string; path: string; value: FactValue }
export interface DataSlot {
  key: string; classification: 'input' | 'derived'; value: FactValue; sourceId: string;
  derivation: Derivation | null;
}
export interface DerivedSlot { key: string; claimId: string; derivation: Derivation; grade: GradedFact['grade']; producerGate: string | null; certHash: string }
export interface FactExtensions { sources: SourceFact[]; dataSlots: DataSlot[]; derivedSlots: DerivedSlot[] }

/** Closed formula language. No eval, inferred statistical procedure, or AI calculation. */
export function derive(formula: string, inputs: readonly SourceFact[]): Derivation {
  if (!inputs.length || new Set(inputs.map(x=>x.id)).size !== inputs.length) throw new Error('derivation requires unique source facts');
  const values = inputs.map(x=>x.value);
  const nums = () => { if (!values.every(v=>typeof v==='number' && Number.isFinite(v))) throw new Error('non-numeric derivation input'); return values as number[]; };
  let value: FactValue;
  if (formula==='identity' && values.length===1) value=values[0]!;
  else if (formula==='upper - lower' && values.length===2) { const [lo,hi]=nums(); if(hi!<lo!)throw new Error('reversed interval'); value=hi!-lo!; }
  else if (formula==='family_size * alpha' && values.length===2) { const [n,a]=nums(); if(!Number.isSafeInteger(n)||n!<1||a!<=0||a!>=1)throw new Error('invalid family'); value=n!*a!; }
  else if (formula==='direction(lower, upper, null)' && values.length===3) { const [lo,hi,n]=nums(); if(lo!>hi!)throw new Error('reversed interval'); value=lo!>n!?'higher':hi!<n!?'lower':'no clear difference'; }
  else if (formula==='magnitude(estimate, null, mei)' && values.length===3) {const [e,n,m]=nums();if(m!<=0)throw new Error('invalid MEI');value=Math.abs(e!-n!)>=m!?'at least the smallest effect of interest':'below the smallest effect of interest';}
  else throw new Error(`unsupported derivation formula: ${formula}`);
  if (typeof value==='number' && !Number.isFinite(value)) throw new Error('non-finite derivation');
  return { formula, inputs:inputs.map(x=>x.id), value };
}
export function verifyDerivation(record: Derivation, sources: readonly SourceFact[]): void {
  const inputs=record.inputs.map(id=>sources.find(x=>x.id===id)??(()=>{throw new Error('missing derivation input');})());
  if (canonicalJson(derive(record.formula,inputs))!==canonicalJson(record)) throw new Error('derivation value mismatch');
}
function leaves(value:unknown,path:string): SourceFact[] {
  if(value!==null && typeof value==='object') return Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).flatMap(([k,v])=>leaves(v,`${path}.${k}`));
  if(!['number','string','boolean'].includes(typeof value) && value!==null)throw new Error('invalid data slot');
  if(typeof value==='number'&&!Number.isFinite(value))throw new Error('non-finite data slot');
  return [{id:canonicalSha256([path,value]),path,value:value as FactValue}];
}
const INPUT_FIELDS=new Set(['accession','accessions','threshold','thresholds','alpha','mei','seed','seeds','date','dates','retrievedat','accrualstart','accrualend','startdate','enddate','cohort','cohortname','name','source','url','release','licence','license','sha256','inputmanifesthash','hash','units','unit','platform','genomebuild','clumpingr2','clumpingwindow']);
/** Explicit identifier/date formats are metadata; other strings carrying counts
 * remain derived even when a producer puts them under a metadata key. */
function inputString(value:string,field:string):boolean {
 const text=value.normalize('NFKC').trim();
 if(['date','dates','retrievedat','accrualstart','accrualend','startdate','enddate'].includes(field)&&/^\d{4}-\d{2}-\d{2}(?:T[0-9:.+-]+Z?)?$/u.test(text))return true;
 if(['accession','accessions'].includes(field)&&/^[A-Za-z]+[0-9]+$/u.test(text))return true;
 if(['sha256','inputmanifesthash','hash'].includes(field)&&/^[a-f0-9]{64}$/iu.test(text))return true;
 if(field==='url'&&/^https:\/\/[^\s]+$/u.test(text))return true;
 return !/\p{N}|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|dozen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|quadrillion|half|quarter|once|twice|double|triple)(?:s|fold|th|ths)?\b|^[IVXLCDM]+$/iu.test(text);
}
/** Unknown fields are derived. In particular n/events never enter a blind packet, even under a metadata object. */
export function buildFactExtensions(plan: JsonObject, manifests: readonly unknown[], facts: readonly GradedFact[]): FactExtensions {
  const sources=manifests.flatMap((m,i)=>leaves(m,`manifest.${i}`));
  // Only explicitly enumerated plan parameters enter the [d:] namespace.
  for(const key of ['alpha','mei','seed','threshold','thresholds','dates','accessions']) if(Object.hasOwn(plan,key))sources.push(...leaves(plan[key],`plan.${key}`));
  const dataSlots:DataSlot[]=sources.map(s=>{
    const parts=s.path.split('.').filter(p=>!/^\d+$/u.test(p));
    const field=parts.at(-1)!.toLowerCase().replace(/[_-]/gu,'');
    const input=INPUT_FIELDS.has(field) && (typeof s.value==='string'&&inputString(s.value,field)||typeof s.value==='boolean'||typeof s.value==='number'&&['alpha','mei','seed','seeds','threshold','thresholds'].includes(field)) && !parts.some(p=>/^(counts?|events?|n|n_units|flow|derived|results?|metrics)$/iu.test(p));
    return {key:s.path,classification:input?'input':'derived',value:s.value,sourceId:s.id,derivation:input?null:derive('identity',[s])};
  });
  const derivedSlots:DerivedSlot[]=[];
  for(const f of facts){
    if(f.value!==null && !['number','string','boolean'].includes(typeof f.value))continue;
    const source={id:f.id,path:f.key,value:f.value as FactValue};sources.push(source);
    if(f.claimId && /\.(ci_width|expected_false|power_n|magnitude|vs\.[^.]+)$/u.test(f.key))derivedSlots.push({key:f.key,claimId:f.claimId,derivation:derive('identity',[source]),grade:f.grade,producerGate:f.producerGate,certHash:f.certHash});
  }
  for(const f of facts.filter(f=>f.source==='kernel' && /\.ci\.0$/u.test(f.key) && f.claimId)){
    const hi=facts.find(h=>h.certificationId===f.certificationId && h.source==='kernel' && h.key===f.key.replace(/0$/u,'1'));
    if(!hi || typeof f.value!=='number'||typeof hi.value!=='number')continue;
    const key=f.key.replace(/ci\.0$/u,'ci_width');
    if(derivedSlots.some(d=>d.key===key&&d.certHash===f.certHash))continue;
    derivedSlots.push({key,claimId:f.claimId!,derivation:derive('upper - lower',[sources.find(s=>s.id===f.id)!,sources.find(s=>s.id===hi.id)!]),grade:f.grade,producerGate:f.producerGate,certHash:f.certHash});
  }
  // Store the display derivations in PW0 as well as their primitive kernel facts.
  // This appendix is hashed into PaperInput, including the locked threshold inputs.
  const claims=Array.isArray(plan.claims)?plan.claims.map(v=>v as JsonObject):[];
  const addSource=(path:string,value:FactValue):SourceFact=>{const source={id:canonicalSha256([path,value]),path,value};if(!sources.some(s=>s.id===source.id))sources.push(source);return source;};
  const append=(key:string,f:GradedFact,formula:string,inputs:SourceFact[])=>{
    if(derivedSlots.some(d=>d.key===key&&d.certHash===f.certHash&&d.grade===f.grade))return;
    derivedSlots.push({key,claimId:f.claimId!,derivation:derive(formula,inputs),grade:f.grade,producerGate:f.producerGate,certHash:f.certHash});
  };
  for(const f of facts.filter(f=>f.source==='kernel'&&f.claimId&&f.key===`${f.claimId}.estimate`&&typeof f.value==='number')){
    const claim=claims.find(c=>String(c.id).toLowerCase()===f.claimId);if(!claim)continue;
    const knobs=claim.knobs&&typeof claim.knobs==='object'?claim.knobs as JsonObject:{};
    const merged={...knobs,...claim};
    if(typeof merged.nullValue!=='number')continue; // Unknown null is not zero.
    const nullValue=merged.nullValue;
    const at=(suffix:string)=>facts.find(v=>v.source==='kernel'&&v.certificationId===f.certificationId&&v.key===`${f.claimId}.${suffix}`);
    const lo=at('ci.0'),hi=at('ci.1');const nullSource=addSource(`plan.claims.${f.claimId}.nullValue`,nullValue);
    if(lo&&hi&&typeof lo.value==='number'&&typeof hi.value==='number')append(`${f.claimId}.direction`,f,'direction(lower, upper, null)',[sources.find(s=>s.id===lo.id)!,sources.find(s=>s.id===hi.id)!,nullSource]);
    if(typeof merged.mei==='number')append(`${f.claimId}.magnitude`,f,'magnitude(estimate, null, mei)',[sources.find(s=>s.id===f.id)!,nullSource,addSource(`plan.claims.${f.claimId}.mei`,merged.mei)]);
    const alpha=at('alpha');if(alpha&&typeof alpha.value==='number'){
      const family=Array.isArray(plan.families)?plan.families.find(v=>(v as JsonObject).name===merged.family) as JsonObject|undefined:plan.families&&typeof plan.families==='object'?(plan.families as Record<string,JsonObject>)[String(merged.family)]:undefined;
      const size=typeof family?.size==='number'?family.size:Math.max(1,claims.filter(c=>c.family===merged.family).length);
      append(`${f.claimId}.expected_false`,alpha,'family_size * alpha',[addSource(`plan.claims.${f.claimId}.family_size`,size),sources.find(s=>s.id===alpha.id)!]);
    }
    for(const comparison of Array.isArray(merged.comparisons)?merged.comparisons:[]){if(typeof comparison!=='string')continue;const estimate=at(`vs.${comparison}.estimate`);if(estimate&&typeof estimate.value==='number')append(`${f.claimId}.vs.${comparison}`,estimate,'identity',[sources.find(s=>s.id===estimate.id)!]);}
  }
  return {sources,dataSlots,derivedSlots};
}
