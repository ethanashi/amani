/**
 * Calibration work pool (v2). A coordinator hands cells to N worker processes (default 2, run under nice 15).
 * Results go to results/v2/<family>.w<worker>.jsonl, one line per (cell, stage), each carrying a cache key bound to
 * the code hash, cell parameters, stage, replicate count and B (audit 8). Stale or missing lines are re-run.
 *
 * Release rule: stage 1 = 2,000 nulls; a size cell whose stage-1 one-sided 95% Clopper-Pearson upper bound
 * (end-to-end, default diagnostics) exceeds the nominal level on any release test gets 20,000 fresh nulls (new
 * seed) that decide alone.
 *
 *   nice -n 15 node sim/pool.ts --workers 2 two-group:env regression paired:env:primary ...
 * Tokens: family | family:group | family:group:tier.
 */
import { fork } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng } from '../src/rng.ts';
import { clopperPearsonUpper } from '../src/special.ts';
import { FAMILIES, type Cell } from './families.ts';
import { RELEASE_TESTS, TESTS, PRIMARY_LEVEL, type Counts } from './common.ts';
import { cellKey, codeHash } from './cache.ts';

const self = fileURLToPath(import.meta.url), root = join(dirname(self), '..');
export const OUT_DIR = join(root, 'results', 'v2');
mkdirSync(OUT_DIR, { recursive: true });
export const STAGE1 = 2000, STAGE2 = 20000;

export interface StoredLine { id: string; family: string; group: string; kind: string; stage: number; reps: number; B: number; key: string; counts: Counts; params: unknown; ms: number; code: string; tier?: string }

export function loadLines(): Map<string, StoredLine> {
  const m = new Map<string, StoredLine>();
  if (!existsSync(OUT_DIR)) return m;
  for (const f of readdirSync(OUT_DIR).filter(f => f.endsWith('.jsonl') && !['coverage.jsonl', 'binary.jsonl'].includes(f)))
    for (const l of readFileSync(join(OUT_DIR, f), 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l) as StoredLine; m.set(r.key, r); }
  return m;
}
export function needsStage2(cell: Cell, c: Counts): boolean {
  return cell.kind === 'size' && RELEASE_TESTS.some(i => clopperPearsonUpper(c.rej[PRIMARY_LEVEL]![i]!, c.reps) > TESTS[i]!.alpha);
}

interface Job { cell: Cell; stage: 1 | 2; reps: number; key: string }
export interface PoolOptions { workers?: number; stage1?: number; stage2?: number | false; tag?: string }

/** Run (or resume) a list of cells; resolves when every required stage has an admitted line. */
export function runPool(cells: Cell[], opts: PoolOptions = {}): Promise<void> {
  const code = codeHash(root), s1 = opts.stage1 ?? STAGE1, s2 = opts.stage2 === undefined ? STAGE2 : opts.stage2, workers = opts.workers ?? 2;
  const lines = loadLines(), queue: Job[] = [];
  for (const cell of cells) {
    const B = cell.B ?? 999, k1 = cellKey(cell, 1, s1, B, code), l1 = lines.get(k1);
    if (!l1) queue.push({ cell, stage: 1, reps: s1, key: k1 });
    else if (s2 && needsStage2(cell, l1.counts) && !lines.get(cellKey(cell, 2, s2, B, code))) queue.push({ cell, stage: 2, reps: s2, key: cellKey(cell, 2, s2, B, code) });
  }
  const total = queue.length, t0 = Date.now();
  console.log(`[pool${opts.tag ? ' ' + opts.tag : ''}] ${total} jobs (${cells.length} cells), code ${code}, ${workers} workers`);
  if (!total) return Promise.resolve();
  return new Promise(resolve => {
    let live = workers, done = 0;
    for (let w = 0; w < workers; w++) {
      const child = fork(self, ['--worker', String(w), String(s1), String(s2 || 0)], { execArgv: process.execArgv });
      const next = () => {
        const job = queue.shift();
        if (job) child.send(job);
        else { child.send('exit'); if (--live === 0) { console.log(`[pool${opts.tag ? ' ' + opts.tag : ''}] done in ${((Date.now() - t0) / 60000).toFixed(1)} min`); resolve(); } }
      };
      child.on('message', (msg: { followUp?: Job } | 'ready') => {
        if (msg !== 'ready' && msg.followUp) queue.unshift(msg.followUp);
        if (msg !== 'ready' && ++done % 50 === 0) console.log(`[pool${opts.tag ? ' ' + opts.tag : ''}] ${done} stages done, ${queue.length} queued, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
        next();
      });
      child.on('exit', c => { if (c) console.error(`[pool] worker ${w} exited with ${c}`); });
    }
  });
}

if (process.argv.includes('--worker')) {
  const ai = process.argv.indexOf('--worker'), w = Number(process.argv[ai + 1]), s2 = Number(process.argv[ai + 3]);
  const code = codeHash(root);
  process.on('message', (job: Job | 'exit') => {
    if (job === 'exit') process.exit(0);
    const F = FAMILIES[job.cell.family]!, B = job.cell.B ?? 999, t = Date.now();
    const counts = F.runner(job.cell)(new Rng(`${job.cell.id}|stage${job.stage}|B${B}`), job.reps, B);
    const line: StoredLine = { id: job.cell.id, family: job.cell.family, group: job.cell.group, kind: job.cell.kind, stage: job.stage, reps: job.reps, B, key: job.key, counts, params: job.cell.params, ms: Date.now() - t, code, ...(job.cell.tier ? { tier: job.cell.tier } : {}) };
    appendFileSync(join(OUT_DIR, `${job.cell.family}.w${w}.jsonl`), JSON.stringify(line) + '\n');
    let followUp: Job | undefined;
    if (job.stage === 1 && s2 > 0 && needsStage2(job.cell, counts)) followUp = { cell: job.cell, stage: 2, reps: s2, key: cellKey(job.cell, 2, s2, B, code) };
    process.send!(followUp ? { followUp } : {});
  });
  process.send!('ready');
} else if (process.argv[1] === self) {
  const args = process.argv.slice(2), wi = args.indexOf('--workers'), workers = wi >= 0 ? Number(args[wi + 1]) : 2;
  const tokens = args.filter((a, i) => !a.startsWith('--') && (wi < 0 || i !== wi + 1));
  const cells: Cell[] = [];
  for (const token of tokens) {
    const [family, group, tier] = token.split(':') as [string, string | undefined, string | undefined];
    const F = FAMILIES[family]; if (!F) throw new Error(`unknown family ${family}`);
    for (const c of F.cells()) if ((!group || c.group === group) && (!tier || (c.tier ?? 'primary') === tier)) cells.push(c);
  }
  void runPool(cells, { workers });
}
