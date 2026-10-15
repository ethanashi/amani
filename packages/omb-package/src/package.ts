/** Production packaging: PW8 is the sole source of released artifact bytes. */
import path from 'node:path';
import {mkdtempSync,mkdirSync,readFileSync,renameSync,rmSync,existsSync} from 'node:fs';
import {createPublicKey,type KeyObject} from 'node:crypto';
import {allUnits,verifyFirstDraft,expectedFlow,loadReleaseKey,verifyPersistedRelease,type ManuscriptPlan,type Manuscript,type Unit} from '../../omb-report/src/reverify/index.ts';
import {assert,canonicalJson,canonicalSha256,sha256,submissionHash} from './common.ts';
import {checkGates,checkRenderedCaps,lintText} from './gates.ts';
import {templates} from './templates.ts';
import {venueProfile} from './profiles.ts';
import {outputProfile} from './output-profiles.ts';
import {toolchain,ROOT} from './toolchain.ts';
import {assembleBundle,sealBundle,freshSandbox,verifyBundle,write,inventory} from './bundle.ts';
import {requirePorts} from './adapters.ts';
import {displayKind} from './genre/records.ts';
import {lintRenderedGenre} from './genre/packaging.ts';
import {createPW8RenderAdapter} from './pw8-render.ts';
import type {HostAuthority,PackageRequest,UpstreamPorts,Submission} from './types.ts';
export interface PackageOptions {authority:HostAuthority;certificateKey:KeyObject;ports:UpstreamPorts;output:string;now?:number;expectedGenreProfiles?:Record<string,string>;/** Trusted host plan, never drafter JSON. */plan?:ManuscriptPlan}
const unitMarkdown=(u:Unit):string=>u.inlines.map(i=>i.t==='value'&&/^(fig|tab):/u.test(i.key)?`[${i.text}](#${i.key.startsWith('fig:')?'fig':'tab'}-${i.key.slice(4)})`:i.text).join('');
export const sectionText=(m:Manuscript,id:string):string=>{const s=m.sections.find(s=>s.id===id);assert(s,`verified section missing: ${id}`);return s.blocks.flatMap(b=>b.kind==='figure'?[unitMarkdown(b.caption)]:b.kind==='table'?[unitMarkdown(b.caption),...b.header.map(unitMarkdown),...b.rows.flat().map(unitMarkdown),...b.notes.map(unitMarkdown)]:b.units.map(unitMarkdown)).join('\n');};
/** Endorsed submission and verified manuscript must describe the same text.
 * No Markdown parser heuristics, numeric-only inventories or coverage subsets. */
export function assertVerifiedSubmission(s:Submission,m:Manuscript):void {
 assert(s.input.sha256===m.paperInputHash&&s.manuscript.skeletonHash===m.skeletonSha256,'PW8 paper or skeleton differs from endorsed submission');
 assert(s.manuscript.title===m.title.text,'PW8 title differs from endorsed submission');
 const supplied=new Map(s.manuscript.sections.concat(s.manuscript.supplement).map(x=>[x.id,x.markdown]));
 if(s.manuscript.authorSummary!==undefined)supplied.set('author-summary',s.manuscript.authorSummary);
 supplied.set('abstract',Object.values(s.manuscript.abstract).join('\n'));supplied.set('plain-summary',s.manuscript.plainSummary);
 assert(supplied.size===m.sections.length&&m.sections.every(sec=>supplied.get(sec.id)===sectionText(m,sec.id)),'PW8 verified sections differ from endorsed submission');
 const tables=m.sections.flatMap(sec=>sec.blocks.filter(b=>b.kind==='table'));assert(tables.length===s.manuscript.displays.filter(d=>d.kind==='table').length,'PW8 table inventory differs');
 for(const t of tables){const d=s.manuscript.displays.find(d=>d.id===t.tableId);assert(d?.kind==='table'&&sha256(d.markdown??'')===t.sha256.markdown&&sha256(d.csv)===t.csvSha256&&sha256(d.dictionary)===t.sha256.dictionary,'PW8 table bytes differ from endorsed submission');}
 const figures=m.sections.flatMap(sec=>sec.blocks.filter(b=>b.kind==='figure'));
 assert(figures.length===s.manuscript.displays.filter(d=>d.kind==='figure').length,'PW8 figure inventory differs');
 for(const f of figures){const d=s.manuscript.displays.find(d=>d.id===f.figureId);assert(d?.svg===f.svg&&d.caption===f.sourceCaption,'PW8 figure or caption differs');}
}
/** Markdown used only for caps/genre evidence, projected from the same verified
 * blocks that PW8 renders. Keep actual display nodes and main/supplement roles. */
export function verifiedPackageSource(s:Submission,m:Manuscript):Record<string,string>{
 const supplement=new Set(s.manuscript.supplement.map(x=>x.id));
 const section=(sec:Manuscript['sections'][number])=>{
  const id=({'plain-summary':'plain_summary','author-summary':'plain_summary','data-code':'data_availability','key-points':'key_points'} as Record<string,string>)[sec.id]??sec.id;
  const blocks=sec.blocks.map(b=>{
   if(b.kind==='figure'||b.kind==='table'){
    const displayId=b.kind==='figure'?b.figureId:b.tableId,kind=displayKind(s,displayId);
    assert(!kind||/^[a-z_-]+$/u.test(kind),'invalid display kind');const tag=kind?` kind="${kind}"`:'';
    if(b.kind==='figure')return `![${unitMarkdown(b.caption)}](${b.src}){#fig-${b.figureId}${tag}}`;
    const d=s.manuscript.displays.find(d=>d.id===b.tableId)!;
    return `::: {.table${tag}}\n## ${unitMarkdown(b.caption)} {#tab-${b.tableId}}\n\n${d.markdown}\n:::`;
   }
   return b.units.map(unitMarkdown).join('\n\n');
  });return `# ${sec.heading.text} {#${sec.id} section-id="${id}"}\n\n${blocks.join('\n\n')}`;
 };
 return {'paper.md':`::: {section-id="title"}\n# ${m.title.text}\n:::\n\n`+m.sections.filter(x=>!supplement.has(x.id)).map(section).join('\n\n')+'\n','supplement.md':m.sections.filter(x=>supplement.has(x.id)).map(section).join('\n\n')+'\n'};
}
export async function packagePaper(request:PackageRequest,options:PackageOptions):Promise<{directory:string;certificate:Record<string,unknown>}> {
 const r=structuredClone(request),s=r.submission,initial=submissionHash(s),p=venueProfile(s.venue),now=options.now??Date.now();
 requirePorts(options.ports);const gates=checkGates(r,options.authority,now);
 assert(options.certificateKey.asymmetricKeyType==='ed25519'&&options.certificateKey.type==='private','Ed25519 certificate signing key required');
 assert(!existsSync(options.output),'output already exists; regenerate to a fresh directory and compare');
 assert(options.plan,'PW8 trusted manuscript plan required; read-back callbacks do not authorize packaging');
 for(const [id,run] of [['PW0',()=>options.ports.authenticateInput(s.input)],['PW5-PW8-source',()=>options.ports.verifySource(s)],['PW3',()=>options.ports.verifyDisplays(s.manuscript.displays)],['PW4',()=>options.ports.verifyCitations(s.manuscript.references)]] as const){await run();assert(submissionHash(s)===initial,'upstream adapter mutated submission');gates.push({id,outcome:'passed',evidenceHash:initial});}
 const checked=verifyFirstDraft(options.plan);assert(checked.ok&&checked.manuscript,'PW8 source verification failed: '+JSON.stringify({refusal:checked.refusal,mustAppear:checked.mustAppear}));const m=checked.manuscript;assertVerifiedSubmission(s,m);
 const format=outputProfile(s,p);
 const cited=new Set<string>();let passedReferences=false;
 for(const sec of m.sections){if(sec.id==='references')passedReferences=true;for(const b of sec.blocks){
  if(b.kind==='figure'||b.kind==='table'){
   const id=b.kind==='figure'?b.figureId:b.tableId;assert(cited.has(id),'PW8 display precedes a bound prose citation: '+id);
   if(p.displayPlacement==='after-references')assert(passedReferences,'PW8 journal display precedes references');
  }else for(const u of b.units)for(const i of u.inlines)if(i.t==='value'&&/^(fig|tab):/u.test(i.key))cited.add(i.key.slice(4));
 }}
 for(const checklist of s.manuscript.checklists)for(const item of checklist.items)if(item.status==='software'||item.status==='llm'){
  const units=allUnits(m).filter(u=>u.uid===item.anchor||u.section===item.anchor||u.block===item.anchor);
  const normal=(v:string)=>v.normalize('NFKC').replace(/\s+/gu,' ').trim();
  assert(units.length&&normal(units.map(u=>u.text).join(' ')).includes(normal(item.excerpt)),`final checklist excerpt/anchor missing: ${checklist.name}/${item.id}`);
 }

 const ancillary=templates(s,p,new Date(now).toISOString().slice(0,10));delete ancillary['paper.md'];delete ancillary['supplement.md'];
 // Internal review is explicitly unverified plain text, never a second paper HTML.
 delete ancillary['internal-review.html'];ancillary['internal-review.txt']='Internal AI review; numbers and claims are not verified; not peer review.\n'+s.reproduction.transcripts.map(t=>t.name+'\n'+t.text).join('\n\n');
 const source={...ancillary,...verifiedPackageSource(s,m)};
 checkRenderedCaps(s,p,source['paper.md']!);for(const text of Object.values(source))lintText(text,s.study.perSampleIdentifiers);
 const tc=await toolchain();mkdirSync(path.join(ROOT,'.tmp'),{recursive:true});const tmp=mkdtempSync(path.join(ROOT,'.tmp/package-pw8-'));
 try{
  const staging=path.join(tmp,'resources');mkdirSync(staging);assembleBundle(staging,s,source);write(staging,'references.json',JSON.stringify(s.manuscript.references.map(x=>x.cslJson)));
  const genre=await lintRenderedGenre(s,p,staging,tc,new Date(now).toISOString().slice(0,10),options.expectedGenreProfiles,'paper.pdf');for(const a of genre.artifacts)write(staging,a.name,a.bytes);
  gates.push({id:'genre-structure',outcome:'passed',evidenceHash:canonicalSha256(genre.report)});
  write(staging,'toolchain.json',canonicalJson(tc.identity)+'\n');write(staging,'venue-profile.json',canonicalJson(p)+'\n');write(staging,'output-profile.json',canonicalJson(format)+'\n');write(staging,'policy-receipt.json',canonicalJson(r.policy)+'\n');write(staging,'skeleton.json',canonicalJson(m.skeleton)+'\n');
  for(const name of ['pixi.toml','pixi.lock','chromium.lock.json','tectonic.lock.json','scripts/tex-bundle.py','scripts/pw8-pdf-tags.py','vendor/tex/pw9-bundle.zip','vendor/tex/TECTONIC-LICENSE.txt','vendor/fonts/GUST-FONT-LICENSE.txt','vendor/tex/LPPL-1.3c.txt','vendor/NOTICE.md','vendor/manifest.json','vendor/fonts/lmroman10-regular.otf','vendor/fonts/lmroman10-bold.otf','vendor/fonts/PW9LatinModernRoman-Regular.ttf','vendor/fonts/PW9LatinModernRoman-Bold.ttf','vendor/fonts/SourceSerif4-Regular.ttf','vendor/fonts/SourceSerif4-Bold.ttf','vendor/fonts/SourceSerif4-It.ttf','vendor/fonts/OFL.txt','scripts/normalize.py','scripts/figure-font.py','scripts/figure-font-bold.py'])write(staging,`packaging-toolchain/${name}`,readFileSync(path.join(ROOT,name)));
  const genreProfiles=Object.fromEntries([...(genre.report.profile?[genre.report.profile]:[]),...genre.report.secondary_profiles].map(p=>[p.genre,p.sha256]));
  for(const slug of Object.keys(genreProfiles))write(staging,`genre-profiles/${slug}.json`,readFileSync(path.join(ROOT,'genres',slug+'.json')));
  const extra={toolchain:tc.identity,outputProfile:format,genreProfiles,genreRuleClassPolicy:genre.report.ruleClassPolicyHash};
  sealBundle(staging,r,gates,options.certificateKey,extra);const reproduced=await freshSandbox(staging,tc);
  for(const name of ['bundle-manifest.json','certificate.payload.json','certificate.sig','certificate-public.pem'])rmSync(path.join(staging,name));
  write(staging,'reproduction-receipt.json',canonicalJson(reproduced)+'\n');gates.push({id:'fresh-sandbox',outcome:'passed',evidenceHash:canonicalSha256(reproduced)});
  const certificate=sealBundle(staging,r,gates,options.certificateKey,extra);verifyBundle(staging,options.certificateKey);
  const resources=new Map(Object.keys(inventory(staging)).map(name=>[name,readFileSync(path.join(staging,name))]));
  const adapter=await createPW8RenderAdapter({purpose:'endorsed-package',expectedManuscriptSha256:canonicalSha256(m),plan:options.plan,workDirectory:path.join(tmp,'render'),outputProfile:format.id,resources});
  const release=await adapter.verifyRelease();assert(release.ok&&release.artifacts&&release.record,'PW8 release refused: '+release.issues.join('; '));
  await options.ports.verifyRendered(s,[...release.artifacts].map(([name,bytes])=>({name,bytes})));assert(submissionHash(s)===initial,'render adapter mutated submission');
  const key=loadReleaseKey(),record=await adapter.persist(key);const persisted=verifyPersistedRelease(record,release.artifacts,{publicKey:createPublicKey(key),paperInputHash:s.input.sha256,buildId:release.record.buildId});assert(persisted.ok,persisted.issues.join('; '));
  checkGates(r,options.authority,now);
  const bundle=path.join(tmp,'accepted');mkdirSync(bundle);for(const [name,bytes] of release.artifacts)write(bundle,name,bytes);
  // Detached certificate/key are the envelope, not self-hashed payload members.
  write(bundle,'release-record.json',canonicalJson(record)+'\n');write(bundle,'release-public.pem',createPublicKey(key).export({type:'spki',format:'pem'}).toString());
  mkdirSync(path.dirname(options.output),{recursive:true});renameSync(bundle,options.output);return {directory:options.output,certificate};
 }finally{rmSync(tmp,{recursive:true,force:true});}
}
