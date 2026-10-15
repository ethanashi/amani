import type { LockRecord, LockTimeline, PostLookAmendment } from '../../omb-contract/src/index.ts';
import type { ContentTuple } from './primitives.ts';
export type { LockRecord, LockTimeline, PostLookAmendment, ContentTuple };
export type LockInput = LockRecord extends infer R ? R extends LockRecord ? Omit<R, 'sequence' | 'previous_hash' | 'time_ms'> : never : never;
export type PreLookLock = Exclude<LockInput, { stage: 'L6-look-record' | 'L7-post-look-amendment' }>;
export interface UnitIdentity { scope: string; key: string }
export interface PriorExposure { identities: UnitIdentity[]; allocations: ('dev' | 'held-out' | 'excluded')[]; burnRecordHashes: string[] }
export interface PartitionCommitment {
  id: string; datasetId: string; publicContractHash: string; partitionHash: string;
  sourceSpellings: Record<string, string[]>;
  sealedTables: { id: string; headers: string[]; rowCount: number; recordAxis: boolean }[];
  sealedArtifactHash: string; commitmentHash: string; units: { node: string; members: string[]; allocation: 'dev' | 'held-out' | 'excluded'; identities: UnitIdentity[] }[];
}
export interface Attempt { tuple: ContentTuple; tupleHash: string; executionId: string; count: number; first: boolean }
export interface Look {
  policyHash: string;
  datasetId: string; partitionId: string; number: number; label: string; executable: boolean;
  separation: 'single-user' | 'os-users'; claimCeiling: 'Tentative' | 'requires-certification';
  previouslyBurned: UnitIdentity[]; attempt: Attempt; record: LockRecord & { stage: 'L6-look-record' }; hash: string;
}
export interface Claim { id: string; datasetId: string; contractHash: string; payload: unknown }
export interface GateFiring { claimId: string; gate: string; status: 'passed' | 'failed' | 'not-run' | 'unavailable'; binding: { publicContractHash: string; privateContractHash: string | null; partitionHash: string; artifactHash: string; registryVersion: string; calibrationResultHash: string }; evidenceHash: string }
export interface Hypothesis { fingerprint: string; payload: unknown }
export interface AlphaFamily { outcomeDatasetHash: string; outcome: string; exposure: string; contractUnit: string }
export interface AlphaReservation { id: string; family: AlphaFamily; familyHash: string; index: number; threshold: number; exploratory: boolean; planFamily: string | null }
export interface AlphaResult { reservationId: string; p: number | null; rejected: boolean }
export type AmendmentSubmission = { datasetId: string; previousContractHash: string; amendedContractHash: string; outcomeBlind: boolean; changes: { kind: string; [key: string]: unknown }[]; evidenceHash: string; reason: string };
export interface AmendmentDecision extends AmendmentSubmission { allowedKinds: boolean; voidsConfirmed: boolean; requiresBothVersions: true; affectedClaims: string[] }
export interface StoreEvent { sequence: number; time: number; kind: string; payload: unknown; previousHash: string | null; hash: string; authorityMac: string }

export interface DevSchemaView {
  version: 'omb-dev-schema/v1'; partitionHash: string; devUnits: string[];
  tables: { id: string; headers: string[]; rowCount: number; columnCount: number }[];
}
