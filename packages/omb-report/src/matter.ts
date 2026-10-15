import {nameKey} from './pw5-names.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { assertContext, type ReportContext } from './context.ts';
import { plain, record, requireThat } from './common.ts';
import { dataSources, lockedSoftware, evidenceInContext, exploratoryCount, count, doi } from './pw5-records.ts';
import { lexicalKey } from './normalise.ts';
import { protect, verifyProtected, type ProtectedRegion } from './limitations.ts';
import { exactKeys, pw5Hash, pw5Text, readPW5Receipt, type PW5Authority, type PW5Receipt } from './pw5-evidence.ts';

export const MATTER_DOMAIN = 'omb-report/matter@1';
export const FIGURE_SENTENCE = 'Figures were drawn by deterministic plotting code from the certified data; no generative image model was used.';
export const ETHICS_SENTENCE = 'Only openly available, de-identified data were analysed; no participants were contacted';
export const AI_STAGES = ['hypothesis', 'design-and-implementation', 'analysis-and-interpretation', 'writing'] as const;
export type AIStage = typeof AI_STAGES[number];
export const GAMER_ITEMS = ['declaration', 'tool-and-version', 'prompting', 'role', 'new-models', 'ai-assisted-sections', 'content-verification', 'data-privacy', 'impact-on-conclusions'] as const;
export type GamerItem = typeof GAMER_ITEMS[number];
export const AI_TIERS = Object.freeze({ A: 'at least 95% human', B: '50–95% human', C: '50–95% AI', D: 'at least 95% AI', N: 'stage not performed in this run' });
export const DEFAULT_CREDIT_ROLES = ['Conceptualization', 'Project administration', 'Supervision', 'Validation', 'Writing – review & editing'] as const;
export type CreditRole = typeof DEFAULT_CREDIT_ROLES[number];
const roleActions: Record<CreditRole, string> = { Conceptualization: 'approved-question', 'Project administration': 'administered-project', Supervision: 'supervised-research', Validation: 'endorsement-review', 'Writing – review & editing': 'wrote-interpretation' };
export interface ModelProvenance { id: string; name: string; version: string; provider: string; roles: string[]; stages: AIStage[]; usedAt: string[]; trainingCutoff: string | null; recallProbe: string }
export interface SoftwareLockEntry { name: string; version: string; ecosystem: string; citation: string; doi: string | null }
export interface AuthorProfile { actor: string; kind: 'human'; name: string; affiliation?: string; email?: string; orcid?: string; contactApproved?: boolean; corresponding?: boolean; roles?: CreditRole[] }
export type OwnerStatement = { state: 'confirmed'; text: string; evidenceHash: string } | { state: 'needs-owner' };
export interface MatterInput {
  authors: AuthorProfile[];
  ownerActions: { actor: string; action: string; at: string; evidenceHash: string }[];
  stages: Record<AIStage, { tier: keyof typeof AI_TIERS; humanRole: string; modelIds: string[] }>;
  gamer: Record<GamerItem, Record<AIStage, string>>;
  grabdrop: { originalitySearch: string; relatedStudies: string; multipleTesting: string; priorSecondaryPapers: OwnerStatement };
  data: { accession: string; release: string; licence: string; sha256: string; accessClass: 'public-deidentified'; source: string }[];
  code: { bundleDoi: string | null; bundleHash: string; rerunCommand: string; openVerifier: string; fetchScriptHash: string };
  funding: OwnerStatement;
  competingInterests: { payments36Months: OwnerStatement; commercialIntent: OwnerStatement };
  ethics: { publicDeidentifiedConfirmed: boolean; noParticipantsContacted: boolean; evidenceHash: string };
}
export interface MatterRegion extends ProtectedRegion { owner: 'software'; heading: string }
export interface MatterDocument { regions: readonly MatterRegion[]; paperHash: string; sha256: string; markdown: string; authorBlock: string; aiUse: string; gamerTable: string; grabdrop: string; frameworkCitation: string; softwareCitations: string[]; contactSlots: { actor: string; email: string; orcid: string }[]; pending: string[]; ready: boolean }
const documents = new WeakMap<MatterDocument, string>();
function docHash(doc: Omit<MatterDocument,'sha256'> | MatterDocument) { const {sha256: _, ...rest} = doc as MatterDocument; return canonicalSha256(rest); }
function date(value: unknown, label: string): asserts value is string {
 pw5Text(value,label);
 requireThat(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/u.test(value), `invalid ${label} shape`);
 requireThat(Number.isFinite(Date.parse(value)), `invalid ${label} value`);
 requireThat(new Date(value).toISOString().slice(0,10) === value.slice(0,10), `invalid ${label} calendar date`);
}
export function provenanceModels(ctx: ReportContext): ModelProvenance[] {
  assertContext(ctx); const raw = record(ctx.input.runMetadata).models;
  requireThat(Array.isArray(raw) && raw.length > 0, 'missing run model provenance');
  const models = structuredClone(raw) as ModelProvenance[];
  requireThat(new Set(models.map(m => m.id)).size === models.length, 'duplicate model provenance ID');
  for (const m of models) {
    for (const key of ['id','name','version','provider','recallProbe'] as const) pw5Text(m[key], `model ${key}`);
    requireThat(Array.isArray(m.roles) && m.roles.length > 0, 'missing model roles'); m.roles.forEach(r => pw5Text(r,'model role'));
    requireThat(Array.isArray(m.stages) && m.stages.length > 0 && new Set(m.stages).size === m.stages.length && m.stages.every(s => AI_STAGES.includes(s)), 'missing or invalid model stages');
    requireThat(Array.isArray(m.usedAt) && m.usedAt.length > 0, 'missing model use dates'); m.usedAt.forEach(d => date(d,'model use date'));
    requireThat(m.trainingCutoff === null || typeof m.trainingCutoff === 'string', 'missing model training cutoff field'); if (m.trainingCutoff !== null) date(m.trainingCutoff,'training cutoff');
  }
  return models;
}
/** Validation seam for structured editorial/model-card assertions. Prose is generated
 * below, never accepted as a source of model identity. Require the complete model set. */
export function validateModelIdentities(ctx: ReportContext, proposed: readonly Pick<ModelProvenance,'id'|'name'|'version'|'provider'>[]): void {
  const models = provenanceModels(ctx);
  requireThat(proposed.length === models.length && new Set(proposed.map(m => m.id)).size === models.length && proposed.every(m => models.some(p => ['id','name','version','provider'].every(k => m[k as keyof typeof m] === p[k as keyof typeof m]))), 'model identity absent from provenance or disclosure incomplete');
}
function identity(model: ModelProvenance) { return `${model.name} ${model.version} (${model.provider}; ${model.id})`; }
export function buildMatter(ctx: ReportContext, envelope: PW5Receipt<MatterInput>, verify: PW5Authority): MatterDocument {
  const input = readPW5Receipt(ctx,envelope,MATTER_DOMAIN,verify), models = provenanceModels(ctx), pending: string[] = [];
  const owner = record(ctx.input.ownerConfiguration);
  const derived=deriveMatterInput(ctx);
  exactKeys(input,Object.keys(derived),'matter input field');
  pw5Text(owner.ownerActor,'host-receipted owner actor');
  requireThat(Array.isArray(owner.actors) && owner.actors.includes(owner.ownerActor), 'missing owner configuration actors');
  requireThat(Array.isArray(input.authors) && input.authors.length > 0 && new Set(input.authors.map(a => a.actor)).size === input.authors.length, 'missing or duplicate author');
  requireThat(input.authors.some(a => a.actor === owner.ownerActor && a.name === 'Ethan Ashihundu'), 'designated owner missing from author block');
  requireThat(new Set(input.authors.map(a=>nameKey(a.name))).size === input.authors.length,'duplicate author name');
  const actors = owner.actors;
  requireThat(canonicalSha256(input.authors) === canonicalSha256(derived.authors),'author profiles differ from host owner allow-list');
  requireThat(canonicalSha256(input.ownerActions) === canonicalSha256(derived.ownerActions),'owner actions differ from host records');
  const contributions: string[] = [], contacts: MatterDocument['contactSlots'] = [];
  for (const action of input.ownerActions) { date(action.at,'owner action date'); pw5Hash(action.evidenceHash,'owner action evidence'); evidenceInContext(ctx,action.evidenceHash); requireThat(owner.actors.includes(action.actor),'unauthorized action actor'); }
  const authors = input.authors.map(a => {
    pw5Text(a.name,'author name');
    requireThat(a.kind === 'human' && actors.includes(a.actor), 'AI or unauthorized author');
    if(a.affiliation !== undefined) pw5Text(a.affiliation,'affiliation');
    const email = a.email ?? '', orcid = a.orcid ?? '';
    requireThat(!email || a.contactApproved === true && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email), 'email requires explicit submission approval');
    requireThat(!orcid || /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/u.test(orcid), 'invalid ORCID shape');
    contacts.push({actor:a.actor,email,orcid});
    const roles = a.roles ?? [...DEFAULT_CREDIT_ROLES];
    requireThat(roles.length > 0 && new Set(roles).size === roles.length && roles.every(r => Object.hasOwn(roleActions,r)), 'unknown or duplicate CRediT role');
    const supported = roles.filter(role => input.ownerActions.some(action => action.actor === a.actor && action.action === roleActions[role]));
    for (const role of roles.filter(r => !supported.includes(r))) pending.push(`CRediT:${a.actor}:${role}`);
    contributions.push(`${a.name}: ${supported.length ? supported.join('; ') : 'contributions awaiting owner evidence'}`);
    return `${a.name}${(a.corresponding ?? a.actor === owner.ownerActor) ? ' (corresponding author)' : ''} — ${a.affiliation ?? 'Independent researcher'}`;
  });
  exactKeys(input.stages,AI_STAGES,'AI stage'); exactKeys(input.gamer,GAMER_ITEMS,'GAMER item');
  for (const item of GAMER_ITEMS) { exactKeys(input.gamer[item],AI_STAGES,'GAMER stage cell'); for (const stage of AI_STAGES) pw5Text(input.gamer[item][stage],`${item}/${stage}`); }
  for (const stage of AI_STAGES) {
    const cell = input.stages[stage]; requireThat(Object.hasOwn(AI_TIERS,cell.tier),'unknown AI tier'); pw5Text(cell.humanRole,'human role');
    const expected = models.filter(m => m.stages.includes(stage)).map(m => m.id).sort();
    requireThat(cell.tier!=='N'||expected.length===0&&cell.humanRole==='No human activity recorded','unperformed stage contains recorded activity');
    requireThat(Array.isArray(cell.modelIds) && canonicalSha256([...cell.modelIds].sort()) === canonicalSha256(expected), 'stage model list differs from provenance');
  }
  requireThat(canonicalSha256(input.gamer) === canonicalSha256(derived.gamer),'GAMER cells differ from provenance templates');
  requireThat(canonicalSha256(input.stages) === canonicalSha256(derived.stages),'AI stages differ from provenance templates');
  const aiUse = `Omerta Bio used ${models.map(m => `${identity(m)} for ${m.roles.join(', ')}`).join('; ')}. AI review rounds were not peer review. See the Methods GAMER table for stage-specific use and human roles.`;
  const gamerRows = GAMER_ITEMS.map(item => {
    const cells = AI_STAGES.map(stage => {
      const selected = models.filter(m => m.stages.includes(stage));
      if (item === 'tool-and-version') return selected.length ? selected.map(identity).join('; ') : 'No AI system recorded for this stage';
      if (item === 'declaration') return `Omerta Bio; ${input.gamer[item][stage]}`;
      if (item === 'role') return [...selected.map(m => `${identity(m)}: ${m.roles.join(', ')}`), `human: ${input.stages[stage].humanRole}`].join('; ');
      return input.gamer[item][stage];
    }); return `| ${item} | ${cells.map(plain).join(' | ')} |`;
  });
  const gamerTable = `| GAMER item | ${AI_STAGES.join(' | ')} |\n| --- | --- | --- | --- | --- |\n| Contribution tier | ${AI_STAGES.map(s => plain(`${input.stages[s].tier}: ${AI_TIERS[input.stages[s].tier]}`)).join(' | ')} |\n${gamerRows.join('\n')}`;
  const publication = record(ctx.input.runMetadata).originalPublicationDate;
  if(publication !== undefined && publication !== null) date(publication,'original publication date');
  const modelDetails = models.map(m => `${identity(m)}; used: ${m.usedAt.join(', ')}; training cutoff: ${m.trainingCutoff ?? 'unavailable'}; cutoff after original publication: ${!publication || !m.trainingCutoff ? 'unknown' : Date.parse(m.trainingCutoff) > Date.parse(String(publication)) ? 'yes' : 'no'}; recall probe: ${m.recallProbe}`);
  function statement(s: OwnerStatement, key: string): string {
    requireThat(s && typeof s === 'object','missing owner statement');
    if(s.state === 'needs-owner') { exactKeys(s,['state'],'owner pending field'); pending.push(key); return 'Awaiting owner confirmation'; }
    requireThat(s.state === 'confirmed','unknown owner statement state'); exactKeys(s,['state','text','evidenceHash'],'owner statement field'); pw5Text(s.text,key); pw5Hash(s.evidenceHash,key); return s.text;
  }
  const g = input.grabdrop;
  for(const key of ['originalitySearch','relatedStudies','multipleTesting'] as const) pw5Text(g[key],`GRABDROP ${key}`);
  requireThat(!/\b(?:first|novel|unprecedented|priority)\b/iu.test(lexicalKey(g.originalitySearch)),'GRABDROP originality requires search evidence, not a priority claim');
  requireThat(canonicalSha256(g) === canonicalSha256(derived.grabdrop),'GRABDROP differs from recorded evidence');
  const grabdrop = [['Originality search',g.originalitySearch],['Related studies on the same data',g.relatedStudies],['Multiple testing',g.multipleTesting],['AI use',aiUse],['Prior secondary-analysis papers in the last three years',statement(g.priorSecondaryPapers,'GRABDROP prior papers')]].map(([k,v]) => `${k}: ${plain(v!)}`).join('\n\n');
  const framework = record(record(ctx.input.runMetadata).framework);
  for(const key of ['version','commit','year'] as const) pw5Text(framework[key],`framework ${key}`);
  requireThat(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(String(framework.commit)) && /^\d{4}$/u.test(String(framework.year)), 'invalid framework commit/year');
  requireThat(framework.doi === null || typeof framework.doi === 'string' && /^10\.\d{4,9}\/[^\s]+$/u.test(framework.doi), 'framework DOI slot required');
  const frameworkCitation = `Ashihundu E. Omerta Bio (version ${framework.version}; commit ${framework.commit}) [software]. ${framework.doi ? `Zenodo; ${framework.year}. doi:${framework.doi}` : `${framework.year}. DOI pending release; see this paper's reproducibility package (${input.code.bundleHash}).`}`;
  const softwareCitations = lockedSoftware(ctx).map(p=>`${p.name} (version ${p.version}; ${p.ecosystem}) [software]${p.doi ? `. doi:${p.doi}` : ''}`);
  requireThat(Array.isArray(input.data) && input.data.length > 0,'missing data availability');
  const dataLines = derived.data.map(d => `${d.source}: ${d.accession}; release ${d.release}; ${d.licence}; SHA-256 ${d.sha256}; ${d.accessClass}`);
  requireThat(canonicalSha256(input.data) === canonicalSha256(derived.data),'data availability differs from stager manifests');
  requireThat(canonicalSha256(input.code) === canonicalSha256(derived.code),'code availability differs from run provenance');
  pw5Hash(input.code.bundleHash,'bundle hash'); pw5Hash(input.code.fetchScriptHash,'fetch script hash'); pw5Text(input.code.rerunCommand,'rerun command'); pw5Text(input.code.openVerifier,'open verifier availability');
  if(input.code.bundleDoi === null) pending.push('bundle DOI');
  const funding = statement(input.funding,'funding');
  const interests = `Payments in the last 36 months: ${statement(input.competingInterests.payments36Months,'payments')}. Omerta Bio commercial intent: ${statement(input.competingInterests.commercialIntent,'commercial intent')}.`;
  requireThat(input.ethics.publicDeidentifiedConfirmed === true && input.ethics.noParticipantsContacted === true,'public-data ethics confirmation required'); pw5Hash(input.ethics.evidenceHash,'ethics evidence');
  requireThat(canonicalSha256(input.funding) === canonicalSha256(derived.funding) && canonicalSha256(input.competingInterests) === canonicalSha256(derived.competingInterests),'owner statements differ from typed owner records');
  requireThat(canonicalSha256(input.ethics) === canonicalSha256(derived.ethics),'ethics differs from provenance');
  evidenceInContext(ctx,input.ethics.evidenceHash);
  const acknowledgments = `The author acknowledges ${models.map(identity).join('; ')} for assistance through Omerta Bio. AI systems are not authors; their recorded roles and exact model identities are disclosed in Methods.`;
  const figures = record(record(ctx.input.runMetadata).figures);
  requireThat(figures.deterministicCode === true && figures.certifiedData === true && figures.generativeImageModelUsed === false,'figure provenance cannot support fixed sentence');
  const checking = record(record(ctx.input.runMetadata).numberVerification);
  const expectedCerts = [...new Set(ctx.claims.map(c => c.certHash))].sort();
  requireThat(checking.producedBy === 'deterministic-software' && checking.checkedBy === 'deterministic-software' && checking.status === 'passed' && Array.isArray(checking.certificateHashes) && canonicalSha256([...checking.certificateHashes].sort()) === canonicalSha256(expectedCerts),'number verification evidence unavailable');
  const checkingText = 'Every reported number was produced and checked by deterministic software. Author endorsement is pending.';
  const authorBlock = authors.map(plain).join('\n');
  const sections: [string,string][] = [['Authors',authorBlock],['AI use in Methods',plain(aiUse)+'\n\n'+gamerTable+'\n\n'+modelDetails.map(plain).join('\n\n')+'\n\n'+checkingText],['Figures',FIGURE_SENTENCE],['GRABDROP',grabdrop],['Data availability',dataLines.map(plain).join('\n\n')],['Code availability',plain(`Bundle DOI: ${input.code.bundleDoi ?? 'pending'}; SHA-256 ${input.code.bundleHash}; rerun: ${input.code.rerunCommand}; open verifier: ${input.code.openVerifier}; fetch script SHA-256 ${input.code.fetchScriptHash}`)],['AI-use disclosure',plain(aiUse)],['Acknowledgments',plain(acknowledgments)],['Author contributions (CRediT)',contributions.map(plain).join('\n\n')],['Competing interests',plain(interests)],['Funding',plain(funding)],['Ethics statement',ETHICS_SENTENCE],['Research scope','Research use only; not a clinical recommendation'],['Software references',[frameworkCitation,...softwareCitations].map(plain).join('\n\n')]];
  const regions: MatterRegion[] = sections.map(([heading,text],i) => ({...protect(`pw5-matter-${i}`,text), heading, owner:'software'}));
  const base: Omit<MatterDocument,'sha256'> = { regions, paperHash: ctx.input.sha256, markdown: sections.map(([h,t]) => `## ${h}\n\n${t}`).join('\n\n'), authorBlock, aiUse, gamerTable, grabdrop, frameworkCitation, softwareCitations, contactSlots: contacts, pending, ready: pending.length === 0 };
  const doc = {...base,sha256:docHash(base)}; documents.set(doc,doc.sha256); return doc;
}
export function assertMatter(ctx: ReportContext, doc: MatterDocument): void { assertContext(ctx); requireThat(doc.paperHash === ctx.input.sha256 && documents.get(doc) === doc.sha256 && docHash(doc) === doc.sha256,'matter changed, foreign or not software-built'); }
/** Endorsement covers this exact rendered PW5 document, not merely the plan.
 * The whole-manuscript publication lock remains the packager's responsibility. */
export function endorseMatter(ctx: ReportContext, doc: MatterDocument, envelope: PW5Receipt<{documentHash:string;actor:string;action:'endorsed'}>, verify: PW5Authority): string {
  assertMatter(ctx,doc); requireThat(doc.ready,'unresolved matter slots');
  const approval = readPW5Receipt(ctx,envelope,'omb-report/matter-endorsement@1',verify);
  requireThat(approval.documentHash === doc.sha256 && approval.actor === record(ctx.input.ownerConfiguration).ownerActor && approval.action === 'endorsed','endorsement does not cover rendered matter');
  return doc.markdown.replace('Author endorsement is pending.','The author endorsed this document.');
}
export function coverLetterAIStatement(ctx: ReportContext, doc: MatterDocument): string { assertMatter(ctx,doc); return doc.aiUse; }

/** The packager carries these regions as software output, never through free prose.
 * Compare edited/converter output against the sealed, receipted document. */
export function verifyMatterRegions(ctx: ReportContext, doc: MatterDocument, actual: readonly MatterRegion[]): void {
  assertMatter(ctx,doc); verifyProtected(doc.regions,actual);
  requireThat(actual.every(r => r.owner === 'software' && doc.regions.some(e => e.id === r.id && e.heading === r.heading)), 'matter region ownership or heading changed');
}

/** Record-only projection. Callers may select/render these values but cannot supply
 * factual sentences. Exact equality below also detects stale editorial input. */
export function deriveMatterInput(ctx:ReportContext):MatterInput {
 assertContext(ctx);const owner=record(ctx.input.ownerConfiguration),run=record(ctx.input.runMetadata),usage=record(run.aiUse),models=provenanceModels(ctx);
 requireThat(Array.isArray(owner.authors)&&owner.authors.length>0,'missing host owner author profiles');
 requireThat(Array.isArray(owner.actions),'missing host owner actions');
 const authors=structuredClone(owner.authors) as AuthorProfile[],ownerActions=structuredClone(owner.actions) as MatterInput['ownerActions'];
 requireThat(authors.every(a=>a.kind==='human'),'host author profile must be human');
 exactKeys(usage, ['stages','prompting','newModels','contentVerification','dataPrivacy','impactOnConclusions'],'run AI-use field');
 requireThat(usage.prompting==='logged-prompts','missing prompt provenance');
 requireThat(typeof usage.newModels==='boolean','missing new-model provenance');
 requireThat(usage.contentVerification==='deterministic-software','missing AI content verification');
 requireThat(usage.dataPrivacy==='public-deidentified','missing AI privacy provenance');
 requireThat(usage.impactOnConclusions==='locked-decision-rule','missing AI conclusion provenance');
 const rawStages=record(usage.stages);exactKeys(rawStages,AI_STAGES,'provenance AI stage');
 const stages=Object.fromEntries(AI_STAGES.map(stage=>{
  const value=record(rawStages[stage]);exactKeys(value,['tier','humanRole'],'provenance stage field');
  requireThat(typeof value.tier==='string'&&Object.hasOwn(AI_TIERS,value.tier),'unknown AI tier');
  requireThat(value.humanRole==='owner-review'||value.humanRole==='none','unknown human role template');
  requireThat(value.tier!=='N'||value.humanRole==='none'&&!models.some(m=>m.stages.includes(stage)),'unperformed stage contains recorded activity');
  return [stage,{tier:value.tier,humanRole:value.humanRole==='owner-review'?'Owner reviewed the recorded output':'No human activity recorded',modelIds:models.filter(m=>m.stages.includes(stage)).map(m=>m.id)}];
 })) as MatterInput['stages'];
 const texts:Record<GamerItem,string>={declaration:'AI use is recorded by stage','tool-and-version':'Generated from run model identities',prompting:'Prompts are retained in the run log',role:'Generated from run roles','new-models':usage.newModels?'New models were developed in this run':'No new models were developed in this run','ai-assisted-sections':'Assisted sections follow the recorded stages','content-verification':'Content was checked by deterministic software','data-privacy':'Only public de-identified data were used','impact-on-conclusions':'The locked decision rule determines conclusions'};
 const gamer=Object.fromEntries(GAMER_ITEMS.map(item=>[item,Object.fromEntries(AI_STAGES.map(stage=>[stage,texts[item]]))])) as MatterInput['gamer'];
 const declarations=record(owner.declarations);
 function statement(key:string,choices:Record<string,string>):OwnerStatement {
  const d=record(declarations[key]);
  if(d.state==='needs-owner'){exactKeys(d,['state'],'owner pending field');return {state:'needs-owner'};}
  exactKeys(d,['state','value','evidenceHash'],'typed owner statement field');
  requireThat(d.state==='confirmed'&&typeof d.value==='string'&&Object.hasOwn(choices,d.value),'unknown typed owner statement');
  evidenceInContext(ctx,String(d.evidenceHash));return {state:'confirmed',text:choices[String(d.value)]!,evidenceHash:String(d.evidenceHash)};
 }
 const literature=record(ctx.input.frozenLiteratureIndex);requireThat(Array.isArray(literature.relatedStudyKeys),'missing related-study index');
 requireThat(literature.relatedStudyKeys.every(k=>ctx.quotes.some(q=>q.key===k&&q.status==='fulltext-verified')),'unverified related study');
 const exploratory=exploratoryCount(ctx);
 const grabdrop={originalitySearch:`Frozen literature index searched: ${canonicalSha256(ctx.input.frozenLiteratureIndex)}`,relatedStudies:literature.relatedStudyKeys.length ? `Frozen related-study keys: ${literature.relatedStudyKeys.join(', ')}` : 'No related studies recorded in the frozen index',multipleTesting:`Locked families: ${canonicalSha256(ctx.input.lockedPlan.families)}; recorded exploratory analyses: ${exploratory}`,priorSecondaryPapers:statement('priorSecondaryPapers',{none:'No prior secondary-analysis papers declared in the last three years'})};
 const data=dataSources(ctx), code=structuredClone(record(run.codeAvailability)) as unknown as MatterInput['code'];
 exactKeys(code,['bundleDoi','bundleHash','rerunCommand','openVerifier','fetchScriptHash'],'code availability field');
 doi(code.bundleDoi,'bundle');
 const ethicsRecord=record(run.ethics);exactKeys(ethicsRecord,['noParticipantsContacted','evidenceHash'],'ethics record field');
 requireThat(ethicsRecord.noParticipantsContacted===true,'public-data ethics confirmation required');evidenceInContext(ctx,String(ethicsRecord.evidenceHash));
 return {authors,ownerActions,stages,gamer,grabdrop,data,code,
  funding:statement('funding',{none:'No funding was received'}),competingInterests:{payments36Months:statement('payments36Months',{none:'No payments declared in the last 36 months'}),commercialIntent:statement('commercialIntent',{none:'No commercial intent declared',possible:'Potential commercial development of Omerta Bio is declared'})},
  ethics:{publicDeidentifiedConfirmed:true,noParticipantsContacted:true,evidenceHash:String(ethicsRecord.evidenceHash)}};
}
/** Author/model declarations live only in protected generated regions. This guard
 * runs on the draft before entity replacement, so aliases cannot launder a claim. */
export {assessAIProse as checkMatterNarrative} from './ai-prose.ts';

/** Host integration schema; these records belong in authenticated PaperInput,
 * never in the drafter's request. Unsupported declarations remain needs-owner. */
export interface PW5OwnerFields {
 ownerActor:string; actors:string[]; authors:AuthorProfile[]; actions:MatterInput['ownerActions'];
 declarations: Record<'priorSecondaryPapers'|'funding'|'payments36Months'|'commercialIntent',
  {state:'needs-owner'} | {state:'confirmed';value:'none'|'possible';evidenceHash:string}>;
}
export interface PW5MatterRunFields {
 models:ModelProvenance[];
 aiUse:{stages:Record<AIStage,{tier:keyof typeof AI_TIERS;humanRole:'owner-review'|'none'}>;prompting:'logged-prompts';newModels:boolean;contentVerification:'deterministic-software';dataPrivacy:'public-deidentified';impactOnConclusions:'locked-decision-rule'};
 exploratoryAnalysisCount:number; codeAvailability:MatterInput['code'];
 ethics:{noParticipantsContacted:boolean;evidenceHash:string};
}
