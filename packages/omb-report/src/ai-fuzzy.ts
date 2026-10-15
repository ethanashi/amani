/** Inputs have already undergone the prose comparison normalization. Display
 * text and provenance identities are never rewritten by this comparison. */
const compact=(s:string)=>s.replace(/[\s\p{P}]/gu,'');
const repeated=(s:string)=>s.replace(/(\p{L})\1+/gu,'$1');
/** Damerau-Levenshtein <= 1: equality, insertion, deletion, substitution or
 * one adjacent transposition. Bounded linear comparison, no distance matrix. */
export function withinOneEdit(a:string,b:string):boolean {
 if(a===b)return true;
 if(Math.abs(a.length-b.length)>1)return false;
 let i=0;while(i<Math.min(a.length,b.length)&&a[i]===b[i])i++;
 if(a.length===b.length)return a.slice(i+1)===b.slice(i+1)||(a[i]===b[i+1]&&a[i+1]===b[i]&&a.slice(i+2)===b.slice(i+2));
 return a.length>b.length?a.slice(i+1)===b.slice(i):a.slice(i)===b.slice(i+1);
}
export interface FuzzyNameHit {name:string;start:number;end:number}
export function fuzzyNameHits(key:string,names:readonly string[]):FuzzyNameHit[] {
 // Normalizing names is the caller's responsibility, just as for the prose.
 const targets=names.map(name=>({name,raw:compact(name),folded:repeated(compact(name))}));
 const maxLength=Math.max(0,...targets.map(t=>t.folded.length))+1;
 const tokens=[...key.matchAll(/[\p{L}\p{N}]+/gu)],hits:FuzzyNameHit[]=[];
 for(let i=0;i<tokens.length;i++){
  let candidate='';
  // Bound separator windows, but collapse arbitrarily long repeated-letter
  // tokens before measuring: padding must not evade detection.
  for(let j=i;j<tokens.length&&j<i+64;j++){
   const token=tokens[j]!;
   if(j>i&&!/^[\s\p{P}]*$/u.test(key.slice(tokens[j-1]!.index+tokens[j-1]![0].length,token.index)))break;
   candidate+=token[0];if(repeated(candidate).length>maxLength)break;
   if(candidate.length<5)continue;
   for(const target of targets){
    // Exact names already took the stronger exact-name path and its allowlist.
    if(candidate===target.raw)continue;
    if(withinOneEdit(repeated(candidate),target.folded))hits.push({name:target.name,start:tokens[i]!.index,end:token.index+token[0].length});
   }
  }
 }
 return hits;
}
