import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hashOf } from '../../../omb-investigate/src/machine.ts';
import type { PhaseMachine } from '../../../omb-investigate/src/machine.ts';
import type { Journal } from '../../../omb-investigate/src/journal.ts';
import { LIVE_DEFAULTS } from '../../../omb-investigate/src/live.ts';
import { git } from './guards.ts';
import type { MedicClass } from './boundary.ts';

export function atomicJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600, flush: true });
  renameSync(tmp, file);
  const fd = openSync(path.dirname(file), 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
}
export function digest(file: string): string { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
export function inventory(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  if (!existsSync(root)) return files;
  const visit = (dir: string): void => {
    for (const n of readdirSync(dir).sort()) {
      const p = path.join(dir, n), st = lstatSync(p);
      if (st.isSymbolicLink() || !st.isDirectory() && !st.isFile()) throw new Error('checkpoint refuses nonregular artifacts');
      if (st.isDirectory()) visit(p); else files[path.relative(root, p)] = digest(p);
    }
  };
  visit(root); return files;
}
export interface EnvironmentManifest {
  node: string; platform: string; arch: string; pixiLockHash: string | null;
  sandboxPolicyHash: string; routing: { codex: string; claude: string }; packageLockHash: string;
  runtimeRoot: string; runtimeIdentity: string | null;
}
export function environmentManifest(repo: string, runtimeRoot: string): EnvironmentManifest {
  const maybe = (p: string) => existsSync(p) ? digest(p) : null;
  return { node: process.version, platform: process.platform, arch: process.arch,
    pixiLockHash: maybe(path.join(repo,'packages/bio-baseline/pixi.lock')),
    sandboxPolicyHash: hashOf(['packages/omb-adapters/src/sandbox.ts','packages/omb-adapters/src/claude-settings.ts','packages/bio-core/src/sandbox/host-sandbox.ts'].map(p => digest(path.join(repo,p)))),
    routing: {codex:process.env.OMB_CODEX_MODEL || 'gpt-6-astra',claude:process.env.OMB_CLAUDE_MODEL || LIVE_DEFAULTS.claudeModel},
    packageLockHash:digest(path.join(repo,'pnpm-lock.yaml')), runtimeRoot,
    runtimeIdentity:maybe(path.join(runtimeRoot,'conda-meta/history')) };
}
export interface FailureRecord {
  schema: 'omb-amani/medic-failure@1'; signature: string; classification: MedicClass; phase: string;
  code: string; diagnostic: string; postExposure: boolean; attemptDir: string;
}
export interface MedicCheckpoint {
  schema:'omb-amani/medic-checkpoint@1'; state:'needs-medic'; id:string; phase:string;
  journal:{sequence:number;hash:string|null}; commit:string; environment:EnvironmentManifest;
  artifacts:Record<string,Record<string,string>>; completed:ReturnType<PhaseMachine['completed']>;
  failure:FailureRecord; hash:string;
}
export function createCheckpoint(o:{root:string;repo:string;machine:PhaseMachine;journal:Journal;environment:EnvironmentManifest;classification:MedicClass;code:string;diagnostic:string}):MedicCheckpoint {
  const {machine}=o, phase=machine.due() ?? 'deliverable';
  const events=o.journal.read(machine.stream), postExposure=machine.notes('look-executing').length>0;
  const failure:FailureRecord={schema:'omb-amani/medic-failure@1',classification:o.classification,phase,code:o.code,
    signature:hashOf({classification:o.classification,phase,code:o.code}),diagnostic:o.diagnostic,
    postExposure,attemptDir:path.dirname(o.root)};
  // Host-only manifest. References remain in place; no copying real inputs to a medic workspace.
  const body={schema:'omb-amani/medic-checkpoint@1' as const,state:'needs-medic' as const,id:machine.stream.slice(4),phase,
    journal:{sequence:events.length,hash:machine.head()},commit:git(o.repo,['rev-parse','HEAD']).trim(),environment:o.environment,
    artifacts:Object.fromEntries(['host','share','work'].map(p=>[p,inventory(path.join(o.root,p))])),completed:machine.completed(),failure};
  const cp={...body,hash:hashOf(body)};
  atomicJson(path.join(o.root,'medic/checkpoint.json'),cp);
  machine.note('needs-medic',{checkpointHash:cp.hash,phase,classification:o.classification,postExposure});
  return cp;
}
export function assertCheckpoint(cp:MedicCheckpoint, environment:EnvironmentManifest):void {
  const {hash,...body}=cp;
  if(hashOf(body)!==hash)throw new Error('medic checkpoint hash mismatch');
  if(hashOf(cp.environment)!==hashOf(environment))throw new Error('resume environment changed');
}
/** Only closed categories cross the boundary, even before exposure. No denylist redaction of
 * arbitrary diagnostics: stderr, paths, model prose and output values are never serialized. */
export function medicPacket(cp:MedicCheckpoint):object {
  const allowedCodes=['host-storage','host-exception','practice-self-check','provider-unavailable','system-bug','incomplete-terminal'];
  return {schema:'omb-amani/medic-request@1',investigation:cp.id,phase:cp.phase,checkpointHash:cp.hash,
    classification:cp.failure.classification,code:allowedCodes.includes(cp.failure.code)?cp.failure.code:'host-exception',
    postExposure:cp.failure.postExposure,environment:cp.environment,baseCommit:cp.commit,
    rules:'packages/omb-amani/MEDIC-RULES.md',
    reproduction:['node','--experimental-transform-types','packages/omb-amani/src/cli.ts','dev-replay','--medic-practice','--inject','write:disk-full'],
    inputPolicy:'Only a host-validated synthetic reproduction may be mounted; official dev-fork inputs are forbidden.'};
}
export function escalate(root:string, cp:MedicCheckpoint, reason:string, report:unknown):void {
  atomicJson(path.join(root,'medic/needs-you.json'),{schema:'omb-amani/needs-you@1',investigation:cp.id,checkpointHash:cp.hash,reason,report});
}

export function assertArtifacts(cp:MedicCheckpoint,root:string,machine:PhaseMachine):void {
  if(hashOf(cp.completed)!==hashOf(machine.completed())||machine.due()!==cp.phase)throw new Error('resume phase identity changed');
  for(const [dir,files] of Object.entries(cp.artifacts))if(hashOf(files)!==hashOf(inventory(path.join(root,dir))))throw new Error(`resume artifact identity changed: ${dir}`);
}
