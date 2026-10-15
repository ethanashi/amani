// Host-owned Claude Code launch policy: native sandbox settings, pinned flags, and the Seatbelt
// rendering of those settings used by the host canary probe. Erasable TypeScript only (the fake CLI
// in the tests imports this file directly with Node's type stripping).
import path from 'node:path';
import { homedir } from 'node:os';
import type { WorkerSpec } from './contracts.ts';
import { inside } from './files.ts';

export const PINNED_CLAUDE_VERSION = '2.1.296';
/** The owner's pinned build (design V6: pinned CLI path). Production wiring passes this as cliPath. */
export const PINNED_CLAUDE_CLI = path.join(homedir(), '.omerta-bio', 'bin', `claude-${PINNED_CLAUDE_VERSION}`);
/** v1 arm tool set (run-claude-arm.sh); init's tool inventory must stay inside it. */
export const CLAUDE_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit'] as const;
/** armlib.py CLAUDE_DENIED_TOOLS: web, sub-agents, scheduling, worktrees, artifacts and every MCP tool. */
export const CLAUDE_DENIED_TOOLS = ['WebSearch', 'WebFetch', 'Task', 'Agent', 'SendMessage', 'Workflow', 'Skill', 'RemoteTrigger',
  'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'EnterWorktree', 'ExitWorktree', 'Monitor', 'PushNotification', 'Artifact*', 'mcp__*'] as const;
/** Deny-by-root read policy shared with sandbox.ts / armlib sandbox_profile. */
export function denyRoots(home: string = homedir()): string[] {
  return [home, '/private/var/tmp/bb', '/private/var/tmp/biobase-arms', '/private/tmp', '/tmp', '/private/var/folders', '/var/folders', '/Volumes', '/Users/Shared'];
}
export interface ClaudeSettings {
  permissions: { defaultMode: 'default'; allow: string[]; deny: string[] };
  sandbox: {
    enabled: true; failIfUnavailable: true; autoAllowBashIfSandboxed: true; allowUnsandboxedCommands: false;
    network: { allowedDomains: string[]; strictAllowlist: true; allowLocalBinding: false; allowMachLookup: string[] };
    filesystem: { denyRead: string[]; allowRead: string[]; denyWrite: string[]; allowWrite: string[] };
  };
}
export interface ClaudeSettingsInput {
  workdir: string; tmp: string; mounts: readonly string[];
  /** CLI configuration HOME (session files, shell snapshots): readable by sandboxed Bash, never writable. */
  configHome: string;
  /** Host authority (state, evidence, canary): no read, no write, by every tool and Bash. */
  denied: readonly string[];
  /** Reaper fingerprint: Claude's macOS profile is deny-default for mach-lookup, so only these names resolve. */
  machLookup: readonly string[];
  home?: string;
}
const rule = (tool: string, p: string): string => `${tool}(/${p}/**)`;
const absolute = (p: string): string => { if (!path.isAbsolute(p) || /[\n\r\0"]/.test(p)) throw new Error('invalid sandbox path'); return p; };
/** Glob syntax in either compiler: the CLI's native sandbox turns a path containing * ? [ ] into a
 * regex rule (2.1.296 `ed()`), and permission patterns go through picomatch (? * + @ ! ( ) [ ] { }),
 * with \ as its escape. An admitted root holding any of them could widen a grant to a sibling, so it is
 * refused, never escaped (V6 review finding 1). */
export const GLOB_META = /[*?[\]{}()!+@\\]/;
export function literalRoot(p: string): string {
  if (GLOB_META.test(absolute(p))) throw new Error(`glob metacharacter in admitted root refused: ${JSON.stringify(p)}`);
  return p;
}
/** Native settings for one worker. Claude permission rules let deny beat allow, so a deny root that
 * contains an allowed scope is not listed for that tool: the Read tool's own working-directory
 * confinement and the sandbox's allowRead precedence cover it. Writes are deny-by-default in the
 * sandbox (only allowWrite), so denyWrite lists only protected paths, never ancestors of allowWrite. */
export function claudeWorkerSettings(input: ClaudeSettingsInput): ClaudeSettings {
  const workdir = literalRoot(input.workdir), tmp = literalRoot(input.tmp), configHome = literalRoot(input.configHome);
  const mounts = input.mounts.map(literalRoot), denied = input.denied.map(literalRoot);
  const readScopes = [workdir, tmp, ...mounts];
  const roots = [...new Set([...denyRoots(input.home), ...denied])];
  for (const d of denied) if ([...readScopes, configHome].some(s => inside(s, d) || inside(d, s))) throw new Error('host authority overlaps worker scope');
  const readDeny = [...new Set([...roots, configHome])].filter(r => !readScopes.some(s => inside(s, r)));
  const writeDeny = [...new Set([...roots, configHome, ...mounts])].filter(r => !inside(workdir, r));
  return {
    permissions: {
      defaultMode: 'default',
      allow: ['Bash', ...['Read', 'Edit', 'Write', 'NotebookEdit'].map(t => rule(t, workdir)), rule('Read', tmp), ...mounts.map(m => rule('Read', m))],
      deny: [...CLAUDE_DENIED_TOOLS, ...readDeny.map(p => rule('Read', p)), ...['Edit', 'Write', 'NotebookEdit'].flatMap(t => writeDeny.map(p => rule(t, p)))],
    },
    sandbox: {
      enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
      network: { allowedDomains: [], strictAllowlist: true, allowLocalBinding: false, allowMachLookup: input.machLookup.map(n => { if (!/^[A-Za-z0-9._-]+$/.test(n)) throw new Error('invalid mach name'); return n; }) },
      filesystem: {
        denyRead: roots, allowRead: [...readScopes, configHome],
        denyWrite: [...new Set([...denied, ...mounts, configHome])].filter(p => !inside(workdir, p) && !inside(tmp, p)),
        allowWrite: [workdir, tmp],
      },
    },
  };
}
/** Seatbelt rendering of the settings' filesystem/network semantics as Claude CLI 2.1.296 documents
 * them (denyRead; allowRead takes precedence; writes only under allowWrite minus denyWrite; no
 * network; mach-lookup names resolve only when listed). The host canary probe runs under it. It is
 * not Claude's own generated profile: the live probe (selfTest) exercises that. */
export function claudeSandboxProfile(settings: ClaudeSettings): string {
  const q = (p: string): string => JSON.stringify(absolute(p));
  const fs = settings.sandbox.filesystem;
  const ancestors = new Set<string>();
  for (const p of [...fs.allowRead, ...fs.allowWrite]) { let parent = path.dirname(p); for (;;) { ancestors.add(parent); if (parent === path.dirname(parent)) break; parent = path.dirname(parent); } }
  return ['(version 1)', '(allow default)',
    ...fs.denyRead.map(p => `(deny file-read* (subpath ${q(p)}))`),
    ...fs.allowRead.map(p => `(allow file-read* (subpath ${q(p)}))`),
    ...[...ancestors].map(p => `(allow file-read-metadata (literal ${q(p)}))`),
    '(deny file-write*)',
    ...fs.allowWrite.map(p => `(allow file-write* (subpath ${q(p)}))`),
    '(allow file-write* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper") (regex #"^/dev/fd/") (regex #"^/dev/ttys"))',
    ...fs.denyWrite.map(p => `(deny file-write* (subpath ${q(p)}))`),
    ...settings.sandbox.network.allowMachLookup.flatMap(n => [`(allow mach-lookup (global-name ${JSON.stringify(n)}))`, `(deny mach-lookup (global-name ${JSON.stringify(n + '.deny')}))`]),
    '(deny network*)', ''].join('\n');
}
/** Pinned flags. Never --bare, never --dangerously-skip-permissions, never --fallback-model. The
 * prompt goes on stdin (byte-identical, no argv limit, no leading-dash ambiguity). `--setting-sources ''`
 * loads only the host --settings file and policy: no user, project or local settings from any
 * worker-writable directory. A first turn pins a host-chosen session id; a resume names it. */
export function claudeArguments(spec: Pick<WorkerSpec, 'model' | 'effort'>, input: { settingsPath: string; sessionId: string; resume: boolean }): string[] {
  return ['-p', '--output-format', 'stream-json', '--verbose',
    '--model', spec.model, '--effort', spec.effort,
    '--permission-mode', 'default', '--permission-prompts', 'none',
    '--restricted', '--tools', CLAUDE_TOOLS.join(','),
    '--no-chrome', '--disable-slash-commands',
    '--setting-sources', '', '--settings', input.settingsPath,
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--disallowedTools', CLAUDE_DENIED_TOOLS.join(','),
    ...(input.resume ? ['--resume', input.sessionId] : ['--session-id', input.sessionId])];
}
