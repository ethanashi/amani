// Usage: node .probe/rm-rand/sim.ts <probe> [nulls]
// Every rejection is counted from the real kernelDecision; G5a from the real nullCalibration.
import { claimOf, dataOf, normal, typeI, g5a, type Rng } from './common.ts';
import { kernelDecision } from '../src/index.ts';

const probe = process.argv[2] ?? 'all', N = Number(process.argv[3] ?? 2000);
const MC = { monteCarlo: { draws: 1999, maxDraws: 1999 } };

/** A: zero null, unbalanced 1 treated : m control rows per unit, treated rows noisier.
 * Equal means in both conditions (mean-difference null is exactly true). */
function hetero(units: number, m: number, sdTreated: number, sdControl: number, intercept = 2) {
  return (rng: Rng) => {
    const x: number[] = [], y: number[] = [], u: string[] = [];
    for (let k = 0; k < units; k++) {
      const b = intercept * normal(rng);
      for (let j = 0; j <= m; j++) { const t = j === 0 ? 1 : 0; x.push(t); u.push('u' + k); y.push(b + (t ? sdTreated : sdControl) * normal(rng)); }
    }
    return dataOf(x, y, u);
  };
}
/** B: zero null, exactly one row per condition (sign-flip path). Treated row is a
 * mean-zero right-skewed lognormal, control row mean-zero normal: equal means. */
function shapePairs(units: number) {
  return (rng: Rng) => {
    const x: number[] = [], y: number[] = [], u: string[] = [];
    for (let k = 0; k < units; k++) {
      const b = 3 * normal(rng);
      x.push(0, 1); u.push('u' + k, 'u' + k);
      y.push(b + .3 * normal(rng), b + Math.exp(1.2 * normal(rng)) - Math.exp(.72));
    }
    return dataOf(x, y, u);
  };
}
/** C: nonzero null, unbalanced 1:2, iid skewed errors within unit, true shift = nullValue.
 * This is the original V2b design (sharp shifted null), now on the model-based path. */
function shiftedSkew(units: number, delta: number, ones = 1, zeros = 2) {
  return (rng: Rng) => {
    const x: number[] = [], y: number[] = [], u: string[] = [];
    for (let k = 0; k < units; k++) {
      const b = 2 * normal(rng);
      for (let j = 0; j < ones + zeros; j++) { const t = j < ones ? 1 : 0; x.push(t); u.push('u' + k); y.push(b + Math.exp(normal(rng)) + delta * t); }
    }
    return dataOf(x, y, u);
  };
}
/** D: zero null, balanced 3:3 per unit, conditions blocked in time (pre/post), AR(1) errors.
 * No condition effect at all; only serial correlation. */
function blockedAR(units: number, rows: number, rho: number) {
  return (rng: Rng) => {
    const x: number[] = [], y: number[] = [], u: string[] = [];
    for (let k = 0; k < units; k++) {
      const b = 2 * normal(rng); let e = normal(rng);
      for (let j = 0; j < rows; j++) { if (j) e = rho * e + Math.sqrt(1 - rho * rho) * normal(rng); x.push(j < rows / 2 ? 0 : 1); u.push('u' + k); y.push(b + e); }
    }
    return dataOf(x, y, u);
  };
}
/** P: positive control, sharp null, unbalanced 1:5, skewed iid errors plus random intercept. */
function sharpControl(units: number, m: number) {
  return (rng: Rng) => {
    const x: number[] = [], y: number[] = [], u: string[] = [];
    for (let k = 0; k < units; k++) { const b = 2 * normal(rng); for (let j = 0; j <= m; j++) { x.push(j === 0 ? 1 : 0); u.push('u' + k); y.push(b + Math.exp(normal(rng))); } }
    return dataOf(x, y, u);
  };
}

async function showG5a(label: string, claim: ReturnType<typeof claimOf>, make: (rng: Rng, i: number) => ReturnType<typeof dataOf>, seed: string, k = 3) {
  const { randomStream } = await import('../src/index.ts');
  const rng = randomStream(seed); const rows: unknown[] = [];
  for (let i = 0, found = 0; found < k && i < 500; i++) {
    const d = make(rng, i), r = kernelDecision(claim, d, seed + ':look:' + i);
    if (r.status !== 'reject') continue; found++;
    const g = await g5a(claim, d, seed + ':' + i);
    rows.push({ dataset: i, kernelStatus: r.status, kernelP: r.decisionP ?? r.p, guarantee: r.guarantee, G5a: g.outcome, waived: g.evidence.waived ?? false, nullGenerator: g.evidence.nullGenerator, stage1: g.evidence.stage1, stage2: g.evidence.stage2 ?? null });
  }
  console.log(JSON.stringify({ experiment: label + ' G5a', results: rows }));
}

const run = async (name: string) => probe === 'all' || probe === name;
if (await run('A')) {
  const c1 = claimOf({ ...MC, direction: 'greater' }), c2 = claimOf({ ...MC, direction: 'two-sided' });
  typeI('A hetero 1:5, sd 5 vs 1, 12 units, greater', c1, N, hetero(12, 5, 5, 1), 'A1');
  typeI('A hetero 1:5, sd 5 vs 1, 12 units, two-sided', c2, N, hetero(12, 5, 5, 1), 'A2');
  typeI('A hetero 1:3, sd 3 vs 1, 30 units, two-sided', c2, N, hetero(30, 3, 3, 1), 'A3');
  // Exhaustive (claimed "exhaustive / exact under exchangeability") orbit: 4^5 = 1024.
  typeI('A hetero 1:3, sd 5 vs 1, 5 units, greater, exhaustive', claimOf({ direction: 'greater' }), N, hetero(5, 3, 5, 1), 'A4');
  await showG5a('A hetero 1:5 12 units greater', c1, hetero(12, 5, 5, 1), 'A1g');
}
if (await run('Adefault')) {
  // Same design, default locked Monte Carlo (9,999 draws + one extension): not an MC-size artifact.
  typeI('A hetero 1:5, default MC settings, greater', claimOf({ direction: 'greater' }), N, hetero(12, 5, 5, 1), 'A1d');
}
if (await run('B')) {
  const c = claimOf({ direction: 'less', test: 'sign-flip' });
  typeI('B 1:1 pairs, lognormal vs normal equal means, 10 units, less (exhaustive sign flip)', c, N, shapePairs(10), 'B1');
  typeI('B 1:1 pairs, lognormal vs normal equal means, 10 units, two-sided', claimOf({ direction: 'two-sided', test: 'sign-flip' }), N, shapePairs(10), 'B2');
  await showG5a('B 1:1 shape pairs less', c, shapePairs(10), 'B1g');
}
if (await run('C')) {
  for (const direction of ['less', 'greater', 'two-sided']) typeI(`C nonzero null .5, 1:2 lognormal iid, 10 units, ${direction}`, claimOf({ direction, nullValue: .5, test: 'sign-flip' }), N, shiftedSkew(10, .5), 'C' + direction);
  typeI('C nonzero null .5, 1:4 lognormal iid, 10 units, less', claimOf({ direction: 'less', nullValue: .5, test: 'sign-flip' }), N, shiftedSkew(10, .5, 1, 4), 'C14');
  await showG5a('C nonzero 1:4 less', claimOf({ direction: 'less', nullValue: .5, test: 'sign-flip' }), shiftedSkew(10, .5, 1, 4), 'Cg');
}
if (await run('D')) {
  typeI('D blocked 3:3 AR(1) rho .9, 10 units, two-sided', claimOf({ ...MC, direction: 'two-sided' }), N, blockedAR(10, 6, .9), 'D1');
  await showG5a('D blocked AR(1)', claimOf({ ...MC, direction: 'two-sided' }), blockedAR(10, 6, .9), 'D1g');
}
if (await run('P')) {
  typeI('P control sharp null 1:5 lognormal + intercept, 12 units, greater', claimOf({ ...MC, direction: 'greater' }), N, sharpControl(12, 5), 'P1');
  typeI('P control sharp null 1:5 lognormal + intercept, 12 units, less', claimOf({ ...MC, direction: 'less' }), N, sharpControl(12, 5), 'P2');
  typeI('P control sharp null 1:3 exhaustive, 5 units, greater', claimOf({ direction: 'greater' }), N, sharpControl(5, 3), 'P3');
}
/** T: sharp null, integer counts at baseline 1e6 with a rare +1 deviation, 1 treated : 3 control. */
function tieCounts(units: number, m: number, pd: number, scale = 1e6) {
  return (rng: Rng) => {
    const x: number[] = [], y: number[] = [], u: string[] = [];
    for (let k = 0; k < units; k++) for (let j = 0; j <= m; j++) { x.push(j === 0 ? 1 : 0); u.push('u' + k); y.push(scale + (rng.uniform() < pd ? 1 : 0)); }
    return dataOf(x, y, u);
  };
}
if (await run('AG')) await showG5a('A hetero 1:5 12 units greater (rejecting datasets)', claimOf({ ...MC, direction: 'greater' }), hetero(12, 5, 5, 1), 'A1g', 4);
if (await run('T')) {
  typeI('T sharp-null integer counts 1e6+Bern(.1), 5 units 1:3, greater (exhaustive)', claimOf({ direction: 'greater' }), N, tieCounts(5, 3, .1), 'T1');
  typeI('T sharp-null integer counts 1e6+Bern(.1), 8 units 1:3, greater (default MC)', claimOf({ direction: 'greater' }), N, tieCounts(8, 3, .1), 'T2');
  await showG5a('T exhaustive ties', claimOf({ direction: 'greater' }), tieCounts(5, 3, .1), 'T1g', 4);
}

if (probe==='ties') {
 for (const [units,baseline,pd,direction] of [[5,1e6,.1,'greater'],[5,1234567.89,.05,'two-sided'],[8,1e6,.1,'greater']] as const) {
  typeI(`ties ${units} units baseline ${baseline} ${direction}`,claimOf({...MC,direction}),N,tieCounts(units,3,pd,baseline),'ties:'+units+':'+baseline);
  typeI(`ties shifted-to-zero ${units} units ${direction}`,claimOf({...MC,direction}),N,tieCounts(units,3,pd,0),'ties:'+units+':'+baseline);
 }
}
