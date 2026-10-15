import path from 'node:path';
import { realpathSync } from 'node:fs';
import { OfflineExecutor } from '../../omb-certify/src/index.ts';
import { inside, regular, sha256 } from './files.ts';

/** Supplied by task staging before the first worker turn, never inferred from worker files. */
export interface TaskEnvironment { prefix: string; envFile: string; manifest: string; lockfile: string }
export interface EnvironmentReceipt {
  prefix: string; activation: { script: string; sha256: string };
  pins: Record<string, string>;
}
export function pinTaskEnvironment(input: TaskEnvironment): EnvironmentReceipt {
  const prefix = realpathSync(input.prefix), pins: Record<string, string> = {};
  for (const file of [input.manifest, input.lockfile, path.join(prefix, 'conda-meta/history'),
    path.join(prefix, 'bin/python'), path.join(prefix, 'bin/Rscript')]) {
    const canonical = realpathSync(file);
    if (file.startsWith(prefix + path.sep) && !inside(canonical, prefix)) throw new Error('runtime interpreter escapes prefix');
    pins[canonical] = sha256(regular(canonical, 300_000_000));
  }
  const script = regular(realpathSync(input.envFile), 1_000_000).toString('utf8');
  const receipt = { prefix, pins, activation: { script, sha256: sha256(script) } };
  verifyEnvironment(receipt);
  return receipt;
}
export function verifyEnvironment(receipt: EnvironmentReceipt): void {
  if (realpathSync(receipt.prefix) !== receipt.prefix || sha256(receipt.activation.script) !== receipt.activation.sha256 || Object.keys(receipt.pins).length < 5) throw new Error('runtime receipt invalid');
  for (const [file, hash] of Object.entries(receipt.pins)) if (sha256(regular(file, 300_000_000)) !== hash) throw new Error('trusted analysis environment changed');
}
/** The same activation and read-only runtime are used for the look, rerun and probes. */
export function taskExecutor(stateRoot: string, receipt: EnvironmentReceipt, abortSignal?: AbortSignal): OfflineExecutor {
  verifyEnvironment(receipt);
  const nodeRoot = path.dirname(realpathSync(process.execPath));
  return new OfflineExecutor({ scratchRoot: path.join(stateRoot, 'scratch'),
    toolPath: `${receipt.prefix}/bin:${nodeRoot}:/usr/bin:/bin`, runtimeRoots: [receipt.prefix, nodeRoot],
    timeoutMs: 60_000, activation: receipt.activation, ...(abortSignal ? { abortSignal } : {}),
    faultAt: () => verifyEnvironment(receipt),
  });
}
