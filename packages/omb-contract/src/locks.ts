import { array, integer, literal as lit, object as obj, str, nullable, union, type Infer, shapeErrors } from './schema-kit.ts';
import { replicateShape } from './schema.ts';
import { assertJson, contentHash } from './json.ts';
import { IdentityResolver } from './identity.ts';
import { validatePartitionArtifact, type PartitionArtifact } from './partitions.ts';
import type { DataContract } from './schema.ts';
import type { Validation, ValidationContext } from './validate.ts';
const hash = str('^[0-9a-f]{64}$'), id = str('^[A-Za-z][A-Za-z0-9_.:-]*$');
const fields = { sequence: integer(), previous_hash: nullable(hash), time_ms: integer() };
export const amendmentShape = obj({
  version: lit('omb-post-look-amendment/v3.1'), previous_contract_hash: hash, amended_contract_hash: hash,
  previous_partition_hash: hash, amended_partition_hash: hash,
  previous_private_contract_hash: nullable(hash), amended_private_contract_hash: nullable(hash),
  look_record_hash: hash, producer_id: id, outcome_blind: lit(true), post_look: lit(true), reason: str(),
  changes: array(union(
    obj({ kind: lit('coarsen-units'), merges: array(obj({ from_nodes: array(id, 2, true), to_node: id, coarser_level: id, limitation: str() }), 1) }),
    obj({ kind: lit('add-replicate-groups'), groups: array(replicateShape, 1) }),
    obj({ kind: lit('remove-held-out-units'), partition_id: id, nodes: array(id, 1, true) }),
  ), 1),
  acceptance: lit('must-pass-under-both-locked-and-amended-contracts'),
});
export const lockRecordShape = union(
  obj({ ...fields, stage: lit('L7-post-look-amendment'), amendment: amendmentShape, amendment_hash: hash }),
  obj({ ...fields, stage: lit('L0-source-lock'), source_hash: hash }),
  obj({ ...fields, stage: lit('L1-contract-lock'), public_contract_hash: hash, private_contract_hash: nullable(hash) }),
  obj({ ...fields, stage: lit('L2-partition-lock'), partition_hash: hash, public_contract_hash: hash }),
  obj({ ...fields, stage: lit('L3-schema-view'), schema_view_hash: hash, partition_hash: hash, dev_only: lit(true) }),
  obj({ ...fields, stage: lit('L4-plan-lock'), plan_hash: hash, public_contract_hash: hash, partition_hash: hash, registry_version: str(), calibration_result_hash: hash }),
  obj({ ...fields, stage: lit('L5-training'), artifact_hash: hash, frozen_code_hash: hash, plan_hash: hash, dev_only: lit(true) }),
  obj({ ...fields, stage: lit('L6-look-record'), plan_hash: hash, public_contract_hash: hash, private_contract_hash: nullable(hash), partition_hash: hash, artifact_hash: hash, frozen_code_hash: hash, registry_version: str(), calibration_result_hash: hash, attempt: integer(1), fsynced_before_execution: lit(true), durability_receipt_hash: hash }),
);
export const lockTimelineShape = array(obj({ record: lockRecordShape, hash }), 1);
export type LockRecord = Infer<typeof lockRecordShape>;
export type LockTimeline = Infer<typeof lockTimelineShape>;
export type PostLookAmendment = Infer<typeof amendmentShape>;
export const lockTimelineJsonSchema = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...lockTimelineShape.json } as const;
export const postLookAmendmentJsonSchema = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...amendmentShape.json } as const;
export function validateAmendmentDeclaration(value: unknown): Validation<PostLookAmendment> {
  try {
    assertJson(value); const errors = shapeErrors(amendmentShape.json, value);
    if (!errors.length) {
      const a = value as PostLookAmendment;
      if (a.previous_contract_hash === a.amended_contract_hash && a.previous_partition_hash === a.amended_partition_hash && a.previous_private_contract_hash === a.amended_private_contract_hash) errors.push('amendment must change a bound artifact');
      if (a.changes.some(c => c.kind === 'remove-held-out-units') && a.previous_partition_hash === a.amended_partition_hash) errors.push('removal must change partition');
      if (a.changes.some(c => c.kind !== 'remove-held-out-units') && a.previous_contract_hash === a.amended_contract_hash) errors.push('structural amendment must change contract');
      for (const change of a.changes) if (change.kind === 'add-replicate-groups' && change.groups.some(g => g.members.length < 2 || (g.kind === 'technical' && g.handling === 'retain-distinct'))) errors.push('replicate group requires two members and technical groups cannot retain-distinct');
    }
    return errors.length ? { ok: false, errors } : { ok: true, value: value as PostLookAmendment, verification: 'structure-only' };
  } catch (e) { return { ok: false, errors: [String(e)] }; }
}
/** Artifact bytes are required; a declaration alone cannot establish a safe amendment. */
export interface AmendmentArtifacts {
  previousContract: DataContract;
  amendedContract: DataContract;
  previousPartition: PartitionArtifact;
  amendedPartition: PartitionArtifact;
}
export function validatePostLookAmendment(value: unknown, artifacts?: AmendmentArtifacts, context: ValidationContext = {}): Validation<PostLookAmendment> {
  const declaration=validateAmendmentDeclaration(value);if(!declaration.ok)return declaration;
  if(!artifacts)return {ok:false,errors:['amendment requires predecessor and amended contract/partition artifacts']};
  try{
    const a=declaration.value, b=artifacts, errors:string[]=[];
    for(const [contract,partition,publicHash,privateHash,partitionHash] of [
      [b.previousContract,b.previousPartition,a.previous_contract_hash,a.previous_private_contract_hash,a.previous_partition_hash],
      [b.amendedContract,b.amendedPartition,a.amended_contract_hash,a.amended_private_contract_hash,a.amended_partition_hash],
    ] as const){
      if(contract.public.hash!==publicHash || (contract.sealed_private?.hash ?? null)!==privateHash || partition.hash!==partitionHash)errors.push('amendment artifact pin mismatch');
      const check=validatePartitionArtifact(contract,partition,{...context,expectedPrivateContractHash:privateHash});if(!check.ok)errors.push(...check.errors);
    }
    if(errors.length)return {ok:false,errors};
    // Reconcile each version's private closure before checking the version transition.
    // Changed private material needs an explicit combined history from the host; refuse it here.
    if(a.previous_private_contract_hash !== a.amended_private_contract_hash)return {ok:false,errors:['amendment cannot replace sealed identity history']};
    const old={...b.previousContract.public.content.structure,partitions:[]};
    const next={...b.amendedContract.public.content.structure,partitions:[]};
    const resolver=new IdentityResolver(old,next);
    errors.push(...resolver.errors,...resolver.amendmentErrors(b.previousPartition.content.partitions,b.amendedPartition.content.partitions,a));
    if(b.previousContract.sealed_private){
      const closure=new IdentityResolver(old,b.previousContract.sealed_private.content.structure);
      errors.push(...closure.partitionErrors([...b.previousPartition.content.partitions,...b.amendedPartition.content.partitions].map(partition=>({layer:'public',partition}))));
    }
    return errors.length?{ok:false,errors}:{ok:true,value:a,verification:'structure-only'};
  }catch(e){return {ok:false,errors:[String(e)]};}
}
export function validateLockTimeline(value: unknown, amendments: Readonly<Record<string, AmendmentArtifacts>> = {}, context: ValidationContext = {}): Validation<LockTimeline> {
  try {
    assertJson(value); const errors = shapeErrors(lockTimelineShape.json, value);
    if (errors.length) return { ok: false, errors };
    const timeline = value as LockTimeline;
    const stages = ['L0-source-lock', 'L1-contract-lock', 'L2-partition-lock', 'L3-schema-view', 'L4-plan-lock', 'L5-training', 'L6-look-record'];
    const pins = new Map<string, string | null>();
    let attempts = 0;
    let lastLook: string | undefined;
    for (const [i, entry] of timeline.entries()) {
      const r = entry.record;
      if ((i < 7 ? r.stage !== stages[i] : !['L6-look-record', 'L7-post-look-amendment'].includes(r.stage)) || r.sequence !== i) errors.push('lock timeline out of order');
      if (r.previous_hash !== (timeline[i - 1]?.hash ?? null)) errors.push('lock parent hash mismatch');
      if (entry.hash !== contentHash(r)) errors.push('lock content hash mismatch');
      if (i && r.time_ms < timeline[i - 1]!.record.time_ms) errors.push('lock time decreased');
      if (r.stage === 'L7-post-look-amendment') {
        const checked = validatePostLookAmendment(r.amendment, amendments[r.amendment_hash], context);
        if (!checked.ok) errors.push(...checked.errors);
        if (contentHash(r.amendment) !== r.amendment_hash) errors.push('amendment hash mismatch');
        if (r.amendment.look_record_hash !== lastLook || timeline[i - 1]?.record.stage !== 'L6-look-record') errors.push('amendment must follow and reference current look');
        for (const [pin, before, after] of [
          ['public_contract_hash', r.amendment.previous_contract_hash, r.amendment.amended_contract_hash],
          ['private_contract_hash', r.amendment.previous_private_contract_hash, r.amendment.amended_private_contract_hash],
          ['partition_hash', r.amendment.previous_partition_hash, r.amendment.amended_partition_hash],
        ] as const) {
          if (pins.get(pin) !== before) errors.push('amendment prior pin mismatch');
          pins.set(pin, after);
        }
      }
      for (const key of ['public_contract_hash', 'private_contract_hash', 'partition_hash', 'plan_hash', 'artifact_hash', 'frozen_code_hash', 'registry_version', 'calibration_result_hash']) {
        if (key in r) {
          const val = (r as unknown as Record<string, string | null>)[key]!;
          if (pins.has(key) && pins.get(key) !== val) errors.push(`lock binding changed: ${key}`);
          pins.set(key, val);
        }
      }
      if (r.stage === 'L6-look-record') {
        if (r.attempt !== ++attempts) errors.push('look attempt must include every attempt, including crashes');
        lastLook = entry.hash;
      }
    }
    return errors.length ? { ok: false, errors } : { ok: true, value: timeline, verification: 'structure-only' };
  } catch (e) { return { ok: false, errors: [String(e)] }; }
}
