/** Published PW0/PW3/PW4 integrations. PW5–PW8 remain explicit required host ports. */
import { buildPaperInput, canonicalPaperInput, type PaperLineage, type PaperInputOptions } from '../../omb-paper/src/index.ts';
import { renderFigure, renderTable, verifyFigure, verifyTable, checkFigureRoundTrip, checkDisplayReferences, type FigureSpec, type TableSpec, type FactStore } from '../../omb-figures/src/index.ts';
import type { FrozenBibliography, CitationSelection, ApiCslRecord } from '../../omb-citations/src/bibliography.ts';
import { assert, canonicalSha256 } from './common.ts';
import type { Display, UpstreamPorts } from './types.ts';

export function paperInputAuthenticator(lineage:PaperLineage,options:PaperInputOptions):UpstreamPorts['authenticateInput'] {
  return async input=>{canonicalPaperInput(input);assert(buildPaperInput(lineage,options).sha256===input.sha256,'PaperInput differs from authenticated PW0 lineage');};
}
export function displayVerifier(host:{figures:readonly FigureSpec[];tables:readonly TableSpec[];store:FactStore;references:()=>readonly string[]}):UpstreamPorts['verifyDisplays']{
  return async displays=>{
    const expectedFigures=host.figures.map(spec=>({spec,rendered:renderFigure(spec,host.store)}));
    const expectedTables=host.tables.map(spec=>({spec,rendered:renderTable(spec,host.store)}));
    assert(displays.length===expectedFigures.length+expectedTables.length&&new Set(displays.map(d=>d.id)).size===displays.length,'PW3 complete display inventory mismatch');
    const inventory:{id:string;csvSha256:string;specSha256:string}[]=[];
    for(const {spec,rendered:e} of expectedFigures){
      const d=displays.find(d=>d.id===spec.id);assert(d?.kind==='figure'&&d.svg,'PW3 figure missing');
      assert(verifyFigure(d.svg,spec,host.store).ok&&checkFigureRoundTrip(d.svg,d.csv,e).ok,'PW3 figure round-trip failed');
      assert(d.caption===e.caption.text&&d.dictionary===e.sourceDictionary&&d.placement===(spec.placement==='results'?'main':'supplement'),'PW3 checked caption/dictionary/placement mismatch');
      inventory.push({id:e.id,...e.provenance});
    }
    for(const {spec,rendered:e} of expectedTables){
      const d=displays.find(d=>d.id===spec.id);assert(d?.kind==='table','PW3 table missing');
      assert(verifyTable({markdown:d.markdown,csv:d.csv,dictionary:d.dictionary,provenance:e.provenance},spec,host.store).ok,'PW3 table round-trip failed');
      assert(d.placement===(spec.placement==='results'?'main':'supplement'),'PW3 table placement mismatch');inventory.push({id:e.id,...e.provenance});
    }
    assert(checkDisplayReferences(inventory,host.references()).length===0,'PW3 missing/dangling manuscript display reference');
  };
}
/** FrozenBibliography owns selection capabilities. L6 is a permanent host-owner gate. */
export function citationVerifier(host:{bibliography:FrozenBibliography;selections:readonly CitationSelection[];approved:readonly ApiCslRecord[];verifyL6:(record:ApiCslRecord)=>Promise<void>}):UpstreamPorts['verifyCitations']{
  return async supplied=>{
    assert(canonicalSha256(supplied)===canonicalSha256(host.approved),'PW4 bibliography is not the host-selected API output');
    assert(supplied.length===host.selections.length,'PW4 selection inventory mismatch');
    for(const [i,selection] of host.selections.entries()){
      const fresh=await host.bibliography.build(selection),old=supplied[i]!;
      assert(fresh.key===old.key&&fresh.sentenceId===old.sentenceId&&fresh.verificationHash===old.verificationHash&&canonicalSha256(fresh.cslJson)===canonicalSha256(old.cslJson),'PW4 fresh metadata/support changed');
      await host.verifyL6(fresh);
    }
  };
}
export function requirePorts(ports:UpstreamPorts):void{
  for(const key of ['authenticateInput','verifySource','verifyDisplays','verifyCitations','verifyRendered'] as const)assert(typeof ports?.[key]==='function',`missing trusted upstream adapter: ${key}`);
}
/** PDF references are matched against citeproc's exact text, independently extracted from
 * final PDF bytes. This extends PW4's bounded audit format without pretending it parses CSL.
 * Fresh metadata/status and L6 must ALSO pass via citationVerifier above. */
export function checkCslPdfText(pdfText:string,referenceTexts:readonly string[],endDisplays=false,inlineLabels=false,footer?:string):void{
  const clean=(s:string)=>s.normalize('NFKC').split('\n').filter(l=>!/^\s*\d+[.]?\s*$/.test(l)).join(' ').replace(/\s+/g,' ').trim();
  if(footer){const compact=(v:string)=>v.replace(/\s/gu,'');const wanted=compact(footer);pdfText=pdfText.split('\n').filter(line=>{const text=compact(line);return !(text.startsWith(wanted)&&/^\d+\/\d+$/u.test(text.slice(wanted.length)));}).join('\n');}
  const at=pdfText.lastIndexOf('\nReferences\n');assert(at>=0,'References heading missing from extracted PDF');
  const end=endDisplays?pdfText.indexOf('\nFigures and tables\n',at):pdfText.length;
  assert(end>at,'end-display heading missing from extracted PDF');
  assert(clean(pdfText.slice(at+'\nReferences\n'.length,end))===clean(referenceTexts.map((t,i)=>inlineLabels?`${i+1}. ${t}`:t).join('\n')),'final PDF reference text differs from citeproc / frozen CSL');
}
