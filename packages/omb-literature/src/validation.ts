/** Malformed worker/provider payloads are infrastructure failures, never scientific findings. */
export class LiteraturePayloadError extends Error {
  readonly category = 'infra';
  constructor(message: string) { super(message); this.name = 'LiteraturePayloadError'; }
}
export const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
export const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);
export function noveltyVotes(v: unknown): v is { key: string; sameAssociation: boolean }[] {
  return Array.isArray(v) && v.every(x => object(x) && text(x.key) && typeof x.sameAssociation === 'boolean') && new Set(v.map(x => x.key)).size === v.length;
}
export function noveltyPage(bytes: string): { hitCount: number; nextCursorMark?: string; resultList: { result: { doi?: string; id?: string; source?: string }[] } } {
  let v: unknown;
  try { v = JSON.parse(bytes); } catch { throw new LiteraturePayloadError('novelty search response is not JSON'); }
  if (!object(v) || !Number.isSafeInteger(v.hitCount) || (v.hitCount as number) < 0 || !object(v.resultList) || !Array.isArray(v.resultList.result) || v.nextCursorMark !== undefined && !text(v.nextCursorMark) ||
    v.resultList.result.some(h => !object(h) || !['doi','id','source'].every(k => h[k] === undefined || text(h[k])) || !text(h.doi) && !text(h.id))) throw new LiteraturePayloadError('novelty search response incomplete: expected hitCount, resultList.result identifiers and string cursor');
  return v as ReturnType<typeof noveltyPage>;
}
