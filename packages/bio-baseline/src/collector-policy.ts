/** Arm C collector policy: phase-specific tools and a closed development sandbox. */
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { machOLibraryRoots } from '../../bio-core/src/index.ts';
import { auditToolReceipts } from '../../bio-host/src/tool-audit.ts';
const obj = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const equalSet = (actual: unknown, expected: string[]) => Array.isArray(actual) && actual.length === new Set(actual).size &&
  actual.length === new Set(expected).size && expected.every(item => actual.includes(item));
let runtime: string[] | undefined;
export function collectorRuntimeReads(): string[] {
  return runtime ??= [...new Set([path.dirname(realpathSync(process.execPath)), '/bin', '/usr/bin', '/usr/lib', '/System/Library', '/Library/Apple/System/Library',
    '/private/var/db/dyld', '/private/etc/localtime', '/usr/share/zoneinfo', '/private/var/db/timezone', '/private/var/select', '/dev/null', '/dev/urandom', '/dev/random',
    ...(process.platform === 'darwin' ? machOLibraryRoots(process.execPath) : ['/lib', '/lib64', '/etc/ld.so.cache'])].filter(existsSync))];
}
export function codePolicyCompliant(boundaryValue: unknown, stdout: string, auditValue: unknown, prefix?: string): boolean {
  const boundary = obj(boundaryValue), settings = obj(boundary.settings), sandbox = obj(settings.sandbox), fs = obj(sandbox.filesystem), net = obj(sandbox.network), audit = obj(auditValue);
  const cwd = Array.isArray(fs.allowWrite) && fs.allowWrite.length === 1 ? fs.allowWrite[0] : undefined;
  if (typeof cwd !== 'string' || boundary.phase !== 'code' || typeof boundary.nonce !== 'string' || boundary.nonce !== audit.nonce ||
    !equalSet(fs.denyRead, ['/']) || !equalSet(fs.allowRead, [cwd, ...collectorRuntimeReads(), ...(prefix ? [prefix] : [])]) ||
    !equalSet(fs.denyWrite, ['data', 'worker-context.json', 'dataset-catalog.json', 'validity-summary.json', 'validity-findings.json', '.claude', 'CLAUDE.md'].map(name => path.join(cwd, name)).concat(prefix ? [prefix] : [])) ||
    sandbox.failIfUnavailable !== true || sandbox.autoAllowBashIfSandboxed !== true || !equalSet(sandbox.excludedCommands, []) ||
    Object.hasOwn(net, 'httpProxyPort') || Object.hasOwn(net, 'socksProxyPort') || !equalSet(net.deniedDomains, ['*']) || net.allowLocalBinding !== false || net.allowAllUnixSockets !== false || !equalSet(net.allowUnixSockets, []) ||
    !Array.isArray(audit.receipts) || !equalSet(audit.missing, []) || !equalSet(audit.violations, [])) return false;
  try {
    const checked = auditToolReceipts(stdout, audit.receipts.map((r: unknown) => JSON.stringify(r)).join('\n'), boundary.nonce,
      { cwd, deny: obj(settings.permissions).deny, bash: true });
    return checked.violations.length === 0;
  } catch { return false; }
}
