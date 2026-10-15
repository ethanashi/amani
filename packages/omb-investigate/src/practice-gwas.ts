/** Fresh biallelic identities and within-study derived frequency fields.
 * No real allele pairing, frequency, or cross-study measurement is read here.
 */
import {independentRandom} from './practice-independent.ts';
import type {AllowedTable} from './practice-provenance.ts';
import type {Table} from './tabular.ts';
export const alleleFields=['effect_allele','other_allele','palindromic','is_palindromic'];
export const frequencyFields=['eaf','effect_allele_frequency','other_allele_frequency','maf'];
export function gwasShape(t:Table):boolean{return ['effect_allele','other_allele'].every(c=>t.header.includes(c)&&t.rows.every(r=>/^(?:[ACGT]+|n[1-4])$/.test(r[t.header.indexOf(c)]??''))); }
export function freshGwas(tables:Table[],specs:readonly AllowedTable[],seed:string):void{
 const eligible=tables.filter(t=>{const s=specs.find(s=>s.file===t.file)!;return ['effect_allele','other_allele'].every(name=>{const c=s.inventories[s.header.indexOf(name)];return c?.kind==='levels'&&c.levels.length>0&&c.levels.every(v=>/^(?:[ACGT]+|n[1-4])$/.test(v));});});
 for(const t of eligible){const s=specs.find(s=>s.file===t.file)!;
  const key=s.declaration.keys.find(k=>/^(variant(_id)?|snp|rsid)$/i.test(k))??(s.declaration.keys.length===1?s.declaration.keys[0]:undefined);if(!key)throw new Error('GWAS practice needs unambiguous variant identity');
  const ns=s.declaration.keyNamespaces?.[key]??'variant',id=t.header.indexOf(key);
  const domain=(name:string)=>{const sets=specs.filter(s=>eligible.some(t=>t.file===s.file)).map(s=>s.inventories[s.header.indexOf(name)]?.levels).filter((v):v is string[]=>!!v?.length);return sets.length?sets[0]!.filter(v=>sets.every(s=>s.includes(v))):['A','C','G','T'];};
  const pairs=domain('effect_allele').flatMap(a=>domain('other_allele').filter(b=>a!==b).map(b=>[a,b]));if(!pairs.length)throw new Error('Infeasible biallelic inventory');
  let lo=0,hi=1;
  for(const name of frequencyFields){const c=s.inventories[t.header.indexOf(name)];if(!c)continue;if(name==='maf')continue;lo=Math.max(lo,name==='other_allele_frequency'?1-c.max:c.min);hi=Math.min(hi,name==='other_allele_frequency'?1-c.min:c.max);}
  if(lo>hi+1e-12)throw new Error('Infeasible complementary frequency inventory');
  for(const r of t.rows){const pair=pairs[Math.floor(independentRandom(seed,JSON.stringify(['gwas-alleles',ns,r[id]]))()*pairs.length)]!,palindromic=['AT','TA','CG','GC'].includes(pair.join(''));
   const eaf=lo+independentRandom(seed,JSON.stringify(['gwas-frequency',t.file,r[id]]))()*(hi-lo);
   t.header.forEach((name,j)=>{if(name==='effect_allele')r[j]=pair[0]!;else if(name==='other_allele')r[j]=pair[1]!;else if(['palindromic','is_palindromic'].includes(name)){const levels=s.inventories[j]?.levels??[];r[j]=levels.includes('true')||levels.includes('false')?String(palindromic):levels.includes('TRUE')||levels.includes('FALSE')?String(palindromic).toUpperCase():palindromic?'1':'0';}else if(frequencyFields.includes(name))r[j]=String(name==='other_allele_frequency'?1-eaf:name==='maf'?Math.min(eaf,1-eaf):eaf);});
  }
 }
}
export function validGwas(t:Table):boolean{
 if(!gwasShape(t))return true;const a=t.header.indexOf('effect_allele'),b=t.header.indexOf('other_allele'),e=t.header.indexOf('eaf')>=0?t.header.indexOf('eaf'):t.header.indexOf('effect_allele_frequency'),o=t.header.indexOf('other_allele_frequency');
 return t.rows.every(r=>r[a]!==r[b]&&(e<0||Number(r[e])>=0&&Number(r[e])<=1)&&(e<0||o<0||Math.abs(Number(r[e])+Number(r[o])-1)<1e-9));
}
