import type { LabelResult } from '../../omb-gauntlet/src/index.ts';
export const OS_SEPARATION_LIMITATION='Conclusive labels require OS-user separation (_ombcert / _ombrun); same-UID evidence is degraded.';
/** Owner decision 2026-10-11: held-out Confirmed needs logged proof of no egress during training and apply. */
export const NOT_SEQUESTERED_LIMITATION='Held-out evidence is internal, not sequestered: Confirmed requires logged proof of no internet egress during training and apply.';
/** Cap a conclusive label (confirmed/replicated -> tentative, refuted -> insufficient-evidence). */
export function capLabel(label:LabelResult,reasons:readonly string[]):LabelResult{
  if(!['confirmed','replicated','refuted'].includes(label.status))return label;
  const status=label.status==='refuted'?'insufficient-evidence':'tentative';
  return {...label,status,taskStatus:status,reasons:[...reasons]};
}
/** Apply before rendering label-dependent prose, including the top null/refute label. */
export function degradedLabel(label:LabelResult):LabelResult{ return capLabel(label,[OS_SEPARATION_LIMITATION]); }
