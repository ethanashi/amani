import { createHash } from 'node:crypto';
import { canonicalJson, canonicalSha256 } from '../../bio-core/src/index.ts';
import type { CertifiedEntity, CertifiedClaim } from './port.ts';
import type { Datum } from './draw.ts';
import type { FigureSpec } from './spec.ts';
import type { FactStore } from './store.ts';
import { TEMPLATE_VERSION } from './templates.ts';
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const GENERATOR_VERSION = 'omb-figures@2';
export interface FigureProvenance {
  figureId: string; templateId: string; factIds: string[]; csvSha256: string;
  generatorVersion: string; certificateHashes: string[]; specSha256: string;
}
export function figureProvenance(spec: FigureSpec, data: readonly Datum[], csv: string, store: FactStore, context: readonly (CertifiedEntity|CertifiedClaim)[] = []): FigureProvenance {
  const certificates = data.map(d => {
    const ctx = { placement: spec.placement, claims: new Set(store.claimIds()), where: 'provenance' };
    return (d.recordType === 'fact' ? store.fact(d.id, ctx) : store.series(d.id, ctx)).certHash;
  });
  return { figureId: spec.id, templateId: `${spec.kind}@${TEMPLATE_VERSION}`, factIds: [...new Set([...data,...context].map(d => d.id))].sort(),
    csvSha256: sha256(csv), generatorVersion: GENERATOR_VERSION, certificateHashes: [...new Set([...certificates,...context.map(r=>r.certHash)])].sort(), specSha256: canonicalSha256(spec) };
}
export const provenanceText = (p: FigureProvenance): string => canonicalJson(p);
export const SOURCE_LINE = 'Source: drawn by deterministic plotting code from certified data; no generative image model was used.';

/** Called with the complete display inventory and references extracted by the manuscript parser. */
export function checkDisplayReferences(items: readonly { id: string; csvSha256: string; specSha256: string }[], references: readonly string[]): string[] {
  const issues: string[] = [], ids = new Set<string>(), csv = new Set<string>(), specs = new Set<string>();
  for (const item of items) {
    if (!item.id || !/^[a-f0-9]{64}$/.test(item.csvSha256) || !/^[a-f0-9]{64}$/.test(item.specSha256)) issues.push(`invalid display: ${item.id}`);
    if (ids.has(item.id)) issues.push(`duplicate id: ${item.id}`);
    if (csv.has(item.csvSha256) || specs.has(item.specSha256)) issues.push(`duplicate figure: ${item.id}`);
    ids.add(item.id); csv.add(item.csvSha256); specs.add(item.specSha256);
    if (!references.includes(item.id)) issues.push(`unused display: ${item.id}`);
  }
  for (const ref of references) if (!ids.has(ref)) issues.push(`dangling reference: ${ref}`);
  return issues;
}
