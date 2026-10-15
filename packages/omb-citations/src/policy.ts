// Code + these constants are included in the frozen verifier identity.
export const POLICY = Object.freeze({ version: 2, cacheMs: 86_400_000, minQuoteWords: 8,
  maxResponseBytes: 8_000_000, timeoutMs: 12_000, retryAttempts: 5, retryBudgetMs: 60_000, retryBaseMs: 500, retryMaxDelayMs: 8_000, titleSimilarity: 0.92, yearTolerance: 1,
  maxInputChars: 100_000, maxSearchResults: 100, l5b: false });
export function fold(s: string): string {
  return s.normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
}
export function words(s: string): string[] { return fold(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []; }
export function doi(s: string | null): string | null { return s ? s.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase() : null; }
