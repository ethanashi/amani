import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Calibration cache admission (audit 8). A stored result is reused only if its key matches the key the current
 * code would produce: the hash of every procedure and generator source file, the cell id and parameters, the stage,
 * the replicate count and the resampling count B. Anything else is stale and is re-run; the report reads only
 * admitted lines.
 */
/** Files whose bytes determine a calibration result: every procedure source, plus the data generators. */
export const GENERATOR_FILES = ['families.ts', 'laws.ts', 'common.ts', 'covering.ts'];
export function codeHash(root: string): string {
  const h = createHash('sha256');
  for (const f of readdirSync(join(root, 'src')).filter(f => f.endsWith('.ts')).sort()) h.update(`src/${f}\n`).update(readFileSync(join(root, 'src', f)));
  for (const f of GENERATOR_FILES) h.update(`sim/${f}\n`).update(readFileSync(join(root, 'sim', f)));
  return h.digest('hex').slice(0, 20);
}

export function cellKey(cell: { id: string; params: unknown }, stage: number, reps: number, B: number, code: string): string {
  return createHash('sha256').update(JSON.stringify({ id: cell.id, params: cell.params, stage, reps, B, code })).digest('hex').slice(0, 24);
}

export function admit(line: { key?: string; [field: string]: unknown }, expected: string): boolean { return line.key === expected; }
