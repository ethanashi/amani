/**
 * PW8 re-verification after any edit (design section 8). A drafter revision, a referee-driven
 * rewrite and an owner edit all end here: software rebuilds the manuscript from the edited
 * plan (re-resolving every placeholder and re-running every lint through renderDraft),
 * recomputes the skeleton, compares it with the baseline and re-checks the must-appear set.
 */
import { ReportRefusal } from '../common.ts';
import { buildManuscript, type BlockPlan, type Manuscript, type ManuscriptPlan } from './manuscript.ts';
import { checkMustAppear, diffSkeletons, mustAppearSet, type EditMode, type MustAppearIssue, type MustAppearOptions, type SkeletonDiff } from './skeleton.ts';
import { verifySignedHtml, type HtmlIssue, type HtmlVerifyOptions, type ProseEdit } from './html.ts';
import type { SpanSigner } from './sign.ts';

export interface EditResult {
  readonly ok: boolean;
  readonly manuscript: Manuscript | null;
  readonly diff: SkeletonDiff | null;
  readonly mustAppear: readonly MustAppearIssue[];
  /** A lint or assembly refusal from the rebuild (a typed number, a broken binding, ...). */
  readonly refusal: string | null;
  readonly htmlIssues: readonly HtmlIssue[];
}

function rebuild(plan: ManuscriptPlan): { manuscript: Manuscript | null; refusal: string | null } {
  try { return { manuscript: buildManuscript(plan), refusal: null }; }
  catch (error) { if (error instanceof ReportRefusal) return { manuscript: null, refusal: error.message }; throw error; }
}

/** The first draft: no baseline, but the must-appear set and every lint apply. */
export function verifyFirstDraft(plan: ManuscriptPlan, options: MustAppearOptions = {}): EditResult {
  const { manuscript, refusal } = rebuild(plan);
  if (!manuscript) return { ok: false, manuscript, diff: null, mustAppear: [], refusal, htmlIssues: [] };
  const mustAppear = checkMustAppear(mustAppearSet(plan.ctx, options), manuscript);
  return { ok: mustAppear.length === 0, manuscript, diff: null, mustAppear, refusal: null, htmlIssues: [] };
}

/** Re-verify an edited plan against the baseline manuscript. */
export function reverifyEdit(baseline: Manuscript, edited: ManuscriptPlan, mode: EditMode, options: MustAppearOptions = {}): EditResult {
  const { manuscript, refusal } = rebuild(edited);
  if (!manuscript) return { ok: false, manuscript, diff: null, mustAppear: [], refusal, htmlIssues: [] };
  const diff = diffSkeletons(baseline, manuscript, mode, true);
  const mustAppear = checkMustAppear(mustAppearSet(edited.ctx, options), manuscript);
  return { ok: diff.ok && mustAppear.length === 0, manuscript, diff, mustAppear, refusal: null, htmlIssues: [] };
}

/**
 * Turn per-unit prose edits into new drafter sources for the affected draft blocks. Software
 * units keep their original request; edited drafted units contribute their rebuilt request.
 */
export function applyProseEdits(baselinePlan: ManuscriptPlan, baseline: Manuscript, edits: readonly ProseEdit[]): ManuscriptPlan {
  if (!edits.length) return baselinePlan;
  const byUid = new Map(edits.map((e) => [e.uid, e]));
  const sections = baselinePlan.sections.map((sp) => ({
    ...sp,
    blocks: sp.blocks.map((bp): BlockPlan => {
      if (bp.kind !== 'draft') return bp;
      const section = baseline.sections.find((s) => s.id === sp.id);
      const block = section?.blocks.find((b) => b.id === bp.id);
      if (!block || block.kind !== 'paragraphs' || !block.units.some((u) => byUid.has(u.uid))) return bp;
      const paragraphs = new Map<number, string[]>();
      for (const u of block.units) {
        if(u.source===null)continue;
        const edit = byUid.get(u.uid);
        const source = edit ? edit.source : u.source!;
        paragraphs.set(u.paragraph, [...paragraphs.get(u.paragraph) ?? [], source]);
      }
      return { ...bp, source: [...paragraphs.values()].map((p) => p.join(' ')).join('\n\n') };
    }),
  }));
  return { ...baselinePlan, sections };
}

/**
 * Owner edit of the signed HTML: verify signatures and the closed world on the edited file,
 * convert prose edits back into drafter requests, rebuild and compare with the baseline.
 */
export function readBackHtmlEdit(html: string, baselinePlan: ManuscriptPlan, baseline: Manuscript, signer: SpanSigner, mode: EditMode, options: HtmlVerifyOptions & MustAppearOptions = {}): EditResult {
  const verification = verifySignedHtml(html, baseline, signer, options);
  if (!verification.ok) return { ok: false, manuscript: null, diff: null, mustAppear: [], refusal: null, htmlIssues: verification.issues };
  return reverifyEdit(baseline, applyProseEdits(baselinePlan, baseline, verification.prose), mode, options);
}
