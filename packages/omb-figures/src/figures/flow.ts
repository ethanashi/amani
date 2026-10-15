/**
 * Data-flow diagram (STROBE 13, TRIPOD+AI 20-21 style: raw, de-duplicated, excluded with reasons,
 * units, splits, analysed) and claim-flow diagram (proposed, locked, looked, labels). Counts are
 * certified facts; the arithmetic between boxes is checked, and a mismatch is refused.
 */
import { Canvas, FONT, STROKE, group, line, rect, templateFragments, textWidth } from "../draw.ts";
import { coord } from "../format.ts";
import { NEUTRAL } from "../palette.ts";
import { CLAIM_STATUSES, type CertifiedFact, type ClaimStatus } from "../port.ts";
import { refuse } from "../refusal.ts";
import { FLOW_STAGES, type ConsortSpec, type ClaimFlowSpec, type DataFlowSpec, type FlowStage } from "../spec.ts";
import type { FactStore, UseContext } from "../store.ts";
import { T } from "../templates.ts";
import { resolveTemplate, stat, type Segment } from "../text.ts";
import { el, type SvgNode } from "../xml.ts";
import { captionSegs, joinSegs, nonEmptyArray, scalarSegs, trimTrailing, useContext, type FigureDraft } from "./common.ts";

const LINE_H = 10;
const STAGE_TITLE: Record<FlowStage, string> = {
  raw: T.stageRaw, deduplicated: T.stageDeduplicated, eligible: T.stageEligible, units: T.stageUnits, analysed: T.stageAnalysed,
};

function arrowDown(x: number, y1: number, y2: number): SvgNode {
  return group("arrow", [
    line(x, y1, x, y2 - 3, { width: STROKE.axis }),
    el("path", [["d", `M${coord(x)} ${coord(y2)}L${coord(x - 2.5)} ${coord(y2 - 4)}L${coord(x + 2.5)} ${coord(y2 - 4)}Z`], ["fill", NEUTRAL.ink], ["stroke", "none"]]),
  ]);
}

function arrowRight(x1: number, x2: number, y: number): SvgNode {
  return group("arrow", [
    line(x1, y, x2 - 3, y, { width: STROKE.axis }),
    el("path", [["d", `M${coord(x2)} ${coord(y)}L${coord(x2 - 4)} ${coord(y - 2.5)}L${coord(x2 - 4)} ${coord(y + 2.5)}Z`], ["fill", NEUTRAL.ink], ["stroke", "none"]]),
  ]);
}

/** Orthogonal fan-out: down from the parent, across, then an arrow down into each child box. */
function fanOut(from: number, y: number, centres: readonly number[], yTo: number): SvgNode {
  const mid = y + (yTo - y) / 2;
  const kids = [line(from, y, from, mid, { width: STROKE.axis }), line(Math.min(from, ...centres), mid, Math.max(from, ...centres), mid, { width: STROKE.axis })];
  for (const cx of centres) kids.push(arrowDown(cx, mid, yTo));
  return group("arrow", kids);
}

/** A box with centred lines of text. */
function box(c: Canvas, x: number, y: number, w: number, lines: readonly (readonly Segment[])[], anchor: "middle" | "start" = "middle"): { node: SvgNode; height: number } {
  const h = lines.length * LINE_H + 8;
  const kids = [rect(x, y, w, h, { stroke: NEUTRAL.ink, width: STROKE.axis, cls: "box" })];
  lines.forEach((segs, i) => kids.push(c.text(anchor === "middle" ? x + w / 2 : x + 5, y + 4 + (i + 1) * LINE_H - 2.5, segs, { size: FONT.label, anchor, cls: "flow-text" })));
  return { node: group("flow-box", kids), height: h };
}

const segWidth = (lines: readonly (readonly Segment[])[]) => Math.max(...lines.map((l) => textWidth(l.map((s) => s.text).join(""), FONT.label)));

function countLine(store: FactStore, count: CertifiedFact, events: CertifiedFact | null): Segment[] {
  return [stat(T.nEq), ...scalarSegs(store, count), ...(events ? [stat(T.semicolon), stat(T.eventsEq), ...scalarSegs(store, events)] : [])];
}

function counted(c: Canvas, store: FactStore, ctx: UseContext, id: string, role: string): CertifiedFact {
  return c.useFact(store.fact(id, ctx, ["count"]), role);
}

export function renderDataFlow(spec: DataFlowSpec, store: FactStore): FigureDraft {
  const ctx = useContext(spec, []);
  const stages = nonEmptyArray(spec.stages, `${ctx.where} stages`, FLOW_STAGES.length);
  const splitsSpec = spec.splits ?? [];
  const templates = [
    ...stages.flatMap((s) => [s.unitLabel, ...(s.removed?.reasons ?? []).map((r) => r.label)]), ...splitsSpec.map((s) => s.label),
    spec.caption?.message, spec.caption?.shortLabel,
  ];
  const c = new Canvas("data-flow", spec.id, 400, templateFragments(templates));
  let lastIndex = -1;
  const resolved = stages.map((s, i) => {
    const order = FLOW_STAGES.indexOf(s.stage);
    if (order <= lastIndex) refuse("invalid-spec", `${ctx.where}: stages must follow the fixed order ${FLOW_STAGES.join(", ")}`);
    lastIndex = order;
    if (s.unitLabel !== undefined && s.stage !== "units") refuse("invalid-spec", `${ctx.where}: only the units stage takes a unit label`);
    const count = counted(c, store, ctx, s.count, `${s.stage}-count`);
    const events = s.events === undefined ? null : counted(c, store, ctx, s.events, `${s.stage}-events`);
    if (events && events.value > count.value) refuse("inconsistent-data", `${ctx.where}: more events than records at ${s.stage}`);
    let removed: { total: CertifiedFact; reasons: { label: Segment[]; count: CertifiedFact }[] } | null = null;
    if (s.removed) {
      if (i === 0) refuse("invalid-spec", `${ctx.where}: the first stage cannot remove records`);
      const total = counted(c, store, ctx, s.removed.total, `${s.stage}-removed`);
      const reasons = nonEmptyArray(s.removed.reasons, `${ctx.where} removal reasons`, 12).map((r) => ({ label: resolveTemplate(r.label, store, ctx), count: counted(c, store, ctx, r.count, `${s.stage}-reason`) }));
      if (reasons.reduce((sum, r) => sum + r.count.value, 0) !== total.value) refuse("inconsistent-data", `${ctx.where}: reasons at ${s.stage} do not sum to the total removed`);
      removed = { total, reasons };
    }
    const title: Segment[] = s.stage === "units" && s.unitLabel !== undefined
      ? [stat(STAGE_TITLE.units), stat(T.openParen), ...resolveTemplate(s.unitLabel, store, ctx), stat(T.closeParen)]
      : [stat(STAGE_TITLE[s.stage])];
    return { stage: s.stage, count, events, removed, title };
  });
  let lastEventsStage: typeof resolved[number] | undefined;
  resolved.forEach((r, i) => {
    const prev = resolved[i - 1];
    const previousEvents = lastEventsStage;
    if(previousEvents?.events && r.events && (r.events.value>previousEvents.events.value || (r.count.value===previousEvents.count.value && r.events.value!==previousEvents.events.value))) refuse("inconsistent-data",`${ctx.where}: events do not reconcile across stages`);
    if(r.events) lastEventsStage=r;
    if(prev && !r.removed && r.stage!=="units" && prev.count.value!==r.count.value) refuse("inconsistent-data",`${ctx.where}: count changed without removals`);
    if(prev && r.stage==="units" && r.count.value>prev.count.value) refuse("inconsistent-data",`${ctx.where}: units exceed eligible records`);
    if (prev && r.removed && prev.count.value - r.removed.total.value !== r.count.value) {
      refuse("inconsistent-data", `${ctx.where}: ${prev.stage} minus removed does not equal ${r.stage}`);
    }
  });
  const splits = splitsSpec.map((s) => {
    const count = counted(c, store, ctx, s.count, "split-count");
    const events = s.events === undefined ? null : counted(c, store, ctx, s.events, "split-events");
    if (events && events.value > count.value) refuse("inconsistent-data", `${ctx.where}: more events than records in a split`);
    return { label: resolveTemplate(s.label, store, ctx), count, events };
  });
  if (splits.length === 1) refuse("invalid-spec", `${ctx.where}: a split needs at least two parts`);
  if (splits.length && splits.reduce((sum, s) => sum + s.count.value, 0) !== resolved.at(-1)!.count.value) {
    refuse("inconsistent-data", `${ctx.where}: split counts do not sum to the last stage`);
  }

  const lastEvents=resolved.at(-1)!.events;
  // Earlier event totals cannot determine the final cohort after intervening removals.
  if(!lastEvents && splits.some(s=>s.events)) refuse("inconsistent-data",`${ctx.where}: final stage events required to reconcile split events`);
  if(splits.length && lastEvents && (splits.some(s=>!s.events) || splits.reduce((n,s)=>n+s.events!.value,0)!==lastEvents.value)) refuse("inconsistent-data",`${ctx.where}: split events must sum to last stage events`);
  const mainX = 30, mainW = 190, sideX = 248, sideW = 144;
  const mainLines = resolved.map((r) => [r.title, countLine(store, r.count, r.events)]);
  const sideLines = resolved.map((r) => (r.removed ? [
    [stat(r.stage === "deduplicated" ? T.removed : T.excluded), stat(T.colon), stat(T.nEq), ...scalarSegs(store, r.removed.total)],
    ...r.removed.reasons.map((x) => [...x.label, stat(T.colon), stat(T.nEq), ...scalarSegs(store, x.count)]),
  ] : null));
  if (Math.max(...mainLines.map(segWidth)) > mainW - 8 || Math.max(0, ...sideLines.map((l) => (l ? segWidth(l) : 0))) > sideW - 10) {
    refuse("label-too-long", `${ctx.where}: a box label exceeds the template's box width`);
  }
  let y = 10;
  const centre = mainX + mainW / 2;
  resolved.forEach((r, i) => {
    const side = sideLines[i];
    if (i > 0) {
      const gap = side ? side.length * LINE_H + 16 : 16;
      const yStart = y, yEnd = y + gap;
      c.nodes.push(arrowDown(centre, yStart, yEnd));
      if (side) {
        const sb = box(c, sideX, yStart + 4, sideW, side, "start");
        c.nodes.push(arrowRight(centre, sideX, yStart + 4 + sb.height / 2), sb.node);
      }
      y = yEnd;
    }
    const b = box(c, mainX, y, mainW, mainLines[i]!);
    c.nodes.push(b.node);
    y += b.height;
  });
  if (splits.length) {
    const gap = 8, w = (400 - 16 - gap * (splits.length - 1)) / splits.length;
    const splitLines = splits.map((s) => [s.label, countLine(store, s.count, s.events)]);
    if (Math.max(...splitLines.map(segWidth)) > w - 6) refuse("label-too-long", `${ctx.where}: a split label exceeds its box`);
    const yBox = y + 22;
    c.nodes.push(fanOut(centre, y, splits.map((_, k) => 8 + k * (w + gap) + w / 2), yBox));
    splits.forEach((_, k) => c.nodes.push(box(c, 8 + k * (w + gap), yBox, w, splitLines[k]!).node));
    y = yBox + splitLines[0]!.length * LINE_H + 8;
  }
  const altStages = resolved.map((r, i) => {
    const parts: Segment[] = [...r.title, stat(T.colon), ...countLine(store, r.count, r.events)];
    const side = sideLines[i];
    if (side) parts.push(stat(T.openParen), ...joinSegs(side, T.semicolon), stat(T.closeParen));
    return parts;
  });
  const alt: Segment[] = [stat(T.titleDataFlow), stat(T.periodSpace), stat(T.altDataFlow), ...joinSegs(altStages, T.altArrow), stat(T.periodSpace)];
  if (splits.length) alt.push(stat(T.altSplits), ...joinSegs(splits.map((s) => [...s.label, stat(T.colon), ...countLine(store, s.count, s.events)]), T.semicolon), stat(T.period));
  return { canvas: c, height: y + 10, title: [stat(T.titleDataFlow)], alt: trimTrailing(alt), caption: captionSegs(store, ctx, spec.caption, [stat(T.capDataFlow)]) };
}

const STATUS_LINES: Record<ClaimStatus, readonly [string, string]> = {
  confirmed: [T.statusConfirmedA, T.statusConfirmedB], replicated: [T.statusReplicatedA, T.statusReplicatedB],
  tentative: [T.statusTentativeA, T.statusTentativeB], refuted: [T.statusRefutedA, T.statusRefutedB],
  "insufficient-evidence": [T.statusInsufficientA, T.statusInsufficientB], "non-identifiable": [T.statusNonIdentifiableA, T.statusNonIdentifiableB],
  exploratory: [T.statusExploratoryA, T.statusExploratoryB], voided: [T.statusVoidedA, T.statusVoidedB],
};

export function renderClaimFlow(spec: ClaimFlowSpec, store: FactStore): FigureDraft {
  const ctx = useContext(spec, []);
  const outcomesSpec = nonEmptyArray(spec.outcomes, `${ctx.where} outcomes`, CLAIM_STATUSES.length);
  if (outcomesSpec.some((o) => !CLAIM_STATUSES.includes(o.status)) || new Set(outcomesSpec.map((o) => o.status)).size !== outcomesSpec.length) {
    refuse("invalid-spec", `${ctx.where}: outcome statuses must be distinct known labels`);
  }
  const probe = new Canvas("claim-flow", spec.id, 0, templateFragments([spec.caption?.message, spec.caption?.shortLabel]));
  const proposed = counted(probe, store, ctx, spec.proposed, "proposed");
  const locked = counted(probe, store, ctx, spec.locked, "locked");
  const looked = counted(probe, store, ctx, spec.looked, "looked");
  const outcomes = [...outcomesSpec].sort((a, b) => CLAIM_STATUSES.indexOf(a.status) - CLAIM_STATUSES.indexOf(b.status))
    .map((o) => ({ status: o.status, count: counted(probe, store, ctx, o.count, `outcome-${o.status}`) }));
  if (locked.value > proposed.value || looked.value > locked.value) refuse("inconsistent-data", `${ctx.where}: stage counts must not grow (proposed >= locked >= looked)`);
  if (outcomes.reduce((s, o) => s + o.count.value, 0) !== looked.value) refuse("inconsistent-data", `${ctx.where}: label counts do not sum to the hypotheses looked at`);

  const outLines = outcomes.map((o) => [[stat(STATUS_LINES[o.status][0])], [stat(STATUS_LINES[o.status][1])], [stat(T.nEq), ...scalarSegs(store, o.count)]]);
  const boxW = Math.ceil(Math.max(...outLines.map(segWidth)) + 10), gap = 6;
  const width = Math.max(400, outcomes.length * boxW + (outcomes.length - 1) * gap + 16);
  const c = new Canvas("claim-flow", spec.id, width, templateFragments([spec.caption?.message, spec.caption?.shortLabel]));
  for (const d of probe.data) c.data.push(d);
  c.exec = probe.exec;
  const mainW = 200, mainX = (width - mainW) / 2, centre = width / 2;
  const stagesLines = [[stat(T.flowProposed)], [stat(T.flowLocked)], [stat(T.flowLooked)]].map((title, i) => [title, [stat(T.nEq), ...scalarSegs(store, [proposed, locked, looked][i]!)]]);
  let y = 10;
  stagesLines.forEach((lines, i) => {
    if (i > 0) { c.nodes.push(arrowDown(centre, y, y + 14)); y += 14; }
    const b = box(c, mainX, y, mainW, lines);
    c.nodes.push(b.node);
    y += b.height;
  });
  const total = outcomes.length * boxW + (outcomes.length - 1) * gap;
  const startX = (width - total) / 2, yBox = y + 22;
  c.nodes.push(fanOut(centre, y, outLines.map((_, k) => startX + k * (boxW + gap) + boxW / 2), yBox));
  outLines.forEach((lines, k) => c.nodes.push(box(c, startX + k * (boxW + gap), yBox, boxW, lines).node));
  const height = yBox + 3 * LINE_H + 8 + 10;
  const alt: Segment[] = [
    stat(T.titleClaimFlow), stat(T.periodSpace), stat(T.altClaimFlow),
    ...joinSegs(stagesLines.map(([title, count]) => [...title!, stat(T.colon), ...count!]), T.altArrow), stat(T.altArrow),
    ...joinSegs(outcomes.map((o, k) => [stat(STATUS_LINES[o.status][0]), stat(T.space), stat(STATUS_LINES[o.status][1]), stat(T.colon), ...outLines[k]![2]!]), T.semicolon), stat(T.period),
  ];
  return { canvas: c, height, title: [stat(T.titleClaimFlow)], alt, caption: captionSegs(store, ctx, spec.caption, [stat(T.capClaimFlow)]) };
}

/** consort pattern only: every allocation, exclusion and loss is explicit and reconciled. */
export function renderConsort(spec: ConsortSpec, store: FactStore): FigureDraft {
  const ctx=useContext(spec,[]);
  const arms=nonEmptyArray(spec.arms,"CONSORT arms",2);
  if(arms.length!==2) refuse("invalid-spec","CONSORT template requires two arms");
  if(!Array.isArray(spec.excluded) || arms.some(a=>!Array.isArray(a.lost))) refuse("invalid-spec","explicit exclusion/loss lists required (empty means none)");
  const c=new Canvas("consort",spec.id,400,templateFragments([spec.caption.message,spec.caption.shortLabel,...spec.excluded.map(x=>x.label),...arms.flatMap(a=>[a.label,...a.lost.map(x=>x.label)])]));
  const read=(id:string,role:string)=>counted(c,store,ctx,id,role);
  const assessed=read(spec.assessed,"assessed"),enrolled=read(spec.enrolled,"enrolled");
  const excluded=spec.excluded.map(e=>({label:resolveTemplate(e.label,store,ctx),n:read(e.count,"excluded")}));
  if(assessed.value-excluded.reduce((s,e)=>s+e.n.value,0)!==enrolled.value) refuse("inconsistent-data","CONSORT exclusions do not reconcile");
  const resolved=arms.map(a=>({label:resolveTemplate(a.label,store,ctx),allocated:read(a.allocated,"allocated"),analysed:read(a.analysed,"analysed"),lost:a.lost.map(l=>({label:resolveTemplate(l.label,store,ctx),n:read(l.count,"lost")}))}));
  if(resolved.reduce((s,a)=>s+a.allocated.value,0)!==enrolled.value) refuse("inconsistent-data","CONSORT allocations do not sum");
  for(const a of resolved) if(a.allocated.value-a.lost.reduce((s,l)=>s+l.n.value,0)!==a.analysed.value) refuse("inconsistent-data","CONSORT follow-up does not reconcile");
  const countedLine=(label:readonly Segment[],n:CertifiedFact)=>[...label,stat(T.colon),...scalarSegs(store,n)];
  const topLines=[countedLine([stat(T.assessed)],assessed),...excluded.map(e=>countedLine(e.label,e.n)),countedLine([stat(T.enrolled)],enrolled)];
  if(segWidth(topLines)>350) refuse("label-too-long","CONSORT label too wide");
  const top=box(c,20,10,360,topLines); c.nodes.push(top.node);
  const y=top.height+45;
  c.nodes.push(fanOut(200,10+top.height,[105,295],y));
  let height=y;
  resolved.forEach((a,i)=> {
    const lines=[a.label,countedLine([stat(T.allocated)],a.allocated),...a.lost.map(l=>countedLine(l.label,l.n)),countedLine([stat(T.stageAnalysed)],a.analysed)];
    if(segWidth(lines)>170) refuse("label-too-long","CONSORT arm label too wide");
    const arm=box(c,15+i*190,y,180,lines);c.nodes.push(arm.node);height=Math.max(height,y+arm.height+10);
  });
  const alt=[stat(T.titleConsort),stat(T.periodSpace),stat(T.consortCap)];
  return {canvas:c,height,title:[stat(T.titleConsort)],alt,caption:captionSegs(store,ctx,spec.caption,[stat(T.consortCap)])};
}
