import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { assertContext, type ReportContext } from './context.ts';
import { requireThat } from './common.ts';
import { assertVisible, canonicalText } from './normalise.ts';

/** The host authenticates the ENTIRE record with its authority key/store.
 * A payload hash alone is not an authority receipt. Never expose this callback to a drafter. */
export interface PW5Receipt<T> { record: { domain: string; paperHash: string; payload: T }; receipt: string }
export type PW5Authority = (record: unknown, receipt: string) => boolean;
export function readPW5Receipt<T>(ctx: ReportContext, envelope: PW5Receipt<T>, domain: string, verify: PW5Authority): T {
  assertContext(ctx);
  requireThat(envelope?.record?.domain === domain && envelope.record.paperHash === ctx.input.sha256, 'PW5 receipt domain/paper mismatch');
  const copy = structuredClone(envelope);
  requireThat(typeof copy.receipt === 'string' && copy.receipt.length > 0 && verify(copy.record, copy.receipt) === true, 'PW5 host receipt unavailable or invalid');
  // Do not permit a verifier to rewrite what was authenticated.
  requireThat(canonicalSha256(copy) === canonicalSha256(envelope), 'PW5 receipt changed during verification');
  return structuredClone(copy.record.payload);
}
export function pw5Text(value: unknown, label: string): asserts value is string {
  requireThat(typeof value === 'string' && canonicalText(value).length > 0 && !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(value), `missing or invalid ${label}`);
}
export function pw5Hash(value: unknown, label: string): asserts value is string {
  requireThat(typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value), `invalid ${label}`);
}
export function exactKeys(value: object, expected: readonly string[], label: string): void {
  requireThat(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === expected.length && expected.every(k => Object.hasOwn(value, k)), `missing or extra ${label}`);
}

/** Owner identifiers are authenticated identities, not invisible display labels. */
export function assertOwnerActor(value:unknown):asserts value is string {
  pw5Text(value,'owner actor');assertVisible(value);
  requireThat(!/\p{Cf}|\p{Default_Ignorable_Code_Point}/u.test(value)&&(value.match(/[\p{L}\p{N}]/gu)??[]).length>=2,'owner actor needs two visible letters or digits');
}
