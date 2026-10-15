import {addReportMetadata} from './report-metadata.ts';
import { randomBytes } from 'node:crypto';
import { computeCardIntegrity, cardIntegrityEvidence } from './card-integrity.ts';
import { existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { materialize, object, type Evidence } from './results.ts';
import { loadTask, readJson, safePath } from './task.ts';

export interface ReplayOptions { task: string; attempt: string; out: string }
/** Diagnosis only: saved worker computation is never executed. Missing card inventories are recomputed in host. */
export function replayAmani(options: ReplayOptions) {
  const taskDir = safePath(options.task), attempt = safePath(options.attempt), out = safePath(options.out);
  for (const root of [taskDir, attempt]) {
    if (insideDirectory(out, root)) throw new Error('replay output must be outside served and attempt directories');
  }
  if (['report.json', 'amani-run.json'].includes(path.basename(out).toLowerCase())) throw new Error('replay cannot write an official report or sidecar filename');
  const task = loadTask(taskDir);
  const saved = readJson(path.join(attempt, '.amani/engine-result.json'));
  if (!object(saved) || !Object.hasOwn(saved, 'draft') || !object(saved.evidence) || !object(saved.evidence.metrics) || !object(saved.evidence.outputs) || !Array.isArray(saved.evidence.claims)) throw new Error('invalid engine-result checkpoint');
  const evidence = saved.evidence as unknown as Evidence;
  let source: 'saved' | 'replay-recomputed' = 'saved';
  if (task.mode === 'card' && (!object(evidence.integrity?.value) || evidence.integrity.value.status !== 'observed')) {
    evidence.integrity = cardIntegrityEvidence(computeCardIntegrity({publicContract: task.publicContract ?? null, dataDir: task.dataRoot, key: randomBytes(32)}));
    source = 'replay-recomputed';
  }
  const resolved = materialize(task.template, saved.draft!, evidence, task);
  const incomplete = saved.status !== 'complete' || saved.simulated === true || resolved.issues.length > 0;
  addReportMetadata(resolved.report, task, incomplete, saved.id ?? 'amani-investigation');
  const result = { replay: true, ...resolved,
    integrity: {source, value: evidence.integrity?.value ?? null, fileSha256: evidence.integrity?.fileSha256 ?? null, identitiesSha256: evidence.integrity?.identities?.fileSha256 ?? null},
    integrityIdentities: evidence.integrity?.identities?.value ?? null };
  mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
  // Exclusive creation also refuses existing symlink/hardlink destinations and preserves past diagnostics.
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600, flush: true });
  return result;
}

/** Inode ancestry handles case aliases according to the actual volume's semantics.
 * Inputs have already been realpathed, including the existing prefix of new outputs. */
function insideDirectory(out: string, root: string): boolean {
  const expected = statSync(root);
  for (let current = out; ; current = path.dirname(current)) {
    if (existsSync(current)) {
      const actual = statSync(current);
      if (actual.dev === expected.dev && actual.ino === expected.ino) return true;
    }
    if (path.dirname(current) === current) return false;
  }
}
