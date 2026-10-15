import {checklistEvidence,checklistKeywordHint,type ChecklistProducers} from './checklist-evidence.ts';
import {lexicalKey} from './normalise.ts';
import { readFileSync } from 'node:fs';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { plain, record, requireThat } from './common.ts';
import { type ReportContext, assertContext } from './context.ts';
import { assertOwnerActor, exactKeys, pw5Text, readPW5Receipt, type PW5Receipt, type PW5Authority } from './pw5-evidence.ts';

export const CLINICAL_RESEARCH_TEXT = 'Research use only; no clinical role or implementation is proposed';
export const CHECKLIST_NAMES = ['STROBE', 'STROBE-MR', 'TRIPOD+AI', 'CONSORT', 'PRISMA', 'PRISMA-Abstracts', 'PRISMA-Harms', 'ReSEEM', 'REMARK'] as const;
export type ChecklistName = typeof CHECKLIST_NAMES[number];
export interface ChecklistItem { id: string; prompt: string; clinical: boolean; allowedNA: boolean; requiredKeywords: readonly string[]; evidenceGroup: string; section?: string }
export interface ReportingChecklist { name: ChecklistName; version: string; attribution: string; source: string; wording: 'original-prompts'; publishedDate?: string; verifiedDate?: string; officialItemCount?: number; scope?: string; items: readonly ChecklistItem[] }
const registry = new Map<ChecklistName, ReportingChecklist>();
for (const name of CHECKLIST_NAMES) {
  const data = JSON.parse(readFileSync(new URL(`../checklists/${name.replace('+', '-plus-')}.json`, import.meta.url), 'utf8')) as ReportingChecklist;
  requireThat(data.name === name && data.items.length > 0 && new Set(data.items.map(i => i.id)).size === data.items.length, 'invalid checklist registry');
  data.items.forEach(i=>{Object.freeze(i.requiredKeywords);Object.freeze(i);}); Object.freeze(data.items); registry.set(name, Object.freeze(data));
}
export function reportingChecklist(name: ChecklistName): ReportingChecklist {
  const list = registry.get(name); requireThat(list, 'unknown checklist'); return list;
}
export const PAPER_RENDER_DOMAIN = 'omb-report/rendered-paper@1';
export interface RenderedChecklistPaper {sections: readonly {id:string; sentences: readonly {id:string;text:string}[]}[]}
export const ANCHOR_DOMAIN = 'omb-report/final-anchors@2';
export const NA_DOMAIN = 'omb-report/checklist-na@2';
export const MIN_EXCERPT_LENGTH = 24;
export type NAApproval = { checklist: ChecklistName; item: string; actor: string; action: 'approve-not-applicable' };
export type ChecklistSlot =
  | { kind: 'software' | 'llm'; anchor: string }
  | { kind: 'not-applicable'; evidenceHash: string | null; approval: PW5Receipt<NAApproval> | null }
  | { kind: 'not-available-in-source-data' }
  | { kind: 'needs-owner' };
export interface RenderAnchor { id: string; item: string; section: string; sentence: string; start: number; end: number; owner: 'software' | 'llm'; evidence?:{source:string;sha256:string}; sharedWith?:readonly string[] }
/** Issued by the host renderer after assigning each item its satisfying sentence.
 * The receipt covers text, offsets, item mapping AND this paper's hash. */
export interface FinalAnchorDocument { paperHash: string; checklist: ChecklistName; text: string; sha256: string; anchors: readonly RenderAnchor[]; paper?:PW5Receipt<RenderedChecklistPaper> }
export interface FilledChecklistRow { item: string; anchor: string | null; section: string | null; sentence: string | null; excerpt: string; status: ChecklistSlot['kind']; verified: boolean; needsOwner: boolean }
export function fillChecklist(ctx: ReportContext, name: ChecklistName, slots: Readonly<Record<string, ChecklistSlot>>, envelope: PW5Receipt<FinalAnchorDocument>, verify: PW5Authority, producers:ChecklistProducers={}) {
  const document = readPW5Receipt(ctx, envelope, ANCHOR_DOMAIN, verify);
  const list = reportingChecklist(name);
  exactKeys(slots, list.items.map(i => i.id), 'checklist slot');
  requireThat(document.paperHash === ctx.input.sha256 && document.checklist === name, 'foreign checklist anchor document');
  requireThat(document.sha256 === canonicalSha256(document.text), 'stale final render');
  requireThat(new Set(document.anchors.map(a => a.id)).size === document.anchors.length, 'duplicate anchor');
  requireThat(new Set(document.anchors.map(a => a.item)).size === document.anchors.length, 'duplicate item mapping');
  for (const a of document.anchors) {
    requireThat(/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(a.id) && Number.isSafeInteger(a.start) && Number.isSafeInteger(a.end) && a.start >= 0 && a.end > a.start && a.end <= document.text.length, 'invalid anchor range');
    requireThat(a.owner === 'software', 'factual checklist anchors require software ownership');
    requireThat(list.items.some(i => i.id === a.item), 'unknown mapped checklist item');
    pw5Text(a.section, 'anchor section'); pw5Text(a.sentence, 'anchor sentence');
  }
  // A shared sentence requires an explicit host mapping AND a registry relation.
  for (let i=0;i<document.anchors.length;i++) for (let j=i+1;j<document.anchors.length;j++) {
    const a=document.anchors[i]!, b=document.anchors[j]!;
    const shared = a.sharedWith?.includes(b.item) && b.sharedWith?.includes(a.item) && list.items.find(i=>i.id===a.item)!.evidenceGroup === list.items.find(i=>i.id===b.item)!.evidenceGroup;
    requireThat(shared || a.end <= b.start || b.end <= a.start, 'reused anchor excerpt');
    requireThat(shared || a.section !== b.section || a.sentence !== b.sentence, 'reused anchor sentence');
    const clinical = list.items.find(i=>i.id===a.item)!.clinical && list.items.find(i=>i.id===b.item)!.clinical;
    requireThat(shared || clinical || !checklistExcerptNearDuplicate(document.text.slice(a.start,a.end),document.text.slice(b.start,b.end)), 'reused excerpt text');
  }
  requireThat(document.paper,'missing receipted rendered paper');
  const paper=readPW5Receipt(ctx,document.paper,PAPER_RENDER_DOMAIN,verify);
  requireThat(Array.isArray(paper.sections)&&new Set(paper.sections.map(s=>s.id)).size===paper.sections.length,'invalid rendered paper sections');
  const rows: FilledChecklistRow[] = list.items.map(item => {
    const slot = slots[item.id]!; requireThat(slot && typeof slot === 'object', 'missing checklist slot');
    if (slot.kind === 'software' || slot.kind === 'llm') {
      exactKeys(slot, ['kind', 'anchor'], 'anchor slot field');
      const anchor = document.anchors.find(a => a.id === slot.anchor);
      requireThat(anchor && anchor.owner === slot.kind, 'missing anchor or false authorship');
      requireThat(anchor.item === item.id, 'anchor belongs to a different item');
      const excerpt = document.text.slice(anchor.start, anchor.end); pw5Text(excerpt, 'anchor excerpt');
      requireThat(excerpt.trim().length >= MIN_EXCERPT_LENGTH, 'anchor excerpt too short');
      if (item.clinical) requireThat(slot.kind === 'software' && excerpt === CLINICAL_RESEARCH_TEXT, 'clinical item requires fixed software text');
      const section=paper.sections.find(s=>s.id===anchor.section);
      const sentence=section?.sentences.find(s=>s.id===anchor.sentence);
      requireThat(sentence && sentence.text===excerpt,'excerpt absent from claimed rendered paper sentence');
      const evidence=checklistEvidence(ctx,name,item,producers);
      requireThat(evidence && anchor.evidence?.source===evidence.source && anchor.evidence.sha256===evidence.sha256 && excerpt===evidence.text,'missing item evidence; software producer mapping required');
      requireThat(name!=='STROBE'||item.id!=='1a'||anchor.section==='abstract','study design item requires abstract placement');
      requireThat(!item.section||anchor.section===item.section,'checklist item requires registered section');
      const keywordHint=checklistKeywordHint(excerpt,item.requiredKeywords);
      return { item: item.id, anchor: anchor.id, section: anchor.section, sentence: anchor.sentence, excerpt, keywordHint, status: slot.kind, verified: evidence.verified, needsOwner: !evidence.verified };
    }
    requireThat(!item.clinical, 'clinical item requires fixed software text');
    let approved = false, needsOwner = slot.kind === 'needs-owner';
    if (slot.kind === 'not-applicable') {
      exactKeys(slot, ['kind', 'evidenceHash', 'approval'], 'N/A slot field');
      requireThat(item.allowedNA === true, 'registry does not permit not-applicable');
      if (slot.evidenceHash !== null) {
        approved = ctx.input.certifications.some(c => canonicalSha256(c.certificate) === slot.evidenceHash &&
          Array.isArray(record(c.certificate).checklistApplicability) && (record(c.certificate).checklistApplicability as unknown[]).some((raw: unknown) => {
            const f=raw as Record<string,unknown>; return f.checklist === name && f.item === item.id && f.applicable === false && f.status === 'passed';
          }));
        requireThat(approved, 'uncertified checklist applicability');
      }
      if (slot.approval !== null) {
        const approval=readPW5Receipt(ctx,slot.approval,NA_DOMAIN,verify);
        const owner=ctx.input.ownerConfiguration as Record<string,unknown> | null;
        exactKeys(approval,['checklist','item','actor','action'],'N/A approval field');
        requireThat(owner && typeof owner.ownerActor === 'string' && owner.ownerActor.trim().length > 0 && typeof approval.actor === 'string' && approval.actor.trim().length > 0,'N/A owner configuration required');
        requireThat(approval.checklist === name && approval.item === item.id && approval.actor === owner?.ownerActor && approval.action === 'approve-not-applicable', 'N/A owner approval mismatch');
        assertOwnerActor(approval.actor);
        approved=true;
      }
      needsOwner=!approved;
    } else { requireThat(slot.kind === 'not-available-in-source-data' || slot.kind === 'needs-owner', 'unknown checklist slot state'); exactKeys(slot, ['kind'], 'unresolved slot field'); }
    return { item: item.id, anchor: null, section: null, sentence: null, excerpt: slot.kind === 'needs-owner' ? 'owner-supplied / not verified' : slot.kind === 'not-applicable' ? approved ? 'Not applicable (verified applicability)' : 'Not applicable (owner approval required)' : slot.kind, status: slot.kind, verified: approved, needsOwner };
  });
  return { name, version: list.version, paperHash: ctx.input.sha256, documentHash: document.sha256, rows, complete: rows.every(r => r.verified), verified: rows.every(r => r.verified), needsOwner: rows.some(r => r.needsOwner) };
}
/** Host renderer helper: offsets and the item→section/sentence mapping are emitted
 * together. Host must authenticate this output only after checking the assignments. */
export function renderFinalAnchors(ctx: ReportContext, name: ChecklistName, sentences: readonly {item:string;section:string;sentence:string;text:string;evidence?:{source:string;sha256:string};sharedWith?:readonly string[]}[], paper?:PW5Receipt<RenderedChecklistPaper>): FinalAnchorDocument {
  assertContext(ctx); let text=''; const anchors: RenderAnchor[]=[];
  for (const s of sentences) { const start=text.length; text+=s.text; anchors.push({id:`item-${s.item}`,item:s.item,section:s.section,sentence:s.sentence,start,end:text.length,owner:'software',...(s.evidence?{evidence:s.evidence}:{}),...(s.sharedWith?{sharedWith:s.sharedWith}:{})}); text+='\n'; }
  return {paperHash:ctx.input.sha256,checklist:name,text,sha256:canonicalSha256(text),anchors,...(paper?{paper}:{})};
}
/** Token Dice similarity ignores labels, punctuation and digit changes. */
export function checklistExcerptNearDuplicate(a:string,b:string):boolean {
 const words=(s:string)=>new Set(lexicalKey(s).match(/[\p{L}]+/gu)??[]);
 const x=words(a),y=words(b);return 2*[...x].filter(w=>y.has(w)).length/(x.size+y.size)>=0.85;
}
export function exportChecklistAnchors(ctx: ReportContext, name: ChecklistName, slots: Readonly<Record<string, ChecklistSlot>>, document: PW5Receipt<FinalAnchorDocument>, verify: PW5Authority, producers:ChecklistProducers={}): string {
  const result = fillChecklist(ctx,name,slots,document,verify,producers);
  return '| Item | Anchor | Section | Sentence | Verbatim excerpt | Status |\n| --- | --- | --- | --- | --- | --- |\n' + result.rows.map(r => `| ${plain(name + ' ' + r.item)} | ${plain(r.anchor ?? '')} | ${plain(r.section ?? '')} | ${plain(r.sentence ?? '')} | ${plain(r.excerpt)} | ${r.status} |`).join('\n');
}

/** Produce item assignments from records, never from drafter sentences. Missing
 * typed records refuse; unsupported item schemas produce no verified anchor. */
export function renderChecklistEvidence(ctx:ReportContext,name:ChecklistName,items:readonly string[],producers:ChecklistProducers={}) {
 return items.flatMap(id=>{const item=reportingChecklist(name).items.find(i=>i.id===id);requireThat(item,'unknown checklist item');const evidence=checklistEvidence(ctx,name,item,producers);return evidence?[{item:id,section:item.section??(name==='STROBE'&&id==='1a'?'abstract':`checklist-${name}`),sentence:`item-${id}`,text:evidence.text,evidence:{source:evidence.source,sha256:evidence.sha256}}]:[];});
}

/** Enumerate every official row, keeping unavailable records explicitly pending.
 * The host still authenticates actual rendered paper and anchor assignments before
 * fillChecklist; this helper cannot attest its own paper inclusion. */
export function prepareChecklist(ctx:ReportContext,name:ChecklistName,producers:ChecklistProducers={}) {
 const sentences=renderChecklistEvidence(ctx,name,reportingChecklist(name).items.map(i=>i.id),producers);
 const slots:Record<string,ChecklistSlot>=Object.fromEntries(reportingChecklist(name).items.map(i=>[i.id,sentences.some(s=>s.item===i.id)?{kind:'software',anchor:`item-${i.id}`}:{kind:'needs-owner'}]));
 return {sentences,slots};
}
