import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { POLICY } from './policy.ts';
import type { Receipt } from './types.ts';
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export interface Reply { status: 200 | 404; body: string; receipt: Receipt }
export interface Cache { get(key: string): Promise<Reply | undefined>; set(key: string, value: Reply): Promise<void> }
export class MemoryCache implements Cache {
  private entries = new Map<string, Reply>();
  async get(key: string) { const v = this.entries.get(key); return v ? structuredClone(v) : undefined; }
  async set(key: string, value: Reply) { this.entries.set(key, structuredClone(value)); }
}
export class FileCache implements Cache {
  private dir: string;
  constructor(dir: string) { this.dir = dir; }
  async get(key: string): Promise<Reply | undefined> {
    try { return JSON.parse(await readFile(join(this.dir, key + '.json'), 'utf8')) as Reply; } catch { return undefined; }
  }
  async set(key: string, value: Reply) {
    await mkdir(this.dir, { recursive: true });
    const path = join(this.dir, key + '.json');
    const temp = path + `.${process.pid}.${crypto.randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify(value), { flag: 'wx' }); await rename(temp, path); }
    finally { await rm(temp, { force: true }); }
  }
}
export class Unavailable extends Error {}
const HOSTS = new Set(['api.crossref.org', 'www.ebi.ac.uk', 'eutils.ncbi.nlm.nih.gov']);
export interface HttpOptions {
  now: () => number; cache?: Cache; fetch?: typeof fetch; timeoutMs?: number; maxBytes?: number;
  /** Explicit snapshot resume; fresh always bypasses it. Default library cache TTL is unchanged. */
  resumeCache?: boolean;
  retry?: { attempts?: number; budgetMs?: number; baseMs?: number; maxDelayMs?: number };
  wait?: (ms: number) => Promise<void>; random?: () => number;
}
class Transient extends Unavailable {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs = 0) { super(message); this.retryAfterMs = retryAfterMs; }
}
function transient(error: unknown): boolean {
  if (error instanceof Transient) return true;
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return /^(EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/.test(code ?? '') ||
    /^(AbortError|TimeoutError)$/.test(error.name) || (error.cause !== undefined && transient(error.cause));
}
export class HttpClient {
  private options: HttpOptions;
  constructor(options: HttpOptions) { this.options = options; }
  async get(url: string, fresh = false): Promise<Reply> {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !HOSTS.has(u.hostname) || u.username || u.password || u.port) throw new Unavailable('URL outside scholarly allowlist');
    const key = sha256(url), start = this.options.now();
    if (!fresh) {
      const c = await this.options.cache?.get(key);
      if (c && (c.status === 200 || c.status === 404) && typeof c.body === 'string' && c.receipt?.url === url &&
          c.receipt.status === c.status && c.receipt.sha256 === sha256(c.body) &&
          start >= c.receipt.retrievedAt && (this.options.resumeCache || start - c.receipt.retrievedAt < POLICY.cacheMs)) return c;
    }
    const attempts = this.options.retry?.attempts ?? POLICY.retryAttempts;
    const budget = this.options.retry?.budgetMs ?? POLICY.retryBudgetMs;
    const base = this.options.retry?.baseMs ?? POLICY.retryBaseMs;
    const cap = this.options.retry?.maxDelayMs ?? POLICY.retryMaxDelayMs;
    const timeout = this.options.timeoutMs ?? POLICY.timeoutMs;
    if (![attempts, budget, base, cap, timeout].every(n => Number.isFinite(n) && n > 0) || !Number.isInteger(attempts)) throw new Unavailable('invalid retry policy');
    let waited = 0, last: unknown;
    const remaining = () => budget - Math.max(waited, this.options.now() - start);
    for (let attempt = 0; attempt < attempts && remaining() > 0; attempt++) {
      try {
        const reply = await this.attempt(url, Math.min(timeout, remaining()));
        await this.options.cache?.set(key, reply);
        return reply;
      } catch (e) {
        last = e;
        if (!transient(e) || attempt + 1 === attempts) break;
        const random = (this.options.random ?? Math.random)();
        if (!Number.isFinite(random) || random < 0 || random > 1) throw new Unavailable('invalid retry jitter');
        const backoff = Math.ceil(Math.min(cap, base * 2 ** attempt) * (0.5 + random / 2));
        const ms = Math.max(backoff, e instanceof Transient ? e.retryAfterMs : 0);
        // Never violate Retry-After or start an attempt outside the total budget.
        if (ms >= remaining()) break;
        await (this.options.wait ?? (ms => delay(ms)))(ms);
        waited += ms;
      }
    }
    throw new Unavailable(last instanceof Error ? last.message : 'request budget exhausted');
  }
  private async attempt(url: string, timeoutMs: number): Promise<Reply> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Transient('request timeout')); }, timeoutMs);
    });
    const request = async (): Promise<Reply> => {
      const response = await (this.options.fetch ?? fetch)(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json, application/xml, text/xml', 'User-Agent': 'omerta-bio-citations/0.2' } });
      if (response.status !== 200 && response.status !== 404) {
        await response.body?.cancel();
        const message = `HTTP ${response.status}: ${new URL(url).hostname}`;
        if (response.status === 429 || response.status >= 500) {
          const raw = response.headers.get('retry-after');
          const retryAfter = raw === null ? 0 : /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Math.max(0, Date.parse(raw) - this.options.now());
          throw new Transient(message, Number.isFinite(retryAfter) ? retryAfter : 0);
        }
        throw new Unavailable(message);
      }
      const max = this.options.maxBytes ?? POLICY.maxResponseBytes;
      if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Unavailable('response size cap'); }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = []; let bytes = 0;
      if (reader) { try { for (;;) { const r = await reader.read(); if (r.done) break; bytes += r.value.byteLength; if (bytes > max) { await reader.cancel(); throw new Unavailable('response size cap'); } chunks.push(r.value); } } finally { reader.releaseLock(); } }
      const body = Buffer.concat(chunks).toString('utf8');
      return { status: response.status, body, receipt: { url, retrievedAt: this.options.now(), sha256: sha256(body), status: response.status } };
    };
    try { return await Promise.race([request(), expired]); }
    finally { clearTimeout(timer); }
  }
}
