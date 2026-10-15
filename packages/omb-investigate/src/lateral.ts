import type { LateralDecision, LateralSuggestion } from '../../omb-literature/src/ideas.ts';

type Checked<T> = { ok: true; value: T; normalizations: { from: string; to: string }[] } | { ok: false; error: string };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const canonical = (id: string): string => id.trim().toLowerCase();
function document(text: string | null): Record<string, unknown> | null {
  try { const v: unknown = JSON.parse(text ?? 'null'); return object(v) ? v : null; } catch { return null; }
}
export function lateralSuggestions(text: string | null): Checked<LateralSuggestion[]> {
  const rows = document(text)?.suggestions;
  if (!Array.isArray(rows)) return { ok: false, error: 'lateral.json must contain a suggestions array' };
  const seen = new Set<string>(), value: LateralSuggestion[] = [];
  for (const row of rows) {
    if (!object(row) || !nonempty(row.id) || !nonempty(row.suggestion)) return { ok: false, error: 'each suggestion needs string id and suggestion' };
    const key = canonical(row.id);
    if (seen.has(key)) return { ok: false, error: 'suggestion ids must be unique after trim and case-fold' };
    seen.add(key); value.push({ id: row.id, suggestion: row.suggestion });
  }
  return { ok: true, value, normalizations: [] };
}
export function lateralDecisions(text: string | null, suggestions: readonly LateralSuggestion[]): Checked<LateralDecision[]> {
  const rows = document(text)?.decisions;
  if (!Array.isArray(rows)) return { ok: false, error: 'decisions.json must contain a decisions array' };
  const valid = new Map(suggestions.map(s => [canonical(s.id), s.id]));
  const seen = new Set<string>(), value: LateralDecision[] = [], normalizations: { from: string; to: string }[] = [];
  for (const row of rows) {
    if (!object(row) || !nonempty(row.id) || !nonempty(row.reason) || typeof row.disposition !== 'string' || !['exploratory', 'rejected'].includes(row.disposition)) return { ok: false, error: 'each decision needs string id, nonempty reason and exploratory|rejected disposition; no unplanned claims' };
    const id = valid.get(canonical(row.id));
    if (id === undefined) return { ok: false, error: `unknown decision id ${JSON.stringify(row.id)}` };
    if (seen.has(id)) return { ok: false, error: `duplicate decision id ${JSON.stringify(row.id)}` };
    seen.add(id);
    if (row.id !== id) normalizations.push({ from: row.id, to: id });
    value.push({ id, disposition: row.disposition as 'exploratory' | 'rejected', reason: row.reason });
  }
  if (seen.size !== suggestions.length) return { ok: false, error: `missing decisions for ${JSON.stringify(suggestions.filter(s => !seen.has(s.id)).map(s => s.id))}` };
  return { ok: true, value, normalizations };
}
