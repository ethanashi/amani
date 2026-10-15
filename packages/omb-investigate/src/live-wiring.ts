import {AUTHORITY_PROTOCOL} from '../../omb-launcher/src/authority.ts';
import type {AuthorityPins} from './launcher-native.ts';
import type {OSAttestationResult,LockLedgerPort,StagerPort,ConfirmationPort} from './ports.ts';
interface Wiring {ledger:LockLedgerPort;stager:StagerPort;confirmation?:ConfirmationPort}
/** A verified launcher is necessary, but preparation must also succeed before enabling native
 * confirmation. Refusals stay explicit; there is no late fallback after an authority look. */
export async function selectLiveWiring(o:{attested:OSAttestationResult;fallback:Wiring;prepare:(pins:AuthorityPins)=>Promise<Wiring&{confirmation:ConfirmationPort}>}):Promise<Wiring&{separated:boolean;reason:string}> {
  const a=o.attested.attested?o.attested.attestation:null;
  if(!a||a.authorityProtocol!==AUTHORITY_PROTOCOL||!a.signingPublicKey)return {...o.fallback,separated:false,reason:`degraded single-user mode; labels capped at Tentative: ${o.attested.attested?'installed launcher lacks authority preparation protocol':o.attested.reason}`};
  try {
    const native=await o.prepare({releaseHash:a.releaseHash,signingPublicKey:a.signingPublicKey,authorityProtocol:a.authorityProtocol});
    return {...native,separated:true,reason:`native authority store and confirmation bridge prepared (release ${a.releaseHash}); Confirmed requires software gates and a valid certify ticket`};
  } catch(error) {
    return {...o.fallback,separated:false,reason:`degraded single-user mode; labels capped at Tentative: authority preparation refused (${String((error as Error).message).slice(0,160)})`};
  }
}
