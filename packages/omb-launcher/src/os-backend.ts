import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile, chmod, rm, lstat } from 'node:fs/promises';
import { canonicalJson } from '../../bio-core/src/index.ts';
import type { ApplyInput, ApplyOutput, ConfirmBackend } from '../../omb-store/src/confirm-runner.ts';
import { CERT_UID, INSTALL, RESPONSE_CAP, STAGE, WALL_MS } from './constants.ts';
import { boundedProcess, LauncherError, type Execute } from './process.ts';
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export interface Freeze { codeHash: string; artifactHash: string; runtime: 'python' | 'r' }
export interface BackendDeps {
  execute: Execute; id: () => string;
  mkdir: typeof mkdir; writeFile: typeof writeFile; chmod: typeof chmod; rm: typeof rm; lstat: typeof lstat;
  /** Durable authority-store artifact insertion, never a worker callback. */
  persistEvidence: (bytes: Buffer) => string;
  /** Hash of the root-owned audited release, checked by the host before dispatch. */
  releaseHash: string;
}
export function parsePredictions(bytes: Buffer, tokens: string[]): string {
  if (bytes.length > RESPONSE_CAP) throw new LauncherError('response-limit', 'prediction cap exceeded');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  if (lines.shift() !== 'token\tprediction' || lines.length !== tokens.length || !tokens.length || new Set(tokens).size !== tokens.length) throw new LauncherError('invalid-response', 'prediction coverage');
  const remaining = new Set(tokens);
  for (const line of lines) {
    const parts = line.split('\t'); const token = parts[0]!, value = parts[1];
    if (parts.length !== 2 || !remaining.delete(token) || value === undefined || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new LauncherError('invalid-response', 'invalid prediction');
  }
  return text;
}
export function createOSBackend(freeze: Freeze, overrides: Pick<BackendDeps, 'persistEvidence' | 'releaseHash'> & Partial<BackendDeps>): ConfirmBackend {
  const deps: BackendDeps = { execute: boundedProcess(), id: () => randomBytes(16).toString('hex'), mkdir, writeFile, chmod, rm, lstat, ...overrides };
  return { async execute(input: ApplyInput): Promise<ApplyOutput> {
    if (input.runAs !== '_ombrun' || input.network !== 'none' || input.acceptedOutput !== 'predictions.tsv' || !['python', 'r'].includes(freeze.runtime) || !/^[a-f0-9]{64}$/.test(deps.releaseHash) || sha256(input.frozenCode) !== freeze.codeHash || sha256(input.trainingArtifact) !== freeze.artifactHash) throw new LauncherError('refused', 'frozen input mismatch');
    if (input.headers[0] !== 'token' || new Set(input.headers).size !== input.headers.length || input.headers.some(x => typeof x !== 'string' || /[\r\n\t]/.test(x)) || input.rows.some(row => row.length !== input.headers.length)) throw new LauncherError('refused', 'invalid features');
    const tokens = input.rows.map(row => String(row[0]));
    if (!tokens.length || new Set(tokens).size !== tokens.length || tokens.some(t => !/^[a-f0-9]{64}$/.test(t))) throw new LauncherError('refused', 'invalid tokens');
    const stageStat = await deps.lstat(STAGE);
    if (!stageStat.isDirectory() || stageStat.isSymbolicLink() || stageStat.uid !== CERT_UID || (stageStat.mode & 0o7777) !== 0o755) throw new LauncherError('refused', 'invalid stage root');
    const id = deps.id(); if (!/^[a-f0-9]{32}$/.test(id)) throw new LauncherError('refused', 'invalid run id');
    const path = `${STAGE}/${id}`;
    // Exclusive creation: never remove another invocation's stage after EEXIST.
    await deps.mkdir(path, { mode: 0o700 });
    try {
      const cells = (row: unknown[]) => row.map(x => { const s = x === null ? '' : String(x); if (/[\r\n\t]/.test(s)) throw new LauncherError('refused', 'non-TSV feature'); return s; }).join('\t');
      const features = [cells(input.headers), ...input.rows.map(cells)].join('\n') + '\n';
      if (Buffer.byteLength(features) > 64 * 1024 * 1024 || input.frozenCode.length > 4 * 1024 * 1024 || input.trainingArtifact.length > 64 * 1024 * 1024) throw new LauncherError('request-limit', 'staging cap exceeded');
      for (const [name, data] of Object.entries({ release: deps.releaseHash, 'features.tsv': features, 'training.bin': input.trainingArtifact, [freeze.runtime === 'python' ? 'entry.py' : 'entry.R']: input.frozenCode, runtime: freeze.runtime })) {
        const file = `${path}/${name}`;
        await deps.writeFile(file, data, { mode: 0o444, flag: 'wx' });
        // The certifier runs with umask 077; enforce the read-only stage mode
        // explicitly before _ombrun receives access.
        await deps.chmod(file, 0o444);
      }
      await deps.chmod(path, 0o755);
      const bytes = await deps.execute({ command: '/usr/bin/sudo', args: ['-n', '-u', '_ombrun', `${INSTALL}/bin/run-launch`, id], input: Buffer.alloc(0), outputCap: RESPONSE_CAP, timeoutMs: WALL_MS });
      const predictions = parsePredictions(bytes, tokens);
      const evidence = Buffer.from(canonicalJson({ kind: 'seatbelt-no-egress/v1', releaseHash: deps.releaseHash, codeHash: freeze.codeHash, artifactHash: freeze.artifactHash, predictionHash: sha256(bytes), runId: id }));
      const evidenceHash = deps.persistEvidence(evidence);
      if (evidenceHash !== sha256(evidence)) throw new LauncherError('execution', 'evidence persistence mismatch');
      return { files: { 'predictions.tsv': predictions }, networkEvidence: 'verified-no-egress', evidenceHash };
    } finally { await deps.rm(path, { recursive: true, force: true }); }
  } };
}
