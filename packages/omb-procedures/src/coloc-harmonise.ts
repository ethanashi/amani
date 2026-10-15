import type { ColocInput, ColocVariant } from './coloc.ts';
const complement=(a:string)=>a.replace(/[ACGT]/g,c=>({A:'T',T:'A',C:'G',G:'C'})[c]!);
const palindrome=(a:string,b:string)=>complement(a)===b;
/** Align both studies to reference effect alleles before any score or LD computation.
 * Palindromes need resolvable effect-allele frequencies in both studies and reference.
 * Duplicate coordinates/alleles are excluded rather than selecting a favorable row. */
export function harmoniseColoc(input:ColocInput): ColocInput {
  const normalize=(v:ColocVariant)=>({...v,effect_allele:v.effect_allele.toUpperCase(),other_allele:v.other_allele.toUpperCase()});
  const key=(v:ColocVariant)=>[v.chromosome,v.position,[v.effect_allele,v.other_allele].sort().join('')].join(':');
  const a=input.exposure.map(normalize), b=input.outcome.map(normalize);
  const unique=(rows:ColocVariant[])=>{const m=new Map<string,ColocVariant|null>();for(const v of rows){const k=key(v);m.set(k,m.has(k)?null:v);}return m;};
  const am=unique(a),bm=unique(b), refs=new Map(input.reference.ids.map((id,i)=>[id,i]));
  const exposure:ColocVariant[]=[],outcome:ColocVariant[]=[];
  const freq=(f:number|undefined)=>f!==undefined && Number.isFinite(f) && f>0 && f<1;
  for(const x of am.values()) {
    if(!x)continue;
    const y=bm.get(key(x)) ?? bm.get(key({...x,effect_allele:complement(x.effect_allele),other_allele:complement(x.other_allele)}));
    if(!y)continue;
    const ri=refs.get(x.id);if(ri===undefined)continue;
    const effect=input.reference.effect_alleles[ri]!.toUpperCase();
    const refFreq=input.reference.effect_allele_frequencies?.[ri] ?? (input.reference.dosages?.[ri]?.reduce((s,v)=>s+v,0)!/(2*(input.reference.dosages?.[ri]?.length??0)));
    const pal=palindrome(x.effect_allele,x.other_allele);
    const orient=(v:ColocVariant):ColocVariant|null=>{
      let sign:number;
      if(pal) {
        if(v.maf>.42 || !freq(v.eaf) || !freq(refFreq) || Math.min(refFreq,1-refFreq)>.42)return null;
        const same=Math.abs(v.eaf!-refFreq),flipped=Math.abs(1-v.eaf!-refFreq);
        if(Math.min(same,flipped)>.1 || Math.abs(same-flipped)<.1)return null;
        sign=same<flipped?1:-1;
      } else if(v.effect_allele===effect || complement(v.effect_allele)===effect)sign=1;
      else if(v.other_allele===effect || complement(v.other_allele)===effect)sign=-1;
      else return null;
      const other=[x.effect_allele,x.other_allele].includes(effect)?[x.effect_allele,x.other_allele].find(a=>a!==effect)!:complement([x.effect_allele,x.other_allele].find(a=>complement(a)!==effect)!);
      return {...v,id:x.id,effect_allele:effect,other_allele:other,beta:sign*v.beta,...(v.eaf===undefined?{}:{eaf:sign===1?v.eaf:1-v.eaf})};
    };
    const xx=orient(x),yy=orient(y);if(xx&&yy){exposure.push(xx);outcome.push(yy);}
  }
  if(!exposure.length)throw new Error('no harmonised variants: alleles or palindromic frequencies unresolved');
  return {...input,exposure,outcome,reference:{...input.reference,effect_alleles:input.reference.effect_alleles.map(a=>a.toUpperCase())}};
}
