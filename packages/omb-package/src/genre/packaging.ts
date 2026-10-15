import path from 'node:path';
import { command,type Toolchain } from '../toolchain.ts';
import { lintText } from '../gates.ts';
import { canonicalJson } from '../common.ts';
import { structureInput } from './records.ts';
import { lintStructure,assertStructure,reportBytes,reportMarkdown } from './structure.ts';
import type { Submission,VenueProfile,RenderedArtifact } from '../types.ts';
import type { LintInput,Report } from './types.ts';
export async function lintRenderedGenre(s:Submission,p:VenueProfile,dir:string,tc:Toolchain,asOf:string,expectedProfileHashes?:Record<string,string>,supplementDocument?:string):Promise<{report:Report;artifacts:RenderedArtifact[]}> {
 const ast=JSON.parse(await command(tc.pandoc,['-f','markdown-raw_html-raw_tex','-t','json','--citeproc','--bibliography','references.json','paper.md'],dir));
 const supplementAst=JSON.parse(await command(tc.pandoc,['-f','markdown-raw_html-raw_tex','-t','json','supplement.md'],dir));
 const input=structureInput(s,p,ast,supplementAst,asOf);if(expectedProfileHashes)input.expectedProfileHashes=expectedProfileHashes;
 if(supplementDocument)input.manifest=input.manifest.map(x=>({...x,path:x.path.replace(/^supplement\.pdf/u,supplementDocument)}));
 const report=lintStructure(input);assertStructure(report);
 const files:Record<string,string>={'lint/structure.json':reportBytes(report),'lint/structure.md':reportMarkdown(report),'supplement/manifest.json':canonicalJson(input.manifest)+'\n','structure_waivers.json':canonicalJson(input.waivers)+'\n','limitations-part-b.json':canonicalJson(input.limitations)+'\n'};
 for(const text of Object.values(files))lintText(text,s.study.perSampleIdentifiers);
 return {report,artifacts:Object.entries(files).map(([name,text])=>({name,text,bytes:Buffer.from(text)}))};
}
/** Re-run on newly rendered ASTs after an edit using hashes from the prior trusted
 * certificate. Packaging still requires a new reviewed submission endorsement. */
export function reverifyGenre(input:LintInput,certificate:{genreProfiles:Record<string,string>}):Report {
 const report=lintStructure({...input,expectedProfileHashes:certificate.genreProfiles});assertStructure(report);return report;
}
