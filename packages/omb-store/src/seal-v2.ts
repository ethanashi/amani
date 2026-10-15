import { createCipheriv, createDecipheriv, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { fail, key } from './primitives.ts';
export const SEAL_V2_MAGIC = Buffer.from('OMERTA-BIO-SEAL-v2\n');
const label = Buffer.from('omerta-bio/seal/v2/authentication-key\0');
function authenticate(raw: Uint8Array, cipher: Uint8Array): Buffer {
  const authKey = createHmac('sha256', raw).update(label).digest();
  return createHmac('sha256', authKey).update(SEAL_V2_MAGIC).update(cipher).digest();
}
function material(raw: Uint8Array, salt: Uint8Array): Buffer {
  // Port of bio-baseline seal.py: hex passphrase, OpenSSL enc -pbkdf2
  // (10,000 iterations, SHA-256), AES-256-CTR, legacy 8-byte salt framing.
  return pbkdf2Sync(Buffer.from(raw).toString('hex'), salt, 10_000, 48, 'sha256');
}
export function sealV2(plain: Uint8Array, hostKey: Uint8Array, entropy: (n: number) => Uint8Array = randomBytes): Buffer {
  const raw = key(hostKey), salt = Buffer.from(entropy(8));
  if (salt.length !== 8) fail('seal entropy must return eight bytes');
  const m = material(raw, salt), cipher = createCipheriv('aes-256-ctr', m.subarray(0, 32), m.subarray(32));
  const body = Buffer.concat([Buffer.from('Salted__'), salt, cipher.update(plain), cipher.final()]);
  return Buffer.concat([SEAL_V2_MAGIC, authenticate(raw, body), body]);
}
function authenticatedBody(envelope: Uint8Array, hostKey: Uint8Array): Buffer {
  const raw = key(hostKey), snapshot = Buffer.from(envelope), start = SEAL_V2_MAGIC.length;
  if (snapshot.length < start + 48 || !snapshot.subarray(0, start).equals(SEAL_V2_MAGIC)) fail('unknown or truncated seal format');
  const expected = snapshot.subarray(start, start + 32), body = snapshot.subarray(start + 32);
  if (!timingSafeEqual(expected, authenticate(raw, body))) fail('seal MAC mismatch');
  if (body.subarray(0, 8).toString() !== 'Salted__') fail('invalid OpenSSL seal framing');
  return body;
}
/** MAC-only preflight: no decryption or plaintext access. */
export function verifySealV2(envelope: Uint8Array, hostKey: Uint8Array): void { authenticatedBody(envelope, hostKey); }
export function openSealV2(envelope: Uint8Array, hostKey: Uint8Array): Buffer {
  const raw = key(hostKey), body = authenticatedBody(envelope, raw);
  const m = material(raw, body.subarray(8, 16)), cipher = createDecipheriv('aes-256-ctr', m.subarray(0, 32), m.subarray(32));
  return Buffer.concat([cipher.update(body.subarray(16)), cipher.final()]);
}
