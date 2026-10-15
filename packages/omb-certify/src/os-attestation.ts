import path from 'node:path';
import type { ConfirmMode, OSUserAttestation } from '../../omb-store/src/confirm-runner.ts';
import { effectiveUid, ownerAndMode, systemUid } from './os-probe.ts';
/** Checks a held-out OS-user attestation against the running operating system. The attestation is
 * a host-adapter callback, so its numbers are never trusted on their own: the certifier's effective
 * uid must be the system `_ombcert` account, `_ombrun` must be a distinct system account, the
 * attested uids must equal those accounts, and the store directory and database must be owned by
 * `_ombcert` with no group/other permission bits. Returns null when verified, otherwise the reason.
 * The seal key file is not visible to the certifier (it receives key bytes only); its owner and
 * mode remain the store adapter's attestation. */
export function osAttestationFault(mode:ConfirmMode|undefined,store:{readonly databasePath?:unknown}|null|undefined):string|null {
  if(!mode||mode.kind!=='os-users')return 'held-out confirm mode is not os-users';
  let a:OSUserAttestation;
  try{a=mode.attest();}catch{return 'attestation unavailable';}
  const euid=effectiveUid(),cert=systemUid('_ombcert'),run=systemUid('_ombrun');
  if(euid===null||cert===null||run===null)return 'system accounts _ombcert/_ombrun are not resolvable on this host';
  if(cert<=0||run<=0||cert===run)return 'system accounts _ombcert/_ombrun are not distinct unprivileged users';
  if(!a||typeof a!=='object'||a.certUser!=='_ombcert'||a.runUser!=='_ombrun'||a.certUid!==cert||a.runUid!==run||a.effectiveUid!==euid||euid!==cert||a.storeOwnerUid!==cert||a.keyOwnerUid!==cert)
    return 'attested uids differ from the operating system';
  const db=typeof store?.databasePath==='string'?store.databasePath:null;
  if(!db||!path.isAbsolute(db))return 'store location unavailable for ownership verification';
  for(const file of [path.dirname(db),db]){
    const st=ownerAndMode(file);
    if(!st||st.symlink||st.uid!==cert||(st.mode&0o077)!==0)return 'store ownership or permissions differ from the attestation';
  }
  return null;
}
