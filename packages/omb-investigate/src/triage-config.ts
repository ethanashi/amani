/** Trusted configuration; never read from worker files or an appeal. */
export interface TriageLimits { workerAppeals:number; autoAppeals:number; repeatRefusals:number; ruleCorrectStreak:number; totalRefusals:number; repairs:number }
export const TRIAGE_LIMITS:Readonly<TriageLimits>=Object.freeze({workerAppeals:5,autoAppeals:5,repeatRefusals:2,ruleCorrectStreak:3,totalRefusals:12,repairs:3});
export function triageLimits(overrides:Partial<TriageLimits>={}):TriageLimits {
 const limits={...TRIAGE_LIMITS,...overrides};
 for(const value of Object.values(limits))if(!Number.isSafeInteger(value)||value<1)throw new Error('Triage thresholds must be positive integers');
 // These two are hard lineage ceilings; other thresholds can be selected for a trusted investigation type.
 if(limits.workerAppeals>5||limits.repairs>3)throw new Error('Triage appeal/repair hard ceilings cannot be raised');
 return limits;
}
