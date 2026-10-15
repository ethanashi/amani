import { outputProfile } from './output-profiles.ts';
import { canonicalPaperInput, validateContactRecord } from '../../omb-paper/src/index.ts';
import { assert, canonicalSha256, sha256, submissionHash, utc } from './common.ts';
import { locateDisplays } from './displays.ts';
import { checkProvenance } from './provenance.ts';
import { requiredChecklists, STUDY_PIECES, venueProfile } from './profiles.ts';
import type { GateResult, HostAuthority, PackageRequest, Submission, VenueProfile } from './types.ts';

export function lintText(text: string, identifiers: readonly string[] = []): void {
  // Scan escaped HTML as text too: escaping prevents execution, not disclosure.
  for(let i=0;i<3;i++) text=text.replace(/&(?:lt|gt|quot|apos|amp|#(?:x[0-9a-f]+|[0-9]+));/gi,entity=>{
    const named:Record<string,string>={'&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&amp;':'&'};
    if(named[entity.toLowerCase()])return named[entity.toLowerCase()]!;
    const n=entity.slice(2,-1),code=parseInt(n[0]?.toLowerCase()==='x'?n.slice(1):n,n[0]?.toLowerCase()==='x'?16:10);
    return code<=0x10ffff?String.fromCodePoint(code):entity;
  });
  assert(!/(?:^|[^\p{L}\p{N}:])(?:\/(?:Users|home|private|tmp|var|etc|Volumes)\/|~\/|[A-Z]:[\\/])/imu.test(text), 'absolute/local filesystem path in bundled artifact');
  assert(!/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{20,})\b|\b(?:api[_ -]?key|access[_ -]?token|password|secret)["']?\s*[:=]\s*["']?[^\s"',;}{]{8,}/i.test(text), 'secret/credential in bundled artifact');
  assert(!/\[(?:unverified number|unavailable metric:|ambiguous metric:)|\[[a-z]+:[^\]]*\]/i.test(text), 'unresolved placeholder / render error marker');
  assert(!/\b(?:as an AI|certainly|TODO|TBD|lorem ipsum)\b/i.test(text), 'leftover AI text');
  assert(!/[\p{Cf}]/u.test(text), 'hidden Unicode format character');
  assert(!/<(?:script|iframe|object|embed|input|style)\b|\bon\w+\s*=|javascript:|data:text\/html/i.test(text), 'active or hidden markup');
  assert(!/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)|font-size\s*:\s*(?:[0-6](?:\.\d+)?)(?:px|pt)|\bhidden\s*(?:=|>)|w:(?:vanish|webHidden|commentRangeStart|commentReference)\b/i.test(text), 'hidden/tiny text or DOCX comments');
  assert(!/ignore (?:all |previous |the )?instructions|(?:reviewer|editor)[ -]directed instructions/i.test(text), 'reviewer-directed instruction');
  assert(!/\b(?:patient_id|subject_id|sample_id|donor_id|date_of_birth|social.security.number)\b/i.test(text), 'identifying column in public artifact');
  for (const id of identifiers) assert(!id || !text.includes(id), 'per-sample identifier in public artifact');
}
export function words(text: string): number { return (text.replace(/<[^>]*>/g,' ').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length; }
export function checkCaps(s: Submission, p: VenueProfile, completeMainText?: string): void {
  const m=s.manuscript;
  // A separate display-text budget prevents prose moving out of capped sections.
  for(const display of m.displays) assert(words(display.caption)<=p.caps.caption,`${display.id} caption word cap exceeded`);
  const displayText=m.displays.filter(x=>x.placement==='main').map(x=>`${x.title} ${x.caption} ${x.markdown??''}`).join('\n');
  assert(words(displayText)<=p.caps.captions,'combined caption/display-text word cap exceeded');
  const abstract=Object.values(m.abstract).join(' ');
  assert(words(abstract)<=p.caps.abstract,'abstract word cap exceeded');
  assert(words(m.plainSummary)<=p.caps.plainSummary,'plain summary word cap exceeded');
  assert(words(m.authorSummary??'')<=p.caps.authorSummary,'author summary word cap exceeded');
  const body=[abstract,m.plainSummary,m.authorSummary??'',...m.sections.map(x=>x.markdown),...m.displays.filter(x=>x.placement==='main').map(x=>`${x.title} ${x.caption} ${x.markdown??''}`)].join('\n');
  assert(words(completeMainText??body)<=p.caps.total,'total word cap exceeded');
  for(const section of m.sections) assert(words(section.markdown)<=(p.caps.sections[section.id]??p.caps.total),`${section.id} word cap exceeded`);
  assert(m.displays.filter(x=>x.placement==='main').length<=p.caps.displays,'display-item cap exceeded');
  assert(new Set(m.references.map(x=>String(x.cslJson.id))).size<=p.caps.references,'reference cap exceeded');
}
/** Count generated declarations and end-placed displays as well as source prose. */
export function checkRenderedCaps(s:Submission,p:VenueProfile,paper:string):void {
  checkCaps(s,p,paper.replace(/::: \{\.title-page[^}]*\}[\s\S]*?:::/,'').replace(/# References \{#references[^}]*\}\s*::: \{#refs\}\s*:::/,''));
}
const equalSet=(a:readonly string[],b:readonly string[]):boolean=>a.length===new Set(a).size&&b.length===new Set(b).size&&canonicalSha256([...a].sort())===canonicalSha256([...b].sort());
function contactGate(s:Submission, now:number):void {
  const c=validateContactRecord(s.input.contact);
  const metadata=s.input.runMetadata as Record<string,unknown>;
  const claims=(s.input.lockedPlan.claims??[]) as {kind:string}[];
  const triggered=c.required || s.study.reanalysisOfOthersData || s.study.differingNumbers || s.study.pipelineReuse || s.study.kinds.some(k=>['data-integrity','reproduction'].includes(k)) || claims.some(k=>['data-integrity','reproduction'].includes(k.kind)) || ['reanalysisOfOthersData','differingNumbers','pipelineReuse'].some(k=>metadata[k]===true);
  if(!triggered)return;
  assert(c.required,'contact required by study, regardless of supplied flag');
  assert(c.status==='replied'||c.status==='no-reply','contact log with reply or completed wait required');
  assert(c.contacts?.length && c.draftHash,'contact log missing');
  assert(s.study.contactNames.length>0,'contact recipient inventory missing');
  assert(equalSet(c.contacts.map(x=>x.name),s.study.contactNames),'contact log omits an implicated author/group');
  assert(s.study.contactQuestions.length>=2&&s.study.contactQuestions.length<=4,'contact pack needs two to four questions');
  for(const entry of c.contacts){
    assert(entry.paperInputHash===c.draftHash,'contact version mismatch');
    assert(utc(entry.date)<=now,'contact date is in the future');
    if(c.status==='replied') assert(entry.reply?.trim(),'contact reply missing');
    else assert(entry.waitEnd && utc(entry.waitEnd)<=now && utc(entry.waitEnd)>=utc(entry.date)+(c.waitDays??21)*86400000,'contact wait has not ended');
  }
  assert(s.input.ownerDeclarations.some(a=>a.action==='contacted-authors'&&a.evidence),'contact action evidence missing');
}
export function checkGates(request:PackageRequest, authority:HostAuthority, now:number=Date.now()):GateResult[] {
  const {submission:s,endorsement,review,policy}=request, p=venueProfile(s.venue), hash=submissionHash(s);
  canonicalPaperInput(s.input);
  const output=outputProfile(s,p);
  const gates:GateResult[]=[];
  const passed=(id:string,evidence:unknown)=>gates.push({id,outcome:'passed',evidenceHash:canonicalSha256(evidence)});
  assert(authority.verify(s.owner),'owner configuration receipt invalid');
  const owner=s.owner.record;
  assert(owner.schema==='omb/package-owner@1' && owner.lineageId===s.input.lineageId && owner.ownerActor===s.input.ownerConfiguration?.ownerActor,'owner configuration differs from PaperInput');
  assert(owner.authors.length>0 && owner.authors.some(a=>a.actor===owner.ownerActor&&a.name==='Ethan Ashihundu'),'owner author missing');
  assert(owner.authors.some(a=>a.corresponding),'corresponding author missing');
  assert(new Set(owner.authors.map(a=>a.actor)).size===owner.authors.length,'duplicate authors');
  for(const a of owner.authors){
    assert(a.name.trim()&&a.affiliations.length&&a.affiliations.every(x=>x.trim()),'author affiliation required');
    assert(!/\b(?:AI|Claude|ChatGPT|Codex|GPT)\b/i.test(a.name),'AI cannot be an author');
    assert(!a.email || a.emailApprovedForSubmission===true,'owner email requires explicit submission consent');
    for(const c of a.contributions)assert(s.input.ownerDeclarations.some(x=>x.actor===a.actor&&x.action===c.action),'CRediT role lacks recorded action');
  }
  assert(s.input.paperStatus==='owner-approved','plan was not owner-approved');
  for(const action of ['approved-question','approved-plan','reran-analysis','wrote-interpretation','comprehension-check'])assert(s.input.ownerDeclarations.some(a=>a.actor===owner.ownerActor&&a.action===action&&(action.startsWith('approved-')||a.evidence)) ,`missing human-check record: ${action}`);
  passed('owner',s.owner);
  assert(authority.verify(review) && review.record.schema==='omb/package-review@1','final review receipt invalid');
  assert(review.record.paperInputHash===s.input.sha256&&review.record.submissionHash===hash&&review.record.finalDiffReviewed&&review.record.openMajorIssues===0,'owner edit with no final diff review or major issues');
  assert(authority.verify(endorsement)&&endorsement.record.schema==='omb/package-endorsement@1'&&endorsement.record.state==='endorsed','missing authenticated endorsed lock');
  assert(endorsement.record.actor===owner.ownerActor&&endorsement.record.paperInputHash===s.input.sha256&&endorsement.record.submissionHash===hash&&endorsement.record.reviewHash===canonicalSha256(review),'endorsement does not bind this exact PaperInput / submission / review');
  assert(utc(endorsement.record.at)>=utc(review.record.at)&&utc(endorsement.record.at)<=now,'endorsement must follow final diff review');
  passed('endorsed',endorsement);passed('final-diff-review',review);
  contactGate(s,now);passed('contact',s.input.contact);
  assert(equalSet(s.manuscript.certificationIds,s.input.certifications.map(x=>x.id))&&equalSet(s.manuscript.claimIds,s.input.plannedFound.found.map(x=>x.claimId).filter((v,i,a)=>a.indexOf(v)===i))&&!s.input.plannedFound.missingClaimIds.length,'lineage coverage incomplete');
  passed('lineage',s.manuscript.certificationIds);
  assert(s.study.targets.length===1,'exactly one posting target required');
  const target=s.study.targets[0]!;
  assert(!/frontiers/i.test(target),'Frontiers excluded');
  if(s.venue==='preprint') assert(target===(s.study.humanHealth?'medRxiv':'bioRxiv'),'wrong preprint server');
  if(s.venue==='plos-one')assert(target==='PLOS ONE','target/profile mismatch');
  if(s.venue==='research-note')assert(target==='research-note','short format is a local template, target policy requires a specific future profile');
  assert(s.study.access==='public'&&s.study.publicDataOnly,'controlled-access data blocked');
  assert(!(s.study.datasetCount===1&&s.study.entityPairCount===1&&!s.study.independentValidation),'formulaic public-data genre');
  assert(!(s.venue==='preprint'&&s.study.rung>=3),'rung 3/4 dossier requires a separately reviewed target-prioritisation profile');
  if(s.study.kinds.includes('causal-genetic')){
    assert(s.study.independentValidation,'lone two-sample MR estimate');
    if(s.venue==='plos-one') assert(s.input.plannedFound.found.filter(x=>x.status!=='voided').every(x=>x.status==='replicated')&&s.study.literatureSearchPresent,'PLOS ONE MR requires replicated label and literature search');
  }
  passed('genre-and-privacy',s.study);
  assert(authority.verify(policy)&&policy.record.schema==='omb/package-policy@1','policy receipt invalid');
  assert(policy.record.paperInputHash===s.input.sha256&&policy.record.profileHash===canonicalSha256(p),'policy receipt binding mismatch');
  const checked=utc(policy.record.checkedAt);
  assert(checked<=now&&new Date(checked).toISOString().slice(0,10)===new Date(now).toISOString().slice(0,10),'policies must be rechecked at packaging time');
  assert(equalSet(policy.record.results.map(x=>x.id),p.policies.map(x=>x.id)),'policy receipt inventory incomplete');
  for(const rule of p.policies){const r=policy.record.results.find(x=>x.id===rule.id)!;assert(r.url===rule.url&&r.quote.trim()&&/^[a-f0-9]{64}$/.test(r.sourceSha256)&&r.allowsUse,`editorial / generative-AI policy blocks: ${rule.id}`);}
  passed('editorial-and-ai-policy',policy);
  for(const heading of p.abstractHeadings)assert(s.manuscript.abstract[heading]?.trim(),`structured abstract missing ${heading}`);
  for(const id of ['introduction','methods','results','verification','discussion','limitations','data-code']) assert(s.manuscript.sections.some(x=>x.id===id&&x.markdown.trim()),`required section missing: ${id}`);
  for(const piece of s.study.kinds.flatMap(k=>STUDY_PIECES[k]??[]))assert([...s.manuscript.sections,...s.manuscript.supplement].some(x=>x.id===piece&&x.markdown.trim()),`study variant missing: ${piece}`);
  assert(s.manuscript.displays.some(x=>x.id==='summary-of-findings'&&x.kind==='table'&&x.placement==='main'),'Summary of findings required even in short format');
  assert(s.manuscript.displays.some(x=>x.kind==='figure'&&x.id==='study-design'),'Figure 1 study design missing');
  if(p.summaryLayers.includes('Author Summary'))assert(s.manuscript.authorSummary?.trim(),'PLOS Author Summary missing');
  for(const name of requiredChecklists(p,s.study.kinds)){
    const checklist=s.manuscript.checklists.find(c=>c.name===name);
    assert(checklist?.items.length&&checklist.attribution,`missing checklist: ${name}`);
    for(const item of checklist.items){assert(item.id&&item.text&&['software','llm','not-applicable','not-available-in-source-data'].includes(item.status),'missing checklist slot');assert(item.status==='not-applicable'?item.reason?.trim():item.status==='not-available-in-source-data'||(item.anchor&&item.excerpt),'missing checklist anchor/excerpt');}
  }
  passed('structure-and-checklists',s.manuscript.checklists);
  checkCaps(s,p);passed('caps',p.caps);passed('output-profile',output);
  const locations=locateDisplays(s.manuscript);passed('display-citations',locations.map(({display,...location})=>({id:display.id,...location})));
  checkProvenance(s);
  assert(s.models.length>0,'AI provenance model cards missing');
  for(const m of s.models)assert(m.modelId&&m.version&&m.provider&&m.system&&m.stage&&m.date&&m.software&&m.humanRole&&m.recallProbe&&/^[a-f0-9]{64}$/.test(m.sourceHash),'incomplete journaled AI provenance');
  const publicText=JSON.stringify({manuscript:s.manuscript,owner:owner,models:s.models});
  lintText(publicText,s.study.perSampleIdentifiers);
  for(const transcript of s.reproduction.transcripts)lintText(`${transcript.name}\n${transcript.text}`,s.study.perSampleIdentifiers);
  passed('text-lints',sha256(publicText+JSON.stringify(s.reproduction.transcripts)));
  assert(canonicalSha256(s.manuscript.numericInventory)===canonicalSha256(s.reproduction.expected)&&Object.keys(s.reproduction.expected).length>0,'reproduction omits manuscript numbers');
  passed('number-coverage',s.reproduction.expected);
  return gates;
}
