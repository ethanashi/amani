import { canonicalSha256 } from "../../bio-core/src/index.ts";
import { choice, fail, hash, integer, shape, text, validateRecord,
  type NotebookRecord, type RecordKind } from "./records.ts";

export interface Owner { readonly token: string; readonly pid: number }
export interface Commitment { readonly partitionId: string; readonly dataHash: string }
export interface Look { readonly experimentId: string; readonly partitionId: string; readonly probeId: string }
export interface Attempt { readonly id: string; readonly hypothesisId: string; readonly number: number }
export interface LedgerSnapshot {
  readonly sequence: number;
  readonly lastAt: number;
  readonly status: "ready" | "paused" | "canceled";
  readonly reason: string;
  readonly owner: Owner | null;
  readonly maxAttempts: number;
  readonly records: readonly NotebookRecord[];
  readonly commitments: readonly Commitment[];
  readonly looks: readonly Look[];
  readonly attempts: readonly Attempt[];
}
export interface State {
  sequence: number; lastAt: number; status: LedgerSnapshot["status"]; reason: string; owner: Owner | null;
  maxAttempts: number; records: NotebookRecord[]; commitments: Commitment[]; looks: Look[]; attempts: Attempt[];
}
export function initial(): State {
  return { sequence: 0, lastAt: 0, status: "ready", reason: "created", owner: null, maxAttempts: 0,
    records: [], commitments: [], looks: [], attempts: [] };
}
export function getRecord<K extends RecordKind>(s: LedgerSnapshot, id: string, kind: K): NotebookRecord<K> {
  hash(id);
  const r = s.records.find(r => r.id === id);
  if (!r || r.payload.kind !== kind) fail(`missing or wrong-type ${kind} record`);
  return r as NotebookRecord<K>;
}
export function isCurrent(s: LedgerSnapshot, id: string): boolean {
  return !s.records.some(r => r.payload.parents.some(p => p.relation === "supersedes" && p.id === id));
}
export function current<K extends RecordKind>(s: LedgerSnapshot, id: string, kind: K): NotebookRecord<K> {
  const r = getRecord(s, id, kind);
  if (!isCurrent(s, id)) fail("superseded record is not current");
  return r;
}
export function rootId(s: LedgerSnapshot, id: string): string {
  let r = s.records.find(r => r.id === id) ?? fail("missing record");
  for (;;) {
    const previous = r.payload.parents.find(p => p.relation === "supersedes");
    if (!previous) return r.id;
    r = s.records.find(r => r.id === previous.id) ?? fail("missing superseded record");
  }
}
/** Hypothesis derivations (including merges and siblings) share one attempt budget. */
export function attemptCount(s: LedgerSnapshot, id: string): number {
  const family = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of s.records) {
      if (r.payload.kind !== "hypothesis") continue;
      for (const p of r.payload.parents) {
        if (p.type !== "hypothesis" || !["supersedes", "derived_from"].includes(p.relation)) continue;
        if (family.has(r.id) || family.has(p.id)) {
          if (!family.has(r.id) || !family.has(p.id)) changed = true;
          family.add(r.id); family.add(p.id);
        }
      }
    }
  }
  return s.attempts.filter(a => family.has(a.hypothesisId)).length;
}
function identity(value: string): string { return value.normalize("NFC").trim().replace(/\s+/gu, " "); }
function hasLink(r: NotebookRecord, id: string, relation?: string): boolean {
  return r.payload.parents.some(p => p.id === id && (relation === undefined || p.relation === relation));
}
function checkHistory(s: LedgerSnapshot, id: string): NotebookRecord<"check">[] {
  const root = rootId(s, id);
  return s.records.filter((r): r is NotebookRecord<"check"> => r.payload.kind === "check" && rootId(s, r.id) === root);
}
function checkedEvidence(s: State, r: NotebookRecord, dataHash?: string, sourceHashes: readonly string[] = []): void {
  const checks = r.payload.parents.filter(p => p.type === "check" && p.relation === "supports")
    .map(p => current(s, p.id, "check"));
  if (!checks.length || checks.some(c => c.payload.data.status !== "passed")) fail("confirmation requires executed passing checks");
  if (checks.some(c => checkHistory(s, c.id).some(old => old.payload.data.status === "failed"))) fail("confirmation blocked by failed check history");
  if (checks.some(c => c.payload.data.dataHashes.some(h => sourceHashes.includes(h)))) fail("idea checks include source data");
  const eligible = checks.filter(c => dataHash === undefined || c.payload.data.dataHashes.includes(dataHash));
  if (!eligible.some(c => c.payload.data.kind === "reexecution")
    || !eligible.some(c => ["replication", "blind-reimplementation"].includes(c.payload.data.kind))) fail("confirmation requires reexecution and independent review; otherwise tentative");
}
/** Follow discovery ancestry, never the fresh checks cited as confirmation evidence. */
function observationInputs(s: State, r: NotebookRecord): Set<string> {
  const hashes = new Set<string>(), visited = new Set<string>(), pending = [r];
  while (pending.length) {
    const record = pending.pop()!;
    if (visited.has(record.id)) continue;
    visited.add(record.id);
    if (record.payload.kind === "observation") record.payload.data.inputHashes.forEach(h => hashes.add(h));
    for (const p of record.payload.parents) {
      if (p.type === "observation" || p.relation === "derived_from" || p.relation === "supersedes") pending.push(getRecord(s, p.id, p.type));
    }
  }
  return hashes;
}
function addRecord(s: State, r: NotebookRecord): void {
  if (s.records.some(old => old.id === r.id)) fail("duplicate record event");
  for (const p of r.payload.parents) getRecord(s, p.id, p.type);
  const supersedes = r.payload.parents.filter(p => p.relation === "supersedes");
  if (supersedes.length > 1) fail("at most one superseded record");
  const previous = supersedes[0] ? current(s, supersedes[0].id, r.payload.kind) : undefined;
  // Stable card/claim identity prevents an update from silently forking its history.
  if (r.payload.kind === "idea" || r.payload.kind === "interpretation" || r.payload.kind === "assumption" || r.payload.kind === "hypothesis") {
    const textIdentity = identity(r.payload.data.text);
    const existing = s.records.filter(old => old.payload.kind === r.payload.kind && "text" in old.payload.data && identity(old.payload.data.text) === textIdentity).at(-1);
    if (existing && (!previous || rootId(s, previous.id) !== rootId(s, existing.id))) fail("status changes must supersede the current record");
  }
  if (previous && ["observation", "probe", "amendment"].includes(r.payload.kind)) fail("evidence cannot be replaced");
  if (["observation", "check", "experiment", "probe", "amendment"].includes(r.payload.kind) && r.payload.actor.kind !== "software") fail("software-only record");
  switch (r.payload.kind) {
    case "citation":
      if (r.payload.actor.kind !== "software" && (r.payload.data.resolution !== "unavailable" || previous?.payload.actor.kind === "software")) fail("software-only citation resolution");
      break;
    case "assumption":
      if (previous?.payload.kind === "assumption" && identity(previous.payload.data.text) !== identity(r.payload.data.text)) fail("assumption identity cannot change");
      if (r.payload.actor.kind !== "software" && (r.payload.data.status !== "untested" || previous?.payload.actor.kind === "software")) fail("software-only assumption status");
      break;
    case "prediction": {
      const exp = current(s, r.payload.data.experimentId, "experiment"), root = rootId(s, exp.id);
      if (!hasLink(r, exp.id)) fail("prediction requires experiment parent");
      const overlaps = (otherId: string) => {
        const other = getRecord(s, otherId, "experiment");
        return rootId(s, otherId) === root || other.payload.data.plan.partitionIds.some(p => exp.payload.data.plan.partitionIds.includes(p));
      };
      if (s.looks.some(l => overlaps(l.experimentId)) || s.records.some(p => p.payload.kind === "probe" && overlaps(p.payload.data.experimentId))) fail("prediction must precede probes and unsealing");
      break;
    }
    case "experiment": {
      const d = r.payload.data;
      getRecord(s, d.plan.hypothesisId, "hypothesis");
      if (!hasLink(r, d.plan.hypothesisId)) fail("plan requires hypothesis parent");
      const old = s.records.filter(x => x.payload.kind === "experiment" && x.payload.data.experimentKey === d.experimentKey).at(-1);
      if (old && previous?.id !== old.id) fail("experiment key already exists; supersede its current record");
      if (previous?.payload.kind === "experiment" && (previous.payload.data.experimentKey !== d.experimentKey
        || previous.payload.data.plan.hypothesisId !== d.plan.hypothesisId)) fail("experiment identity cannot change");
      break;
    }
    case "check":
      if (previous?.payload.kind === "check" && (previous.payload.data.name !== r.payload.data.name
        || previous.payload.data.kind !== r.payload.data.kind
        || canonicalSha256(previous.payload.data.dataHashes) !== canonicalSha256(r.payload.data.dataHashes))) fail("check identity cannot change");
      break;
    case "interpretation":
      if (previous?.payload.kind === "interpretation" && identity(previous.payload.data.text) !== identity(r.payload.data.text)) fail("claim identity cannot change");
      if (r.payload.data.status === "confirmed") {
        if (r.payload.actor.kind !== "software") fail("software-only confirmation");
        checkedEvidence(s, r);
      }
      break;
    case "idea": {
      if (previous?.payload.kind === "idea" && (canonicalSha256(previous.payload.data.sourceDataHashes) !== canonicalSha256(r.payload.data.sourceDataHashes)
        || identity(previous.payload.data.text) !== identity(r.payload.data.text))) fail("idea source identity cannot change");
      if (!previous && (r.payload.data.status !== "new" || r.payload.data.confirmation !== "tentative")) fail("ideas start new and tentative");
      const sources = observationInputs(s, r), sourceHashes = r.payload.data.sourceDataHashes;
      if ([...sources].some(h => !sourceHashes.includes(h))) fail("idea sources must cover observation inputs");
      if (r.payload.data.status === "tested") {
        if (r.payload.actor.kind !== "software") fail("software-only tested idea");
        const checks = r.payload.parents.filter(p => p.type === "check" && ["supports", "refutes"].includes(p.relation)).map(p => current(s, p.id, "check"));
        if (!checks.length || checks.some(c => !["passed", "failed"].includes(c.payload.data.status))) fail("tested idea requires executed checks");
      }
      if (r.payload.data.confirmation === "confirmed") {
        if (r.payload.actor.kind !== "software") fail("software-only confirmation");
        if (!["tested", "promoted"].includes(r.payload.data.status)) fail("confirmed idea must be tested or promoted");
        if (!sources.size) fail("idea confirmation requires observation provenance");
        checkedEvidence(s, r, r.payload.data.confirmationDataHash!, r.payload.data.sourceDataHashes);
      }
      break;
    }
  }
  s.records.push(r);
}
function owned(s: State, token: unknown, active = true): void {
  text(token);
  if (!s.owner || s.owner.token !== token) fail("stale ledger owner");
  if (active && s.status !== "ready") fail(`investigation is ${s.status}`);
}
function recordAt(value: unknown, at: number): NotebookRecord {
  const r = validateRecord(value);
  if (r.payload.at !== at) fail("record/event timestamp mismatch");
  return r;
}

/** Used both before append and during replay: unknown events never silently disappear. */
export function apply(s: State, type: string, value: unknown, at: number): void {
  if (at < s.lastAt) fail("clock moved backwards");
  switch (type) {
    case "created": {
      const p = shape(value, ["maxAttempts"]); integer(p.maxAttempts, 1);
      if (s.sequence !== 0 || s.maxAttempts !== 0) fail("duplicate creation");
      s.maxAttempts = p.maxAttempts; break;
    }
    case "acquired": {
      const p = shape(value, ["owner", "previousToken"]), owner = shape(p.owner, ["token", "pid"]);
      text(owner.token); integer(owner.pid, 1);
      if (owner.pid > 2147483647 || p.previousToken !== (s.owner?.token ?? null)) fail("invalid ownership transition");
      s.owner = owner as unknown as Owner; break;
    }
    case "released": {
      const p = shape(value, ["token"]); owned(s, p.token, false); s.owner = null; break;
    }
    case "control": {
      const p = shape(value, ["action", "reason"]); choice(p.action, ["pause", "cancel", "resume"]); text(p.reason);
      if (s.status === "canceled") fail("canceled investigation is terminal");
      if (p.action === "resume" && s.status !== "paused") fail("resume requires paused investigation");
      s.status = p.action === "pause" ? "paused" : p.action === "cancel" ? "canceled" : "ready";
      s.reason = p.reason; break;
    }
    case "recorded": {
      const p = shape(value, ["token", "record"]); owned(s, p.token);
      const r = recordAt(p.record, at);
      if (["experiment", "amendment", "probe"].includes(r.payload.kind)) fail("record requires dedicated ledger operation");
      addRecord(s, r); break;
    }
    case "planned": {
      const p = shape(value, ["token", "record"]); owned(s, p.token);
      const r = recordAt(p.record, at);
      if (r.payload.kind !== "experiment" || r.payload.data.status !== "planned" || r.payload.parents.some(p => p.relation === "supersedes")) fail("invalid planned experiment");
      addRecord(s, r); break;
    }
    case "locked": {
      const p = shape(value, ["token", "previousId", "record", "amendment"]); owned(s, p.token);
      const old = current(s, p.previousId as string, "experiment"), r = recordAt(p.record, at);
      if (r.payload.kind !== "experiment" || r.payload.data.status !== "locked" || !hasLink(r, old.id, "supersedes")) fail("invalid locked experiment");
      const changed = old.payload.data.planHash !== r.payload.data.planHash;
      if (!changed && old.payload.data.status === "locked") fail("plan already locked");
      addRecord(s, r);
      if (changed) {
        const amendment = recordAt(p.amendment, at);
        if (amendment.payload.kind !== "amendment" || amendment.payload.data.supersedes !== old.id
          || amendment.payload.data.replacementId !== r.id || amendment.payload.data.post_unblinding !== (s.looks.length > 0)
          || !hasLink(amendment, old.id) || !hasLink(amendment, r.id)) fail("plan edit requires accurate amendment");
        addRecord(s, amendment);
      } else if (p.amendment !== null) fail("unexpected amendment");
      break;
    }
    case "committed": {
      const p = shape(value, ["token", "partitionId", "dataHash"]); owned(s, p.token); text(p.partitionId); hash(p.dataHash);
      if (s.commitments.some(c => c.partitionId === p.partitionId || c.dataHash === p.dataHash)) fail("partition or data already committed");
      s.commitments.push({ partitionId: p.partitionId, dataHash: p.dataHash }); break;
    }
    case "probed": {
      const p = shape(value, ["token", "record"]); owned(s, p.token);
      const r = recordAt(p.record, at);
      if (r.payload.kind !== "probe") fail("invalid probe record");
      const exp = current(s, r.payload.data.experimentId, "experiment");
      if (exp.payload.data.status !== "locked" || exp.payload.data.planHash !== r.payload.data.planHash
        || !hasLink(r, exp.id)) fail("probe requires exact locked plan");
      if (s.looks.some(l => l.experimentId === exp.id || exp.payload.data.plan.partitionIds.includes(l.partitionId))) fail("probe must be closed-book before unsealing");
      if (s.records.some(old => old.payload.kind === "probe" && old.payload.data.experimentId === exp.id)) fail("probe already recorded");
      addRecord(s, r); break;
    }
    case "unsealed": {
      const p = shape(value, ["token", "experimentId", "partitionId", "probeId"]); owned(s, p.token); text(p.partitionId);
      const exp = current(s, p.experimentId as string, "experiment");
      if (exp.payload.data.status !== "locked" || !exp.payload.data.plan.partitionIds.includes(p.partitionId)) fail("partition is not in locked plan");
      if (!s.commitments.some(c => c.partitionId === p.partitionId)) fail("partition commitment required");
      if (s.looks.some(l => l.partitionId === p.partitionId)) fail("partition is burned");
      if (s.looks.some(l => rootId(s, l.experimentId) === rootId(s, exp.id))) fail("pre-registration look already consumed");
      const probe = getRecord(s, p.probeId as string, "probe");
      if (probe.payload.data.experimentId !== exp.id || probe.payload.data.planHash !== exp.payload.data.planHash) fail("probe does not match locked plan");
      s.looks.push({ experimentId: exp.id, partitionId: p.partitionId, probeId: probe.id }); break;
    }
    case "attempted": {
      const p = shape(value, ["token", "id", "hypothesisId", "number"]); owned(s, p.token); text(p.id); integer(p.number, 1);
      const h = getRecord(s, p.hypothesisId as string, "hypothesis");
      const count = attemptCount(s, h.id);
      if (s.attempts.some(a => a.id === p.id)) fail("attempt id already consumed");
      if (count >= s.maxAttempts) fail("policy-limited: attempt cap reached");
      if (p.number !== count + 1) fail("invalid attempt count");
      s.attempts.push({ id: p.id, hypothesisId: h.id, number: p.number }); break;
    }
    default: fail(`unknown ledger event: ${type}`);
  }
  s.lastAt = at;
}

export type ClaimStatus = "tentative" | "supported" | "confirmed" | "refuted" | "insufficient" | "contradicted";
export function claimStatus(s: LedgerSnapshot, id: string): ClaimStatus {
  const first = getRecord(s, id, "interpretation"), root = rootId(s, first.id);
  const history = s.records.filter((r): r is NotebookRecord<"interpretation"> => r.payload.kind === "interpretation" && rootId(s, r.id) === root);
  let supported = false, result: ClaimStatus = "tentative";
  for (const r of history) {
    const status = r.payload.data.status;
    // Refutations are terminal, including against later software-authored records.
    if (status === "refuted") return supported ? "contradicted" : "refuted";
    const checks = r.payload.parents.filter(p => p.relation === "supports" && p.type === "check")
      .map(p => getRecord(s, p.id, "check"));
    const before = s.records.slice(0, s.records.indexOf(r));
    const eligible = checks.filter(c => {
      // A software interpretation attests its support links. A proposal needs a
      // checker-authored binding back to this claim's lineage instead.
      const bound = r.payload.actor.kind === "software" || checkHistory(s, c.id).some(version =>
        before.includes(version) && version.payload.parents.some(p => p.type === "interpretation"
          && ["derived_from", "supports"].includes(p.relation) && rootId(s, p.id) === root));
      const wasCurrent = !before.some(old => hasLink(old, c.id, "supersedes"));
      return bound && wasCurrent && c.payload.data.status === "passed";
    });
    if (status === "confirmed" || (status === "tentative" && eligible.length > 0)) {
      supported = true;
      // Inspect every historical supporting lineage so omitting a failed check
      // in a later proposal or rerunning it to a pass cannot hide the failure.
      if (checks.some(c => checkHistory(s, c.id).some(old => old.payload.data.status === "failed"))) return "contradicted";
    }
    if (status === "confirmed") result = "confirmed";
    else if (status === "tentative" && eligible.length) result = "supported";
    else result = status;
    if ((result === "confirmed" || result === "supported") && checks.some(c => !isCurrent(s, c.id)
      || checkHistory(s, c.id).at(-1)!.payload.data.status !== "passed")) result = "tentative";
  }
  return result;
}
