import { MODEL_API_HOSTS, ANTHROPIC_API_HOSTS, allowedTarget } from '../../omb-adapters/src/proxy.ts';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import type { WorkerSpec, WorkerResult } from '../../omb-adapters/src/contracts.ts';
export interface TurnAudit {
  jobId: string; family: string;
  status: WorkerResult['status']; supervisor: WorkerResult['supervisor'];
  network: { configured: string; observed: string; allowed: number | null; denied: number | null; loggingFailed: boolean };
  webSearch: { configured: 'disabled' | 'unverified'; observed: 'seen' | 'not-seen-in-events' | 'unverified' };
  containment: WorkerResult['containment']; survivors: number | null; canary: WorkerResult['provenance']['canary']; failed: boolean;
}
function readPlain(file: string, max: number): string | null {
  let fd: number | undefined;
  try {
    const st = lstatSync(file); if (!st.isFile() || st.nlink !== 1 || st.size > max) return null;
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); const opened = fstatSync(fd);
    if (opened.nlink !== 1 || opened.ino !== st.ino || opened.dev !== st.dev || opened.size > max) return null;
    const buf = Buffer.alloc(opened.size); if (readSync(fd, buf, 0, buf.length, 0) !== buf.length) return null; return buf.toString('utf8');
  } catch { return null; } finally { if (fd !== undefined) closeSync(fd); }
}
function jsonLines(text: string | null): any[] | null { if (text === null) return null; try { return text.split('\n').filter(s => s.trim()).map(s => JSON.parse(s)); } catch { return null; } }
function searchCall(v: any): boolean {
  if (!v || typeof v !== 'object') return false;
  if (['web_search', 'web_search_call'].includes(v.type) || ['tool_use', 'server_tool_use'].includes(v.type) && /^(WebSearch|web_search)$/.test(v.name)) return true;
  return Object.values(v).some(searchCall);
}
export function auditTurn(root: string, spec: WorkerSpec, result: WorkerResult, live: boolean): TurnAudit {
  const family = spec.family, expected = path.join(root, 'adapters', family === 'claude' ? 'claude-state' : 'codex-state', 'runs');
  const relative = path.relative(expected, result.eventsPath), parts = relative.split(path.sep);
  let valid = live && parts.length === 2 && /^[0-9a-f-]{36}$/.test(parts[0]!) && parts[1] === 'events.jsonl';
  if (valid) for (const dir of [path.join(root, 'adapters'), path.dirname(expected), expected, path.dirname(result.eventsPath)]) { try { if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) valid = false; } catch { valid = false; } }
  const dir = path.dirname(result.eventsPath);
  const events = valid ? jsonLines(readPlain(result.eventsPath, 8 << 20)) : null;
  const egress = valid ? jsonLines(readPlain(path.join(dir, 'egress.jsonl'), 8 << 20)) : null;
  const config = valid ? readPlain(path.join(dir, 'config.toml'), 64 << 10) : null;
  let claudeDisabled = false;
  if (valid) try { const settings = JSON.parse(readPlain(path.join(dir, 'claude-settings.json'), 64 << 10) ?? 'null'); claudeDisabled = settings?.permissions?.deny?.includes('WebSearch') === true; } catch { /* unverified */ }
  const disabled = config !== null && /^web_search\s*=\s*"disabled"\s*$/m.test(config) || claudeDisabled;
  const loggingFailed = result.warnings.some(w => /egress audit unavailable/i.test(w));
  const checkedEgress = egress !== null && egress.every(e => typeof e?.allowed === 'boolean' && typeof e?.connected === 'boolean' && typeof e?.target === 'string');
  const allowed = checkedEgress ? egress!.filter(e => e.allowed).length : null, denied = checkedEgress ? egress!.filter(e => !e.allowed).length : null;
  const nonModel = checkedEgress && egress!.some(e => e.allowed && !allowedTarget(e.target, family === 'claude' ? ANTHROPIC_API_HOSTS : MODEL_API_HOSTS));
  const seen = events?.some(searchCall) === true;
  const failed = nonModel || seen || result.provenance.canary === 'failed' || result.containment === 'survivor-killed' || (result.supervisor?.survivors ?? 0) > 0 || loggingFailed || result.status === 'containment_failure' || !!result.violation;
  return { jobId: spec.jobId, family, status: result.status, supervisor: result.supervisor ? structuredClone(result.supervisor) : null, network: { configured: valid ? spec.network : 'unverified', observed: nonModel ? 'non-model-egress' : !checkedEgress || loggingFailed || result.provenance.canary !== 'denied' || result.containment !== 'reaped' ? 'unverified' : allowed! + denied! === 0 ? 'no-egress-observed' : denied ? 'denied-egress-attempts' : 'model-api-egress-only', allowed, denied, loggingFailed }, webSearch: { configured: disabled ? 'disabled' : 'unverified', observed: seen ? 'seen' : events?.length ? 'not-seen-in-events' : 'unverified' }, containment: result.containment, survivors: result.supervisor?.survivors ?? null, canary: result.provenance.canary, failed };
}
export function summarizeAudit(turns: readonly TurnAudit[] = []) {
  const common = (values: string[]) => !values.length ? 'unverified' : values.every(v => v === values[0]) ? values[0]! : 'mixed';
  return { network: { configured: common(turns.map(t => t.network.configured)), observed: common(turns.map(t => t.network.observed)) }, webSearch: { configured: common(turns.map(t => t.webSearch.configured)), observed: turns.some(t => t.webSearch.observed === 'seen') ? 'seen' : common(turns.map(t => t.webSearch.observed)) }, failed: turns.some(t => t.failed) };
}
