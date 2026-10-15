import {honestNullReason} from '../templates.ts';
/**
 * PW8 fact skeleton comparison and the must-appear set (design section 8).
 *
 * The spine of a manuscript is every software unit plus every drafted unit that carries a
 * software value. The spine must be identical across any edit: same order, sections,
 * containers, claim and citation bindings, values and software text. Drafted prose outside
 * values may change silently. A drafted sentence without values ("glue") may be added or
 * removed only in a revision round, and each such change is listed for the diff review.
 */
import { canonicalJson } from '../../../bio-core/src/index.ts';
import { assertContext, type ReportContext } from '../context.ts';
import { limitationsPartA } from '../limitations.ts';
import { allUnits, type Manuscript, type SkeletonUnit, type Unit } from './manuscript.ts';

export type EditMode = 'edit' | 'revision';
export interface SkeletonChange {
  readonly type: 'context-changed' | 'spine-changed' | 'spine-missing' | 'spine-added' | 'glue-added' | 'glue-removed' | 'glue-moved' | 'prose-changed' | 'review-metadata-changed';
  readonly allowed: boolean;
  readonly detail: string;
}
export interface SkeletonDiff { readonly ok: boolean; readonly mode: EditMode; readonly changes: readonly SkeletonChange[] }

export const isSpine = (u: SkeletonUnit): boolean => u.o === 'software' || u.values.length > 0;
const spineKey = (u: SkeletonUnit): string => canonicalJson(u);
const describe = (u: SkeletonUnit): string => `${u.block} (${u.c}, ${u.o}${u.values.length ? `, values ${u.values.map(([k]) => k).join(', ')}` : ''})`;

/** Compare the skeletons of a baseline and an edited manuscript. */
export function diffSkeletons(baseline: Manuscript, edited: Manuscript, mode: EditMode, regeneratedReviewMetadata=false): SkeletonDiff {
  const changes: SkeletonChange[] = [];
  if (baseline.contextSha256 !== edited.contextSha256) changes.push({ type: 'context-changed', allowed: false, detail: 'claims, labels, protected regions, citations, figures, tables, checklist or PaperInput changed' });
  const isReview=(u:SkeletonUnit)=>regeneratedReviewMetadata&&u.o==='software'&&u.values.length===1&&u.values[0]![0].startsWith('ai-review:');
  const reviewsChanged=canonicalJson(baseline.skeleton.units.filter(isReview))!==canonicalJson(edited.skeleton.units.filter(isReview));
  const a = baseline.skeleton.units.filter(u=>!isReview(u)), b = edited.skeleton.units.filter(u=>!isReview(u));
  const spineA = a.filter(isSpine), spineB = b.filter(isSpine);
  for (const step of pairRuns(align(spineA.map(spineKey), spineB.map(spineKey)))) {
    if (step.op === 'same') continue;
    const x = step.op === 'ins' ? undefined : spineA[step.i!], y = step.op === 'del' ? undefined : spineB[step.j!];
    if (x && y) changes.push({ type: 'spine-changed', allowed: false, detail: `spine unit ${step.i}: ${describe(x)} became ${describe(y)}${valueDelta(x, y)}` });
    else if (x) changes.push({ type: 'spine-missing', allowed: false, detail: `spine unit ${step.i} removed: ${describe(x)}` });
    else if (y) changes.push({ type: 'spine-added', allowed: false, detail: `spine unit added before baseline unit ${step.i ?? spineA.length}: ${describe(y)}` });
  }
  // Glue between consecutive spine units: compare counts per gap and per block.
  const gaps = (units: readonly SkeletonUnit[]) => {
    const out: SkeletonUnit[][] = [[]];
    for (const u of units) { if (isSpine(u)) out.push([]); else out.at(-1)!.push(u); }
    return out;
  };
  const ga = gaps(a), gb = gaps(b);
  if (ga.length === gb.length) {
    ga.forEach((glueA, g) => {
      const glueB = gb[g]!;
      const keyed = (units: SkeletonUnit[]) => units.map((u) => canonicalJson({ ...u }));
      const ka = keyed(glueA), kb = keyed(glueB);
      if (ka.length === kb.length && ka.every((k, i) => k === kb[i])) return;
      const added = kb.length - ka.length;
      const where = `gap after spine unit ${g - 1}`;
      if (added > 0) changes.push({ type: 'glue-added', allowed: mode === 'revision', detail: `${added} glue sentence(s) added ${where}` });
      else if (added < 0) changes.push({ type: 'glue-removed', allowed: mode === 'revision', detail: `${-added} glue sentence(s) removed ${where}` });
      else changes.push({ type: 'glue-moved', allowed: mode === 'revision', detail: `glue sentence binding or placement changed ${where}` });
    });
  }
  // Prose changes are visible in the diff review but never block.
  const unitsA = allUnits(baseline), unitsB = allUnits(edited);
  if (unitsA.length === unitsB.length) unitsA.forEach((u, i) => { if (u.origin === 'drafter' && u.text !== unitsB[i]!.text) changes.push({ type: 'prose-changed', allowed: true, detail: `${u.block}#${u.index}: "${u.text}" -> "${unitsB[i]!.text}"` }); });
  if(reviewsChanged)changes.push({type:'review-metadata-changed',allowed:true,detail:'Review notice regenerated from the rebuilt source; previous draft acknowledgments no longer apply.'});
  return { ok: changes.every((c) => c.allowed), mode, changes };
}

interface Step { readonly op: 'same' | 'del' | 'ins' | 'sub'; readonly i?: number; readonly j?: number }

/** Longest-common-subsequence alignment of two key lists (spines are small). */
export function align(a: readonly string[], b: readonly string[]): Step[] {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: Step[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) out.push({ op: 'same', i: i++, j: j++ });
    else if (j < n && (i >= m || dp[i]![j + 1]! >= dp[i + 1]![j]!)) out.push({ op: 'ins', j: j++, ...(i < m ? { i } : {}) });
    else out.push({ op: 'del', i: i++ });
  }
  return out;
}

/** Pair each run of deletions with the insertions next to it, so a changed unit reads as one change. */
function pairRuns(steps: readonly Step[]): Step[] {
  const out: Step[] = [];
  for (let k = 0; k < steps.length;) {
    if (steps[k]!.op === 'same') { out.push(steps[k++]!); continue; }
    const dels: Step[] = [], ins: Step[] = [];
    while (k < steps.length && steps[k]!.op !== 'same') (steps[k]!.op === 'del' ? dels : ins).push(steps[k++]!);
    const paired = Math.min(dels.length, ins.length);
    for (let p = 0; p < paired; p++) out.push({ op: 'sub', i: dels[p]!.i!, j: ins[p]!.j! });
    out.push(...dels.slice(paired), ...ins.slice(paired));
  }
  return out;
}

function valueDelta(a: SkeletonUnit, b: SkeletonUnit): string {
  const va = canonicalJson(a.values), vb = canonicalJson(b.values);
  return va === vb ? '' : `; values ${va} -> ${vb}`;
}

// ------------------------------------------------------------------------------------------
// Must-appear set

export interface MustAppearRule { readonly key: string; readonly sections: readonly string[]; readonly why: string }
export interface MustAppearOptions {
  readonly abstract?: readonly string[]; readonly keyPoints?: readonly string[]; readonly results?: readonly string[];
  readonly aims?: readonly string[]; readonly search?: readonly string[]; readonly limitations?: readonly string[]; readonly claimCount?: readonly string[];
}
export interface MustAppearIssue { readonly key: string; readonly sections: readonly string[]; readonly why: string }

/** The facts and software lines each section must hold (section 8), derived from the sealed context. */
export function mustAppearSet(ctx: ReportContext, options: MustAppearOptions = {}): MustAppearRule[] {
  assertContext(ctx);
  const o = { abstract: ['abstract'], keyPoints: ['key-points'], results: ['results'], aims: ['introduction'], search: ['introduction', 'methods'], limitations: ['limitations'], ...options };
  o.claimCount ??= o.results;
  const rules: MustAppearRule[] = [];
  const primary = ctx.input.plannedFound.primaryClaimId;
  if (primary) {
    for (const [name, sections] of [['abstract', o.abstract], ['Key Points', o.keyPoints], ['Results', o.results]] as const) {
      for (const s of sections) {
        if(honestNullReason(ctx.claims.find(c=>c.id===primary)!)!==null)rules.push({key:`m:${primary}.null_reason`,sections:[s],why:`primary abstention reason in ${name}`});
        else if (ctx.slots.has(`m:${primary}.result`)) rules.push({ key: `m:${primary}.result`, sections: [s], why: `primary claim bundle in ${name}` });
        rules.push({ key: `m:${primary}.label`, sections: [s], why: `primary claim label in ${name}` });
      }
    }
  }
  rules.push({ key: 'block:claim-count', sections: o.claimCount, why: 'claim-count sentence' });
  for (const c of ctx.claims) rules.push({ key: `block:results:${c.id}`, sections: o.results, why: `Results block for ${c.id}` });
  rules.push({ key: 'block:aims', sections: o.aims, why: 'aims paragraph' });
  for (const r of limitationsPartA(ctx)) rules.push({ key: `protected:${r.id}#${r.sha256}`, sections: o.limitations, why: `Limitations Part A line ${r.id}` });
  rules.push({ key: 'block:search', sections: o.search, why: 'literature-search sentence' });
  return rules;
}

/** Keys a unit supplies: its value keys, declared software provisions and protected hash. */
export function unitKeys(u: Unit): string[] {
  return [...u.inlines.flatMap((i) => (i.t === 'value' ? i.key.split('|') : [])), ...u.provides];
}

export function checkMustAppear(rules: readonly MustAppearRule[], m: Manuscript): MustAppearIssue[] {
  const bySection = new Map<string, Set<string>>();
  for (const u of allUnits(m)) {
    const set = bySection.get(u.section) ?? new Set<string>();
    for (const k of unitKeys(u)) set.add(k);
    bySection.set(u.section, set);
  }
  return rules.filter((r) => !r.sections.some((s) => {
    const keys=bySection.get(s);if(keys?.has(r.key))return true;
    // A reading label may be factored across a shared paragraph and its claim.
    // Require every authenticated component in this same section, never any one.
    const claim=r.key.match(/^m:(.+)\.label$/u)?.[1];
    return claim!==undefined&&['registration','checks','evidence'].every(field=>keys?.has(`label-part:${claim}:${field}`));
  })).map((r) => ({ key: r.key, sections: r.sections, why: r.why }));
}
