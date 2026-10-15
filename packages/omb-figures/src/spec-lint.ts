/** Declarative input boundary: no worker settings or plotting code. Data semantics are
 * checked against authenticated records by each template before Canvas.finish draws SVG. */
import { FIGURE_KINDS, type FigureSpec } from './spec.ts';
import { lintTemplate } from './text.ts';
const fields: Record<string, string[]> = {
  funnel:['claimId','effects','standardErrors','center'], 'surrogacy-scatter':['claimId','surrogate','outcome','seSurrogate','seOutcome','grid','fitted','lower','upper'],
  consort: ["assessed","enrolled","excluded","arms"],
  forest: ['claimId','rows'], 'mr-forest': ['claimId','variants','summaries'],
  roc: ['claimId','series'], calibration: ['claimId','predicted','observed','lower','upper','slope','intercept'],
  'decision-curve': ['claimId','modelLabel','thresholds','netBenefit','treatAll','lockedThresholds'],
  volcano: ['claimId','estimate','pAdjusted','features','threshold','familySize'],
  'mr-scatter': ['claimId','betaExposure','seExposure','betaOutcome','seOutcome','fits','mrKeep'],
  coloc: ['claimId','posteriors','threshold'], 'data-flow': ['stages','splits'],
  'claim-flow': ['proposed','locked','looked','outcomes'], 'kaplan-meier': ['claimId','groups'],
};
export function lintFigureSpec(input: unknown): string[] {
  const issues: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['spec must be an object'];
  const s = input as FigureSpec;
  if (!FIGURE_KINDS.includes(s.kind)) return ['unknown template'];
  const allowed = new Set(['id','kind','placement','caption', ...fields[s.kind]!]);
  for (const key of Object.keys(s)) if (!allowed.has(key)) issues.push(`unknown setting: ${key}`);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(s.id ?? '')) issues.push('invalid figure id');
  if (!['results','supplement'].includes(s.placement)) issues.push('invalid placement');
  if (!s.caption || typeof s.caption.message !== 'string') issues.push('caption required');
  // Reject executable/settings payloads even when hidden inside a row.
  const visit = (v: unknown, key = ''): void => {
    if (typeof v === 'number' || typeof v === 'function') issues.push(`literal number/code forbidden: ${key}`);
    if (typeof v === 'string' && ['message','shortLabel','label','modelLabel','unitLabel'].includes(key)) {
      issues.push(...lintTemplate(v).map(i => `template: ${key}: ${i.code}`));
    }
    if (v && typeof v === 'object') for (const [k,x] of Object.entries(v)) {
      if (/^(?:code|script|style|font|palette|settings|axis|domain|colour|color)$/.test(k)) issues.push(`worker setting forbidden: ${k}`);
      visit(x,k);
    }
  };
  visit(s);
  return issues;
}
