/**
 * PW8 directed mutation campaign. Each mutant is one exact source edit to a PW8 guard
 * (scripts/pw8-mutants.json, built by build-pw8-mutants.py). The complete PW8 test set runs
 * against every mutant. The source is restored in finally after every run and every source
 * hash is checked at the end. A load error, timeout or run without failed assertions is
 * invalid, never killed. Usage: node packages/omb-report/scripts/pw8-mutate.ts [id-prefix...]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(pkg, '../..');
interface Mutant { id: string; file: string; from: string; to: string }
const catalogue = JSON.parse(readFileSync(path.join(pkg, 'scripts/pw8-mutants.json'), 'utf8')) as { mutants: Mutant[]; omitted: { site: string; reason: string }[] };
interface Run { ok: boolean; failed: string[]; invalid: boolean; ms: number; total: number }

function run(): Run {
  const started = performance.now();
  const args = [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'packages/omb-report/test/pw8-', '--reporter=json', '--maxWorkers=1', '--no-file-parallelism'];
  const out = spawnSync('nice', ['-n', '15', process.execPath, ...args], { cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
  try {
    const report = JSON.parse(out.stdout);
    const failed: string[] = (report.testResults ?? []).flatMap((s: { assertionResults?: { status: string; fullName: string }[] }) => (s.assertionResults ?? []).filter((a) => a.status === 'failed').map((a) => a.fullName));
    const suiteErrors = (report.testResults ?? []).some((s: { status: string; assertionResults?: unknown[] }) => s.status === 'failed' && !(s.assertionResults ?? []).length);
    return { ok: out.status === 0 && report.numPassedTests > 0 && report.numPendingTests === 0, failed, invalid: !!out.error || !report.numTotalTests || suiteErrors || (out.status !== 0 && !failed.length), ms: Math.round(performance.now() - started), total: report.numTotalTests };
  } catch { return { ok: false, failed: [], invalid: true, ms: Math.round(performance.now() - started), total: 0 }; }
}

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const files = [...new Set(catalogue.mutants.map((m) => path.join(pkg, 'src', m.file)))];
const before = new Map(files.map((f) => [f, sha(f)]));
const baseline = run();
if (!baseline.ok) throw new Error('PW8 mutation baseline did not pass');
process.stdout.write(`baseline: ${baseline.total} tests passed in ${baseline.ms} ms\n`);
const selected = process.argv.slice(2);
const results: { id: string; file: string; status: 'killed' | 'survived' | 'invalid'; tests: string[]; ms: number; rerun?: boolean }[] = [];
let firstRun: unknown = null;
for (const m of catalogue.mutants.filter((x) => !selected.length || selected.some((p) => x.id.startsWith(p)))) {
  const file = path.join(pkg, 'src', m.file);
  const original = readFileSync(file, 'utf8');
  if (original.split(m.from).length !== 2) throw new Error(`mutant ${m.id} does not identify exactly one source site`);
  try {
    writeFileSync(file, original.replace(m.from, () => m.to));
    const r = run();
    const status = r.invalid ? 'invalid' : r.failed.length ? 'killed' : 'survived';
    results.push({ id: m.id, file: m.file, status, tests: r.failed, ms: r.ms });
    process.stdout.write(`${m.id}: ${status} (${r.failed.length} failing, ${r.ms} ms)\n`);
  } finally { writeFileSync(file, original); }
}
for (const f of files) if (sha(f) !== before.get(f)) throw new Error(`source not restored: ${f}`);
// PW8_MERGE=1 with selected IDs: re-run those mutants and merge them into the last full report.
// Sound only when tests were added or tightened since that run (that can add kills, never remove them).
const merge = selected.length > 0 && process.env.PW8_MERGE === '1';
if (merge) {
  const previous = JSON.parse(readFileSync(path.join(pkg, 'pw8-mutation-results.json'), 'utf8')) as { results: typeof results; firstRun?: unknown };
  const ids = new Set(catalogue.mutants.map((m) => m.id));
  const byId = new Map(previous.results.filter((r) => ids.has(r.id)).map((r) => [r.id, { ...r, rerun: false }]));
  for (const r of results) byId.set(r.id, { ...r, rerun: true });
  const missing = catalogue.mutants.filter((m) => !byId.has(m.id)).map((m) => m.id);
  if (missing.length) throw new Error(`merge leaves mutants without a result: ${missing.join(', ')}`);
  results.splice(0, results.length, ...catalogue.mutants.map((m) => byId.get(m.id)!));
  firstRun = previous.firstRun ?? { total: previous.results.length, killed: previous.results.filter((r) => r.status === 'killed').length, notKilled: previous.results.filter((r) => r.status !== 'killed').map((r) => `${r.id}: ${r.status}`) };
}
if (!selected.length || merge) {
  const killed = results.filter((r) => r.status === 'killed').length;
  const report = { schema: 'omb-report/pw8-mutations@1', baselineTests: baseline.total, ...firstRun ? { firstRun } : {}, total: results.length, killed, survived: results.filter((r) => r.status === 'survived').map((r) => r.id), invalid: results.filter((r) => r.status === 'invalid').map((r) => r.id), rate: killed / results.length, omitted: catalogue.omitted, results };
  writeFileSync(path.join(pkg, 'pw8-mutation-results.json'), JSON.stringify(report, null, 1) + '\n');
  const cell = (s: string) => s.replace(/\|/gu, '/');
  writeFileSync(path.join(pkg, 'PW8-MUTATION-KILL-TABLE.md'), `# PW8 directed mutation results\n\n${killed}/${results.length} killed (${(100 * killed / results.length).toFixed(1)}%), baseline ${baseline.total} PW8 tests green. Invalid runs count against the denominator. Every source was restored after each run and verified by hash at the end.${firstRun ? `\n\nFirst full run: ${(firstRun as { killed: number; total: number }).killed}/${(firstRun as { total: number }).total} killed. Not killed then: ${(firstRun as { notKilled: string[] }).notKilled.join('; ')}. Tests were added or tightened for each, then those mutants were re-run (marked "re-run" below).` : ''}\n\n| Mutant | File | Outcome | Failing tests (first three) |\n| --- | --- | --- | --- |\n${results.map((r) => `| ${r.id} | ${r.file} | ${r.status}${r.rerun ? ' (re-run)' : ''} | ${cell(r.tests.slice(0, 3).join('; '))}${r.tests.length > 3 ? ` (+${r.tests.length - 3})` : ''} |`).join('\n')}\n\n## Omitted sites\n\n| Site | Reason |\n| --- | --- |\n${catalogue.omitted.map((o) => `| ${cell(o.site)} | ${cell(o.reason)} |`).join('\n')}\n`);
  process.stdout.write(`${killed}/${results.length} killed\n`);
  if (killed !== results.length) process.exitCode = 1;
}
