import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { IntegrityIdentities } from '../../omb-investigate/src/integrity.ts';
import type { Json } from './results.ts';

/** Separate from worker outputs: only the host deliverable's hash-bound section is admitted. */
export interface IntegrityEvidence { value: Json; fileSha256: string; identities?: {value: IntegrityIdentities; fileSha256: string} }
export function readDeliverableIntegrity(dir: string, files: Record<string, string>): IntegrityEvidence | undefined {
  const expected = files['integrity.json'];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) return undefined;
  let fd: number | undefined;
  try {
    fd = openSync(path.join(dir, 'integrity.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024) return undefined;
    const bytes = readFileSync(fd);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expected) throw new IntegrityChanged('Trusted deliverable integrity hash changed');
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const data = value as Record<string, unknown>;
    if (data.schema !== 'omb-investigate/integrity@1' || !['observed', 'unavailable'].includes(String(data.status))) return undefined;
    return { value: value as Json, fileSha256: actual };
  } catch (error) {
    if (error instanceof IntegrityChanged) throw error;
    return undefined;
  } finally { if (fd !== undefined) closeSync(fd); }
}
export class IntegrityChanged extends Error {}
