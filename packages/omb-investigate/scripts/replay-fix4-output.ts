/** Counterfactual offline replay of a saved analysis, never a mutation of its spent live plan. */
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { certifyDirectory, freezeCode, ContractAuthority, GateAuthority, OfflineExecutor } from '../../omb-certify/src/index.ts';
import { parsePlan, planLockHash } from '../../omb-gauntlet/src/index.ts';
import { hostContractInput } from '../src/kernel.ts';
import { snapshotBundle, treeHash } from '../src/bundle.ts';
import { checkPlan, contractRules } from '../src/plan-check.ts';
import type { ContractPin } from '../src/ports.ts';

const stamp = '20261012210753';
const source = process.argv[2] ?? path.join(process.env.HOME!, '.omerta-bio/v7-smoke', stamp);
const scratch = mkdtempSync(path.resolve('packages/omb-investigate/.fix4-output-'));
const before = process.env.BIO_GRADING_ROOT;
process.env.BIO_GRADING_ROOT = path.join(scratch, 'grading');
const db = new DatabaseSync(path.join(source, 'journal.sqlite'), { readOnly: true });
try {
  const events = db.prepare('select event_type,payload_json from kernel_events where stream_id=?').all(`inv:smoke-p1-esr1-${stamp}`).map(r => ({ type: r.event_type, p: JSON.parse(String(r.payload_json)).data }));
  const stage = events.find(e => e.type === 'phase-completed' && e.p.phase === 'stage')!.p.output;
  const pin = stage.contract as ContractPin, rawDir = stage.staged.contractInput.dir;
  const host = path.join(source, 'host', `smoke-p1-esr1-${stamp}`);
  const original = readFileSync(path.join(host, 'locked/plan.json'), 'utf8');
  const corrected = JSON.parse(original);
  // Preserve every descriptive byte in the designated locked context field. These
  // four names are the exact unsupported narrative keys diagnosed in the saved run.
  const fields = ['estimand_details', 'mei_justification', 'missing_data', 'identifiability'];
  corrected.sharedKnobs ??= {};
  for (const claim of corrected.claims) {
    const descriptions: Record<string, unknown> = {};
    for (const name of fields) if (Object.hasOwn(claim, name)) { descriptions[name] = claim[name]; delete claim[name]; }
    corrected.sharedKnobs[claim.id] = descriptions;
  }
  const text = JSON.stringify(corrected, null, 2) + '\n';
  const locked = path.join(scratch, 'plan.json'); writeFileSync(locked, text);
  const check = checkPlan(text, contractRules(pin.design));
  if (check.status !== 'accepted') throw new Error('corrected plan remains unevaluable');
  const bundle = snapshotBundle(path.join(host, 'bundles/candidate-0'), path.join(scratch, 'bundle'), locked);
  const pixi = realpathSync('packages/bio-baseline/.pixi/envs/default'), node = path.dirname(realpathSync(process.execPath));
  const authority = new GateAuthority(Buffer.alloc(32, 6));
  const executor = new OfflineExecutor({ scratchRoot: path.join(scratch, 'exec'), toolPath: `${pixi}/bin:${node}:/usr/bin:/bin`, runtimeRoots: [pixi, node], timeoutMs: 30_000 });
  const { host: contract } = hostContractInput({ contract: pin, rawDir }, new ContractAuthority(Buffer.alloc(32, 7)));
  const frozen = freezeCode(bundle.dir, path.join(scratch, 'probe'));
  const start = performance.now(), plan = parsePlan(text).plan!;
  const result = await certifyDirectory({ workdir: bundle.dir, rawDir, stateRoot: path.join(scratch, 'state'),
    executionId: 'counterfactual-fix4-p1', lock: { planHash: planLockHash(plan), lockedAt: 1 }, firstLookAt: 2,
    expectedInputHash: treeHash(rawDir), expectedCodeHash: frozen.hash, ...contract,
    authority, executor, now: () => 3, simulations: false, osUserSeparation: false,
  });
  const report = { claims: result.certification.assessments.map(c => ({ claimId: c.claimId, status: c.status, reasons: c.label.reasons })),
    gates: result.gates.map(({ result: g }) => ({ gate: g.gate, claimId: g.claimId ?? null, outcome: g.outcome, summary: g.summary,
      disagreements: g.evidence?.kernelDisagreements ?? null })),
    metrics: Object.fromEntries(result.certification.metrics.values), warnings: result.warnings };
  const evidence = { source, scope: 'Counterfactual offline replay; narrative fields moved into locked sharedKnobs. No live plan/ledger changed. Simulations disabled and G7/G8 unavailable; this is NOT full live acceptance.',
    originalIssues: checkPlan(original, contractRules(pin.design)).issues, correctedPrelockStatus: check.status,
    wallMs: Math.round(performance.now() - start), claims: report.claims.map(c => ({ id: c.claimId, status: c.status, reasons: c.reasons })),
    gates: report.gates, metricKeys: Object.keys(report.metrics), warnings: report.warnings };
  writeFileSync('packages/omb-investigate/integration/fix4-output-replay.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  if (!['G1', 'G1a', 'G3', 'G4'].every(g => report.gates.some(r => r.gate === g && r.outcome === 'passed')) || report.claims[0]?.status !== 'tentative') process.exitCode = 1;
} finally { db.close(); rmSync(scratch, { recursive: true, force: true }); if (before === undefined) delete process.env.BIO_GRADING_ROOT; else process.env.BIO_GRADING_ROOT = before; }
