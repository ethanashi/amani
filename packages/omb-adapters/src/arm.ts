import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexAdapter, type CodexAdapterOptions } from './codex.ts';
import type { WorkerResult, WorkerSpec, ProcessRunner } from './contracts.ts';
import { runProcess } from './process.ts';
import { snapshotDeliverables } from './snapshot.ts';
import { verifyToolpack } from './toolpack.ts';
import { inside, regular, removeScratch, sha256 } from './files.ts';
import { pinTaskEnvironment, verifyEnvironment, type TaskEnvironment, type EnvironmentReceipt } from './environment.ts';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
export const B_G_ARM_ID = 'codex-tools-gauntlet';
export interface ToolsGauntletRequest {
  worker: WorkerSpec;
  adapter: CodexAdapterOptions;
  /** Trusted mailbox root, never under worker scope. Existing in/request.json is host owned. */
  certificationState: string;
  rawDir: string;
  certifyTimeoutMs: number;
  analysisEnvironment?: TaskEnvironment;
}
export interface ToolsGauntletResult {
  arm: typeof B_G_ARM_ID; reserved: true; worker: WorkerResult;
  certification: 'written' | 'unavailable' | 'voided';
  softwareResultsPath: string | null; reportPath: string | null;
  snapshotPath: string; snapshotSha256: string;
  environment?: EnvironmentReceipt;
  toolpackReceipt: { toolpack_profile: 'checks'; toolpack_sha256: string; toolpack_check: 'verified'; toolpack_intact_after_run: boolean; tools_md_sha256: string };
  warnings: string[];
}
/** Host-side composition through trusted CLIs and the integration executor bridge.
 * B gets the pinned checks toolpack; G runs after B's look, even with partial output.
 * V5/V8/V10 supply pre-look lock/route-H/G7 evidence before this reserved arm can count. */
export async function runToolsGauntlet(request: ToolsGauntletRequest, hostRunner: ProcessRunner = runProcess): Promise<ToolsGauntletResult> {
  const work = realpathSync(request.worker.workdir);
  mkdirSync(request.certificationState, { recursive: true, mode: 0o700 });
  const state = realpathSync(request.certificationState);
  if (inside(state, path.resolve(work)) || inside(path.resolve(work), state)) throw new Error('certification state overlaps worker');
  mkdirSync(request.adapter.scratchRoot, { recursive: true, mode: 0o700 });
  const temporary = mkdtempSync(path.join(request.adapter.scratchRoot, 'tools-'));
  try {
    const environment = request.analysisEnvironment && pinTaskEnvironment(request.analysisEnvironment);
    const runtimeReceipt = path.join(temporary, 'runtime.json');
    const envFile = path.join(work, 'env.sh');
    if (environment) {
      if (inside(work, environment.prefix)) throw new Error('runtime contains worker');
      for (const protectedRoot of [state, request.adapter.stateRoot, request.rawDir]) {
        if (inside(protectedRoot, environment.prefix) || inside(environment.prefix, protectedRoot)) throw new Error('runtime overlaps worker or authority');
      }
      writeFileSync(runtimeReceipt, JSON.stringify(environment), { flag: 'wx', mode: 0o400 });
      // A host-staged activation is protected from worker replacement.
      if (request.analysisEnvironment!.envFile !== envFile) copyFileSync(request.analysisEnvironment!.envFile, envFile);
      if (sha256(regular(envFile)) !== environment.activation.sha256) throw new Error('task activation changed');
      chmodSync(envFile, 0o400);
    }
    const bundle = path.join(temporary, 'checks');
    const base = { command: process.execPath, cwd: repo, env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: temporary }, timeoutMs: request.certifyTimeoutMs };
    const built = await hostRunner({ ...base, args: [path.join(repo, 'packages/bio-toolpack/src/build.ts'), 'build', '--profile', 'checks', '--out', bundle] });
    if (built.exitCode !== 0 || built.timedOut || built.signal || built.truncated) throw new Error('checks toolpack source pin/build failed');
    const lock = path.join(repo, 'packages/bio-toolpack/toolpack.lock.json');
    const toolpackHash = verifyToolpack(bundle, lock);
    copyFileSync(path.join(bundle, 'TOOLS.md'), path.join(work, 'TOOLS.md')); chmodSync(path.join(work, 'TOOLS.md'), 0o400);
    const promptFile = path.join(temporary, 'prompt.txt');
    // Bash command substitution strips trailing newlines; B joins the fixed sentence with one space.
    writeFileSync(promptFile, regular(request.worker.promptFile, 16_000_000).toString().replace(/\n+$/, '') + ' ' + readFileSync(path.join(repo, 'packages/bio-toolpack/prompt-sentence.txt'), 'utf8').replace(/\n+$/, ''), { flag: 'wx', mode: 0o400 });
    const worker = await new CodexAdapter({ ...request.adapter,
      toolPath: `${bundle}/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
    }).run({ ...request.worker, promptFile, mounts: [...request.worker.mounts, { path: bundle, mode: 'ro' },
      ...(environment ? [...new Set([environment.prefix, envFile, ...Object.keys(environment.pins)])].map(path => ({ path, mode: 'ro' as const })) : [])] });
    const snapshots = path.join(request.adapter.stateRoot, 'snapshots'); mkdirSync(snapshots, { recursive: true, mode: 0o700 });
    const snapshotParent = mkdtempSync(path.join(snapshots, 'deliverable-')), snapshotPath = path.join(snapshotParent, 'work');
    if (inside(snapshotPath, state) || inside(state, snapshotPath)) throw new Error('snapshot and certification state overlap');
    const snapshot = snapshotDeliverables(work, snapshotPath);
    if (environment) writeFileSync(path.join(snapshotParent, 'environment.json'), JSON.stringify(environment), { flag: 'wx', mode: 0o400 });
    let intact = false; try { intact = verifyToolpack(bundle, lock) === toolpackHash; } catch { /* explicit failed receipt */ }
    const result: ToolsGauntletResult = { arm: B_G_ARM_ID, reserved: true, worker, certification: 'unavailable', softwareResultsPath: null, reportPath: null,
      snapshotPath, snapshotSha256: snapshot.hash, ...(environment ? { environment } : {}), toolpackReceipt: { toolpack_profile: 'checks', toolpack_sha256: toolpackHash, toolpack_check: 'verified', toolpack_intact_after_run: intact, tools_md_sha256: sha256(regular(path.join(bundle, 'TOOLS.md'))) }, warnings: snapshot.warnings };
    if (worker.containment !== 'reaped') {
      result.warnings.push('worker containment failure; frozen partial deliverables retained, certification unavailable');
      return result;
    }
    mkdirSync(state, { recursive: true, mode: 0o700 });
    // The authority is outside the worker scope and never mounted. No agent statuses are used.
    if (environment) try { verifyEnvironment(environment); } catch {
      result.warnings.push('trusted analysis environment changed; certification unavailable'); return result;
    }
    const checked = await hostRunner({ ...base, timeoutSignal: 'SIGTERM', args: [...(environment
      ? [path.join(repo, 'packages/omb-adapters/src/certify-entry.ts'), runtimeReceipt]
      : [path.join(repo, 'packages/omb-certify/src/cli.ts')]), 'certify',
      ...(worker.status === 'violation' ? ['adopt'] : []), snapshotPath, '--state', state, '--raw', request.rawDir] });
    if (worker.status === 'violation') {
      result.certification = 'voided'; result.warnings.push('worker containment violation; retain record, publish no claims');
    } else if (checked.exitCode === 0 && !checked.timedOut && !checked.signal && !checked.truncated) {
      try {
        const results = path.join(state, 'out/results.json'), report = path.join(state, 'out/report.md');
        const parsed = JSON.parse(regular(results).toString()) as { claims?: unknown };
        if (!Array.isArray(parsed.claims)) throw new Error('software claims unavailable');
        regular(report); result.certification = 'written'; result.softwareResultsPath = results; result.reportPath = report;
      } catch { result.warnings.push('certification outputs unavailable'); }
    } else result.warnings.push(`certifier unavailable (exit ${checked.exitCode}, signal ${checked.signal}, timeout ${checked.timedOut}, truncated ${checked.truncated}); worker deliverables retained${checked.stderr ? ': ' + checked.stderr.slice(-2000) : ''}`);
    return result;
  } finally { removeScratch(temporary); }
}
