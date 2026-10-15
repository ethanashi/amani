import { canonicalSha256 } from '../../bio-core/src/index.ts';
import type { ProcedureDiagnostic } from '../../omb-procedures/src/types.ts';

/** Hash the JSON value that would have been persisted, never its printable summary. */
export function redactedOutput(outputId: string, value: unknown, blockingDiagnosticId: string) {
  return { redacted: true, outputId, valueSha256: canonicalSha256(JSON.parse(JSON.stringify(value))), blockingDiagnosticId };
}

/** Handles both dotted output IDs and nested records/arrays. Applied before sealing. */
export function redactBlockedOutputs(outputs: Record<string, unknown>, diagnostics: readonly ProcedureDiagnostic[]): Record<string, unknown> {
  const active = diagnostics.filter(d => d.status === 'fail' || d.status !== 'pass' && d.mandatory !== false);
  const walk = (value: unknown, at: string): unknown => {
    const blocking = active.find(d => d.blocks.some(b => at === b || at.startsWith(b + '.')));
    if (blocking) {
      const marker = value as ReturnType<typeof redactedOutput> | null;
      if (marker?.redacted === true && marker.outputId === at && marker.blockingDiagnosticId === blocking.id && /^[a-f0-9]{64}$/.test(marker.valueSha256)) return marker;
      return redactedOutput(at, value, blocking.id);
    }
    if (Array.isArray(value)) return value.map((v, i) => walk(v, `${at}.${i}`));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, at ? `${at}.${k}` : k)]));
    return value;
  };
  return walk(outputs, '') as Record<string, unknown>;
}
