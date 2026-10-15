export * from './identity.ts';
export * from './partitions.ts';
export * from './schema.ts';
export * from './json.ts';
export * from './normalize.ts';
export * from './validate.ts';
export * from './locks.ts';
import { type DataContract, type PublicEnvelope, type PublicLayer, type PrivateLayer } from './schema.ts';
import { contentHash, canonicalJson } from './json.ts';
import { validateDataContract, validatePublicLayer, type ValidationContext } from './validate.ts';

/** Hashing is NOT sealing, signing, producer authentication, or permission to confirm. */
export function buildContract(publicLayer: PublicLayer, privateLayer?: PrivateLayer, context: ValidationContext = {}): DataContract {
  const contract: DataContract = { public: { content: publicLayer, hash: contentHash(publicLayer) }, ...(privateLayer ? { sealed_private: { content: privateLayer, hash: contentHash(privateLayer) } } : {}) };
  const checked = validateDataContract(contract, context);
  if (!checked.ok) throw new Error(checked.errors.join('\n'));
  return JSON.parse(canonicalJson(contract)) as DataContract;
}
/** Only accepts the public envelope. Do not give an analyst process a host DataContract. */
export function analystView(publicEnvelope: PublicEnvelope, context: ValidationContext = {}): PublicEnvelope {
  const checked = validatePublicLayer(publicEnvelope.content, context);
  if (!checked.ok || contentHash(publicEnvelope.content) !== publicEnvelope.hash || Object.keys(publicEnvelope).some(k => !['content', 'hash'].includes(k))) throw new Error('invalid public envelope');
  return JSON.parse(canonicalJson({ content: publicEnvelope.content, hash: publicEnvelope.hash })) as PublicEnvelope;
}
