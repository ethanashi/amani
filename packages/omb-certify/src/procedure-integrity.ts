import { canonicalSha256 } from '../../bio-core/src/index.ts';
import type { Json } from '../../omb-investigate/src/types.ts';
import { TIERC_REGISTRATIONS, tiercRegistryHash, type TiercKind } from './tierc.ts';
import type { TiercInputSource } from './tierc-plan.ts';

export const PROCEDURE_INTEGRITY_FACT_SCHEMA = 'omb-certify/procedure-integrity-fact@1' as const;
/** Registry metadata: an official output leaf that a registered procedure certifies as a data-integrity
 * fact. It is the only way a procedure output may answer a protected integrity field, and only under
 * its declared scope. Counts are over every input unit; a procedure without a declaration certifies none. */
export interface IntegrityFactDeclaration { readonly fact: string; readonly output: string; readonly pointer: string; readonly scope: 'outcome'; readonly unit: string; readonly description: string }
export interface ProcedureIntegrityFact {
  schema: typeof PROCEDURE_INTEGRITY_FACT_SCHEMA; fact: string; procedure: string; registryHash: string; specId: string;
  /** Qualified transport output key and the JSON Pointer of the certified leaf inside it. */
  output: string; pointer: string; value: Json;
  /** Host-verified input dimension the value is about (the staged table and its outcome column). */
  scope: { kind: 'outcome'; table: string; column: string };
  coverage: { rows: number; trials: number; complete: boolean };
  inputHash: string; planSettingsHash: string;
  /** Tier C certificate: canonicalSha256({official, inputHash, registryHash}); official holds the value. */
  certificate: string;
  /** canonicalSha256 of every other field, so the record's hash covers the value. */
  sha256: string;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hex = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function factLeaf(value: unknown, p: string): unknown {
  let current = value;
  for (const part of p.slice(1).split('/')) { if (!object(current) || !Object.hasOwn(current, part)) return undefined; current = current[part]; }
  return current;
}

/** Records only for a host-built input with complete coverage. A pre-staged trial array carries no
 * host-verified outcome scope, so it certifies no integrity fact. */
export function procedureIntegrityFacts(kind: TiercKind, specId: string, official: Record<string, unknown>, source: TiercInputSource | undefined,
  binding: { inputHash: string; planSettingsHash: string; certificate: string }): ProcedureIntegrityFact[] {
  if (!source || source.kind !== 'arms' || !source.complete) return [];
  const registration = TIERC_REGISTRATIONS[kind];
  return registration.integrityFacts.flatMap(d => {
    const value = factLeaf(official[d.output], d.pointer);
    if (!count(value)) return [];
    const body = { schema: PROCEDURE_INTEGRITY_FACT_SCHEMA, fact: d.fact, procedure: registration.procedureId, registryHash: tiercRegistryHash(kind), specId,
      output: `${specId}.${d.output}`, pointer: d.pointer, value, scope: { kind: d.scope, table: source.table, column: source.column },
      coverage: { rows: source.rows, trials: source.trials, complete: source.complete }, ...binding };
    return [{ ...body, sha256: canonicalSha256(body) }];
  });
}

/** Undefined when the record is intact, declared by the current registry and fully covered. */
export function verifyProcedureIntegrityFact(f: unknown): string | undefined {
  if (!object(f) || f.schema !== PROCEDURE_INTEGRITY_FACT_SCHEMA) return 'unknown integrity fact schema';
  const { sha256, ...body } = f;
  if (sha256 !== canonicalSha256(body as Json)) return 'integrity fact hash mismatch';
  const entry = (Object.entries(TIERC_REGISTRATIONS) as [TiercKind, (typeof TIERC_REGISTRATIONS)[TiercKind]][]).find(([, r]) => r.procedureId === f.procedure);
  if (!entry) return 'integrity fact procedure is not registered';
  const [kind, registration] = entry;
  if (f.registryHash !== tiercRegistryHash(kind)) return 'stale or unknown registry hash';
  const scope = f.scope;
  if (typeof f.specId !== 'string' || !/^[a-z0-9_-]+$/i.test(f.specId) || !object(scope)) return 'malformed integrity fact';
  if (!registration.integrityFacts.some(d => d.fact === f.fact && f.output === `${f.specId}.${d.output}` && f.pointer === d.pointer && scope.kind === d.scope))
    return 'registry does not declare this integrity fact for the procedure';
  if (typeof scope.table !== 'string' || !scope.table || typeof scope.column !== 'string' || !scope.column) return 'integrity fact scope unavailable';
  const c = f.coverage;
  if (!object(c) || c.complete !== true || !count(c.trials) || c.trials < 1 || c.rows !== 2 * c.trials) return 'incomplete integrity fact input coverage';
  if (!count(f.value)) return 'integrity fact value is not a count';
  if (![f.inputHash, f.planSettingsHash, f.certificate].every(hex)) return 'malformed integrity fact certificate';
}
