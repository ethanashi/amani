import { developmentAuthorized } from './medic-authorization.ts';
import { summarizeAudit } from './adapter-audit.ts';
import { retainAdapterEvidence } from './retain.ts';
import {addReportMetadata} from './report-metadata.ts';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweepTrackedProcesses } from '../../bio-core/src/tracked-cleanup.ts';
import { BoundedProcessRunner, cleanupEvidence, type BoundedCommandResult } from '../../bio-core/src/index.ts';
import { emptyResult, saveJson, weeklyBandsFromEnv, type EngineResult } from './engine.ts';
import { materialize, object, type Json } from './results.ts';
import { exportPilot } from './pilot-export.ts';
import { loadTask, safePath, type Task } from './task.ts';

export interface RunOptions { task: string; out: string; mode?: 'pilot' | 'card'; capMinutes?: number; live?: boolean }
export interface RunDeps {
  now: () => number;
  engine?: (o: { task: Task; root: string; id: string; capMs: number; live: boolean }) => Promise<EngineResult>;
}
export interface RunResult { resultFile: string; sidecar: string; status: string; incomplete: boolean }

export async function runAmani(options: RunOptions, deps: RunDeps = { now: Date.now }): Promise<RunResult> {
  const weeklyQuota = { ...weeklyBandsFromEnv().quota!, override: process.env.OMB_QUOTA_WEEKLY?.trim() || null, development: process.env.OMB_DEVELOPMENT === '1' };
  const capMs = (options.capMinutes ?? 30) * 60_000;
  if (!Number.isFinite(capMs) || capMs < 1) throw new Error('cap-minutes must be finite and positive');
  const taskDir = safePath(options.task), out = safePath(options.out);
  if (out === taskDir || out.startsWith(taskDir + path.sep) || taskDir.startsWith(out + path.sep)) throw new Error('task and output roots must be disjoint');
  mkdirSync(out, { recursive: true, mode: 0o700 });
  if (readdirSync(out).length) throw new Error('output directory must be empty (one investigation per attempt)');
  let task: Task;
  try { task = loadTask(taskDir, options.mode); }
  catch (error) {
    const mode = options.mode ?? (existsSync(path.join(taskDir, 'DATA-CONTRACT.json')) ? 'card' : 'pilot');
    const resultDir = mode === 'pilot' ? path.join(out, 'workdir') : out; mkdirSync(resultDir, { recursive: true, mode: 0o700 });
    saveJson(path.join(resultDir, mode === 'pilot' ? 'results.json' : 'report.json'), { incomplete: true });
    saveJson(path.join(out, 'amani-run.json'), { schema: 'omb-amani/run@1', status: 'invalid-task', incomplete: true, mode, warnings: [String(error)], network: { configured: 'unverified', observed: 'unverified' }, webSearch: { configured: 'unverified', observed: 'unverified' } });
    throw error;
  }
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const root = path.join(out, '.amani'); mkdirSync(root, { mode: 0o700 });
  const startedAt = deps.now(), id = 'amani-investigation';
  const live = options.live ?? process.env.OMB_LIVE === '1';
  const resultDir = task.mode === 'pilot' ? path.join(out, 'workdir') : out;
  mkdirSync(resultDir, { recursive: true, mode: 0o700 });
  const resultFile = path.join(resultDir, task.mode === 'pilot' ? 'results.json' : 'report.json');
  const sidecar = path.join(out, 'amani-run.json');
  let result = emptyResult(id, !live);
  let cleanupReceipt: Omit<BoundedCommandResult, "stdout" | "stderr"> | null = null;
  const finish = () => {
    const resolved = materialize(task.template, result.draft, result.evidence, task);
    const audit = summarizeAudit(result.workerAudit);
    const incomplete = audit.failed || result.warnings.some(w => /process cleanup evidence:/.test(w)) || result.status !== 'complete' || result.simulated || resolved.issues.length > 0;
    const report = resolved.report;
    addReportMetadata(report, task, incomplete, id, result.planAmendments ?? []);
    saveJson(resultFile, report);
    saveJson(sidecar, { schema: 'omb-amani/run@1', investigationId: id, mode: task.mode, status: result.status, incomplete,
      weeklyQuota, cleanup: cleanupReceipt, simulated: result.simulated, startedAt, wallMs: Math.max(0, deps.now() - startedAt), capMs, network: audit.network, webSearch: audit.webSearch, workerAudit: result.workerAudit ?? [],
      diagnostics: existsSync(path.join(root, 'diagnostics/adapters.json')) ? JSON.parse(readFileSync(path.join(root, 'diagnostics/adapters.json'), 'utf8')) : null,
      medicHeals: result.medicHeals ?? [], phases: result.phases ?? [], replans: result.replans ?? [], planAmendments: result.planAmendments ?? [], claims: result.evidence.claims, parks: result.parks, warnings: [...task.warnings, ...result.warnings, ...resolved.warnings], resultIssues: resolved.issues, numberSources: resolved.sources, integrityScope: resolved.integrityScope, deliverable: result.deliverable });
    return { resultFile, sidecar, status: result.status, incomplete };
  };
  finish(); // A valid incomplete record exists even if the subprocess never starts.
  try {
    if (deps.engine) result = await deps.engine({ task, root, id, capMs, live });
    else {
      const configFile = path.join(root, 'config.json');
      saveJson(configFile, { taskDir: task.dir, mode: task.mode, expectedManifestHash: task.expectedManifestHash, root, repoRoot, id, capMs, live, medic:developmentAuthorized() });
      const grading = path.join(root, 'grading'); mkdirSync(grading);
      const child = await new BoundedProcessRunner({ now: deps.now, sweepProcesses: sweepTrackedProcesses }).run({
        command: process.execPath, args: ['--experimental-transform-types', '--no-warnings', fileURLToPath(new URL('./engine.ts', import.meta.url)), configFile],
        cwd: repoRoot, cleanupCwd: out, env: { ...process.env, BIO_GRADING_ROOT: grading, PYTHONDONTWRITEBYTECODE: '1' }, timeoutMs: capMs, nice: 10, maxOutputBytes: 128_000, settleMs: 20,
      });
      const { stdout: _stdout, stderr: _stderr, ...receipt } = child;
      cleanupReceipt = receipt;
      saveJson(path.join(root, 'cleanup.json'), cleanupReceipt);
      const checkpoint = path.join(root, 'engine-result.json');
      if (existsSync(checkpoint)) result = JSON.parse(readFileSync(checkpoint, 'utf8')) as EngineResult;
      if (child.timedOut || child.exitCode !== 0) { result.status = child.timedOut ? 'cap-reached' : 'error'; result.warnings.push(`engine exit ${child.exitCode}; ${child.signal ?? 'no signal'}`); }
      if (cleanupEvidence(child) === 'unproven') {
        const reason = child.cleanupReason === 'unattributed' || child.cleanupReason === 'survivor' || child.cleanupReason === 'groups-alive' ? child.cleanupReason : 'inspection-failed';
        result.warnings.push(`process cleanup evidence: ${reason}: ${child.cleanupDiagnostic ?? (reason === 'survivor' ? 'tracked process remained after group cleanup; see cleanup receipt' : reason === 'groups-alive' ? 'owned process groups remained after cleanup' : child.cleanupReason || 'missing or inconsistent cleanup receipt')}`);
      }
      writeFileSync(path.join(root, 'engine.log'), child.stderr + '\n' + child.stdout, { mode: 0o600 });
    }
  } catch (e) {
    const checkpoint = path.join(root, 'engine-result.json');
    if (existsSync(checkpoint)) { try { result = JSON.parse(readFileSync(checkpoint, 'utf8')) as EngineResult; } catch { /* preserve the last in-memory result */ } }
    result.status = 'error'; result.warnings.push(String(e));
  }
  finally {
    // A capped engine may never execute its finally. Repeat bounded retention here.
    rmSync(path.join(root, 'host.key'), { force: true });
    if (process.env.AMANI_KEEP_DIAGNOSTICS === '1') { try { retainAdapterEvidence(root); } catch { result.warnings.push('adapter diagnostics retention failed'); } }
    // Evidence survives; mutable worker/auth and execution scratch do not.
    for (const rel of (result.status === 'needs-medic' || process.env.AMANI_KEEP_DIAGNOSTICS === '1' ? ['adapters'] : ['work', 'adapters', 'kernel'])) rmSync(path.join(root, rel), { recursive: true, force: true });
  }
  if (task.mode === 'pilot') {
    exportPilot(task, result, out);
    cpSync(task.dataRoot, path.join(out, 'data'), { recursive: true });
    cpSync(path.join(task.dir, 'TASK.md'), path.join(out, 'TASK.md'));
    if (existsSync(path.join(task.dir, 'manifest.json'))) cpSync(path.join(task.dir, 'manifest.json'), path.join(out, 'manifest.json'));
    if (result.deliverable && existsSync(path.join(result.deliverable, 'report.md'))) cpSync(path.join(result.deliverable, 'report.md'), path.join(resultDir, 'REPORT.md'));
    else writeFileSync(path.join(resultDir, 'REPORT.md'), 'Amani investigation incomplete. See ../amani-run.json.\n');
    saveJson(path.join(out, 'meta.json'), { arm: 'amani', task_id: task.datasetId, status: result.status, model: process.env.OMB_CODEX_MODEL || 'gpt-6-astra', dry_run: !live, contaminated: 'no-transcript' });
  }
  return finish();
}
