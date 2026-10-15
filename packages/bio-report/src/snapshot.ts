import { canonicalSha256 } from "../../bio-core/src/index.ts";
import { type ClaimStatus, InvestigationLedger, type LedgerSnapshot, type NotebookRecord } from "../../bio-ledger/src/index.ts";

export class ReportRefusal extends Error {
  constructor(message: string) { super(message); this.name = "ReportRefusal"; }
}
export function refuse(message: string): never { throw new ReportRefusal(message); }

/** Capture through the trusted ledger: its snapshot alone omits effective claim labels. */
export interface ReportSnapshot {
  readonly ledger: LedgerSnapshot;
  readonly claimStatuses: Readonly<Record<string, ClaimStatus>>;
}
const captured = new WeakSet<ReportSnapshot>();
const statuses: readonly string[] = ["confirmed", "tentative", "supported", "refuted", "insufficient", "contradicted"];

export function captureSnapshot(ledger: InvestigationLedger): ReportSnapshot {
  // Refuse structural lookalikes, subclasses, and instance overrides. Calling the
  // prototype API ensures labels and records are obtained through journal replay.
  const prototype = InvestigationLedger.prototype;
  if (!(ledger instanceof InvestigationLedger) || Object.getPrototypeOf(ledger) !== prototype
    || Object.getOwnPropertyNames(prototype).some(key => Object.hasOwn(ledger, key))) {
    refuse("Use a genuine, unmodified trusted ledger");
  }
  const snapshot = prototype.snapshot.call(ledger); // The real API verifies and replays the journal.
  const labels: Record<string, ClaimStatus> = {};
  for (const record of snapshot.records) {
    if (record.payload.kind !== "interpretation") continue;
    const status = prototype.claimStatus.call(ledger, record.id);
    if (!statuses.includes(status)) refuse(`Unavailable claim label: ${record.id}`);
    labels[record.id] = status;
  }
  // Each public claimStatus call reads the ledger. Refuse a concurrent change rather
  // than accidentally combine labels from a newer journal with an older snapshot.
  if (canonicalSha256(snapshot) !== canonicalSha256(prototype.snapshot.call(ledger))) refuse("Ledger changed during capture; retry");
  const result = Object.freeze({ ledger: snapshot, claimStatuses: Object.freeze(labels) });
  captured.add(result);
  return result;
}

export function assertCaptured(snapshot: ReportSnapshot): void {
  if (!captured.has(snapshot)) refuse("Use captureSnapshot with the trusted ledger API");
}

/** Escape all Markdown/HTML punctuation and collapse multiline text into one line. */
export function plain(text: string): string {
  return text.replace(/[\r\n\t\u0000-\u001f\u007f]+/gu, " ")
    .replace(/[&<>\\`*_{}\[\]()#+!|~:@=]/gu, char => `&#${char.codePointAt(0)};`)
    .replace(/www\./giu, "www&#46;")
    .replace(/(^|\s)-(?=\s|--)/gu, "$1&#45;");
}
export function recordLink(id: string, label = id): string { return `[${plain(label)}](ledger:record/${id})`; }
export function hashLink(hash: string, label = hash): string { return `[${plain(label)}](sha256:${hash})`; }
export function assertHash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) refuse("Missing or invalid SHA-256 hash");
}
export function currentRecords(snapshot: ReportSnapshot): readonly NotebookRecord[] {
  const superseded = new Set(snapshot.ledger.records.flatMap(r => r.payload.parents.filter(p => p.relation === "supersedes").map(p => p.id)));
  return snapshot.ledger.records.filter(r => !superseded.has(r.id));
}

export interface NegativePointer { readonly id: string; readonly label: string }
/** Historical failures remain visible even when superseded by a successful retry. */
export function negativePointers(snapshot: ReportSnapshot): readonly NegativePointer[] {
  assertCaptured(snapshot);
  return snapshot.ledger.records.flatMap((r): NegativePointer[] => {
    const p = r.payload;
    let label: string | undefined;
    if (p.kind === "interpretation") {
      const effective = snapshot.claimStatuses[r.id];
      if (effective === "contradicted" || effective === "refuted" || effective === "insufficient") label = effective;
      else if (p.data.status === "refuted" || p.data.status === "insufficient") label = p.data.status;
    } else if (p.kind === "decision" && p.data.action === "stop") label = "aborted / stopped";
    else if (p.kind === "check" && p.data.status !== "passed") label = `not verified / ${p.data.status}`;
    else if (p.kind === "idea" && p.data.status === "dead") label = "dead idea";
    else if (p.kind === "assumption" && p.data.status === "violated") label = "violated assumption";
    return label === undefined ? [] : [{ id: r.id, label }];
  });
}
