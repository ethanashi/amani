import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileSha256 } from './bundle.ts';
import type { JsonObject, ClaimRecord } from './types.ts';
export const REPLAN_REASONS = ['contract-infeasible', 'registry-infeasible', 'standby-confirmed-infeasible'] as const;
export type ReplanReason = typeof REPLAN_REASONS[number];
export function replanReason(v: unknown): ReplanReason | null { return REPLAN_REASONS.includes(v as ReplanReason) ? v as ReplanReason : null; }
export function classifyPlanIssues(codes: readonly string[]): ReplanReason | null {
  if (codes.some(c => ['unit-not-in-contract', 'table-not-in-contract', 'column-not-in-contract'].includes(c))) return 'contract-infeasible';
  if (codes.some(c => ['unsupported-analysis-knob', 'unevaluable-reproduction', 'unknown-kind'].includes(c))) return 'registry-infeasible';
  return null;
}
/** Only a closed enum crosses into the fresh planner. No stderr, claim, rule path,
 * reason string, previous artifact or reviewer explanation is part of this prompt. */
export function blindReplanPrompt(reason: unknown): string {
  const code = replanReason(reason); if (!code) throw new Error('unclassified replan');
  return `\nHOST PLAN AMENDMENT: ${code}. The look is unspent. Create a new feasible plan from the original task, public schema and registered rules. All gates remain in force.`;
}
/** Isolated amendment export hook: keep the shared deliverable implementation untouched. */
export function renderPlanAmendments(dir: string, files: Record<string, string>, amendments: JsonObject[]): Record<string, string> {
  if (!amendments.length) return files;
  const name = 'plan-amendments.json'; writeFileSync(path.join(dir, name), JSON.stringify(amendments, null, 2) + '\n');
  const report = path.join(dir, 'report.md');
  writeFileSync(report, readFileSync(report, 'utf8') + '\n## Pre-registration deviation log\n\n' + amendments.map(a => `- Amendment ${a.generation}: ${a.reason}; ${a.postExposure ? 'after' : 'before'} practice-data exposure; phase ${a.scope}; host time ${a.at}; ledger sequence ${(a.receipt as JsonObject)?.sequence ?? 'unknown'}.`).join('\n') + '\n');
  const paper = path.join(dir, 'paper-input.json'), value = JSON.parse(readFileSync(paper, 'utf8'));
  value.deviations = [...(value.deviations ?? []), ...amendments]; writeFileSync(paper, JSON.stringify(value) + '\n');
  const hashes: Record<string, string> = { ...files, [name]: fileSha256(path.join(dir, name)), 'report.md': fileSha256(report), 'paper-input.json': fileSha256(paper) };
  delete hashes['manifest.json'];
  const manifest = path.join(dir, 'manifest.json'), m = JSON.parse(readFileSync(manifest, 'utf8')); m.files = hashes; writeFileSync(manifest, JSON.stringify(m) + '\n');
  return { ...hashes, 'manifest.json': fileSha256(manifest) };
}

/** Post-exposure amendments have the same supported/unsupported task ceiling as
 * exploratory claims, and cannot turn a refutation into confirmatory evidence. */
export function capAmendedClaims(claims: ClaimRecord[], amendments: readonly JsonObject[]): ClaimRecord[] {
  if (!amendments.some(a => a.postExposure === true)) return claims;
  return claims.map(c => c.voided || ['insufficient-evidence', 'non-identifiable'].includes(c.status) ? c : {
    ...c, status: 'exploratory', taskStatus: ['confirmed', 'tentative'].includes(c.taskStatus) ? 'tentative' : 'insufficient-evidence',
    reasons: [...c.reasons, 'plan amended after practice-data exposure'], limitations: [...c.limitations, 'post-exposure plan: exploratory evidence only'],
  });
}
