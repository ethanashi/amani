import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { canonicalJson, canonicalSha256 } from '../../bio-core/src/index.ts';
import { exactKeys, requireThat } from '../../omb-report/src/index.ts';
import type { PaperInput } from '../../omb-paper/src/index.ts';
export interface LookLedgerRecord {
 schema:'omb/pw7-look-ledger@1'; keyId:string; lineageId:string; planHash:string; indexHash:string;
 introductionHash:string|null; introductionRecordedAt:number|null;
 ledgerHash:string; looks:{hash:string;at:number}[]; issuedAt:number;
}
export interface LookLedgerReceipt { record:LookLedgerRecord; signature:string }
/** Provisioned by host config, never read from model output or the receipt. */
export interface LedgerTrust { keyId:string; publicKey:KeyObject|string }
export function verifyLedgerReceipt(receipt:LookLedgerReceipt,trust:LedgerTrust):LookLedgerRecord {
 requireThat(receipt&&trust&&typeof receipt.signature==='string','missing signed look-ledger receipt or trust anchor');
 exactKeys(receipt,['record','signature'],'look-ledger receipt');
 const r=receipt.record;exactKeys(r,['schema','keyId','lineageId','planHash','indexHash','introductionHash','introductionRecordedAt','ledgerHash','looks','issuedAt'],'look-ledger record');
 const key=typeof trust.publicKey==='string'?createPublicKey(trust.publicKey):trust.publicKey;
 requireThat(key.asymmetricKeyType==='ed25519'&&r.keyId===trust.keyId&&verify(null,Buffer.from(canonicalJson(r)),key,Buffer.from(receipt.signature,'base64')),'invalid host look-ledger signature');
 requireThat(r.schema==='omb/pw7-look-ledger@1'&&typeof r.lineageId==='string'&&[r.planHash,r.indexHash,r.ledgerHash].every(h=>/^[a-f0-9]{64}$/u.test(h)),'invalid look-ledger binding');
 requireThat(Number.isSafeInteger(r.issuedAt)&&r.issuedAt>=0&&Array.isArray(r.looks),'invalid ledger time');
 for(const look of r.looks){exactKeys(look,['hash','at'],'ledger look');requireThat(/^[a-f0-9]{64}$/u.test(look.hash)&&Number.isSafeInteger(look.at)&&look.at>=0&&look.at<=r.issuedAt,'invalid ledger look');}
 requireThat(new Set(r.looks.map(l=>l.hash)).size===r.looks.length,'duplicate ledger look');
 requireThat((r.introductionHash===null&&r.introductionRecordedAt===null)||(/^([a-f0-9]{64})$/u.test(r.introductionHash??'')&&Number.isSafeInteger(r.introductionRecordedAt)&&r.introductionRecordedAt!>=0&&r.introductionRecordedAt!<=r.issuedAt),'invalid introduction ledger timestamp');
 return structuredClone(r);
}
export function verifyTemporalProof(input:PaperInput,hash:string,initial:LookLedgerReceipt,final:LookLedgerReceipt,trust:LedgerTrust):void {
 const before=verifyLedgerReceipt(initial,trust),after=verifyLedgerReceipt(final,trust);
 for(const r of [before,after])requireThat(r.lineageId===input.lineageId&&r.planHash===canonicalSha256(input.lockedPlan)&&r.indexHash===canonicalSha256(input.frozenLiteratureIndex)&&r.introductionHash===hash,'ledger belongs to another introduction/plan');
 requireThat(before.looks.length===0&&before.introductionRecordedAt!==null,'introduction was not recorded before looks');
 requireThat(after.ledgerHash===canonicalSha256(input.lookLedger)&&canonicalJson(after.looks.map(l=>l.hash).sort())===canonicalJson(input.looks.map(l=>canonicalSha256(l)).sort()),'stale or incomplete look-ledger receipt');
 requireThat(after.looks.length>0&&after.introductionRecordedAt===before.introductionRecordedAt&&after.issuedAt>=before.issuedAt&&before.introductionRecordedAt<Math.min(...after.looks.map(l=>l.at)),'introduction must strictly precede the first ledgered look');
}
