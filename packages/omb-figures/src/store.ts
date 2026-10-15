/**
 * The verified fact store. Built once from PaperInput records; every figure and table reads
 * numbers only through it. Unsigned, ungraded, malformed, duplicate or orphan records refuse the
 * whole store (fail closed). Placement rules are enforced at each use.
 */
import { DisplayFormatter } from "./format.ts";
import {
  validateRecordShape, type CertifiedClaim, type CertifiedEntity, type CertifiedFact, type CertifiedRecord,
  type CertifiedSeries, type FactKind, type RecordAuthenticator, type RecordIssue,
} from "./port.ts";
import { refuse } from "./refusal.ts";

/** `results`: main-text figures and tables (kernel or exec grade only). `supplement`: any signed grade. */
export type Placement = "results" | "supplement";

export interface UseContext {
  readonly placement: Placement;
  /** Claims the figure or table reports; facts bound to other claims are refused. */
  readonly claims: ReadonlySet<string>;
  /** Literature values from verified quotes (previous-study rows only). */
  readonly published?: boolean;
  /** Set only by the dedicated supplementary table of unverified numbers (design section 2.2). */
  readonly unverifiedTable?: boolean;
  /** Where the value is used, for error messages. */
  readonly where: string;
}

/** Records are cloned at build and frozen all the way down (values, texts, thresholds), so a verified
 * record can never change after its signature was checked. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

export class FactStore {
  readonly #facts = new Map<string, CertifiedFact>();
  readonly #series = new Map<string, CertifiedSeries>();
  readonly #entities = new Map<string, CertifiedEntity>();
  readonly #claims = new Map<string, CertifiedClaim>();
  readonly formatter: DisplayFormatter;

  private constructor() {
    this.formatter = new DisplayFormatter((id) => (id === null ? null : this.#claims.get(id) ?? null));
  }

  /** Validates shape, signature, uniqueness and claim references for every record. */
  static build(records: readonly unknown[], authenticator: RecordAuthenticator): FactStore {
    if (!Array.isArray(records)) refuse("invalid-records", "records must be an array");
    const store = new FactStore();
    const issues: RecordIssue[] = [];
    const accepted: CertifiedRecord[] = [];
    records.forEach((raw, index) => {
      const shape = validateRecordShape(raw, index);
      if (shape.length) { issues.push(...shape); return; }
      const record = raw as CertifiedRecord;
      let ok = false;
      try { ok = authenticator.verify(record) === true; } catch { ok = false; }
      if (!ok) { issues.push({ index, id: record.id, code: "unsigned", detail: "signature does not verify" }); return; }
      accepted.push(structuredClone(record));
    });
    for (const record of accepted) {
      const map: Map<string, CertifiedRecord> =
        record.recordType === "fact" ? store.#facts : record.recordType === "series" ? store.#series
          : record.recordType === "entity" ? store.#entities : store.#claims;
      if (map.has(record.id)) issues.push({ index: -1, id: record.id, code: "duplicate", detail: `duplicate ${record.recordType} id` });
      else map.set(record.id, deepFreeze(record));
    }
    for (const record of [...store.#facts.values(), ...store.#series.values()]) {
      if (record.claimId !== null && !store.#claims.has(record.claimId)) {
        issues.push({ index: -1, id: record.id, code: "orphan-claim", detail: `claim ${record.claimId} is not in the input` });
      }
    }
    if (issues.length) refuse("invalid-records", `${issues.length} record(s) refused`, issues.map((i) => `${i.code} ${i.id}: ${i.detail}`));
    return store;
  }

  #check(record: CertifiedFact | CertifiedSeries, ctx: UseContext, kinds: readonly FactKind[] | undefined): void {
    if (record.grade === "unverified" && ctx.unverifiedTable !== true) {
      refuse("unverified-quarantined", `${ctx.where}: ${record.id} is unverified-grade; it may print only in the supplementary table of unverified numbers`);
    }
    if (ctx.unverifiedTable === true && record.grade !== "unverified") {
      refuse("kind-mismatch", `${ctx.where}: ${record.id} is ${record.grade}-grade; the unverified-numbers table holds unverified-grade numbers only`);
    }
    if (record.grade === "published" && ctx.published !== true) {
      refuse("published-not-allowed", `${ctx.where}: ${record.id} is a published value (previous-study rows only)`);
    }
    if (record.grade !== "published" && ctx.published === true) {
      refuse("kind-mismatch", `${ctx.where}: previous-study value ${record.id} must be published-grade`);
    }
    if (record.claimId !== null && !ctx.claims.has(record.claimId)) {
      refuse("foreign-claim", `${ctx.where}: ${record.id} belongs to claim ${record.claimId}, not to this figure`);
    }
    if (kinds && !kinds.includes(record.kind)) refuse("kind-mismatch", `${ctx.where}: ${record.id} has kind ${record.kind}, expected ${kinds.join("|")}`);
  }

  fact(id: string, ctx: UseContext, kinds?: readonly FactKind[]): CertifiedFact {
    const record = this.#facts.get(id) ?? refuse("missing-record", `${ctx.where}: no certified fact ${id}`);
    this.#check(record, ctx, kinds);
    return record;
  }

  series(id: string, ctx: UseContext, kinds?: readonly FactKind[]): CertifiedSeries {
    const record = this.#series.get(id) ?? refuse("missing-record", `${ctx.where}: no certified series ${id}`);
    this.#check(record, ctx, kinds);
    return record;
  }

  entity(id: string, where: string): CertifiedEntity {
    return this.#entities.get(id) ?? refuse("missing-record", `${where}: no certified entity ${id}`);
  }

  claim(id: string, where: string): CertifiedClaim {
    return this.#claims.get(id) ?? refuse("missing-record", `${where}: no certified claim ${id}`);
  }

  claimIds(): string[] {
    return [...this.#claims.keys()].sort();
  }

  hasClaim(id: string): boolean {
    return this.#claims.has(id);
  }
}
