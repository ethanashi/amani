import type { QuotaSnapshot, QuotaWindow, TokenUsage } from './contracts.ts';
type Obj = Record<string, unknown>;
const object = (v: unknown): Obj | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null;
export function events(text: string): Obj[] {
  const result: Obj[] = [];
  for (const line of text.split('\n')) try { const v = object(JSON.parse(line)); if (v) result.push(v); } catch { /* not a CLI event */ }
  return result;
}
// Exact port of bio-tasks/pilot/telemetry.py codex_error / CODEX_LIMIT / terminal logic.
// codex-cli 0.156.1 has message strings, not structured provider error codes.
const LIMIT = /usage limit|rate[ _]limit|too many requests|status: 429|insufficient_quota|(?<!disk )quota exceeded/i;
const RESET = /try again (at|in) ([0-9A-Za-z ,:]{1,60})/i;
function errorMessage(e: Obj): string | null {
  let message: unknown;
  if (e.type === 'error' && Object.keys(e).sort().join() === 'message,type') message = e.message;
  else if (e.type === 'turn.failed' && Object.keys(e).sort().join() === 'error,type') {
    const error = object(e.error);
    if (error && Object.keys(error).join() === 'message') message = error.message;
  }
  return typeof message === 'string' && message.length <= 4000 ? message : null;
}
/** Time zone is injected as a resolver; the host CLI uses its local calendar, including DST.
 * Unknown/relative hints are retained without guessing a reset time. */
export function rateLimit(text: string, writtenAt: number, resolveLocal: (hint: string, writtenAt: number) => number | null = localReset) {
  const stream = events(text), signals = new Set<string>();
  let last: Obj | null = null, open = false;
  for (const e of stream) {
    if (typeof e.type !== 'string') continue;
    last = e;
    if (e.type === 'turn.started') open = true;
    else if (e.type === 'turn.completed' || e.type === 'turn.failed') open = false;
    const message = errorMessage(e);
    if (message !== null && LIMIT.test(message)) signals.add(e.type + ':limit');
  }
  const message = last && errorMessage(last);
  const terminal = !!(last && message && LIMIT.test(message) && (last.type === 'turn.failed' || open));
  const found = terminal && message ? RESET.exec(message) : null;
  const hint = found?.[2]?.replace(/^[ ,]+|[ ,]+$/g, '') ?? null;
  return { terminal, signals: [...signals].sort(), resetHint: found ? `${found[1]!.toLowerCase()} ${hint}` : null,
    resetAt: found?.[1]?.toLowerCase() === 'at' && hint ? resolveLocal(hint, writtenAt) : null };
}
export function localReset(text: string, writtenAt: number): number | null {
  const m = /^(?:([A-Z][a-z]{2}) (\d{1,2})(?:st|nd|rd|th), (\d{4}) )?(\d{1,2}):(\d{2}) ([AP]M)$/.exec(text);
  if (!m || !Number.isFinite(writtenAt)) return null;
  const date = new Date(writtenAt * 1000), hour = Number(m[4]), minute = Number(m[5]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const month = m[1] ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[1]) : date.getMonth();
  const day = m[2] ? Number(m[2]) : date.getDate(), year = m[3] ? Number(m[3]) : date.getFullYear();
  if (month < 0) return null;
  const reset = new Date(year, month, day, hour % 12 + (m[6] === 'PM' ? 12 : 0), minute);
  const epoch = reset.getTime() / 1000;
  return reset.getDate() === day && epoch >= 1e9 && epoch < 1e10 ? epoch : null;
}
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
function tokens(v: unknown): TokenUsage | null {
  const o = object(v); if (!o || !integer(o.input_tokens) || !integer(o.output_tokens)) return null;
  const cached = o.cached_input_tokens ?? 0;
  if (!integer(cached) || cached > o.input_tokens) return null;
  const total = o.total_tokens ?? o.input_tokens + o.output_tokens;
  if (!integer(total) || total < o.input_tokens + o.output_tokens) return null;
  return { inputTokens: o.input_tokens, cachedInputTokens: cached, outputTokens: o.output_tokens, totalTokens: total };
}
function window(v: unknown): QuotaWindow | null {
  const o = object(v);
  if (!o || typeof o.used_percent !== 'number' || !Number.isFinite(o.used_percent) || o.used_percent < 0 || o.used_percent > 100 || !integer(o.window_minutes) || o.window_minutes === 0) return null;
  return { usedPercent: o.used_percent, windowMinutes: o.window_minutes, resetsAt: integer(o.resets_at) && o.resets_at >= 1e9 && o.resets_at < 1e10 ? o.resets_at : null };
}
export interface RolloutTelemetry {
  sessionId: string | null; models: string[]; efforts: string[];
  usage: TokenUsage | null; quota: QuotaSnapshot | null; matchedRollouts: string[];
  usageComplete: boolean; verified: boolean; warnings: string[];
}
/** CLI-owned stdout owns identity binding and billed usage. Worker-writable rollouts
 * only corroborate a single filename/first-record-bound session; never choose by sort order. */
export function readRolloutTelemetry(transcript: string, rollouts: Readonly<Record<string, string>>, previousUsage: TokenUsage | null = null): RolloutTelemetry {
  const stdout = events(transcript);
  const ids = new Set(stdout.filter(e => e.type === 'thread.started' && typeof e.thread_id === 'string').map(e => e.thread_id as string));
  const sessionId = ids.size === 1 ? [...ids][0]! : null;
  const models = new Set<string>(), efforts = new Set<string>(), matchedRollouts: string[] = [], warnings: string[] = [];
  let usage: TokenUsage | null = null, rolloutUsage: TokenUsage | null = null, quota: QuotaSnapshot | null = null;
  let completed = 0, validUsage = 0;
  for (const e of stdout) if (e.type === 'turn.completed') {
    completed++;
    const next = tokens(e.usage);
    if (next) {
      validUsage++;
      usage = usage ? { inputTokens: usage.inputTokens + next.inputTokens, cachedInputTokens: usage.cachedInputTokens + next.cachedInputTokens,
        outputTokens: usage.outputTokens + next.outputTokens, totalTokens: usage.totalTokens + next.totalTokens } : next;
    }
  }
  let duplicate = false;
  const candidates: [string, Obj[]][] = [];
  for (const [name, text] of Object.entries(rollouts)) {
    const stream = events(text);
    let first: Obj | null = null; try { first = object(JSON.parse(text.split('\n', 1)[0]!)); } catch { /* first line must be session_meta */ }
    if (!sessionId || first?.type !== 'session_meta' || object(first.payload)?.id !== sessionId) continue;
    // Codex rollout-<timestamp>-<thread-id>.jsonl. Exact suffix prevents substring aliases.
    if (name.split('/').at(-1)?.endsWith(`-${sessionId}.jsonl`)) candidates.push([name, stream]);
    else duplicate = true;
  }
  if (candidates.length !== 1) warnings.push('single filename-bound rollout unavailable');
  if (duplicate || candidates.length > 1) warnings.push('extra rollout claims stdout session ID');
  if (candidates.length === 1) {
    const [name, stream] = candidates[0]!; matchedRollouts.push(name);
    for (const e of stream) {
      const p = object(e.payload); if (!p) continue;
      if (e.type === 'turn_context') {
        if (typeof p.model === 'string' && p.model) models.add(p.model);
        if (typeof p.effort === 'string' && p.effort) efforts.add(p.effort);
      }
      if (e.type === 'event_msg' && p.type === 'token_count') {
        rolloutUsage = tokens(object(p.info)?.total_token_usage);
        const limits = object(p.rate_limits);
        quota = limits ? { primary: window(limits.primary), secondary: window(limits.secondary) } : null;
      }
    }
  }
  // On resume, compare cumulative rollout with saved cumulative + this invocation's stdout.
  const cumulative = usage && { inputTokens: usage.inputTokens + (previousUsage?.inputTokens ?? 0),
    cachedInputTokens: usage.cachedInputTokens + (previousUsage?.cachedInputTokens ?? 0),
    outputTokens: usage.outputTokens + (previousUsage?.outputTokens ?? 0), totalTokens: usage.totalTokens + (previousUsage?.totalTokens ?? 0) };
  const agrees = !!(cumulative && rolloutUsage && Object.keys(cumulative).every(k => cumulative[k as keyof TokenUsage] === rolloutUsage[k as keyof TokenUsage]));
  if (!agrees) warnings.push('stdout usage and rollout cumulative usage disagree or are unavailable');
  if (!models.size || !efforts.size) warnings.push('observed model/effort unavailable');
  const usageComplete = validUsage > 0 && validUsage === completed && stdout.at(-1)?.type === 'turn.completed';
  const verified = candidates.length === 1 && !duplicate && agrees && models.size > 0 && efforts.size > 0;
  // An ambiguous or contradictory receipt must never advertise quota headroom.
  if (!verified) quota = null;
  return { sessionId, models: [...models].sort(), efforts: [...efforts].sort(), usage, quota, matchedRollouts, usageComplete, verified, warnings };
}
