/** Post-build audit of extracted PDF text. Independent of PW4 rows, L2 tolerance, cached
 * support verdicts and the frozen index. Every printed DOI/PMID is re-resolved with fresh=true.
 * The publication host must extract text from the actual final PDF and retain its PDF hash.
 * Bounded style: numbered References, authors separated by semicolons, (year), title, journal,
 * then DOI/PMID. Unknown styles are not verified, never guessed through an LLM. */
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { HttpClient, sha256 } from './http.ts';
import { parseIdentifier, retrieveApiMetadata } from './api-metadata.ts';
import type { Metadata, Receipt } from './types.ts';
export interface ReferenceAuditRow { number:number; keys:string[]; status:'passed'|'failed'|'unavailable'; issues:string[]; receipts:Receipt[] }
export interface ReferenceAudit {
  ok:boolean; textSha256:string; pdfSha256:string; rows:ReferenceAuditRow[]; issues:string[]; sha256:string;
}
const fold=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[‐‑‒–—−]/g,'-').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function identifiers(text:string):string[] {
  const dois=[...text.matchAll(/\b10\.\d{4,9}\/[^\s<>"{}]+/gi)].map(m=>'doi:'+m[0].replace(/[.,;]+$/,'').toLowerCase());
  const pmids=[...text.matchAll(/\bPMID\s*:\s*([1-9]\d*)\b/gi)].map(m=>'pmid:'+m[1]);
  return [...dois,...pmids];
}
export async function auditPdfReferences(input:{text:string;pdfSha256:string;expectedKeys:readonly string[];frozenBibliography:readonly Metadata[]}, client:HttpClient):Promise<ReferenceAudit> {
  // Capture before the first await: a caller changing its object cannot rebind this result.
  const text=input.text, pdfSha256=input.pdfSha256, expectedKeys=[...input.expectedKeys], frozenBibliography=structuredClone(input.frozenBibliography??[]);
  const issues:string[]=[],rows:ReferenceAuditRow[]=[];
  const done=():ReferenceAudit=> {
    const body={ok:!issues.length&&rows.length>0&&rows.every(r=>r.status==='passed'),textSha256:sha256(text),pdfSha256:pdfSha256,rows,issues};
    return {...body,sha256:canonicalSha256(body)};
  };
  if(!/^[a-f0-9]{64}$/.test(pdfSha256)) issues.push('final PDF hash missing or malformed');
  if(typeof text!=='string'||!text.trim()||text.length>2_000_000) {issues.push('PDF text missing or outside audit bounds');return done();}
  const expected=expectedKeys.map(k=>{try{const id=parseIdentifier(k);return id.kind+':'+id.value;}catch{issues.push('invalid expected identifier');return k;}});
  if(!expected.length||new Set(expected).size!==expected.length) issues.push('expected reference inventory missing/duplicate');
  const headings=[...text.matchAll(/^References\s*$/gm)];
  if(headings.length!==1) {issues.push('exactly one References heading required');return done();}
  const section=text.slice(headings[0]!.index+headings[0]![0].length).trim();
  const starts=[...section.matchAll(/^\[(\d+)\]\s+/gm)];
  if(!starts.length || starts[0]!.index!==0 || starts.length>500) {issues.push('unparseable or oversized reference list');return done();}
  if(!frozenBibliography.length) issues.push('frozen bibliography missing');
  const seen=new Set<string>(), numbers=new Set<number>();
  for(let i=0;i<starts.length;i++) {
    const block=section.slice(starts[i]!.index,starts[i+1]?.index??section.length).replace(/\s+/g,' ').trim();
    const number=Number(starts[i]![1]),keys=identifiers(block);
    const row:ReferenceAuditRow={number,keys,status:'passed',issues:[],receipts:[]};rows.push(row);
    if(numbers.has(number)||number!==i+1) row.issues.push('duplicate or nonconsecutive reference number');numbers.add(number);
    if(!keys.length) row.issues.push('reference lacks DOI/PMID');
    if(keys.some(k=>!expected.includes(k))) row.issues.push('unlisted reference');
    for(const key of keys) {if(seen.has(key)) row.issues.push('duplicate identifier');seen.add(key);}
    const parsed=/^\[\d+\]\s+(.+?)\s+\((\d{4})\)\.\s+(.+)$/.exec(block);
    if(!parsed) row.issues.push('reference style unparseable');
    for(const key of keys) {
      try {
        const {metadata:m,receipt,retracted,flags,statusReceipts}=await retrieveApiMetadata(client,key,undefined,true);row.receipts.push(receipt,...statusReceipts);
        if(retracted || flags.includes('expression-of-concern')) row.issues.push(`${key}: fresh API retraction or expression of concern`);
        if(parsed) {
          const authors=parsed[1]!.split(';').map(fold),year=Number(parsed[2]);
          if(JSON.stringify(authors)!==JSON.stringify(m.authors.map(fold))) row.issues.push(`${key}: authors mismatch`);
          // Exact year: unlike PW4 L2, ±1 is not allowed after the document was built.
          if(year!==m.year) row.issues.push(`${key}: year mismatch (${year} vs ${m.year})`);
          // Match trailing fields from the right: honest titles may contain '. Volume: '.
          // Field delimiters are part of the host's fixed reference style. No tail is ignored.
          const fields=/^(.+)\. Volume: (.*?)\. Pages: (.*?)\. DOI: (\S+)\. PMID: (\S+)\.$/.exec(parsed[3]!);
          if(!fields) row.issues.push(`${key}: unrecognised reference fields or trailing text`);
          else {
            // Try punctuation boundaries against the known complete title, not the first dot.
            // Folding each field separately preserves the title/journal boundary.
            const titleJournal=fields[1]!;
            const titleEnds=[...titleJournal.matchAll(/[.!?]\s+/g)].filter(b=>fold(titleJournal.slice(0,b.index))===fold(m.title));
            if(!titleEnds.length) row.issues.push(`${key}: title mismatch`);
            else if(!titleEnds.some(b=>fold(titleJournal.slice(b.index+b[0].length))===fold(m.journal))) row.issues.push(`${key}: journal mismatch`);
            const printed=[fields[2]!,fields[3]!,fields[4]!,fields[5]!];
            const apiFields=[m.volume??'-',m.pages??'-',m.doi??'-',m.pmid??'-'];
            const names=['volume','pages','DOI','PMID'];
            printed.forEach((value,j)=>{
              // Crossref has no PMID; the independent PMID read verifies that alias.
              if(j===3 && m.pmid===null && keys.some(k=>k.startsWith('pmid:'))) return;
              if(fold(value)!==fold(apiFields[j]!)) row.issues.push(`${key}: ${names[j]} mismatch`);
            });
          }
          const frozen=frozenBibliography.find(f=>key===(key.startsWith('doi:')?'doi:'+f.doi:'pmid:'+f.pmid));
          if(!frozen) row.issues.push(`${key}: absent from frozen bibliography`);
          else {
            for(const field of ['title','journal','volume','pages','doi','year'] as const) if(fold(String(m[field]??''))!==fold(String(frozen[field]??''))) row.issues.push(`${key}: frozen ${field} mismatch`);
            if(JSON.stringify(m.authors.map(fold))!==JSON.stringify(frozen.authors.map(fold))) row.issues.push(`${key}: frozen authors mismatch`);
          }
        }
      } catch(error) {row.status='unavailable';row.issues.push(`${key}: ${error instanceof Error?error.message:'metadata unavailable'}`);}
    }
    if(row.issues.length&&row.status!=='unavailable') row.status='failed';
  }
  for(const key of expected) if(!seen.has(key)) issues.push(`missing printed reference: ${key}`);
  return done();
}
