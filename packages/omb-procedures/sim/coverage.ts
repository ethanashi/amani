/**
 * Real interval coverage (audit 2): the PUBLIC procedures are run with their default content seeds (B = 999 here)
 * and default diagnostics on data with a known nonzero effect; coverage = share of reported intervals that contain
 * the true value, among datasets the procedure did not refuse. Results: results/v2/coverage.jsonl (cache-keyed).
 *   nice -n 15 node sim/coverage.ts            (runs as 2 worker processes)
 */
import { fork } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng } from '../src/rng.ts';
import { twoGroupWelchPermutation, pairedSignFlip, stratifiedCr2, stratifiedWeightedWelch, olsWildBootstrap, crossoverHillsArmitage, ratioOfGeometricMeans, brunnerMunzelPermutation, binaryRiskDifference } from '../src/index.ts';
import type { Direction } from '../src/special.ts';
import { lawSampler, type Law } from './laws.ts';
import { cellKey, codeHash } from './cache.ts';

const self = fileURLToPath(import.meta.url), root = join(dirname(self), '..'), OUT = join(root, 'results', 'v2', 'coverage.jsonl');
const B = 999, f4 = (x: number) => x.toFixed(4);
const law = (skew: number, tails: Law['tails'], sign: 1 | -1 = 1) => lawSampler({ skew, tails, sign });
const Phi = (x: number) => { let s = 0, t = x, k = 0; const xx = x * x; for (; k < 200; k++) { s += t; t *= xx / (2 * k + 3); } return 0.5 + s * Math.exp(-xx / 2) / Math.sqrt(2 * Math.PI); };

export interface CovCase { id: string; truth: number; direction: Direction; reps: number; run: (rng: Rng) => { status: string; ci: [number, number] } }
export const CASES: CovCase[] = [];
const add = (id: string, truth: number, reps: number, run: CovCase['run'], direction: Direction = 'two-sided') => CASES.push({ id, truth, direction, reps, run });
{
  const n = law(0, 'normal'), s1 = law(1, 'normal'), s1m = law(1, 'normal', -1), t3 = law(0, 't3');
  const arms = (rng: Rng, nA: number, nB: number, la: typeof n, lb: typeof n, sdA: number, sdB: number, shift: number) =>
    ({ a: Array.from({ length: nA }, () => f4(sdA * la.draw(rng))), b: Array.from({ length: nB }, () => f4(shift + sdB * lb.draw(rng))) });
  add('two-group/10v10-normal-d0.5', 0.5, 500, rng => { const d = arms(rng, 10, 10, n, n, 1, 1, 0.5); return twoGroupWelchPermutation({ ...d, decimals: 4, B }); });
  add('two-group/15v45-skew1-opposite-r9-d0.3', 0.3, 500, rng => { const d = arms(rng, 15, 45, s1, s1m, 3, 1, 0.3); return twoGroupWelchPermutation({ ...d, decimals: 4, B }); });
  add('two-group/30v30-t3-d0.5', 0.5, 500, rng => { const d = arms(rng, 30, 30, t3, t3, 1, 1, 0.5); return twoGroupWelchPermutation({ ...d, decimals: 4, B }); });
  add('two-group/30v30-skew1-opposite-d0.3-greater', 0.3, 500, rng => { const d = arms(rng, 30, 30, s1, s1m, 1, 1, 0.3); return twoGroupWelchPermutation({ ...d, decimals: 4, B, direction: 'greater' }); }, 'greater');
  add('paired/10-normal-d1', 1, 500, rng => pairedSignFlip({ units: Array.from({ length: 10 }, () => { const base = 3 * rng.normal(); return { control: [f4(base)], treated: [f4(base + 1 + n.draw(rng))] }; }), decimals: 4, B }));
  add('paired/20-skew1-d0.3', 0.3, 500, rng => pairedSignFlip({ units: Array.from({ length: 20 }, () => { const base = 3 * rng.normal(); return { control: [f4(base)], treated: [f4(base + 0.3 + s1.draw(rng))] }; }), decimals: 4, B }));
  add('cr2/10x(1:2)-normal-d1', 1, 500, rng => stratifiedCr2({ strata: Array.from({ length: 10 }, () => { const base = 2 * rng.normal(); return { a: [f4(base + n.draw(rng)), f4(base + n.draw(rng))], b: [f4(base + 1 + n.draw(rng))] }; }), decimals: 4, B }));
  add('weighted-welch/3x(10v10)-normal-d0.5', 0.5, 300, rng => stratifiedWeightedWelch({ strata: Array.from({ length: 3 }, () => { const s = 3 * rng.normal(); return { a: Array.from({ length: 10 }, () => f4(s + n.draw(rng))), b: Array.from({ length: 10 }, () => f4(s + 0.5 + n.draw(rng))) }; }), decimals: 4, B }));
  add('crossover/12+12-normal-tau1', 1, 500, rng => { const mk = (ab: boolean) => Array.from({ length: 12 }, () => { const s = 50 + 3 * rng.normal(); return [f4(s + (ab ? 1 : 0) + n.draw(rng)), f4(s + 0.5 + (ab ? 0 : 1) + n.draw(rng))] as [string, string]; }); return crossoverHillsArmitage({ ab: mk(true), ba: mk(false), decimals: 4, B }); });
  const reg = (rng: Rng, nn: number, xl: 'normal' | 'binary', het: boolean, l: typeof n, beta: number) => {
    const x = Array.from({ length: nn }, () => (xl === 'normal' ? Math.round(rng.normal() * 100) / 100 : rng.uniform() < 0.5 ? 1 : 0));
    const y = x.map(v => f4(beta * v + (het ? 1 + 2 * Math.min(1, Math.abs(v) / 2) : 1) * l.draw(rng)));
    return olsWildBootstrap({ y: { values: y, decimals: 4 }, x: { values: x.map(String), decimals: 2 }, B });
  };
  add('regression/n30-normalx-homosk-b0.5', 0.5, 300, rng => reg(rng, 30, 'normal', false, n, 0.5));
  add('regression/n30-normalx-abs9-skew1-b0.3', 0.3, 300, rng => reg(rng, 30, 'normal', true, s1, 0.3));
  add('regression/n80-binary-adjusted-b0.6', 0.6, 200, rng => {
    const age = Array.from({ length: 80 }, () => 30 + rng.int(40)), x = age.map(a => (rng.uniform() < 1 / (1 + Math.exp(-(a - 50) / 6)) ? 1 : 0));
    const y = x.map((v, i) => f4(5 + 0.6 * v + 0.05 * (age[i]! - 50) + rng.normal()));
    return olsWildBootstrap({ y: { values: y, decimals: 4 }, x: { values: x.map(String), decimals: 0 }, covariates: [{ values: age.map(String), decimals: 0 }], B });
  });
  add('ratio/20v20-lognormal-sd1-ratio2', 2, 500, rng => ratioOfGeometricMeans({ a: Array.from({ length: 20 }, () => (Math.exp(2 + rng.normal())).toFixed(2)), b: Array.from({ length: 20 }, () => (Math.exp(2 + Math.log(2) + rng.normal())).toFixed(2)), decimals: 2, B }));
  add('brunner-munzel/20v20-normal-shift0.8', Phi(0.8 / Math.SQRT2), 500, rng => { const d = arms(rng, 20, 20, n, n, 1, 1, 0.8); return brunnerMunzelPermutation({ ...d, decimals: 4, B }); });
  add('binary/20v20-0.3v0.6', 0.3, 300, rng => { let xa = 0, xb = 0; for (let i = 0; i < 20; i++) { if (rng.uniform() < 0.3) xa++; if (rng.uniform() < 0.6) xb++; } return binaryRiskDifference({ xa, na: 20, xb, nb: 20 }); });
}

if (process.argv.includes('--worker')) {
  const w = Number(process.argv[process.argv.indexOf('--worker') + 1]), code = codeHash(root);
  process.on('message', (msg: { id: string } | 'exit') => {
    if (msg === 'exit') process.exit(0);
    const cs = CASES.find(c => c.id === msg.id)!, rng = new Rng(`coverage|${cs.id}`), t0 = Date.now();
    let ok = 0, covered = 0, refusedN = 0, lowMiss = 0, highMiss = 0, width = 0;
    for (let r = 0; r < cs.reps; r++) {
      const res = cs.run(rng);
      if (res.status !== 'ok') { refusedN++; continue; }
      ok++; const [lo, hi] = res.ci;
      if (lo <= cs.truth && cs.truth <= hi) covered++; else if (cs.truth < lo) lowMiss++; else highMiss++;
      if (Number.isFinite(hi - lo)) width += hi - lo;
    }
    const line = { id: cs.id, key: cellKey({ id: cs.id, params: { truth: cs.truth, direction: cs.direction } }, 1, cs.reps, B, code), reps: cs.reps, ok, covered, refused: refusedN, lowMiss, highMiss, meanWidth: ok ? width / ok : NaN, direction: cs.direction, truth: cs.truth, ms: Date.now() - t0, code, w };
    appendFileSync(OUT, JSON.stringify(line) + '\n');
    process.send!('ready');
  });
  process.send!('ready');
} else if (process.argv[1] === self) {
  const code = codeHash(root), done = new Set<string>();
  if (existsSync(OUT)) for (const l of readFileSync(OUT, 'utf8').split('\n')) if (l.trim()) done.add(JSON.parse(l).key);
  const queue = CASES.filter(cs => !done.has(cellKey({ id: cs.id, params: { truth: cs.truth, direction: cs.direction } }, 1, cs.reps, B, code))).map(c => c.id);
  console.log(`[coverage] ${queue.length} cases`);
  let live = 2;
  for (let w = 0; w < 2; w++) {
    const child = fork(self, ['--worker', String(w)], { execArgv: process.execArgv });
    child.on('message', () => { const id = queue.shift(); if (id) child.send({ id }); else { child.send('exit'); if (--live === 0) console.log('[coverage] done'); } });
  }
}
