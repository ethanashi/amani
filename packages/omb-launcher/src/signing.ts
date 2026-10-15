import { createHmac, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { canonicalJson } from '../../bio-core/src/index.ts';
import { LauncherError } from './process.ts';

/** Separate Ed25519 seed domain; neither the seed nor the store MAC key crosses the launcher. */
function privateKey(hostKey: Uint8Array) {
  if (hostKey.byteLength !== 32) throw new LauncherError('refused', 'authority key length');
  const seed = createHmac('sha256', hostKey).update('omb-launcher/certificate-ed25519/v1').digest();
  try { return createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' }); }
  finally { seed.fill(0); }
}
export function signingPublicKey(hostKey: Uint8Array): string {
  return createPublicKey(privateKey(hostKey)).export({ format: 'der', type: 'spki' }).toString('base64');
}
export interface SignedResult<T = unknown> {
  schema: 'omb-launcher/signed-result/v1'; releaseHash: string; requestHash: string; result: T; signature: string;
}
export function signResult<T>(result: T, releaseHash: string, requestHash: string, hostKey: Uint8Array): SignedResult<T> {
  const body = { schema: 'omb-launcher/signed-result/v1' as const, releaseHash, requestHash, result };
  return { ...body, signature: sign(null, Buffer.from(canonicalJson(body)), privateKey(hostKey)).toString('base64') };
}
/** The key MUST come from a separately verified launcher attestation, never the response itself. */
export function verifyResult<T>(value: unknown, publicKey: string, releaseHash: string, requestHash: string): T {
  try {
    const v = value as SignedResult<T>;
    if (!v || Object.keys(v).sort().join(',') !== 'releaseHash,requestHash,result,schema,signature' || v.schema !== 'omb-launcher/signed-result/v1' || v.releaseHash !== releaseHash || v.requestHash !== requestHash || typeof v.signature !== 'string') throw Error();
    const { signature, ...body } = v;
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(canonicalJson(body)), key, Buffer.from(signature, 'base64'))) throw Error();
    return v.result;
  } catch { throw new LauncherError('invalid-response', 'certificate signature or binding'); }
}
