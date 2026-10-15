import { lstatSync, type Stats } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { OSUserAttestation } from '../../omb-store/src/confirm-runner.ts';
import { AUTHORITY, CERT_UID, RUN_UID } from './constants.ts';
import { LauncherError } from './process.ts';
export interface AttestDeps { euid: () => number; uid: (name: string) => number; stat: (path: string) => Pick<Stats, 'uid' | 'mode' | 'nlink' | 'isDirectory' | 'isFile' | 'isSymbolicLink'> }
const defaults: AttestDeps = {
  euid: () => process.geteuid!(),
  uid: name => Number(execFileSync('/usr/bin/id', ['-u', name], { env: {}, encoding: 'utf8' }).trim()),
  stat: lstatSync,
};
export function attest(deps: AttestDeps = defaults): OSUserAttestation {
  const certUid = deps.uid('_ombcert'), runUid = deps.uid('_ombrun'), effectiveUid = deps.euid();
  const root = deps.stat(AUTHORITY), key = deps.stat(`${AUTHORITY}/seal.key`);
  if (certUid !== CERT_UID || runUid !== RUN_UID || effectiveUid !== certUid || !root.isDirectory() || root.isSymbolicLink() || root.uid !== certUid || (root.mode & 0o7777) !== 0o700 || !key.isFile() || key.isSymbolicLink() || key.nlink !== 1 || key.uid !== certUid || (key.mode & 0o7777) !== 0o600) throw new LauncherError('refused', 'OS-user ownership not attested');
  return { certUser: '_ombcert', runUser: '_ombrun', certUid, runUid, effectiveUid, storeOwnerUid: root.uid, storeMode: root.mode & 0o7777, keyOwnerUid: key.uid, keyMode: key.mode & 0o7777 };
}
