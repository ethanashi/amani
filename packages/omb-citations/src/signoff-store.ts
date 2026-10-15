import { dirname } from 'node:path';
import { open } from 'node:fs/promises';
import { canonicalSha256, canonicalJson } from '../../bio-core/src/index.ts';
import type { OwnerSignoff } from './bundle.ts';
/** Exclusive durable record creation. A revision is a new file linking previousHash, never overwrite. */
export async function persistOwnerSignoff(path: string, record: OwnerSignoff): Promise<void> {
  const { hash, ...payload } = record; if (canonicalSha256(payload) !== hash) throw new Error('sign-off record changed');
  const file = await open(path, 'wx', 0o400);
  try { await file.writeFile(canonicalJson(record) + '\n'); await file.sync(); }
  finally { await file.close(); }
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
