// Claude Code `--output-format stream-json` readers. CLI wrapper fields only: message.content text,
// tool output and the final answer never create or suppress a signal. Rate-limit and refusal rules
// are ports of bio-tasks/pilot/telemetry.py (rate_limit, provider_refusal, api_error_message).
import type { QuotaSnapshot, QuotaWindow, RefusalReceipt, TokenUsage } from './contracts.ts';
type Obj = Record<string, unknown>;
const object = (v: unknown): Obj | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null;
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const epoch = (v: unknown): number | null => integer(v) && v >= 1e9 && v < 1e10 ? v : null;
const blocks = (message: unknown): Obj[] => { const c = object(message)?.content; return Array.isArray(c) ? c.map(object).filter((b): b is Obj => b !== null) : []; };
export const SYNTHETIC_MODEL = '<synthetic>';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function claudeEvents(text: string): Obj[] {
  const out: Obj[] = [];
  for (const line of text.split('\n')) { if (!line.trim()) continue; try { const v = object(JSON.parse(line)); if (v) out.push(v); } catch { /* not a CLI event */ } }
  return out;
}
/** Drop only the context-window selector ("[1m]"). A date suffix is a revision and is kept: unlike
 * telemetry.py model_id, two dated revisions never compare equal (V6 review finding 2). */
export function modelId(value: unknown): string | null {
  return typeof value === 'string' && value ? value.replace(/\[\d+[mk]\]$/, '') : null;
}
/** Host-owned alias table: an undated requested id → the dated revisions it may resolve to. */
export type ModelAliases = Readonly<Record<string, readonly string[]>>;
const DATED = /-\d{8}$/;
/** Did `observed` serve a request for `requested`? Equal ids (context selector ignored) match. A dated
 * request pins its revision exactly; an undated alias resolves only through the explicit mapping. */
export function sameModel(requested: string, observed: string, aliases: ModelAliases = {}): boolean {
  const r = modelId(requested), o = modelId(observed);
  if (!r || !o) return false;
  if (r === o) return true;
  if (DATED.test(r)) return false;
  return (aliases[r] ?? []).some(revision => modelId(revision) === o);
}
/** CLI-synthesized messages carry all-zero top-level token counts; nested objects are ignored. */
function zeroUsage(usage: unknown): boolean {
  const u = object(usage);
  return !!u && u.input_tokens === 0 && u.output_tokens === 0 && Object.values(u).every(v => typeof v !== 'number' || v === 0);
}
/** An assistant event the CLI synthesized for an API error (wrapper `is_api_error_message`,
 * message.model "<synthetic>", zero usage). Wrapper/metadata fields only. */
export function apiErrorMessage(e: Obj): boolean {
  const m = object(e.message);
  return e.type === 'assistant' && e.is_api_error_message === true && !!m && m.model === SYNTHETIC_MODEL && zeroUsage(m.usage);
}
const LIMIT_API_ERRORS = ['usage_limit_reached', 'model_substitution_disabled'];
/** A refusal or rate/usage-limit api-error message: its "<synthetic>" model is no identity. */
function infrastructureApiError(e: Obj): boolean {
  return apiErrorMessage(e) && (object(e.message)!.stop_reason === 'refusal' || e.error === 'rate_limit' || LIMIT_API_ERRORS.includes(e.api_error as string));
}

export interface ClaudeRateLimit { terminal: boolean; signals: string[]; resetsAt: number | null }
/** Exact port of telemetry.py rate_limit(family="claude"). `terminal` only when the CLI's own last
 * result is the limit failure; transient retries and rejected-then-recovered windows are signals. */
export function claudeRateLimit(text: string): ClaudeRateLimit {
  const signals = new Set<string>();
  let resetsAt: number | null = null, result: Obj | null = null, assistantError: unknown = null, resultAssistantError: unknown = null;
  for (const e of claudeEvents(text)) {
    if (e.type === 'rate_limit_event') {
      const info = object(e.rate_limit_info);
      if (info?.status === 'rejected') { signals.add('rate_limit_event:rejected'); resetsAt = epoch(info.resetsAt) ?? resetsAt; }
    } else if (e.type === 'assistant') {
      assistantError = e.error;
      if (assistantError === 'rate_limit') signals.add('assistant.error:rate_limit');
      if (e.api_error === 'model_substitution_disabled') signals.add('assistant.api_error:model_substitution_disabled');
      if (e.api_error === 'usage_limit_reached') {
        signals.add('assistant.api_error:usage_limit_reached');
        resetsAt = epoch(object(object(e.api_error_params)?.rate_limit_info)?.resetsAt) ?? resetsAt;
      }
    } else if (e.type === 'system' && e.subtype === 'api_retry' && (e.error === 'rate_limit' || e.error_status === 429)) signals.add('api_retry:429');
    else if (e.type === 'result') { result = e; resultAssistantError = assistantError; assistantError = null; }
  }
  const terminal = !!result && result.is_error === true && (result.api_error_status === 429 || LIMIT_API_ERRORS.includes(result.api_error as string) || resultAssistantError === 'rate_limit');
  if (terminal) signals.add('result:is_error:rate_limit');
  return { terminal, signals: [...signals].sort(), resetsAt };
}

const CATEGORY = /^[a-z][a-z0-9_-]{0,39}$/;
const category = (v: unknown): string | null => typeof v === 'string' && CATEGORY.test(v) ? v : null;
// eslint-disable-next-line no-control-regex
const explanation = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 1000) : null;
/** telemetry.py provider_refusal(family="claude") plus the work counters that split prework from
 * midtask. A terminal refusal is the last result being an error with no real assistant message
 * after the last refused turn. Prework additionally requires no real assistant message, no tool use
 * and no tool result anywhere in the stream: the classifier stopped the job before any work. */
export function claudeRefusal(text: string): RefusalReceipt {
  const signals = new Set<string>(), categories: (string | null)[] = [];
  let refusals = 0, fallback = false, agent = 0, toolUses = 0, toolResults = 0;
  let result: Obj | null = null, refusedLast = false, resultRefused = false;
  let lastCategory: string | null = null, lastExplanation: string | null = null, requestId: string | null = null;
  for (const e of claudeEvents(text)) {
    if (e.type === 'assistant' && apiErrorMessage(e)) {
      const m = object(e.message)!;
      if (m.stop_reason === 'refusal') {
        refusedLast = true; refusals++; signals.add('assistant.api_error:refusal');
        const details = object(m.stop_details);
        lastCategory = category(details?.category) ?? lastCategory; categories.push(category(details?.category));
        lastExplanation = explanation(details?.explanation) ?? lastExplanation;
        requestId = typeof e.request_id === 'string' && e.request_id.length <= 200 ? e.request_id : requestId;
      }
    } else if (e.type === 'assistant') {
      refusedLast = false;
      if (object(e.message)) { agent++; toolUses += blocks(e.message).filter(b => b.type === 'tool_use').length; }
    } else if (e.type === 'user') {
      toolResults += blocks(e.message).filter(b => b.type === 'tool_result').length;
      if (e.isSynthetic === true && typeof e.refused_message_id === 'string') signals.add('user:refused_message');
    } else if (e.type === 'system' && e.subtype === 'model_refusal_fallback') {
      refusals++; fallback = true; signals.add('system:model_refusal_fallback'); categories.push(category(e.api_refusal_category));
    } else if (e.type === 'system' && e.subtype === 'model_refusal_no_fallback') {
      // The CLI's own note that NO_MODEL_FALLBACK kept the model; the synthetic message carries the turn.
      signals.add('system:model_refusal_no_fallback');
      lastCategory = category(e.api_refusal_category) ?? lastCategory; lastExplanation = explanation(e.api_refusal_explanation) ?? lastExplanation;
    } else if (e.type === 'result') { result = e; resultRefused = refusedLast; refusedLast = false; }
  }
  const terminal = !!result && result.is_error === true && resultRefused;
  if (terminal) signals.add('result:is_error:refusal');
  const usage = object(result?.usage);
  return { phase: !terminal ? null : agent === 0 && toolUses === 0 && toolResults === 0 ? 'prework' : 'midtask', terminal,
    category: lastCategory, categories: [...new Set(categories.filter((c): c is string => c !== null))].sort(), explanation: lastExplanation,
    signals: [...signals].sort(), refusals, fallback, realAssistantMessages: agent, toolUses, toolResults,
    outputTokens: integer(usage?.output_tokens) ? usage.output_tokens : null, durationMs: integer(result?.duration_ms) ? result.duration_ms : null,
    safetyStops: integer(result?.safety_stops) ? result.safety_stops : null, requestId };
}

function usageOf(v: unknown): TokenUsage | null {
  const u = object(v); if (!u || !integer(u.input_tokens) || !integer(u.output_tokens)) return null;
  const write = u.cache_creation_input_tokens ?? 0, read = u.cache_read_input_tokens ?? 0;
  if (!integer(write) || !integer(read)) return null;
  // Claude cache writes/reads are additional input (telemetry.py); cachedInputTokens is the read part.
  const input = u.input_tokens + write + read;
  return { inputTokens: input, cachedInputTokens: read, outputTokens: u.output_tokens, totalTokens: input + u.output_tokens };
}
function window(v: unknown, minutes: number): QuotaWindow | null {
  const o = object(v);
  if (!o || typeof o.utilization !== 'number' || !Number.isFinite(o.utilization) || o.utilization < 0 || o.utilization > 1) return null;
  return { usedPercent: Math.round(o.utilization * 10000) / 100, windowMinutes: minutes, resetsAt: epoch(o.resetsAt) };
}
// The pinned CLI's modelUsage entry schema (2.1.296): counters, capacity, and pricing metadata.
const USAGE_COUNTERS = ['inputTokens', 'outputTokens', 'thinkingTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens', 'webSearchRequests', 'costUSD'];
const USAGE_CAPACITY = ['contextWindow', 'maxOutputTokens'];
/** A result.modelUsage entry with no usage. Every token/cost counter present must be exactly 0
 * (input and output required); capacity numbers and the pricing metadata (canonicalModel, provider,
 * costBasis) are accepted; any other key or type keeps the entry (fail closed). telemetry.py's
 * all-numeric rule rejected the CLI's own string metadata (V6 review finding 4). */
export function zeroModelUsage(v: unknown): boolean {
  const o = object(v);
  if (!o || o.inputTokens !== 0 || o.outputTokens !== 0) return false;
  return Object.entries(o).every(([k, x]) => USAGE_COUNTERS.includes(k) ? x === 0
    : USAGE_CAPACITY.includes(k) ? typeof x === 'number' && Number.isFinite(x) && x >= 0
    : k === 'canonicalModel' || k === 'provider' ? typeof x === 'string' && x.length <= 200
    : k === 'costBasis' ? x === 'list' || x === 'managed' || x === 'unknown'
    : false);
}
export interface ClaudeResultSummary { isError: boolean; subtype: string | null; apiErrorStatus: number | null; apiError: string | null; numTurns: number | null; durationMs: number | null; stopReason: string | null }
export interface ClaudeTelemetry {
  sessionId: string | null; initModel: string | null; cliVersion: string | null;
  /** Every model the CLI reported doing work (init, assistant, modelUsage, fallbacks); refusal/limit
   * "<synthetic>" placeholders excluded as in telemetry.py. Raw ids, compare with modelId(). */
  models: string[];
  apiKeySource: string | null; tools: string[] | null; mcpServers: unknown[] | null;
  usage: TokenUsage | null; usageComplete: boolean; quota: QuotaSnapshot | null;
  result: ClaudeResultSummary | null; results: number;
  /** Turn failed on credentials (HTTP 401 or wrapper error authentication_failed). */
  authFailed: boolean;
  /** Turn failed on a provider-side error (HTTP 5xx or wrapper error overloaded/server_error). */
  providerError: string | null;
}
export function claudeTelemetry(text: string): ClaudeTelemetry {
  const out: ClaudeTelemetry = { sessionId: null, initModel: null, cliVersion: null, models: [], apiKeySource: null, tools: null, mcpServers: null,
    usage: null, usageComplete: false, quota: null, result: null, results: 0, authFailed: false, providerError: null };
  const models: string[] = [], synthetic: string[] = [];
  let dropped = 0, inits = 0, validUsage = 0, lastAssistantError: unknown = null, resultAssistantError: unknown = null;
  for (const e of claudeEvents(text)) {
    if (e.type === 'system' && e.subtype === 'init') {
      inits++;
      if (inits === 1) {
        out.sessionId = typeof e.session_id === 'string' ? e.session_id : null;
        out.initModel = typeof e.model === 'string' ? e.model : null;
        out.cliVersion = typeof e.claude_code_version === 'string' ? e.claude_code_version : null;
        out.apiKeySource = typeof e.apiKeySource === 'string' ? e.apiKeySource : null;
        out.tools = Array.isArray(e.tools) && e.tools.every(t => typeof t === 'string') ? e.tools as string[] : null;
        out.mcpServers = Array.isArray(e.mcp_servers) ? e.mcp_servers : null;
      } else if (e.session_id !== out.sessionId) out.sessionId = null; // two sessions in one stream: no identity
      if (typeof e.model === 'string') models.push(e.model);
    } else if (e.type === 'system' && ['model_refusal_fallback', 'model_fallback', 'model_consent_fallback'].includes(e.subtype as string)) {
      if (typeof e.fallback_model === 'string') models.push(e.fallback_model); // the model the CLI switched to did the work
      else models.push('unknown-fallback-model');
    } else if (e.type === 'assistant') {
      lastAssistantError = e.error;
      const m = object(e.message);
      if (infrastructureApiError(e)) dropped++;
      else if (m && typeof m.model === 'string' && m.model) models.push(m.model);
    } else if (e.type === 'rate_limit_event') {
      const windows = object(object(e.rate_limit_info)?.unifiedWindows);
      if (windows) out.quota = { primary: window(windows.five_hour, 300), secondary: window(windows.seven_day, 10080) };
    } else if (e.type === 'result') {
      out.results++; resultAssistantError = lastAssistantError; lastAssistantError = null;
      out.result = { isError: e.is_error !== false, subtype: typeof e.subtype === 'string' ? e.subtype : null,
        apiErrorStatus: integer(e.api_error_status) ? e.api_error_status : null, apiError: typeof e.api_error === 'string' ? e.api_error : null,
        numTurns: integer(e.num_turns) ? e.num_turns : null, durationMs: integer(e.duration_ms) ? e.duration_ms : null,
        stopReason: typeof e.stop_reason === 'string' ? e.stop_reason : null };
      const next = usageOf(e.usage);
      if (next) {
        validUsage++;
        out.usage = out.usage ? { inputTokens: out.usage.inputTokens + next.inputTokens, cachedInputTokens: out.usage.cachedInputTokens + next.cachedInputTokens,
          outputTokens: out.usage.outputTokens + next.outputTokens, totalTokens: out.usage.totalTokens + next.totalTokens } : next;
      }
      const usage = object(e.modelUsage);
      for (const [name, use] of Object.entries(usage ?? {})) {
        if (name === SYNTHETIC_MODEL && zeroModelUsage(use)) { synthetic.push(name); continue; }
        models.push(name);
        // The CLI's canonical id for the entry is identity evidence too (V6 review finding 2).
        const canonical = object(use)?.canonicalModel;
        if (canonical !== undefined) models.push(typeof canonical === 'string' && canonical ? canonical : 'invalid-canonical-model');
      }
    }
  }
  // A zero-usage "<synthetic>" modelUsage entry is dropped only when the stream has refusal/limit messages.
  if (!dropped) models.push(...synthetic);
  out.models = [...new Set(models)].sort();
  out.usageComplete = out.results === 1 && validUsage === 1;
  const r = out.result;
  if (r?.isError) {
    out.authFailed = r.apiErrorStatus === 401 || resultAssistantError === 'authentication_failed';
    out.providerError = r.apiErrorStatus !== null && r.apiErrorStatus >= 500 ? `HTTP ${r.apiErrorStatus}`
      : resultAssistantError === 'overloaded' || resultAssistantError === 'server_error' ? String(resultAssistantError) : null;
  }
  return out;
}
/** Claude Code 2.1.295+: a resume that ran no turn found no conversation (bio-runner precedent). */
export function claudeResumeUnavailable(stdout: string, stderr: string, sessionId: string): boolean {
  const result = claudeEvents(stdout).filter(e => e.type === 'result').at(-1);
  if (!result || result.is_error !== true || result.num_turns !== 0) return false;
  const text = `${stderr}\n${typeof result.result === 'string' ? result.result : ''}`;
  return text.split(/\r?\n/).some(line => line.trim() === `No conversation found with session ID: ${sessionId}`);
}
/** Hard stop 1 for Claude streams. Denied tool results (is_error) never count; any other event,
 * an unparseable line, assistant content, a successful tool result or the final text does. */
export function claudeCanaryExposed(text: string, canary: string): boolean {
  for (const line of text.split('\n')) {
    if (!line.includes(canary)) continue;
    let e: Obj | null;
    try { e = object(JSON.parse(line)); } catch { return true; }
    if (!e) return true;
    if (e.type !== 'user' || !Array.isArray(object(e.message)?.content)) return true;
    const content = blocks(e.message);
    const denied = content.filter(b => b.type === 'tool_result' && b.is_error === true);
    const kept: Obj = { ...e, message: { ...object(e.message), content: (object(e.message)!.content as unknown[]).filter(b => !denied.includes(b as Obj)) } };
    // The CLI's structured copy of a tool result belongs to that result: drop it only if every result here was denied.
    if (denied.length && denied.length === content.filter(b => b.type === 'tool_result').length) delete kept.tool_use_result;
    if (JSON.stringify(kept).includes(canary)) return true;
  }
  return false;
}
