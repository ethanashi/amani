import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Cache } from '../../omb-citations/src/http.ts';
import type { RetrievedPage } from './network.ts';
import { maskLiteratureContact } from './contact.ts';

export interface AcademicOptions {
  contactEmail: string;
  cache: Cache;
  now: () => number;
  wait?: (ms: number) => Promise<void>;
}
export class AcademicResponseError extends Error {
  constructor(readonly status: number, readonly retryAfter: string | null) { super(`academic HTTP ${status}`); }
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
/** Shared by search, resolver and novelty. One outstanding request per host; at most 2/sec.
 * Retry-After is never shortened. Long server cooldowns fail closed instead of holding a run. */
export class AcademicAccess {
  private tails = new Map<string, Promise<unknown>>();
  private next = new Map<string, number>();
  constructor(private readonly options: AcademicOptions) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.contactEmail)) throw new Error('literature contactEmail required');
  }
  async get(url: string, retrieve: (url: string, headers: Record<string, string>) => Promise<RetrievedPage>): Promise<RetrievedPage> {
    const u = new URL(url), host = u.hostname, o = this.options;
    const previous = this.tails.get(host) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const key = hash(url), cached = await o.cache.get(key);
      if (cached && cached.status === 200 && cached.receipt.status === 200 && cached.receipt.url === url &&
        cached.receipt.sha256 === hash(cached.body) && Buffer.byteLength(cached.body) <= 2_000_000 &&
        o.now() >= cached.receipt.retrievedAt && o.now() - cached.receipt.retrievedAt < 86_400_000) {
        // Classification and source scanning still belong to RoleNetwork, including on cache hits.
        return { url, body: cached.body, sha256: cached.receipt.sha256, retrievedAt: cached.receipt.retrievedAt, citable: true, flags: [] };
      }
      if (host === 'eutils.ncbi.nlm.nih.gov') { u.searchParams.set('email', o.contactEmail); u.searchParams.set('tool', 'omerta-bio'); }
      if (host === 'api.crossref.org' || host === 'api.openalex.org') u.searchParams.set('mailto', o.contactEmail);
      const headers = { 'User-Agent': `omerta-bio-literature/1.0 (mailto:${o.contactEmail})`, From: o.contactEmail };
      const wait = o.wait ?? (ms => delay(ms));
      let waited = 0;
      for (let attempt = 0; ; attempt++) {
        const pause = Math.max(0, (this.next.get(host) ?? 0) - o.now());
        if (waited + pause > 60_000) throw new Error('academic server cooldown exceeds retry budget');
        if (pause) { await wait(pause); waited += pause; }
        this.next.set(host, o.now() + 500);
        try {
          const page = await retrieve(u.href, headers);
          const result = { ...page, url };
          await o.cache.set(key, { status: 200, body: page.body, receipt: { url, status: 200, sha256: page.sha256, retrievedAt: page.retrievedAt } });
          return result;
        } catch (error) {
          const retryable = error instanceof AcademicResponseError ? error.status === 429 || error.status >= 500 :
            error instanceof Error && (['TimeoutError', 'AbortError'].includes(error.name) || error instanceof TypeError);
          if (!retryable) throw error;
          const raw = error instanceof AcademicResponseError ? error.retryAfter : null;
          const retryAfter = raw === null ? 0 : /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - o.now();
          const backoff = Math.max(1000 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter : 0);
          this.next.set(host, Math.max(this.next.get(host)!, o.now() + backoff));
          if (attempt === 3) throw error;
        }
      }
    });
    this.tails.set(host, pending);
    try { return await pending; }
    catch (error) {
      // Drop the original stack, cause and custom properties, which can carry headers/URLs.
      throw new Error(maskLiteratureContact(error instanceof Error ? error.message : 'academic request failed', o.contactEmail));
    } finally { if (this.tails.get(host) === pending) this.tails.delete(host); }
  }
}
