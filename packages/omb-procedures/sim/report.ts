/**
 * Report (v2): aggregates ADMITTED results (cache key = current procedure + generator code, parameters, stage,
 * reps, B) into results/v2/TABLES.md and results/v2/summary.json.
 *   node sim/report.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clopperPearsonUpper, wilson } from '../src/special.ts';
import { DIAG_LEVELS } from '../src/diagnostics.ts';
import { FAMILIES, type Cell } from './families.ts';
import { lawSampler, lawDescription, contaminationDistance, type AnyLaw, type MixLaw } from './laws.ts';
import { PRIMARY_LEVEL, TEST_NAMES, type Counts } from './common.ts';
import { cellKey, codeHash } from './cache.ts';
import { boundEvidenceVerdict } from './bound-evidence.ts';
import { loadLines, OUT_DIR, STAGE1, STAGE2, type StoredLine } from './pool.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'), code = codeHash(root);
const all = loadLines();
const out: string[] = [], summary: Record<string, unknown> = { code };
const h = (s: string) => out.push(`\n## ${s}\n`);
const table = (head: string[], rows: (string | number)[][]) => { out.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)); };
const pct = (x: number, d = 2) => (Number.isFinite(x) ? `${(100 * x).toFixed(d)}%` : '-');
const L1 = PRIMARY_LEVEL;
const cp = (k: number, n: number) => clopperPearsonUpper(k, n);
const TWO_MAX = 0.0625, DIR_MAX = 0.05, DIR_REF = 0.03125;

// ---------------------------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------------------------
interface Final { cell: Cell; line: StoredLine; c: Counts; stage2: boolean; b999?: Counts }
const finals = new Map<string, Final>();
let admitted = 0;
for (const F of Object.values(FAMILIES)) for (const cell of F.cells()) {
  const B = cell.B ?? 999, l1 = all.get(cellKey(cell, 1, STAGE1, B, code)); if (!l1) continue;
  const l2 = all.get(cellKey(cell, 2, STAGE2, B, code)); admitted += l2 ? 2 : 1;
  const line = l2 ?? l1; finals.set(cell.id, { cell, line, c: line.counts, stage2: !!l2 });
}
// Lines of dynamic cells (adversarial, boundary B=9999): admitted when their stored key equals the key the current code
// gives for their stored id, params, stage, reps and B.
const dynamic = new Map<string, StoredLine>();
for (const l of all.values()) if ((l.id.startsWith('adv/') || l.B !== 999) && l.key === cellKey({ id: l.id, params: l.params }, l.stage, l.reps, l.B, code)) {
  const dk = l.B === 9999 && !l.id.endsWith('@B9999') ? `${l.id}@B9999-same-design` : l.id;
  const prev = dynamic.get(dk); if (!prev || l.stage > prev.stage) dynamic.set(dk, l);
}
// Production-B override: a boundary cell re-run at B = 9,999 (fresh nulls) is decided by that run.
let overridden = 0;
for (const l of dynamic.values()) {
  if (l.B !== 9999) continue;
  const base = finals.get(l.id.replace(/@B9999$/, ''));
  if (base) { finals.set(base.cell.id, { ...base, line: l, c: l.counts, stage2: l.stage === 2, b999: base.c } as Final); overridden++; }
}
const stale = all.size - admitted - dynamic.size;
out.push(`Code hash ${code}. Admitted ${admitted} stage lines for ${finals.size} registered cells and ${dynamic.size} dynamic cells; ${Math.max(0, stale)} stored lines are stale or superseded and ignored. ${overridden} envelope-boundary cells are decided by their production-B (9,999) re-run.`);
out.push(`Rates are END-TO-END Confirmed rates (procedure rejects and no refusal) at the default diagnostic level alpha_d = ${DIAG_LEVELS[L1]} unless stated. Release limits: two-sided .05 test, CP upper <= ${pct(TWO_MAX)}; directional one-sided .025 tests, false-direction CP upper <= ${pct(DIR_MAX)} (owner, round 2; ${pct(DIR_REF)} shown for reference).`);

const verdict = (c: Counts, l = L1) => {
  const two = cp(c.rej[l]![0]!, c.reps), one = Math.max(cp(c.rej[l]![1]!, c.reps), cp(c.rej[l]![2]!, c.reps));
  return { two, one, passTwo: two <= TWO_MAX, passDir: one <= DIR_MAX, passRef: one <= DIR_REF };
};
const byFamily = (fam: string, pred: (f: Final) => boolean) => [...finals.values()].filter(f => f.cell.family === fam && pred(f));
const families = Object.keys(FAMILIES);

// ---------------------------------------------------------------------------------------------
// 1. Release grid
// ---------------------------------------------------------------------------------------------
h('1. Release grid (covering array, corners, re-probe designs, liveness nulls, lattice laws, audit counterexample)');
const relRows: (string | number)[][] = [];
for (const fam of families) {
  const fs = byFamily(fam, f => f.cell.kind === 'size' && !f.cell.group.startsWith('env'));
  if (!fs.length) continue;
  const v = fs.map(f => verdict(f.c)), v0 = fs.map(f => verdict(f.c, 0));
  relRows.push([fam, fs.length, fs.filter(f => f.stage2).length, `${v.filter(x => x.passTwo).length} / ${v.filter(x => x.passDir).length} / ${v.filter(x => x.passRef).length}`, `${v0.filter(x => x.passTwo).length} / ${v0.filter(x => x.passDir).length}`]);
}
table(['family', 'cells', 'stage-2 runs', 'pass with diagnostics: two-sided 6.25% / directional 5% / directional 3.125%', 'pass without diagnostics: two-sided / directional 5%'], relRows);
h('Failing or notable release cells');
const notable: (string | number)[][] = [];
for (const f of [...finals.values()].sort((a, b) => a.cell.id.localeCompare(b.cell.id))) {
  if (f.cell.kind !== 'size' || f.cell.group.startsWith('env')) continue;
  const v = verdict(f.c), c = f.c, show = !v.passTwo || !v.passDir || ['reprobe', 'live', 'adv-fixed', 'lattice'].includes(f.cell.group);
  if (!show) continue;
  notable.push([f.cell.id, c.reps, `${pct(c.rej[0]![0]! / c.reps)} -> ${pct(c.rej[L1]![0]! / c.reps)} (${pct(v.two)})`, `${pct(Math.max(c.rej[L1]![1]!, c.rej[L1]![2]!) / c.reps)} (${pct(v.one)})`, pct(c.refused[L1]! / c.reps, 1), v.passTwo ? 'pass' : 'FAIL', v.passDir ? 'pass' : 'FAIL']);
}
table(['cell', 'nulls', 'two-sided: no diag -> diag (CP up)', 'worse one-sided tail, diag (CP up)', 'refused (diag)', 'two-sided 6.25%', 'directional 5%'], notable);

// ---------------------------------------------------------------------------------------------
// 2. Envelopes over the calibration families
// ---------------------------------------------------------------------------------------------
interface LawInfo { skew: number; r: number; tails: string }
function lawInfo(f: Final): LawInfo | null {
  const p = f.cell.params as Record<string, any>, sk = (l: any) => (l && 'skew' in l ? l.skew : NaN), tl = (l: any) => (l && 'tails' in l ? l.tails : 'other');
  switch (f.cell.family) {
    case 'two-group': return { skew: Math.max(sk(p.lawA), sk(p.lawB)), tails: tl(p.lawA), r: (Math.max(p.sdA, p.sdB) / Math.min(p.sdA, p.sdB)) ** 2 };
    case 'weighted-welch': return { skew: Math.max(sk(p.lawA), sk(p.lawB)), tails: tl(p.lawA), r: (Math.max(p.sdA, p.sdB) / Math.min(p.sdA, p.sdB)) ** 2 };
    case 'paired': return { skew: sk(p.law), tails: tl(p.law), r: p.r };
    case 'cr2': return { skew: sk(p.law), tails: tl(p.law), r: Math.max(p.sdT / p.sdC, p.sdC / p.sdT) ** 2 };
    case 'crossover': return { skew: Math.max(sk(p.lawP1), sk(p.lawP2)), tails: tl(p.lawP1), r: Math.max(p.sdAB / p.sdBA, p.sdBA / p.sdAB) ** 2 };
    case 'regression': return { skew: sk(p.law), tails: tl(p.law), r: p.het === 'none' ? 1 : 9 };
  }
  return null;
}
const SUBSETS: [string, (l: LawInfo) => boolean][] = [
  ['all calibration laws (|skew|<=1, ratio<=9, t3)', () => true], ['ratio 1 only', l => l.r <= 1], ['skew 0 only', l => l.skew === 0], ['normal tails only', l => l.tails === 'normal'],
];
type Split = (f: Final) => [string, number] | null;
const SPLITS: Record<string, Split> = {
  'two-group': f => { const p = f.cell.params as any; const k = [1, 1.5, 2, 3, 4].reduce((a, b) => (Math.abs(b - p.nB / p.nA) < Math.abs(a - p.nB / p.nA) ? b : a)); return [`k=${k}`, p.nA]; },
  paired: f => ['all', (f.cell.params as any).n],
  cr2: f => { const p = f.cell.params as any; return [`stratum ${p.m}:${p.kT}`, p.S]; },
  crossover: f => { const p = f.cell.params as any; return [`k=${+(p.nBA / p.nAB).toFixed(1)}`, p.nAB]; },
  'weighted-welch': f => { const p = f.cell.params as any; return [`S=${p.S}, k=${+(p.nB / p.nA).toFixed(0)}`, p.nA]; },
  regression: f => { const p = f.cell.params as any; return [`${p.xLaw}/${p.cov}`, p.n]; },
};
const envSummary: Record<string, unknown> = {};
for (const fam of Object.keys(SPLITS)) {
  const fs = byFamily(fam, f => f.cell.group.startsWith('env') && f.cell.kind === 'size');
  if (!fs.length) continue;
  for (const [tname, which] of [['two-sided .05 (limit 6.25%)', 'two'], ['directional one-sided .025 (false direction <= 5%)', 'one']] as const) {
    h(`2. Minimum envelope: ${fam}, ${tname}`);
    out.push('Entry = smallest evaluated n such that it and every larger evaluated n pass for every law in the subset (worst CP upper at that n in brackets). ">N" = the largest evaluated N fails.');
    const groups = [...new Set(fs.map(f => SPLITS[fam]!(f)![0]))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const rows: (string | number)[][] = [], fsum: Record<string, Record<string, string>> = {};
    for (const g of groups) {
      const row: (string | number)[] = [g];
      for (const [sname, ok] of SUBSETS) {
        const pts = new Map<number, number>();
        for (const f of fs) { const [gg, n] = SPLITS[fam]!(f)!; if (gg !== g) continue; const li = lawInfo(f); if (!li || !ok(li)) continue; const v = verdict(f.c); pts.set(n, Math.max(pts.get(n) ?? 0, which === 'two' ? v.two : v.one)); }
        const ns = [...pts.keys()].sort((a, b) => a - b), lim = which === 'two' ? TWO_MAX : DIR_MAX;
        let cell = 'n/a';
        if (ns.length) { let i = ns.length - 1; if (pts.get(ns[i]!)! > lim) cell = `>${ns[i]} (${pct(pts.get(ns[i]!)!, 1)})`; else { while (i > 0 && pts.get(ns[i - 1]!)! <= lim) i--; cell = `${ns[i]} (${pct(pts.get(ns[i]!)!, 1)})`; } }
        row.push(cell); (fsum[g] ??= {})[sname] = cell;
      }
      rows.push(row);
    }
    table(['design', ...SUBSETS.map(s => s[0])], rows);
    envSummary[`${fam}|${which}`] = fsum;
  }
}
summary.envelopes = envSummary;

// Regression per fixed design: certified at its own BM df.
{
  const fs = byFamily('regression', f => f.cell.group === 'env');
  if (fs.length) {
    h('3. Regression: certification per fixed design (each design at its own Bell-McCaffrey df)');
    // Keyed by the actual design (v2 audit 1): every law cell of a key runs on the same fixed X, so all of them must
    // report the same BM df; a mismatch means cells of different designs were pooled, and the report stops.
    const designs = new Map<string, { df: number; two: number; one: number; n: number; label: string; worst: string }>();
    for (const f of fs) {
      const p = f.cell.params as any, key = `${p.xLaw}/${p.cov}/n${p.n}/${p.design}`, v = verdict(f.c), df = f.c.observed?.bmDfMin ?? NaN, dfMax = f.c.observed?.bmDfMedian ?? NaN;
      const e = designs.get(key) ?? { df, two: 0, one: 0, n: p.n, label: key, worst: '' };
      const same = (a: number, b: number) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-9;
      if (!same(df, e.df) || !same(df, dfMax)) throw new Error(`regression design ${key}: BM df differs between its cells (${e.df} vs ${df}); designs are not shared`);
      if (v.two > e.two) e.worst = f.cell.id;
      e.two = Math.max(e.two, v.two); e.one = Math.max(e.one, v.one); designs.set(key, e);
    }
    const degenerate = [...designs.values()].filter(d => !Number.isFinite(d.df));
    const ds = [...designs.values()].filter(d => Number.isFinite(d.df)).sort((a, b) => a.df - b.df);
    table(['design', 'BM df', 'worst two-sided CP up', 'two-sided', 'worst directional CP up', 'directional', 'worst cell'], ds.map(d => [d.label, d.df.toFixed(2), pct(d.two), d.two <= TWO_MAX ? 'pass' : 'FAIL', pct(d.one), d.one <= DIR_MAX ? 'pass' : 'FAIL', d.worst.replace('reg/env/', '')]));
    if (degenerate.length) out.push(`\nDegenerate fixed designs (exposure constant or collinear; every dataset refused, rate 0): ${degenerate.map(d => d.label).join(', ')}.`);
    const thr = (which: 'two' | 'one') => { let t = Infinity; for (let i = ds.length - 1; i >= 0; i--) { if (ds[i]![which] > (which === 'two' ? TWO_MAX : DIR_MAX)) break; t = ds[i]!.df; } return t; };
    const safeDf = (df: number) => Number.isFinite(df) ? (Math.ceil((df - 1e-12) * 10) / 10).toFixed(1) : 'none';
    out.push(`\nBM-df envelope: every evaluated design with df >= ${safeDf(thr('two'))} passes two-sided; every design with df >= ${safeDf(thr('one'))} passes directional.`);
    summary.regressionDf = { two: thr('two'), one: thr('one'), designs: ds };
  }
}

// ---------------------------------------------------------------------------------------------
// 4. Diagnostic trade-off
// ---------------------------------------------------------------------------------------------
h('4. Diagnostic levels: refusal cost and validity effect (envelope cells, calibration laws)');
out.push('For each family and diagnostic level: median refusal share over envelope cells, and the number of envelope cells that pass the two-sided and directional limits (of all envelope cells).');
const trRows: (string | number)[][] = [];
for (const fam of Object.keys(SPLITS)) {
  const fs = byFamily(fam, f => f.cell.group.startsWith('env'));
  if (!fs.length) continue;
  const row: (string | number)[] = [fam, fs.length];
  DIAG_LEVELS.forEach((lev, l) => {
    const refs = fs.map(f => f.c.refused[l]! / f.c.reps).sort((a, b) => a - b), med = refs[Math.floor(refs.length / 2)]!;
    const v = fs.map(f => verdict(f.c, l));
    row.push(`${pct(med, 1)} | ${v.filter(x => x.passTwo).length} / ${v.filter(x => x.passDir).length}`);
  });
  trRows.push(row);
}
table(['family', 'env cells', ...DIAG_LEVELS.map(l => (l === 0 ? 'off' : `alpha_d ${l}`) + ': median refused | pass two / dir')], trRows);

// ---------------------------------------------------------------------------------------------
// 5. Liveness power with diagnostics
// ---------------------------------------------------------------------------------------------
h('5. Liveness designs: power with diagnostics on (alpha_d 0.01) vs the oracle');
const powRows: (string | number)[][] = [];
for (const f of [...finals.values()].filter(f => f.cell.kind === 'power').sort((a, b) => a.cell.id.localeCompare(b.cell.id))) {
  const c = f.c, r = (l: number, i: number) => c.rej[l]![i]! / c.reps, o = (i: number) => (c.oracleRej ? c.oracleRej[i]! / c.reps : NaN);
  powRows.push([f.cell.id, c.reps, `${r(L1, 0).toFixed(3)} / ${o(0).toFixed(3)}`, (r(L1, 0) / o(0)).toFixed(3), (r(0, 0) / o(0)).toFixed(3), pct(c.refused[L1]! / c.reps, 1), `${r(L1, 1).toFixed(3)} / ${o(1).toFixed(3)}`, (r(L1, 1) / o(1)).toFixed(3), `${r(L1, 3).toFixed(3)}`]);
}
table(['design', 'reps', 'two-sided .05: proc (diag) / oracle', 'ratio (diag on)', 'ratio (diag off)', 'refused', 'one-sided .025: proc / oracle', 'ratio', 'one-sided .05 proc'], powRows);
const refRows = [...finals.values()].filter(f => /refute|null$/.test(f.cell.id) && f.cell.kind === 'size').map(f => [f.cell.id, f.c.reps, pct(f.c.refLow[L1]! / f.c.reps), pct(cp(f.c.refLow[L1]!, f.c.reps))]);
if (refRows.length) { out.push(''); table(['liveness null', 'reps', 'P(Refuted | effect = MEI)', 'CP upper'], refRows); }

// ---------------------------------------------------------------------------------------------
// 6. Adversarial search
// ---------------------------------------------------------------------------------------------
const idxFile = join(OUT_DIR, 'adversarial-index.json');
if (existsSync(idxFile)) {
  const idx = JSON.parse(readFileSync(idxFile, 'utf8')) as { screen: any[]; refine: any[]; confirm: any[] };
  const lawFor = (e: any): AnyLaw => ({ kind: 'mix', core: e.core ?? 'uniform', type: e.type, p: e.p, L: e.L, sign: 1 });
  h('6. Adversarial search: confirmed maxima (20,000 fresh nulls) of the end-to-end false-Confirmed rate per corner');
  out.push('Mixture: unit-variance core plus outliers at L core-SDs with probability p (one-point, one-exp = unbounded, two-zeroskew = +L and -2L with skewness solved to 0, the audit shape). "clean share" = share of false Confirmed results from datasets in which NO outlier was drawn.');
  const rows: (string | number)[][] = [];
  for (const e of idx.confirm) {
    const l = dynamic.get(e.id); if (!l) continue;
    const c = l.counts, s = lawSampler(lawFor(e)), two = c.rej[L1]![0]!, one = Math.max(c.rej[L1]![1]!, c.rej[L1]![2]!);
    const cleanShare = c.clean && two ? c.clean.rej[L1]![0]! / two : NaN;
    rows.push([e.corner, e.objective, `${e.type} p=${+e.p.toPrecision(3)} L=${+e.L.toPrecision(3)} ${e.pat} r=${e.r} ${e.core}`, `${(s.skewness).toFixed(2)} / ${(s.kurtosis ?? NaN).toFixed(0)}`,
      `${pct(c.rej[0]![0]! / c.reps)} -> ${pct(two / c.reps)} (${pct(cp(two, c.reps))})`, `${pct(one / c.reps)} (${pct(cp(one, c.reps))})`, `${pct(c.rej[3]![0]! / c.reps)}`, pct(c.refused[L1]! / c.reps, 1), pct(cleanShare, 1),
      cp(two, c.reps) <= TWO_MAX && cp(one, c.reps) <= DIR_MAX ? 'pass' : 'FAIL']);
  }
  table(['corner', 'objective', 'mixture', 'skew / kurtosis', 'two-sided: diag off -> on (CP up)', 'directional (CP up)', 'two-sided at alpha_d 0.1', 'refused', 'clean share', 'verdict'], rows);
  const distOf = (e: any) => contaminationDistance(lawFor(e) as MixLaw);
  h('6b. Screen: worst end-to-end two-sided / directional rate over mixtures whose contamination lies at most K core-SDs from the core mean (300 nulls per cell; indicative)');
  out.push('Distance = the farthest contaminating point: L for one-point, 2L for two-zeroskew (its -2L mass), unbounded for one-exp (appears only in the last column).');
  const corners = [...new Set(idx.screen.map((e: any) => e.corner))];
  const Ks = [3, 10, 30, 100, 600, Infinity];
  const sRows: (string | number)[][] = [];
  for (const corner of corners) {
    const row: (string | number)[] = [corner];
    for (const K of Ks) {
      let w2 = 0, w1 = 0;
      for (const e of idx.screen) { if (e.corner !== corner || distOf(e) > K) continue; const l = dynamic.get(e.id); if (!l) continue; const c = l.counts; w2 = Math.max(w2, c.rej[L1]![0]! / c.reps); w1 = Math.max(w1, Math.max(c.rej[L1]![1]!, c.rej[L1]![2]!) / c.reps); }
      row.push(`${pct(w2, 1)} / ${pct(w1, 1)}`);
    }
    sRows.push(row);
  }
  table(['corner', ...Ks.map(K => (Number.isFinite(K) ? `distance <= ${K}` : 'any (incl. unbounded)'))], sRows);
  h('6c. Screen restricted to zero-skew mixtures (inside |skew| <= 1): worst two-sided / directional rate by outlier distance');
  const zRows: (string | number)[][] = [];
  for (const corner of corners) {
    const row: (string | number)[] = [corner];
    for (const K of Ks) {
      let w2 = 0, w1 = 0;
      for (const e of idx.screen) { if (e.corner !== corner || distOf(e) > K || e.type !== 'two-zeroskew') continue; const l = dynamic.get(e.id); if (!l) continue; const c = l.counts; w2 = Math.max(w2, c.rej[L1]![0]! / c.reps); w1 = Math.max(w1, Math.max(c.rej[L1]![1]!, c.rej[L1]![2]!) / c.reps); }
      row.push(`${pct(w2, 1)} / ${pct(w1, 1)}`);
    }
    zRows.push(row);
  }
  table(['corner', ...Ks.map(K => (Number.isFinite(K) ? `distance <= ${K}` : 'any'))], zRows);
  h('6e. Screen restricted to mixtures with |skewness| <= 1 (the calibration class): worst two-sided / directional rate by outlier distance');
  const skewOf = new Map<string, number>();
  const sk = (e: any) => { const k = `${e.type}|${e.p}|${e.L}`; if (!skewOf.has(k)) { try { skewOf.set(k, Math.abs(lawSampler(lawFor(e)).skewness)); } catch { skewOf.set(k, Infinity); } } return skewOf.get(k)!; };
  const kRows: (string | number)[][] = [];
  for (const corner of corners) {
    const row: (string | number)[] = [corner];
    for (const K of Ks) {
      let w2 = 0, w1 = 0;
      for (const e of idx.screen) { if (e.corner !== corner || distOf(e) > K || sk(e) > 1) continue; const l = dynamic.get(e.id); if (!l) continue; const c = l.counts; w2 = Math.max(w2, c.rej[L1]![0]! / c.reps); w1 = Math.max(w1, Math.max(c.rej[L1]![1]!, c.rej[L1]![2]!) / c.reps); }
      row.push(`${pct(w2, 1)} / ${pct(w1, 1)}`);
    }
    kRows.push(row);
  }
  table(['corner', ...Ks.map(K => (Number.isFinite(K) ? `distance <= ${K}` : 'any (incl. unbounded)'))], kRows);
  summary.adversarial = { confirm: rows };
}

const bIdxFile = join(OUT_DIR, 'adversarial-bound-index.json');
const bRaw = existsSync(bIdxFile) ? JSON.parse(readFileSync(bIdxFile, 'utf8')) : null;
if (bRaw && !Array.isArray(bRaw.corners)) out.push('\n(adversarial-bound-index.json has the pre-v2-audit format and is ignored.)');
if (bRaw && Array.isArray(bRaw.corners)) {
  const bidx = bRaw as { code: string; corners: any[]; screen: any[]; confirm: any[]; picks: { corner: string; objective: 'two' | 'one'; K: number; ids: string[] }[] };
  if (bidx.code !== code) out.push('\n(adversarial-bound-index.json was written by other code; its rows are admitted only where their own cache keys match.)');
  const rateOf = (id: string, obj: 'two' | 'one') => { const l = dynamic.get(id); if (!l) return null; const c = l.counts, k = obj === 'two' ? c.rej[L1]![0]! : Math.max(c.rej[L1]![1]!, c.rej[L1]![2]!); return { rate: k / c.reps, cp: cp(k, c.reps), reps: c.reps }; };
  const lawText = (e: any) => `${e.type} p=${e.p} L=${e.L} (dist ${e.dist}, skew ${Number(e.skew).toFixed(2)}) ${e.pat} r=${e.r}${e.on === 'large' ? ' on large arm' : ''} ${e.core}`;
  h('6d. Bounded contamination at every released boundary corner (v2 audit 2): worst confirmed law per bound K (20,000 fresh nulls)');
  out.push('Law = (1 - p - q) x core (unit-variance uniform, or normal for the twin) + contamination at +L (one-point) or at +L and -2L with skewness 0 (two-zeroskew). Class K = contamination distance (farthest contaminating point from the core mean, core SDs) <= K AND |moment skewness| <= 1. One-exp (unbounded) laws are in no class. Per corner, objective and K: the 3 worst screen laws (1,000 nulls) at the released variance ratios, confirmed with 20,000 fresh nulls, plus a normal-core twin of the worst. Cell = worst confirmed CP upper; limit 6.25% two-sided, 5% directional.');
  const Ks = [3, 2, 1], corners = bidx.corners.map(c => c.name), roleOf = new Map(bidx.corners.map(c => [c.name, c.role ?? 'inside'])), noteOf = new Map(bidx.corners.map(c => [c.name, c.note ?? '']));
  const verdictOf = (corner: string, obj: 'two' | 'one', K: number) => boundEvidenceVerdict(
    bidx.picks, corner, obj, K, bidx.corners.find(c => c.name === corner)?.[obj].length! > 0,
    id => rateOf(id, obj), obj === 'two' ? TWO_MAX : DIR_MAX,
  );
  const rows: (string | number)[][] = [], perK: Record<number, { pass: number; total: number; failures: string[] }> = {}, perCorner: Record<string, number> = {};
  for (const K of Ks) perK[K] = { pass: 0, total: 0, failures: [] };
  for (const corner of corners) {
    const inside = roleOf.get(corner) !== 'outside';
    const row: (string | number)[] = [`${corner}${inside ? '' : ' (outside revised envelope)'}${noteOf.get(corner) ? ` [${noteOf.get(corner)}]` : ''}`];
    for (const K of Ks) {
      const v2 = verdictOf(corner, 'two', K), v1 = verdictOf(corner, 'one', K);
      row.push(v2 ? v2.text : '-', v1 ? v1.text : '-');
      const ok = (!v2 || v2.pass) && (!v1 || v1.pass);
      if (!inside) continue;
      perK[K]!.total++; if (ok) perK[K]!.pass++; else perK[K]!.failures.push(`${corner} (${[v2 && !v2.pass ? `two-sided ${v2.text}` : '', v1 && !v1.pass ? `directional ${v1.text}` : ''].filter(Boolean).join(', ')})`);
    }
    // Largest K whose class passes at this corner, requiring every smaller K to pass too.
    let kmax = 0; for (const K of [1, 2, 3]) { const v2 = verdictOf(corner, 'two', K), v1 = verdictOf(corner, 'one', K); if ((!v2 || v2.pass) && (!v1 || v1.pass)) kmax = K; else break; }
    perCorner[corner] = kmax; row.push(kmax ? `${kmax}` : 'none');
    rows.push(row);
  }
  table(['corner', ...Ks.flatMap(K => [`K=${K} two-sided`, `K=${K} directional`]), 'largest passing K'], rows);
  out.push('');
  out.push('Counts below are over corners INSIDE the revised envelope; rows marked "outside" are the evidence that moved it.');
  table(['bound K', 'inside corners passing both objectives', 'failures (worst confirmed CP upper)'], Ks.map(K => [K, `${perK[K]!.pass} / ${perK[K]!.total}`, perK[K]!.failures.join('; ') || '-']));
  const maxK = Ks.find(K => perK[K]!.pass === perK[K]!.total && perK[K]!.total > 0) ?? 0;
  out.push(`\nLargest bound K certified at EVERY corner inside the revised envelope: ${maxK ? `${maxK} core-SDs` : 'none of 1, 2, 3'}.`);
  h('6d (detail). Every bounded-contamination confirmation');
  table(['corner', 'law', 'nulls', 'two-sided (CP up)', 'directional (CP up)', 'refused', 'clean share'], bidx.confirm.map(e => {
    const l = dynamic.get(e.id); if (!l) return [e.corner, lawText(e), 'pending', '', '', '', ''];
    const c = l.counts, two = c.rej[L1]![0]!, one = Math.max(c.rej[L1]![1]!, c.rej[L1]![2]!), cs = c.clean && two ? c.clean.rej[L1]![0]! / two : NaN;
    return [e.corner, lawText(e), c.reps, `${pct(two / c.reps)} (${pct(cp(two, c.reps))})`, `${pct(one / c.reps)} (${pct(cp(one, c.reps))})`, pct(c.refused[L1]! / c.reps, 1), pct(cs, 1)];
  }));
  summary.bound = { maxK, perK, perCorner };
}

// ---------------------------------------------------------------------------------------------
// 6f. Calibration law generators (v2 audit 4)
// ---------------------------------------------------------------------------------------------
h('6f. Calibration law generators and their skewness convention');
out.push('The skew level of a calibration law is a BODY-SKEW level (the Tukey g of its generator). It equals the moment skewness for normal-tailed and t5-tailed laws; for t3-tailed skewed laws the third moment is infinite, so moment skewness is undefined and these cells validate the body-skew level only, not a moment-skewness bound. Kelly skewness = (Q90 + Q10 - 2 Q50) / (Q90 - Q10).');
table(['tails', 'skew level', 'generator', 'moment skewness', 'Kelly skewness', 'tail index'], (['normal', 't5', 't3'] as const).flatMap(t => [0, 1].map(sk => { const d = lawDescription({ skew: sk, tails: t, sign: 1 }); return [t, sk, d.generator, d.momentSkewness, d.kellySkew.toFixed(3), d.tailIndex]; })));

// ---------------------------------------------------------------------------------------------
// 7. Lattice, coverage, binary, B = 9,999
// ---------------------------------------------------------------------------------------------
h('7. Lattice (discrete) outcomes');
table(['cell', 'nulls', 'two-sided: off -> diag (CP up)', 'directional diag (CP up)', 'refused', 'verdict'], [...finals.values()].filter(f => f.cell.group === 'lattice').sort((a, b) => a.cell.id.localeCompare(b.cell.id)).map(f => {
  const v = verdict(f.c), c = f.c; return [f.cell.id, c.reps, `${pct(c.rej[0]![0]! / c.reps)} -> ${pct(c.rej[L1]![0]! / c.reps)} (${pct(v.two)})`, `${pct(Math.max(c.rej[L1]![1]!, c.rej[L1]![2]!) / c.reps)} (${pct(v.one)})`, pct(c.refused[L1]! / c.reps, 1), v.passTwo && v.passDir ? 'pass' : 'FAIL'];
}));
const covFile = join(OUT_DIR, 'coverage.jsonl');
if (existsSync(covFile)) {
  h('8. Real interval coverage (public procedures, default seeds, intervals actually computed)');
  const lines = readFileSync(covFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter((l: any) => l.code === code);
  table(['case', 'reps', 'not refused', 'coverage (Wilson 95%)', 'misses below / above', 'mean width', 'nominal'], lines.map((l: any) => { const [lo, hi] = wilson(l.covered, l.ok); return [l.id, l.reps, l.ok, `${pct(l.covered / l.ok, 1)} [${pct(lo, 1)}, ${pct(hi, 1)}]`, `${l.lowMiss} / ${l.highMiss}`, Number(l.meanWidth).toPrecision(3), l.direction === 'two-sided' ? '95%' : '95% (one-sided bound, alpha .05)']; }));
}
const binFile = join(OUT_DIR, 'binary.jsonl');
if (existsSync(binFile)) {
  const bl = readFileSync(binFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  h('9. Binary risk difference: CERTIFIED maximum size over the nuisance (grid maxima plus exact TV interval slack)');
  table(['design', 'two-sided .05', 'one-sided .025 greater', 'one-sided .025 less', 'Fisher alone two-sided'], bl.filter((b: any) => !b.power).map((b: any) => [b.id, pct(b.two05.certifiedMax), pct(b.g025.certifiedMax), pct(b.l025.certifiedMax), b.two05.fisherCertifiedMax !== undefined ? pct(b.two05.fisherCertifiedMax) : '-']));
  table(['liveness design', 'two-sided .05', 'one-sided .025', 'one-sided .05', 'Fisher two-sided'], bl.filter((b: any) => b.power).map((b: any) => [b.id, b.power.two05.toFixed(3), b.power.g025.toFixed(3), b.power.g05.toFixed(3), b.power.fisher_two05.toFixed(3)]));
}
const bnd = [...dynamic.values()].filter(l => l.B === 9999);
if (bnd.length) {
  h('10. Envelope-boundary cells re-run at production B = 9,999 (fresh nulls)');
  out.push('Every family re-runs under an @B9999 id (fresh nulls). Regression fixed designs are identified by the design, not the cell id, so the re-run uses the same X.');
  table(['cell', 'nulls', 'B=999 two-sided CP up', 'B=9,999 two-sided CP up', 'B=999 directional CP up', 'B=9,999 directional CP up', 'verdict change'], bnd.sort((a, b) => a.id.localeCompare(b.id)).map(l => {
    const base = finals.get(l.id.replace(/@B9999$/, '')), v = verdict(l.counts), v0 = base?.b999 ? verdict(base.b999) : null;
    return [l.id, l.counts.reps, v0 ? pct(v0.two) : '-', pct(v.two), v0 ? pct(v0.one) : '-', pct(v.one), v0 && (v0.passTwo !== v.passTwo || v0.passDir !== v.passDir) ? 'CHANGED' : '-'];
  }));
}
h('Compute');
const ms: Record<string, number> = {}; for (const l of all.values()) ms[l.family] = (ms[l.family] ?? 0) + l.ms;
table(['family', 'CPU minutes (single core, nice 15)'], Object.entries(ms).map(([f, m]) => [f, (m / 60000).toFixed(1)]));
writeFileSync(join(OUT_DIR, 'TABLES.md'), `# Calibration tables (v2)\n\nGenerated by sim/report.ts from results/v2/*.jsonl. Tests: ${TEST_NAMES.join(', ')}.\n${out.join('\n')}\n`);
writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(`wrote results/v2/TABLES.md (${out.length} lines); admitted ${admitted} + ${dynamic.size} dynamic`);
