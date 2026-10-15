/** Host-only D1 decision seam. Receipts must be provided by the trusted experiment host. */
import { canonicalSha256 } from '../../bio-core/src/index.ts';

export interface WindowReceipt {
  readonly id: string;
  readonly outcomesPreviouslySeen: boolean | null;
  readonly sourceVerified: boolean;
  readonly featuresAsOfVerified: boolean;
  readonly codeFrozenBeforeLook: boolean;
  readonly independentKeyAgreement: boolean;
  readonly rankerInputsAvailable: boolean;
  readonly gain: number | null;
  readonly gainCi: readonly [number, number] | null;
}
export interface RankingEvidence {
  readonly criteriaHash: string;
  readonly expectedCriteriaHash: string;
  readonly externalTimestampVerified: boolean;
  readonly power: { readonly atGain: number; readonly estimate: number; readonly replicates: number } | null;
  readonly windows: readonly WindowReceipt[];
}

export function rankingDecision(evidence: RankingEvidence) {
  const reasons: string[] = [];
  const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  if (!/^[a-f0-9]{64}$/.test(evidence.criteriaHash) || evidence.criteriaHash !== evidence.expectedCriteriaHash) reasons.push('criteria-not-pinned');
  if (evidence.externalTimestampVerified !== true) reasons.push('external-timestamp-unverified');
  const p = evidence.power;
  if (!p || p.atGain !== 0.02 || !finite(p.estimate) || p.estimate < 0.8 || p.estimate > 1 || !Number.isInteger(p.replicates) || p.replicates < 200) reasons.push('gain-test-power-unverified');
  if (evidence.windows.length < 2 || new Set(evidence.windows.map(w => w.id)).size !== evidence.windows.length) reasons.push('two-distinct-windows-required');
  for (const w of evidence.windows) {
    if (w.outcomesPreviouslySeen !== false) reasons.push(`${w.id}:development-or-unknown-look`);
    if ([w.sourceVerified, w.featuresAsOfVerified, w.codeFrozenBeforeLook, w.independentKeyAgreement, w.rankerInputsAvailable].some(x => x !== true)) reasons.push(`${w.id}:verification-unavailable`);
    if (!finite(w.gain) || w.gain <= 0 || !w.gainCi || !w.gainCi.every(finite) || w.gainCi[0] <= 0 || w.gainCi[0] > w.gain || w.gainCi[1] < w.gain) reasons.push(`${w.id}:positive-gain-unverified`);
  }
  const certified = reasons.length === 0;
  const decision = { certified, output: certified ? 'ranking' : 'unranked-evidence-cards', reasons } as const;
  return { ...decision, decisionHash: canonicalSha256(decision) };
}
