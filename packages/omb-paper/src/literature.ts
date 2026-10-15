import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { assertBrief, stage1Context, type FrozenBrief } from '../../omb-literature/src/index.ts';
type Row = Record<string, unknown>;
const payload = (e: Row): Row => e.payload as Row;
/** Read only host-authenticated ledger events; supplied manuscript metadata has no authority. */
export function paperLiterature(events: readonly Row[], investigationId: string, lockRequest: Row) {
  const own = events.filter(e => payload(e)?.investigationId === investigationId);
  const frozen = own.filter(e => e.type === 'literature-frozen');
  if (!frozen.length) {
    if (lockRequest.literatureBriefHash) throw new Error('locked literature brief missing');
    return { literatureBrief: null, literatureBriefHash: null, priorKnowledge: null, noveltyCheck: null };
  }
  if (frozen.length !== 1) throw new Error('multiple frozen literature briefs');
  const event = frozen[0]!, brief = payload(event).brief as FrozenBrief;
  assertBrief(brief);
  if (brief.investigationId !== investigationId || payload(event).briefHash !== brief.sha256 || lockRequest.literatureBriefHash !== brief.sha256) throw new Error('locked literature brief hash mismatch');
  const bound = own.find(e => e.type === 'literature-plan-bound');
  if (!bound || Number(bound.seq) <= Number(event.seq) || payload(bound).briefHash !== brief.sha256 || payload(bound).planHash !== lockRequest.planHash) throw new Error('literature not frozen before plan binding');
  if (own.some(e => ['plan-locked','look-recorded','literature-look-started'].includes(String(e.type)) && Number(e.seq) <= Number(bound.seq))) throw new Error('literature frozen after lock/look');
  const ideas = own.find(e => e.type === 'ideation-reviewed');
  if (!ideas || Number(ideas.seq) <= Number(event.seq) || Number(ideas.seq) >= Number(bound.seq) || payload(ideas).briefHash !== brief.sha256) throw new Error('pre-plan ideation record missing');
  const novelty = own.filter(e => e.type === 'novelty-checked').at(-1);
  if (brief.search === 'on' && !novelty) throw new Error('paper requires final novelty check');
  return { literatureBrief: structuredClone(brief), literatureBriefHash: brief.sha256, priorKnowledge: structuredClone(payload(ideas).priorKnowledge), noveltyCheck: novelty ? structuredClone(payload(novelty)) : null };
}
/** Can be called at plan-lock time: no PaperInput/results exist yet. Hash belongs in timestamp receipt. */
export function stage1LiteratureInput(lockedPlan: unknown, brief: FrozenBrief) {
  const context = stage1Context(lockedPlan, brief);
  return { ...context, sha256: canonicalSha256(context) };
}
