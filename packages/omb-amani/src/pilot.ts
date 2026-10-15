import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAmani } from './run.ts';
import { safePath } from './task.ts';

/** Registry dispatch: TASK amani ATTEMPT --results-root DIR [--cap-sec N] [--stage-dir DIR]. */
async function main(args: string[]): Promise<void> {
  if (process.env.OMB_AMANI_PILOT_ENABLED !== '1') throw new Error('amani pilot arm is disabled; coordinator registration and explicit OMB_AMANI_PILOT_ENABLED=1 required');
  const [task, arm, attempt, ...rest] = args;
  if (!task || !/^[a-z0-9][a-z0-9-]+$/.test(task) || arm !== 'amani' || !attempt || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(attempt)) throw new Error('expected TASK amani ATTEMPT');
  if (task === 'p16-recovery') throw new Error('native interruption/resume adapter unavailable for p16-recovery');
  let results: string | undefined, stage: string | undefined, cap: number | undefined, dry = false;
  while (rest.length) {
    const name = rest.shift();
    if (name === '--dry-run') { dry = true; continue; }
    const value = rest.shift(); if (!value) throw new Error('missing pilot argument');
    if (name === '--results-root') results = value;
    else if (name === '--stage-dir') stage = value;
    else if (name === '--cap-sec') cap = Number(value);
    else throw new Error(`unknown pilot argument ${name}`);
  }
  if (!results) throw new Error('--results-root is required; no implicit locked pilot path');
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const python = process.env.BIO_TASKS_PYTHON || path.join(repo, 'packages/bio-baseline/.pixi/envs/default/bin/python');
  const invoke = (argv: string[]): string => {
    const p = spawnSync(python, ['-B', '-m', 'biotasks', ...argv], { cwd: repo, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: path.join(repo, 'packages/bio-tasks/lib') }, encoding: 'utf8', timeout: 60_000 });
    if (p.status !== 0) throw new Error(`biotasks ${argv[0]} refused: ${p.stderr.slice(0, 1000)}`);
    return p.stdout.trim();
  };
  const preflight = invoke(['preflight', task]).split(/\s+/);
  cap ??= Number(preflight.at(-1));
  if (!Number.isFinite(cap) || cap <= 0) throw new Error('invalid pilot cap');
  const root = path.join(safePath(results), task); mkdirSync(root, { recursive: true });
  const ownStage = stage ? null : mkdtempSync(path.join(root, '.amani-stage-'));
  try {
    stage = stage ? safePath(stage) : path.join(ownStage!, 'input');
    if (ownStage) invoke(['stage', task, '--out', stage]);
    invoke(['verify-stage', task, stage]);
    const result = await runAmani({ task: stage, out: path.join(root, `amani-${attempt}`), mode: 'pilot', capMinutes: cap / 60, live: !dry && process.env.OMB_LIVE === '1' });
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally { if (ownStage) rmSync(ownStage, { recursive: true, force: true }); }
}
main(process.argv.slice(2)).catch(e => { process.stderr.write(String(e) + '\n'); process.exitCode = 2; });
