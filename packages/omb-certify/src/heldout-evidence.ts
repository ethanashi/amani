/** Amendment 11: before G9 may emit heldOut:true the held-out route needs a whole-pipeline
 * permutation (retraining on at least 20 permuted dev label sets), sub-batch invariance, and whole
 * batches held out or a within-batch skill permutation. The certifier cannot retrain, so this
 * evidence must come from a trusted host producer sealed with the host GateAuthority
 * (`sealEvidence(HELD_OUT_PIPELINE_DOMAIN, binding, claimId, evidence)`). Missing, unsealed or
 * failing evidence withholds heldOut:true and caps the claim at Tentative. */
export const HELD_OUT_PIPELINE_DOMAIN='omb/heldout-pipeline@1';
export const PIPELINE_EVIDENCE_LIMITATION='Held-out route lacks verified amendment-11 evidence (whole-pipeline permutation on at least 20 permuted dev label sets, sub-batch invariance, and whole batches held out or a within-batch skill permutation); capped at Tentative.';
export interface HeldOutPipelineEvidence {
  wholePipeline:{permutations:number;p:number};
  subBatchInvariant:true;
  batchHoldout:'whole-batches'|'within-batch-skill-permutation';
}
/** null when the verified evidence satisfies amendment 11 at the given level (the claim's decision alpha: one-sided .025 for a directional claim); else the reason. */
export function pipelineEvidenceFault(evidence:Record<string,unknown>|null,alpha:number):string|null {
  if(evidence===null)return 'no authority-sealed amendment-11 evidence for this claim and binding';
  const whole=evidence.wholePipeline as {permutations?:unknown;p?:unknown}|undefined;
  const permutations=whole?.permutations,p=whole?.p;
  if(!whole||typeof whole!=='object'||typeof permutations!=='number'||!Number.isSafeInteger(permutations)||permutations<20)return 'whole-pipeline permutation needs at least 20 permuted dev label sets';
  if(typeof p!=='number'||!Number.isFinite(p)||p<1/(permutations+1)||p>1)return 'whole-pipeline permutation p-value is invalid';
  if(!(alpha>0)||p>alpha)return 'whole-pipeline permutation does not reject at the locked alpha';
  if(evidence.subBatchInvariant!==true)return 'sub-batch invariance not established';
  if(evidence.batchHoldout!=='whole-batches'&&evidence.batchHoldout!=='within-batch-skill-permutation')return 'neither whole batches held out nor a within-batch skill permutation';
  return null;
}
