import type { LockRecord, Look, AmendmentDecision } from '../../omb-store/src/index.ts';
export type { LockRecord, Look, AmendmentDecision };
/** Route-P compatibility records are the authentic V7 ledger events, not fabricated L4 records. */
export interface V7LockRecord {
 stream: 'ledger'; seq: number; at: number; type: 'plan-locked'; prevHash: string | null; hash: string;
 payload: { investigationId:string; datasetId:string; planHash:string; literatureBriefHash?:string; planBytesHash?:string; plainStatement:string; paperSet:string[]; approvalActor:'owner'|'policy' };
}
export interface V7LookRecord {
 stream:'ledger';seq:number;at:number;type:'look-recorded';prevHash:string|null;hash:string;
 payload:{investigationId:string;partitionId:string;executionId:string;frozenCodeHash:string;number:number;executable:boolean};
}
export interface TimestampRecord { planHash:string; at:string; stage1IntroductionHash?:string; literatureBriefHash?:string }
export interface TypedOwnerEvidence { type:'analysis-rerun'|'citation-verdict'|'comprehension-check'|'owner-interpretation'|'author-contact'; sha256:string }
export type PaperLockRecord = LockRecord | V7LockRecord;
export type PaperLook = Look | V7LookRecord;
