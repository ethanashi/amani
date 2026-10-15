/** Refusal-only diagnostics. Applicability is explicit: separation does not invalidate
 * a risk difference, and a constant group does not invalidate every possible procedure. */
export type NonEstimableReason = 'separation' | 'zero-variance' | 'too-few-events' | 'singular-design' | 'insufficient-sample' | 'nonfinite-result' | 'missing-endpoint' | 'weak-instrument';
export interface NumericalDiagnostic { status:'non-estimable'; reason:NonEstimableReason; detail:string }
export interface NumericalInput {
  model:'logistic'|'linear'|'variance'|'survival'; y:readonly number[];
  design?:readonly (readonly number[])[]; groups?:readonly string[]; events?:number; parameters?:number;
}
const fail=(reason:NonEstimableReason,detail:string):NumericalDiagnostic=>({status:'non-estimable',reason,detail});
export function numericalValidity(input:NumericalInput):NumericalDiagnostic|null {
 const {y,design,model}=input, n=y.length, k=input.parameters??design?.[0]?.length??1;
 if(!Number.isInteger(k)||k<1||y.some(v=>!Number.isFinite(v))||design?.some(r=>r.length!==k||r.some(v=>!Number.isFinite(v)))||design&&design.length!==n)return fail('nonfinite-result','nonfinite values or inconsistent design dimensions');
 if(n<=k)return fail('insufficient-sample',`n=${n} does not exceed ${k} fitted parameters`);
 if(model==='survival'&&input.events!==undefined&&input.events<=k)return fail('too-few-events',`${input.events} events for ${k} fitted parameters`);
 if(design){
  const cols=Array.from({length:k},(_,j)=>design.map(r=>r[j]!)),basis:number[][]=[];
  for(const col of cols){const scale=col.reduce((n,v)=>Math.hypot(n,v),0);if(!scale)return fail('singular-design','zero design column');let r=col.map(v=>v/scale);
   for(let pass=0;pass<2;pass++)for(const q of basis){const dot=r.reduce((s,v,i)=>s+v*q[i]!,0);r=r.map((v,i)=>v-dot*q[i]!);}
   const norm=r.reduce((n,v)=>Math.hypot(n,v),0);if(norm<1e-10)return fail('singular-design','linearly dependent design columns');basis.push(r.map(v=>v/norm));
  }
 }
 if(model==='logistic'){
  if(y.some(v=>v!==0&&v!==1))return fail('nonfinite-result','binomial response must be 0 or 1');
  if(new Set(y).size<2)return fail('separation','response has only one observed class; finite logistic intercept does not exist');
  // A binary/categorical group with a pure response admits a diverging coefficient.
  if(input.groups){const groups=new Map<string,number[]>();y.forEach((v,i)=>{const key=input.groups![i]!,group=groups.get(key);if(group)group.push(v);else groups.set(key,[v]);});
   if(groups.size>1&&[...groups.values()].some(v=>new Set(v).size===1))return fail('separation','a fitted group has no events or no non-events (complete or quasi-complete separation)');}
  if(design)for(let j=0;j<k;j++){
   const a=design.filter((_,i)=>y[i]===0).map(r=>r[j]!),b=design.filter((_,i)=>y[i]===1).map(r=>r[j]!);
   if(a.reduce((x,y)=>Math.max(x,y),-Infinity)<b.reduce((x,y)=>Math.min(x,y),Infinity)||b.reduce((x,y)=>Math.max(x,y),-Infinity)<a.reduce((x,y)=>Math.min(x,y),Infinity))return fail('separation','a design column perfectly separates response classes');
  }
 }
 if(model==='variance'){
  const groups=new Map<string,number[]>();y.forEach((v,i)=>{const g=input.groups?.[i]??'all';const group=groups.get(g);if(group)group.push(v);else groups.set(g,[v]);});
  if([...groups.values()].some(v=>v.length<2))return fail('insufficient-sample','fewer than two observations in a variance group');
  if([...groups.values()].some(v=>new Set(v).size<2))return fail('zero-variance','a required within-group variance is zero');
 }
 if(model==='linear'&&new Set(y).size<2)return fail('zero-variance','zero outcome variance; conventional uncertainty is not estimable');
 return null;
}
const reasons=new Set<unknown>(['separation','zero-variance','too-few-events','singular-design','insufficient-sample','nonfinite-result','missing-endpoint','weak-instrument']);
/** Execution accepts an explicit scientific null, never an unexplained NaN or a failed process. */
export function declaredNonEstimability(v:unknown):NumericalDiagnostic|null {
 if(!v||typeof v!=='object'||Array.isArray(v))return null;
 const r=v as Record<string,unknown>;
 if(!['abstain','non-estimable','not-estimable','insufficient-evidence'].includes(String(r.status)))return null;
 const reason=r.reason_code??r.reason;
 if(!reasons.has(reason))return null;
 if(['estimate','coefficient','effect','uncertainty','se','standard_error','p'].some(k=>r[k]!==undefined&&r[k]!==null))return null;
 return fail(reason as NonEstimableReason,typeof r.detail==='string'&&r.detail.trim()?r.detail:`frozen analysis diagnostic: ${reason}`);
}
