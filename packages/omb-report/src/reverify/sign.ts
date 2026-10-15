/**
 * PW8 signed spans. The renderer holds the master key; the drafter never sees it.
 * Every signature is an HMAC-SHA256 over domain-separated canonical JSON under a
 * per-build key derived from the master key, so a span signed for one build never
 * verifies in another. Signatures and build IDs are written with the letters a-p
 * (hex digit d becomes the d-th letter), so signed attributes carry no digits of
 * their own and cannot hide a number from the closed-world check.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from '../../../bio-core/src/index.ts';
import { requireThat } from '../common.ts';

const HEX = '0123456789abcdef';
const LETTERS = 'abcdefghijklmnop';

export function toLetters(hex: string): string {
  requireThat(/^[0-9a-f]+$/u.test(hex), 'letters encoding needs lowercase hex');
  return [...hex].map((c) => LETTERS[HEX.indexOf(c)]!).join('');
}

export function fromLetters(text: string): string {
  requireThat(/^[a-p]+$/u.test(text), 'letters decoding needs a-p');
  return [...text].map((c) => HEX[LETTERS.indexOf(c)]!).join('');
}

export const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');
export const sha256Letters = (text: string): string => toLetters(sha256Hex(text));

/** A build ID binds signatures to one PaperInput and one render. Digit-free by construction. */
export function buildIdFor(paperInputHash: string, nonce: string): string {
  requireThat(/^[0-9a-f]{64}$/u.test(paperInputHash), 'build ID needs the PaperInput sha256');
  requireThat(typeof nonce === 'string' && nonce.length > 0 && nonce.length <= 128, 'build ID needs a nonce');
  return sha256Letters(canonicalJson({ domain: 'omb/pw8/build@1', paperInputHash, nonce }));
}

export class SpanSigner {
  readonly buildId: string;
  readonly #key: Buffer;

  constructor(masterKey: Uint8Array, buildId: string) {
    requireThat(masterKey instanceof Uint8Array && masterKey.length >= 32, 'signing key must be at least 32 bytes');
    requireThat(/^[a-p]{64}$/u.test(buildId), 'build ID must be 64 letters a-p');
    this.buildId = buildId;
    this.#key = createHmac('sha256', Buffer.from(masterKey)).update(`omb/pw8/build-key@1:${buildId}`).digest();
  }

  sign(payload: Readonly<Record<string, unknown>>): string {
    requireThat(typeof payload.d === 'string' && payload.d.startsWith('omb/pw8/'), 'signature payload needs a PW8 domain');
    return toLetters(createHmac('sha256', this.#key).update(canonicalJson({ ...payload, b: this.buildId })).digest('hex'));
  }

  verify(payload: Readonly<Record<string, unknown>>, signature: string | undefined): boolean {
    if (typeof signature !== 'string' || !/^[a-p]{64}$/u.test(signature)) return false;
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
