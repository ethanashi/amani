import {cliAnswer,cliProviderOutcome} from './provider-error.ts';
import {scanForCanaries} from '../../omb-investigate/src/mounts.ts';
import {streamCanary} from './stream-canary.ts';
class TrustedInputChanged extends Error {constructor(readonly file:string,readonly expected:string){super('host protected input hash tamper refused');}}
// V6 Claude Code worker adapter: the Codex adapter's contract on `claude -p`. Claude keeps its own
// native sandbox (an outer Seatbelt nests and breaks Claude's Bash: run-claude-arm.sh, and
// sandbox_apply fails under any non-trivial outer profile on this host), so containment is the
// host-owned --settings file plus the shared sandboxReaper, whose fingerprint rides in the native
// profile through sandbox.network.allowMachLookup.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, closeSync, constants, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readSync, realpathSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import type { Launch, ProcessRunner, RefusalReceipt, RerouteHint, SandboxBackend, WorkerAdapter, WorkerResult, WorkerSpec, WorkerStatus } from './contracts.ts';
import { fileUnder, inside, regular, removeScratch, sha256 } from './files.ts';
import { runProcess } from './process.ts';
import { SeatbeltBackend } from './sandbox.ts';
import { ANTHROPIC_API_HOSTS, startModelProxy } from './proxy.ts';
import { sandboxReaper } from './reaper.ts';
import { finalCensus, superviseOutcome } from './supervision.ts';
import { CLAUDE_TOOLS, claudeArguments, claudeSandboxProfile, claudeWorkerSettings, literalRoot } from './claude-settings.ts';
import { UUID, claudeCanaryExposed, claudeEvents, claudeRateLimit, claudeRefusal, claudeResumeUnavailable, claudeTelemetry, sameModel, type ModelAliases } from './claude-stream.ts';

export interface ClaudeAdapterOptions {
  /** Host authority and ephemeral storage must be disjoint from every worker scope. */
  stateRoot: string; scratchRoot: string;
  /** Pinned CLI (production: PINNED_CLAUDE_CLI). Hashed once and re-checked before every launch. */
  cliPath: string;
  /** Optional pins: a different binary hash or `--version` prefix refuses before any model turn. */
  cliSha256?: string; cliVersion?: string;
  /** Host login keychain directory (~/Library/Keychains), linked into the throwaway HOME so the
   * CLI's OAuth login resolves (run-claude-arm.sh). It stays under the sandbox's denied home root. */
  keychainDir?: string;
  now: () => number; // epoch milliseconds; injected in all tests
  toolPath?: string;
  schemas?: Readonly<Record<string, (bytes: string) => boolean>>;
  runner?: ProcessRunner;
  /** Sandbox that runs the host canary probe under the settings' Seatbelt rendering. */
  probeBackend?: SandboxBackend;
  /** Undated requested id → the dated revisions it may resolve to (host-owned). Default: none, so an
   * undated request must be reported undated and a dated request must match exactly. */
  modelAliases?: ModelAliases;
  /** Host-owned full-match version patterns keyed by requested model. */
  modelVersionPatterns?:Readonly<Record<string,string>>;
  /** Host supervisor (shared sandboxReaper). Default: on, Darwin only. Off means containment is unproven. */
  supervisor?: boolean;
  /** Exact-boundary fault injection. Trusted test/orchestrator hook, never worker input. */
  beforeLaunch?: (boundary: { settingsPath: string; profilePath: string; phase: 'preflight' | 'probe' | 'worker' }) => void;
}
export interface ClaudeAuthReceipt { loggedIn: boolean; authMethod: string | null; apiProvider: string | null; apiKeySource: string | null; subscriptionType: string | null }
export interface ClaudeReceipt {
  /** observedModels and modelVerified cover the whole session, including turns before a resume. */
  sessionId: string | null; requestedModel: string; observedModels: string[]; modelVerified: boolean;
  /** A model other than the requested one served some turn of this session (sticky across resumes). */
  sessionSubstituted: boolean;
  /** `claude auth status --json`, recorded before the first model turn; null when it did not run. */
  auth: ClaudeAuthReceipt | null;
  /** init.apiKeySource: "none" means the CLI used the OAuth login, not an API key. */
  streamApiKeySource: string | null;
  durationMs: number | null;
  /** selfTest only: the in-CLI probe turn against Claude's own generated sandbox profile. */
  liveCanary: 'denied' | 'failed' | 'unavailable' | null;
}
export interface ClaudeWorkerResult extends WorkerResult { refusal: RefusalReceipt | null; reroute: RerouteHint | null; claude: ClaudeReceipt }
export interface ClaudeSelfTest { status: WorkerStatus; auth: ClaudeAuthReceipt | null; hostCanary: WorkerResult['provenance']['canary']; liveCanary: ClaudeReceipt['liveCanary']; ok: boolean; warnings: string[] }
interface Archive { relative: string; file: string; sha256: string }
interface Work { realAssistantMessages: number; toolUses: number; toolResults: number }
interface Session {
  sessionId: string; workdir: string; model: string; effort: string; jobId: string;
  transcripts: Archive[]; cumulativeUsage: WorkerResult['usage']; captured: Record<string, string>;
  /** Host-recorded history (V6 review findings 3 and 5): every model the CLI reported in any turn,
   * the sticky substitution taint, and the work already done, so a continuation cannot erase them. */
  observedModels: string[]; substituted: boolean; work: Work;
}
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
function history(s: Session): boolean {
  const w = s.work as Partial<Work> | undefined;
  return Array.isArray(s.observedModels) && s.observedModels.every(m => typeof m === 'string') && typeof s.substituted === 'boolean'
    && !!w && count(w.realAssistantMessages) && count(w.toolUses) && count(w.toolResults);
}
class PreflightError extends Error {}
const PROBE_MARK = 'OMB-SANDBOX-PROBE';
function freeze(file: string, bytes: string | Buffer): string { writeFileSync(file, bytes, { mode: 0o400, flag: 'wx' }); return sha256(bytes); }
function verify(file: string, hash: string): void {
  const st = lstatSync(file);
  if(sha256(regular(file, 300_000_000))!==hash)throw new TrustedInputChanged(file,hash);
  if ((st.mode & 0o222) !== 0 || st.uid !== process.getuid?.() || sha256(regular(file, 300_000_000)) !== hash) throw new Error('host settings/profile or captured log tamper refused');
}
/** Copy one CLI session file into host evidence: no symlink, one link, stable while read. */
function archiveFile(file: string, archive: string): string {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let out: number | undefined;
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > 256_000_000) throw new Error('unsafe session file');
    out = openSync(archive, 'wx', 0o400);
    const h = createHash('sha256'), chunk = Buffer.alloc(65536);
    for (;;) { const n = readSync(fd, chunk); if (!n) break; h.update(chunk.subarray(0, n)); let o = 0; while (o < n) o += writeSync(out, chunk.subarray(o, n)); }
    const after = fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('session file changed during capture');
    return h.digest('hex');
  } finally { closeSync(fd); if (out !== undefined) closeSync(out); }
}
/** Find the CLI's own transcript for `sessionId` under HOME/.claude/projects (the CLI writes it;
 * sandboxed Bash cannot: configHome is never in allowWrite). */
function captureSession(configDir: string, sessionId: string, evidence: string): { archives: Archive[]; warnings: string[] } {
  const archives: Archive[] = [], warnings: string[] = [], root = path.join(configDir, 'projects');
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(file, depth + 1); continue; }
      if (!entry.isFile() || entry.name !== `${sessionId}.jsonl`) continue;
      try {
        const archive = path.join(evidence, `session-${archives.length}.jsonl`);
        archives.push({ relative: path.relative(configDir, file), file: archive, sha256: archiveFile(file, archive) });
      } catch { warnings.push('session transcript capture unavailable'); }
    }
  };
  try { if (lstatSync(root).isDirectory()) walk(root, 0); } catch { warnings.push('session transcript inventory unavailable'); }
  if (archives.length !== 1) warnings.push(`single CLI session transcript unavailable (${archives.length} found)`);
  return { archives, warnings };
}
/** Strip /private from macOS /var and /tmp aliases for CLAUDE_CODE_TMPDIR, as run-claude-arm.sh does. */
const cliTmp = (p: string): string => /^\/private\/(var|tmp)\//.test(p) ? p.slice('/private'.length) : p;
function messageBlocks(message: unknown): unknown[] {
  const content = message && typeof message === 'object' ? (message as {content?: unknown}).content : undefined;
  return Array.isArray(content) ? content : [];
}
export function liveCanary(stdout: string, canaryPath: string, canary: string): ClaudeReceipt['liveCanary'] {
  if (claudeCanaryExposed(stdout, canary)) return 'failed';
  const commands = new Set<string>(), want = [`cat '${canaryPath}'`, `cat ${canaryPath}`];
  for (const e of claudeEvents(stdout)) if (e.type === 'assistant') for (const b of messageBlocks(e.message)) {
    const block = b as { type?: unknown; name?: unknown; id?: unknown; input?: { command?: unknown } };
    if (block && typeof block === 'object' && block.type === 'tool_use' && block.name === 'Bash' && typeof block.id === 'string' && typeof block.input?.command === 'string' && want.includes(block.input.command.trim())) commands.add(block.id);
  }
  for (const e of claudeEvents(stdout)) if (e.type === 'user') for (const b of messageBlocks(e.message)) {
    const block = b as { type?: unknown; tool_use_id?: unknown; is_error?: unknown; content?: unknown };
    if (block && typeof block === 'object' && block.type === 'tool_result' && commands.has(block.tool_use_id as string) && block.is_error === true && JSON.stringify(block.content ?? '').includes('Operation not permitted')) return 'denied';
  }
  return 'unavailable';
}
export class ClaudeAdapter implements WorkerAdapter {
  readonly options: ClaudeAdapterOptions;
  get schemas() { return this.options.schemas; }
  constructor(options: ClaudeAdapterOptions) { this.options = options; }
  run(spec: WorkerSpec): Promise<ClaudeWorkerResult> { return this.execute(spec, false); }
  /** Adapter-start self-test: pinned CLI, OAuth, host canary probe, then one tiny probe turn that asks
   * the real CLI to `cat` the sealed canary through its own sandboxed Bash. Spends one model turn. */
  async selfTest(input: { workdir: string; model: string; effort: string; timeoutMs: number }): Promise<ClaudeSelfTest> {
    const r = await this.execute({ jobId: 'claude-self-test', kind: 'explore', harness: 'claude-code', family: 'anthropic', model: input.model, effort: input.effort,
      workdir: input.workdir, mounts: [], promptFile: '', network: 'model-api-only', timeoutMs: input.timeoutMs, expect: [] }, true);
    return { status: r.status, auth: r.claude.auth, hostCanary: r.provenance.canary, liveCanary: r.claude.liveCanary,
      ok: r.status === 'ok' && r.provenance.canary === 'denied' && r.claude.liveCanary === 'denied', warnings: r.warnings };
  }
  private async execute(input: WorkerSpec, probeTurn: boolean): Promise<ClaudeWorkerResult> {
    const spec = structuredClone(input), options = this.options, runner = options.runner ?? runProcess;
    const probeBackend = options.probeBackend ?? new SeatbeltBackend();
    const result: ClaudeWorkerResult = { status: 'infra_error', resetAt: null, sessionToken: null, files: {}, warnings: [], usage: null, eventsPath: '', quota: null, usageComplete: false, containment: 'unavailable', supervisor: null,
      rateLimit: { terminal: false, signals: [], resetHint: null }, refusal: null, reroute: null,
      provenance: { cliVersion: null, cliSha256: null, initInventory: [], observedModels: [], observedEfforts: [], identitySource: 'unavailable', profileSha256: null, configSha256: null, canary: 'unavailable' },
      claude: { sessionId: null, requestedModel: spec.model, observedModels: [], modelVerified: false, sessionSubstituted: false, auth: null, streamApiKeySource: null, durationMs: null, liveCanary: null } };
    let scratch: string | null = null, proxy: Awaited<ReturnType<typeof startModelProxy>> | null = null, started = false;
    let reaper: ReturnType<typeof sandboxReaper> | undefined;
    try {
      if (spec.harness !== 'claude-code' || spec.family !== 'anthropic' && spec.family !== 'claude' || spec.network !== 'model-api-only') throw new PreflightError('unsupported worker harness/family/network');
      if (!spec.model.trim() || /[\0\r\n]/.test(spec.model) || !/^[a-z]+$/.test(spec.effort) || !Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs <= 0) throw new PreflightError('invalid worker settings');
      spec.workdir = realpathSync(spec.workdir);
      for (const root of [options.stateRoot, options.scratchRoot]) mkdirSync(root, { recursive: true, mode: 0o700 });
      const state = realpathSync(options.stateRoot), scratchRoot = realpathSync(options.scratchRoot);
      // Every root that reaches a native rule or permission pattern must be literal under glob syntax.
      try { for (const root of [spec.workdir, state, scratchRoot]) literalRoot(root); } catch (e) { throw new PreflightError((e as Error).message); }
      if (inside(state, spec.workdir) || inside(spec.workdir, state) || inside(scratchRoot, spec.workdir) || inside(spec.workdir, scratchRoot) || inside(state, scratchRoot) || inside(scratchRoot, state)) throw new PreflightError('host and worker scopes overlap');
      const mounts = spec.mounts.map(m => { if (m.mode !== 'ro') throw new PreflightError('mount must be read-only'); const real = realpathSync(m.path); try { return literalRoot(real); } catch (e) { throw new PreflightError((e as Error).message); } });
      for (const m of mounts) if ([state, scratchRoot, spec.workdir].some(s => inside(s, m) || inside(m, s))) throw new PreflightError('read-only mount overlaps host authority or worker');
      const prompt = probeTurn ? '' : regular(realpathSync(spec.promptFile), 16_000_000).toString('utf8');
      const cli = realpathSync(options.cliPath);
      result.provenance.cliSha256 = sha256(regular(cli, 300_000_000));
      if (options.cliSha256 && options.cliSha256 !== result.provenance.cliSha256) throw new PreflightError('pinned Claude CLI hash mismatch');
      const runId = randomUUID(), evidence = path.join(state, 'runs', runId);
      mkdirSync(evidence, { recursive: true, mode: 0o700 });
      result.eventsPath = path.join(evidence, 'events.jsonl');
      const pins = new Map<string, string>();
      let resume: Session | undefined;
      if (spec.resume) {
        if (!UUID.test(spec.resume.sessionToken)) throw new Error('resume unavailable: invalid host token');
        const receipt = JSON.parse(regular(path.join(state, 'sessions', spec.resume.sessionToken + '.json'), 24_000_000).toString('utf8')) as { session: Session; hash: string };
        if (canonicalSha256(receipt.session) !== receipt.hash) throw new Error('resume receipt changed');
        resume = receipt.session;
        if (resume.workdir !== spec.workdir || resume.model !== spec.model || resume.effort !== spec.effort || resume.jobId !== spec.jobId || !UUID.test(resume.sessionId)) throw new Error('resume unavailable: binding mismatch');
        if (!history(resume)) throw new Error('resume unavailable: receipt lacks identity/work history');
        for (const [file, hash] of Object.entries(resume.captured)) { verify(file, hash); pins.set(file, hash); }
        for (const a of resume.transcripts) if (!inside(a.file, state) || sha256(regular(a.file, 256_000_000)) !== a.sha256) throw new Error('resume session transcript hash changed');
        result.warnings.push('resumed Claude session history is CLI-written and hash-bound; conversation semantics are not attested');
      }
      scratch = mkdtempSync(path.join(scratchRoot, 'claude-'));
      const home = path.join(scratch, 'home'), configDir = path.join(home, '.claude'), tmp = path.join(scratch, 'tmp');
      for (const dir of [configDir, tmp]) mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (options.keychainDir) { mkdirSync(path.join(home, 'Library'), { mode: 0o700 }); symlinkSync(realpathSync(options.keychainDir), path.join(home, 'Library', 'Keychains')); }
      if (resume) for (const a of resume.transcripts) {
        const target = fileUnder(configDir, a.relative);
        mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); copyFileSync(a.file, target); chmodSync(target, 0o600);
      }
      const egressPath = path.join(evidence, 'egress.jsonl'); freeze(egressPath, ''); chmodSync(egressPath, 0o600);
      proxy = await startModelProxy({ now: options.now, hosts: ANTHROPIC_API_HOSTS, log: e => appendFileSync(egressPath, JSON.stringify(e) + '\n') });
      if (options.supervisor ?? process.platform === 'darwin') reaper = sandboxReaper(state);
      const settings = claudeWorkerSettings({ workdir: spec.workdir, tmp, mounts, configHome: home, denied: [state], machLookup: reaper ? [reaper.allow] : [] });
      const settingsPath = path.join(evidence, 'claude-settings.json'), profilePath = path.join(evidence, 'probe.sb');
      pins.set(settingsPath, freeze(settingsPath, JSON.stringify(settings, null, 2) + '\n')); result.provenance.configSha256 = pins.get(settingsPath)!;
      pins.set(profilePath, freeze(profilePath, claudeSandboxProfile(settings))); result.provenance.profileSha256 = pins.get(profilePath)!;
      // The CLI inherits no user environment or secrets; OAuth resolves through the linked keychain only.
      const env: NodeJS.ProcessEnv = { HOME: home, TMPDIR: tmp, CLAUDE_CODE_TMPDIR: cliTmp(tmp),
        PATH: options.toolPath ?? '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8',
        USER: process.env.USER ?? 'arm', LOGNAME: process.env.LOGNAME ?? process.env.USER ?? 'arm', TERM: 'dumb',
        HTTP_PROXY: `http://127.0.0.1:${proxy.port}`, HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
        http_proxy: `http://127.0.0.1:${proxy.port}`, https_proxy: `http://127.0.0.1:${proxy.port}`, ALL_PROXY: `http://127.0.0.1:${proxy.port}`,
        // Never let the CLI silently switch models (usage limits/overload): it must error instead.
        CLAUDE_CODE_NO_MODEL_FALLBACK: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' };
      const verifyAll = (phase: 'preflight' | 'probe' | 'worker'): void => {
        options.beforeLaunch?.({ settingsPath, profilePath, phase });
        for (const [file, hash] of pins) verify(file, hash);
        if (sha256(regular(cli, 300_000_000)) !== result.provenance.cliSha256) throw new Error('CLI changed before launch');
      };
      const base = { cwd: spec.workdir, env, timeoutMs: Math.min(spec.timeoutMs, 120_000) };
      // Preflight (CONTRACT v2: may fail the job only here, before the first model turn).
      verifyAll('preflight');
      const version = await runner({ ...base, command: cli, args: ['--version'] });
      if (version.exitCode !== 0 || version.timedOut || version.truncated || !version.stdout.trim()) throw new PreflightError(`CLI preflight unavailable (exit ${version.exitCode}, signal ${version.signal}, timeout ${version.timedOut})`);
      result.provenance.cliVersion = version.stdout.trim().split('\n')[0]!;
      if (options.cliVersion && !result.provenance.cliVersion.startsWith(options.cliVersion)) throw new PreflightError(`pinned Claude CLI version mismatch: ${result.provenance.cliVersion}`);
      const authRun = await runner({ ...base, command: cli, args: ['auth', 'status', '--json'] });
      let auth: Record<string, unknown> | null = null;
      try { if (!authRun.timedOut && !authRun.truncated) auth = JSON.parse(authRun.stdout) as Record<string, unknown>; } catch { /* below */ }
      const text = (v: unknown): string | null => typeof v === 'string' && v.length <= 200 ? v : null;
      if (auth && typeof auth === 'object') result.claude.auth = { loggedIn: auth.loggedIn === true, authMethod: text(auth.authMethod), apiProvider: text(auth.apiProvider), apiKeySource: text(auth.apiKeySource), subscriptionType: text(auth.subscriptionType) };
      const a = result.claude.auth;
      if (!a || authRun.exitCode !== 0 || !a.loggedIn || a.authMethod !== 'claude.ai' || (a.apiProvider !== null && a.apiProvider !== 'firstParty') || a.apiKeySource !== null)
        throw new PreflightError(`Claude OAuth self-test failed (exit ${authRun.exitCode}, loggedIn ${a?.loggedIn ?? 'unknown'}, method ${a?.authMethod ?? 'unknown'}, provider ${a?.apiProvider ?? 'unknown'}, api key ${a?.apiKeySource ?? 'none'})`);
      const canary = randomBytes(32).toString('hex'), canaryPath = path.join(evidence, 'sealed-canary'), writeProbe = path.join(evidence, 'write-probe');
      freeze(canaryPath, canary);
      // Positive control: a missing file must never be mistaken for an access denial.
      if (regular(canaryPath).toString() !== canary) throw new PreflightError('canary fixture unavailable');
      verifyAll('probe');
      const probeCode = `const fs=require('node:fs');const no=e=>e.code==='EACCES'||e.code==='EPERM';let r='DENIED';try{fs.readFileSync(process.argv[1]);r='READABLE';}catch(e){if(!no(e))r='UNKNOWN';}try{fs.writeFileSync(process.argv[2],'x');r='WRITABLE';}catch(e){if(!no(e)&&r==='DENIED')r='UNKNOWN';}process.stdout.write(r);process.exitCode=r==='DENIED'?0:7;`;
      const probe = await runner(probeBackend.wrap(profilePath, { ...base, env: { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: tmp }, command: process.execPath, args: ['-e', probeCode, canaryPath, writeProbe] }));
      result.provenance.canary = probe.exitCode === 0 && !probe.timedOut && !probe.truncated && probe.stdout === 'DENIED' && !existsSync(writeProbe) ? 'denied' : 'failed';
      if (result.provenance.canary !== 'denied') throw new PreflightError('canary probe was not DENIED');
      result.provenance.initInventory = ['claude-native-sandbox', 'host-owned settings', 'fresh HOME', 'model-api proxy', `oauth:${a.authMethod}`, reaper ? 'sandbox-reaper' : 'no-supervisor'];
      const sessionId = resume?.sessionId ?? randomUUID();
      const args = claudeArguments(spec, { settingsPath, sessionId, resume: !!resume });
      const stdin = probeTurn ? `${PROBE_MARK}\nRun exactly this one shell command with the Bash tool, once, then reply with the single word DONE.\nCOMMAND: cat '${canaryPath}'\n` : spec.resume?.message ?? prompt;
      // stream-json --verbose carries every tool result inline; 8 MB (the runner default) can end a long
      // run. 32 MB keeps processRunner's per-chunk Buffer.concat copying bounded (see BUILD-NOTES).
      const launch: Launch = { cwd: spec.workdir, env, timeoutMs: spec.timeoutMs, command: cli, args, stdin, maxOutputBytes: 32_000_000, overflow: 'drain' };
      freeze(path.join(evidence, 'launch.json'), JSON.stringify({ command: cli, args, cwd: spec.workdir }));
      const canaryStream=streamCanary(line=>claudeCanaryExposed(line,canary),canary);
      verifyAll('worker'); started = true;
      launch.observeStdout=canaryStream.push;
      let outcome = await runner(reaper ? { ...launch, timeoutSignal: 'SIGTERM', command: reaper.command, args: [...reaper.args, launch.command, ...launch.args] } : launch);
      let supervisorFailure: string | null = null;
      if (reaper) ({ outcome, supervisorFailure } = superviseOutcome(reaper, outcome, result));
      else result.warnings.push('host supervisor disabled; containment unproven');
      if (outcome.cleanupFailed) { result.containment = 'unavailable'; result.warnings.push('process group cleanup failed'); }
      const captured: Record<string, string> = {};
      captured[result.eventsPath] = freeze(result.eventsPath, outcome.stdout);
      const stderrPath = path.join(evidence, 'stderr.log'); captured[stderrPath] = freeze(stderrPath, outcome.stderr);
      captured[settingsPath] = pins.get(settingsPath)!; captured[profilePath] = pins.get(profilePath)!;
      let trustedChanged = false;
      for (const [file, hash] of pins) try { verify(file, hash); } catch { try{verify(file,hash);}catch{trustedChanged=true;} }
      const tel = claudeTelemetry(outcome.stdout), limited = claudeRateLimit(outcome.stdout), turnRefusal = claudeRefusal(outcome.stdout);
      // Work counters cover the whole session: a refusal after a resumed job did work is never prework.
      const prior: Work = resume?.work ?? { realAssistantMessages: 0, toolUses: 0, toolResults: 0 };
      const work: Work = { realAssistantMessages: prior.realAssistantMessages + turnRefusal.realAssistantMessages,
        toolUses: prior.toolUses + turnRefusal.toolUses, toolResults: prior.toolResults + turnRefusal.toolResults };
      const worked = work.realAssistantMessages + work.toolUses + work.toolResults > 0;
      const refusal: RefusalReceipt = { ...turnRefusal, ...work, phase: !turnRefusal.terminal ? null : worked ? 'midtask' : 'prework' };
      result.rateLimit = { terminal: limited.terminal, signals: limited.signals, resetHint: null }; result.resetAt = limited.resetsAt;
      result.quota = tel.quota; result.usage = tel.usage;
      result.usageComplete = tel.usageComplete && outcome.exitCode === 0 && !outcome.timedOut && !outcome.signal && !outcome.truncated;
      result.refusal = refusal.refusals || refusal.signals.length ? refusal : null;
      if (result.refusal) freeze(path.join(evidence, 'refusal.json'), JSON.stringify(result.refusal));
      // Identity covers the whole session: an earlier substitution stays a substitution after resume.
      const observed = [...new Set([...(resume?.observedModels ?? []), ...tel.models])].sort();
      const foreign = observed.filter(m => !sameModel(spec.model, m, options.modelAliases) && !(options.modelVersionPatterns?.[spec.model] && new RegExp(`^(?:${options.modelVersionPatterns[spec.model]})$`, 'u').test(m)));
      const substituted = foreign.length > 0 || (resume?.substituted ?? false);
      result.provenance.observedModels = observed; result.claude.observedModels = observed; result.claude.sessionSubstituted = substituted;
      result.provenance.identitySource = tel.initModel ? 'claude-stream' : 'unavailable';
      result.claude.streamApiKeySource = tel.apiKeySource; result.claude.durationMs = tel.result?.durationMs ?? null;
      result.claude.sessionId = tel.sessionId;
      result.claude.modelVerified = tel.models.length > 0 && !substituted;
      const toolsOk = !!tel.tools && tel.tools.length > 0 && tel.tools.every(t => (CLAUDE_TOOLS as readonly string[]).includes(t)) && Array.isArray(tel.mcpServers) && tel.mcpServers.length === 0;
      const provenanceWarnings: string[] = [];
      if (foreign.length) provenanceWarnings.push(`model substitution observed: requested ${spec.model}, observed ${foreign.join(', ')}`);
      else if (substituted) provenanceWarnings.push('model substitution recorded earlier in this session');
      if (!tel.models.length) provenanceWarnings.push('observed model unavailable');
      if (tel.apiKeySource !== 'none') provenanceWarnings.push(`stream credential source is ${tel.apiKeySource ?? 'unavailable'}, not the OAuth login`);
      if (!toolsOk) provenanceWarnings.push('init tool/MCP inventory unavailable or outside the pinned tool set');
      if (!tel.sessionId || !UUID.test(tel.sessionId)) provenanceWarnings.push('CLI session id unavailable');
      else if (tel.sessionId !== sessionId) provenanceWarnings.push('CLI session id differs from the host-assigned id');
      const exited = !outcome.timedOut && !outcome.signal && !outcome.truncated;
      let status: WorkerStatus;
      result.text=cliAnswer(outcome.stdout);
      const typed=cliProviderOutcome(outcome.stdout,outcome.stderr);if(typed)result.providerOutcome=typed;
      if(outcome.interruption)result.providerOutcome={type:outcome.interruption,text:'Progress watchdog stopped this session'};
      if (outcome.timedOut) status = 'timeout';
      else if (outcome.signal) status = 'agent_error';
      else if (limited.terminal) status = 'rate_limited'; // a terminal limit pauses the provider: it outranks a refusal (pilot.py)
      else if (refusal.terminal && !refusal.fallback && !substituted) status = refusal.phase === 'prework' ? 'refused-prework' : 'refused-midtask';
      else if (resume && claudeResumeUnavailable(outcome.stdout, outcome.stderr, sessionId)) { status = 'needs_resume'; result.warnings.push('resume unavailable: the CLI found no conversation for the restored session'); }
      else if (tel.authFailed) { status = 'provider-error'; result.warnings.push('Claude authentication failed during the turn; re-login required'); }
      else if (tel.providerError) { status = 'provider-error'; result.warnings.push(`provider API error (${tel.providerError}); retry`); }
      else if (outcome.exitCode === 0 && tel.result && !tel.result.isError && tel.results === 1) status = 'ok';
      else status = spec.resume ? 'needs_resume' : 'agent_error';
      if (refusal.terminal && (refusal.fallback || substituted)) result.warnings.push('terminal refusal with a model switch is the arm outcome, not a reroutable refusal');
      if (exited && refusal.terminal) result.warnings.push(`provider usage classifier refused the turn (${refusal.phase}${refusal.category ? `, category ${refusal.category}` : ''}); not a science outcome`);
      if(status==='refused-prework'||status==='refused-midtask'){
        const raw=claudeEvents(outcome.stdout).flatMap(e=>{const m=e.message as {stop_reason?:string;stop_details?:{explanation?:unknown}}|undefined;const explanation=e.subtype==='model_refusal_no_fallback'?e.api_refusal_explanation:m?.stop_reason==='refusal'?m.stop_details?.explanation:null;return typeof explanation==='string'?[explanation]:[];}).at(-1);
        if(raw!==undefined)result.providerOutcome={type:'refusal',text:raw};
      }
      result.status = status;
      if (trustedChanged) { result.status = 'violation'; result.violation={kind:'trusted-path-changed',evidence:'Host protected input hash mismatch confirmed by repeated verification'};result.warnings.push('protected adapter inputs changed; resume refused'); }
      if (canaryStream.finish(outcome.stdout)||scanForCanaries(spec.workdir,[canary]).length>0) { result.status = 'violation'; result.violation={kind:'canary-exposed',evidence:'Host canary matched in captured worker output'};result.warnings.push('sealed canary exposed'); }
      if (probeTurn) result.claude.liveCanary = liveCanary(outcome.stdout, canaryPath, canary);
      result.warnings.push(...provenanceWarnings);
      if ((provenanceWarnings.length || !result.usageComplete) && result.status === 'ok') { result.status = 'provenance_unverified'; result.warnings.push('benchmark provenance unverified'); }
      if (supervisorFailure && result.status !== 'violation') { result.status = 'provider-error'; result.warnings.push(supervisorFailure); }
      else if (result.containment !== 'reaped' && result.status !== 'violation') {
        result.status = 'containment_failure'; result.warnings.push('worker sandbox cleanup failed or detached survivor observed');
      }
      // Resume binds the host token to the CLI's own transcript bytes, never to a worker-chosen id.
      const transcript = tel.sessionId && UUID.test(tel.sessionId) ? captureSession(configDir, tel.sessionId, evidence) : { archives: [], warnings: ['CLI session id unavailable; no resumable transcript'] };
      result.warnings.push(...transcript.warnings);
      if (!trustedChanged && result.status !== 'violation' && transcript.archives.length === 1 && tel.sessionId) {
        const previous = resume?.cumulativeUsage, current = result.usage;
        const cumulativeUsage = current ? { inputTokens: current.inputTokens + (previous?.inputTokens ?? 0), cachedInputTokens: current.cachedInputTokens + (previous?.cachedInputTokens ?? 0), outputTokens: current.outputTokens + (previous?.outputTokens ?? 0), totalTokens: current.totalTokens + (previous?.totalTokens ?? 0) } : previous ?? null;
        const session: Session = { sessionId: tel.sessionId, workdir: spec.workdir, model: spec.model, effort: spec.effort, jobId: spec.jobId, transcripts: transcript.archives, cumulativeUsage, captured,
          observedModels: observed, substituted, work };
        const token = randomUUID(), sessionRoot = path.join(state, 'sessions'); mkdirSync(sessionRoot, { recursive: true, mode: 0o700 });
        freeze(path.join(sessionRoot, token + '.json'), JSON.stringify({ session, hash: canonicalSha256(session) })); result.sessionToken = token;
      }
    } catch (e) {
      result.status = spec.resume && !started && !(e instanceof PreflightError) ? 'needs_resume' : 'infra_error';
      if(e instanceof TrustedInputChanged)try{if(sha256(regular(e.file))!==e.expected){result.status='violation';result.violation={kind:'trusted-path-changed',evidence:'Host input hash mismatch confirmed twice'};}}catch{}
      result.warnings.push(e instanceof Error ? e.message : String(e));
    } finally {
      finalCensus(reaper, started, result);
      if (proxy?.loggingFailed()) result.warnings.push('egress audit unavailable; no unobserved violation inferred');
      try { await proxy?.close(); } catch { result.warnings.push('proxy cleanup unavailable'); }
      if (scratch) try { removeScratch(scratch); } catch { result.warnings.push('scratch cleanup incomplete'); }
      // Partial deliverables survive every terminal path (refused-midtask keeps them for audit).
      for (const item of spec.expect) {
        try {
          const file = fileUnder(spec.workdir, item.file);
          if (!existsSync(file)) { result.files[item.file] = 'missing'; continue; }
          const bytes = regular(file).toString('utf8'), check = options.schemas?.[item.schema];
          result.files[item.file] = check?.(bytes) === true ? 'valid' : 'invalid';
        } catch { result.files[item.file] = 'invalid'; }
      }
      if (spec.expect.some(e => e.required && result.files[e.file] !== 'valid') && result.status === 'ok') result.status = 'needs_resume';
      // Owner's worker-model rule: refused Claude work is re-dispatched to Codex, never graded.
      result.reroute = result.status === 'refused-prework' || result.status === 'refused-midtask'
        ? { to: 'codex', reason: result.status, category: result.refusal?.category ?? null, preservePartialWork: result.status === 'refused-midtask' } : null;
    }
    return result;
  }
}
