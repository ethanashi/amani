import type { Display, Submission, VenueProfile } from './types.ts';
import { lockedGenre,displayKind,ownerActions } from './genre/records.ts';
import { loadProfile } from './genre/profiles.ts';
import { ownerWaiverValid } from './genre/structure.ts';
import { locateDisplays, paragraphs } from './displays.ts';
import { canonicalJson, html, safePath } from './common.ts';
const escape=(s:string)=>s.replace(/[\\`*_{}[\]<>#|]/g,'\\$&').replace(/\r?\n/g,' ');
const table=(head:string[],rows:string[][]):string=>`| ${head.map(escape).join(' | ')} |\n| ${head.map(()=>'---').join(' | ')} |\n${rows.map(r=>`| ${r.map(escape).join(' | ')} |`).join('\n')}`;
export function aiDisclosure(s:Submission):string {
  return `Omerta Bio (${s.framework.version}, commit ${s.framework.commit}) used ${[...new Set(s.models.map(m=>`${m.system} ${m.version} (${m.modelId}; ${m.provider})`))].join('; ')}. Numerical outputs were produced and checked by deterministic software and endorsed by the author; the Methods table records each system's role and the author's checks. Internal AI review was not peer review.`;
}
export function contactStatement(s:Submission):string {
  const c=s.input.contact;
  if(!c.required)return 'Author contact was not required for this study.';
  return (c.contacts??[]).map(x=>`A draft was sent to ${x.name} on ${x.date.slice(0,10)}; ${c.status==='replied'?'their comments are summarised in Supplementary Note N':`no reply was received by ${x.waitEnd!.slice(0,10)}`}.`).join(' ');
}
export function modelCards(s:Submission):Record<string,string>{
  return Object.fromEntries(s.models.map((m,i)=>[`model-cards/ai-${i+1}.json`,canonicalJson({schema:'omb/ai-model-card@1',...m,trainingCutoffAfterOriginalPublication:m.trainingCutoff&&m.originalPublicationDate?m.trainingCutoff>m.originalPublicationDate:null,intendedUse:'Research only; no clinical use.',limitations:'AI output may be inaccurate. Internal AI review is not peer review.',framework:s.framework})+'\n']));
}
export function templates(s:Submission,p:VenueProfile,asOf=new Date().toISOString().slice(0,10)):Record<string,string>{
  const owner=s.owner.record,authors=owner.authors.map(a=>`${escape(a.name)}${a.corresponding?' (corresponding author)':''}\n\n${a.affiliations.map(escape).join('; ')}${a.orcid?`\n\nORCID: ${escape(a.orcid)}`:''}${a.email&&a.emailApprovedForSubmission?`\n\n${escape(a.email)}`:''}`).join('\n\n');
  const abstract=p.abstractHeadings.map(h=>`[**${h}.**]{.abstract-heading} ${s.manuscript.abstract[h]}`).join('\n\n');
  const aiTable=table(['Stage','AI system / exact version','Date / software','Human role','Training cutoff / recall probe'],s.models.map(m=>[m.stage,`${m.system}; ${m.provider}; ${m.modelId}; ${m.version}`,`${m.date}; ${m.software}`,m.humanRole,`${m.trainingCutoff??'Not disclosed'}; ${m.recallProbe}`]));
  const locations=locateDisplays(s.manuscript);
  const display=(d:Display):string=>{
    safePath(d.id);
    const kind=displayKind(s,d.id),tag=kind?` kind="${safePath(kind)}"`:'';
    const {label}=locations.find(l=>l.display===d)!;
    if(d.kind==='figure')return `![${label}. ${escape(d.title)}. ${escape(d.caption)}](figures/${d.id}.svg){#fig-${d.id}${tag} float-width="${d.floatWidth??'column'}" width=6in}\n`;
    const title=`${label}. ${d.title}`;
    return `::: {.table${tag} float-width="${d.floatWidth??'column'}"}\n## ${escape(title)} {#tab-${d.id}}\n\n${d.markdown}\n\n${escape(d.caption)}\n:::\n`;
  };
  const mainDisplays=s.manuscript.displays.filter(d=>d.placement==='main');
  const body=(section:{id:string;heading:string;markdown:string},document:'main'|'supplement')=>{
    const blocks=paragraphs(section.markdown).flatMap((block,i)=>[block.text,...locations.filter(l=>l.display.placement===document&&l.document===document&&l.section===section.id&&l.paragraph===i&&(document==='supplement'||p.displayPlacement==='after-first-citation')).map(l=>display(l.display))]);
    const id=section.id==='data-code'?'data_availability':section.id;
    if(id==='introduction'&&p.untitled_introduction)return `::: {#introduction section-id="introduction"}\n${blocks.join('\n\n')}\n:::`;
    return `# ${escape(section.heading)} {#${safePath(section.id)} section-id="${safePath(id)}"}\n\n${blocks.join('\n\n')}`;
  };
  const parts=[`::: {.title-page section-id="title"}\n# ${escape(s.manuscript.title)}\n\n${authors}\n:::`, `::: {.abstract section-id="abstract"}\n# Abstract {#abstract}\n\n${abstract}\n:::`,`# Plain summary {#plain-summary section-id="plain_summary"}\n\n${s.manuscript.plainSummary}`];
  if(s.manuscript.authorSummary)parts.push(`# Author Summary {#author-summary section-id="plain_summary"}\n\n${s.manuscript.authorSummary}`);
  for(const section of s.manuscript.sections){
    parts.push(body(section,'main'));
    if(section.id==='methods')parts.push(`## Use of AI systems\n\n${aiTable}\n\nInternal AI review rounds were not peer review.`);
  }
  parts.push(`# Declarations {#declarations section-id="declarations"}\n\n## AI-use disclosure {section-id="ai_disclosure"}\n\n::: {statement-id="ai_writing_disclosure"}\n${escape(aiDisclosure(s))}\n:::\n\n## Author contributions {section-id="contributions"}\n\n::: {statement-id="author_contributions"}\n${owner.authors.map(a=>`${escape(a.name)}: ${a.contributions.map(c=>escape(c.role)).join('; ')}.`).join('\n\n')}\n:::\n\n## Author contact\n\n${escape(contactStatement(s))}\n\n## Competing interests {section-id="competing_interests"}\n\n::: {statement-id="competing_interests"}\n${escape(owner.competingInterests)}\n:::\n\n## Funding {section-id="funding"}\n\n::: {statement-id="funding"}\n${escape(owner.funding)}\n:::\n\n## Ethics statement {section-id="ethics"}\n\n::: {statement-id="ethics"}\n${escape(owner.ethics)}\n\nResearch use only; not a clinical recommendation.\n:::\n\n## Acknowledgments {section-id="acknowledgements"}\n\n::: {statement-id="acknowledgements"}\nWe acknowledge Anthropic's Claude and OpenAI's ChatGPT/Codex for the roles documented in Methods.\n:::`);
  parts.push('# References {#references section-id="references"}\n\n::: {#refs}\n:::');
  if(p.displayPlacement==='after-references')parts.push('# Figures and tables {#display-items}',...mainDisplays.map(display));
  const supplement=[`# Supplementary materials {section-id="supplement"}\n\n${escape(s.manuscript.title)}`,...locations.filter(l=>l.display.placement==='supplement'&&l.document==='main').map(l=>display(l.display)),...s.manuscript.supplement.map(x=>body(x,'supplement'))];
  if(s.input.contact.required)supplement.push(`# Supplementary Note N: author contact\n\n${(s.input.contact.contacts??[]).map(c=>`${escape(c.name)}: ${escape(c.reply??`No reply by ${c.waitEnd}`)}.`).join('\n\n')}`);
  for(const c of s.manuscript.checklists)supplement.push(`# ${escape(c.name)} checklist\n\n${escape(c.attribution)}\n\n${table(['Item','Location / status','Verbatim excerpt or reason'],c.items.map(i=>[`${i.id}: ${i.text}`,i.anchor||i.status,i.excerpt||i.reason||'Not available in source data']))}`);
  const profile=lockedGenre(s).genre?loadProfile(lockedGenre(s).genre!):null;
  const waiverContext={ownerActions:ownerActions(s),ownerActor:owner.ownerActor,asOf};
  const waivers=(s.structureWaivers??[]).filter(w=>ownerWaiverValid(w,waiverContext)&&w.profile_sha256===profile?.sha256);
  if(waivers.length)supplement.push(`# Departures from the usual structure of ${escape(profile!.profile.genre_name)} papers\n\n${table(['Rule','What differs','Reason'],waivers.map(w=>[w.rule,w.target,w.reason]))}`);
  const na=(s.manuscript.limitationsPartB??[]).filter(l=>l.status.startsWith('not-applicable:'));
  if(na.length)supplement.push(`# Genre limitation applicability\n\n${table(['Item','Reason'],na.map(l=>[l.id,l.status.slice(15)]))}`);
  const metadata={title:s.manuscript.title,abstract:Object.fromEntries(p.abstractHeadings.map(h=>[h,s.manuscript.abstract[h]])),authors:owner.authors.map(a=>({...a,...(!a.emailApprovedForSubmission?{email:null}:{})})),type:s.venue==='research-note'?'research-note':'research-article',target:s.study.targets[0],paperInputHash:s.input.sha256,keywords:[],ownerCompletion:{orcid:owner.authors.some(a=>!a.orcid),contactEmail:!owner.authors.some(a=>a.emailApprovedForSubmission),license:true,doi:null},description:abstract,feeNote:p.feeNote};
  return {'paper.md':parts.join('\n\n')+'\n','supplement.md':supplement.join('\n\n')+'\n','cover-letter.md':`Dear Editor,\n\nPlease consider “${escape(s.manuscript.title)}” as a ${s.venue==='research-note'?'research note':'research article'}.\n\n${abstract}\n\n${escape(aiDisclosure(s))}\n\n${escape(contactStatement(s))}\n\nSincerely,\n\n${owner.authors.filter(a=>a.corresponding).map(a=>escape(a.name)).join(', ')}\n`,
    'submission-metadata.json':canonicalJson(metadata)+'\n','zenodo-metadata.json':canonicalJson({metadata:{title:metadata.title,description:abstract,upload_type:'publication',publication_type:'article',creators:owner.authors.map(a=>({name:a.name,affiliation:a.affiliations.join('; ')}))},ownerCompletion:metadata.ownerCompletion})+'\n','osf-metadata.json':canonicalJson({title:metadata.title,description:abstract,category:'project',public:false,paperInputHash:s.input.sha256})+'\n',
    'CITATION.cff':canonicalJson({'cff-version':'1.2.0',message:'Cite this reproducibility package with the accompanying manuscript.',title:s.manuscript.title,type:'dataset',version:s.framework.version,authors:owner.authors.map(a=>({'given-names':a.name.split(' ').slice(0,-1).join(' '),'family-names':a.name.split(' ').at(-1)})),identifiers:[{type:'other',value:s.input.sha256,description:'PaperInput sha256'}]})+'\n',
    'declarations.json':canonicalJson({owner:owner,actions:s.input.ownerDeclarations,ai:s.models})+'\n','contact-statement.txt':contactStatement(s)+'\n','contact-pack.md':`# Author contact draft\n\n${s.manuscript.plainSummary}\n\nDraft PaperInput: ${s.input.contact.draftHash??s.input.sha256}\n\n${table(['Source','Published value','Recomputed value','CSV row'],s.study.discrepancies.map(d=>[d.source,d.published,d.recomputed,d.csvRow]))}\n\n${s.study.contactQuestions.map(q=>`- ${escape(q)}`).join('\n')}\n\nWe invite a reply, to be summarised or quoted with your permission, and offer acknowledgment of your assistance.\n`,
    ...modelCards(s),
    'internal-review.html':`<!doctype html><meta charset="utf-8"><h1>AI-generated review text; numbers and claims in it were not checked; this is internal AI review, not peer review</h1>${s.reproduction.transcripts.map(t=>`<h2>${html(t.name)}</h2><pre>${html(t.text)}</pre>`).join('')}`};
}
