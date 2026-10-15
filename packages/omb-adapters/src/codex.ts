import {cliAnswer,cliProviderOutcome} from './provider-error.ts';
import {scanForCanaries} from '../../omb-investigate/src/mounts.ts';
import {streamCanary} from './stream-canary.ts';
class TrustedInputChanged extends Error {constructor(readonly file:string,readonly expected:string){super('host protected input hash tamper refused');}}
import {providerError} from './provider-error.ts';
import { randomUUID, randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import type { Launch, ProcessRunner, SandboxBackend, WorkerAdapter, WorkerResult, WorkerSpec } from './contracts.ts';
import { fileUnder, inside, regular, removeScratch, sha256 } from './files.ts';
import { readVersionedTelemetry } from './codex-cumulative.ts';
import { runProcess } from './process.ts';
import { SeatbeltBackend, seatbeltProfile } from './sandbox.ts';
import { startModelProxy } from './proxy.ts';
import { captureRollouts, hashRollout, settleRollouts, type RolloutArchive } from './rollouts.ts';
import { sandboxReaper } from './reaper.ts';
import { events, rateLimit, readRolloutTelemetry } from './telemetry.ts';
// Pin optional helpers off on new/resumed turns. CLI 0.156.1 requires the
// code-mode host even with code_mode=false: functions.exec otherwise advertises
// tools that fail with 'code-mode host is disabled'. Keep that tracked runtime
// enabled; worker policy supervision and the host birth-identity census reap it.
const DISABLED = ['code_mode','code_mode_prewarm','code_mode_only','browser_use','browser_use_external','in_app_browser','computer_use','apps','plugins','remote_plugin','multi_agent','multi_agent_v2','agent_message_board','hooks','in_app_local_automation','artifact','goals','tool_suggest','image_generation','skill_mcp_dependency_install'];
export interface CodexAdapterOptions {
  /** Host authority and ephemeral storage must be disjoint from every worker write root. */
  stateRoot: string; scratchRoot: string; cliPath: string; authFile?: string;
  now: () => number; // epoch milliseconds; injected in all tests
  runtimeRoots?: readonly string[];
  toolPath?: string;
  schemas?: Readonly<Record<string, (bytes: string) => boolean>>;
  backend?: SandboxBackend; runner?: ProcessRunner;
  /** Exact-boundary fault injection. Trusted test/orchestrator hook, never worker input. */
  beforeLaunch?: (boundary: { profilePath: string; configPath: string; phase: 'probe' | 'worker' }) => void;
}
interface Session {
  sessionId: string; workdir: string; model: string; effort: string; jobId: string;
  rollouts: RolloutArchive[];
  cumulativeUsage: WorkerResult['usage'];
  captured: Record<string, string>;
}
function freeze(file: string, bytes: string | Buffer): string {
  writeFileSync(file, bytes, { mode: 0o400, flag: 'wx' }); return sha256(bytes);
}
function verify(file: string, hash: string): void {
  const st = lstatSync(file);
  if(sha256(regular(file))!==hash)throw new TrustedInputChanged(file,hash);
  if ((st.mode & 0o222) !== 0 || st.uid !== process.getuid?.() || sha256(regular(file)) !== hash) throw new Error('host profile/config or captured log tamper refused');
}
export function codexArguments(spec: WorkerSpec, sessionId?: string): string[] {
  const flags = ['--ignore-user-config','--ignore-rules','--skip-git-repo-check','--json',
    '-m', spec.model, '-c', `model_reasoning_effort=${JSON.stringify(spec.effort)}`,
    '--dangerously-bypass-approvals-and-sandbox','-c','web_search="disabled"',
    ...DISABLED.flatMap(name => ['--disable', name]), '--enable','code_mode_host','--enable','skip_host_skill_discovery'];
  // p16: exec resume lacks -C and --color; cwd remains host supplied. No --last fallback.
  return sessionId ? ['exec','resume',...flags,sessionId,'-'] : ['exec',...flags,'--color','never','-C',spec.workdir,'-'];
}
/** Denied tool results aren't breaches. Only assistant output or a successful tool result counts. */
export function canaryExposed(text: string, canary: string): boolean {
  for (const line of text.split('\n')) {
    let e: Record<string, unknown>;
    try { e = JSON.parse(line) as Record<string, unknown>; } catch { if (line.includes(canary)) return true; continue; }
    if (e?.type !== 'item.completed' || !e.item || typeof e.item !== 'object') continue;
    const item = e.item as Record<string, unknown>;
    if (item.type === 'agent_message' && typeof item.text === 'string' && item.text.includes(canary)) return true;
    if (item.type === 'command_execution' && item.exit_code === 0 && typeof item.aggregated_output === 'string' && item.aggregated_output.includes(canary)) return true;
  }
  return false;
}
export class CodexAdapter implements WorkerAdapter {
  readonly options: CodexAdapterOptions;
  get schemas() { return this.options.schemas; }
  constructor(options: CodexAdapterOptions) { this.options = options; }
  async run(input: WorkerSpec): Promise<WorkerResult> {
    const spec = structuredClone(input), options = this.options, runner = options.runner ?? runProcess;
    const backend = options.backend ?? new SeatbeltBackend();
    const result: WorkerResult = { status: 'infra_error', resetAt: null, sessionToken: null, files: {}, warnings: [], usage: null, eventsPath: '', quota: null, usageComplete: false, containment: 'unavailable', supervisor: null,
      rateLimit: { terminal: false, signals: [], resetHint: null },
      provenance: { cliVersion: null, cliSha256: null, initInventory: [], observedModels: [], observedEfforts: [], identitySource: 'unavailable', profileSha256: null, configSha256: null, canary: 'unavailable' } };
    let scratch: string | null = null, proxy: Awaited<ReturnType<typeof startModelProxy>> | null = null;
    let started = false;
    let reaper: ReturnType<typeof sandboxReaper> | undefined;
    try {
      if (spec.harness !== 'codex' || spec.family !== 'openai' && spec.family !== 'codex' || spec.network !== 'model-api-only') throw new Error('unsupported worker harness/family/network');
      if (!spec.model || !spec.effort || !Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs <= 0) throw new Error('invalid worker settings');
      spec.workdir = realpathSync(spec.workdir);
      for (const root of [options.stateRoot, options.scratchRoot]) mkdirSync(root, { recursive: true, mode: 0o700 });
      const state = realpathSync(options.stateRoot), scratchRoot = realpathSync(options.scratchRoot);
      if (inside(state, spec.workdir) || inside(spec.workdir, state) || inside(scratchRoot, spec.workdir) || inside(spec.workdir, scratchRoot)) throw new Error('host and worker scopes overlap');
      const mounts = spec.mounts.map(m => { if (m.mode !== 'ro') throw new Error('mount must be read-only'); return realpathSync(m.path); });
      const runtimes = (options.runtimeRoots ?? ['/bin','/usr','/System','/Library','/private/etc','/dev','/opt/homebrew']).map(p => realpathSync(p));
      for (const root of [...mounts, ...runtimes]) if (inside(state, root) || inside(scratchRoot, root) || inside(spec.workdir, root)) throw new Error('read grant overlaps host authority or worker');
      const prompt = regular(realpathSync(spec.promptFile), 16_000_000).toString('utf8');
      const cli = realpathSync(options.cliPath);
      result.provenance.cliSha256 = sha256(regular(cli, 300_000_000));
      const runId = randomUUID(), evidence = path.join(state, 'runs', runId);
      mkdirSync(evidence, { recursive: true, mode: 0o700 });
      result.eventsPath = path.join(evidence, 'events.jsonl');
      const pins = new Map<string, string>();
      let resume: Session | undefined;
      if (spec.resume) {
        if (!/^[a-f0-9-]{36}$/.test(spec.resume.sessionToken)) throw new Error('resume unavailable: invalid host token');
        const saved = path.join(state, 'sessions', spec.resume.sessionToken + '.json');
        const receipt = JSON.parse(regular(saved, 24_000_000).toString('utf8')) as { session: Session; hash: string };
        if (canonicalSha256(receipt.session) !== receipt.hash) throw new Error('resume receipt changed');
        resume = receipt.session;
        if (resume.workdir !== spec.workdir || resume.model !== spec.model || resume.effort !== spec.effort || resume.jobId !== spec.jobId || !/^[a-f0-9-]{36}$/.test(resume.sessionId)) throw new Error('resume unavailable: binding mismatch');
        for (const [file, hash] of Object.entries(resume.captured)) { verify(file, hash); pins.set(file, hash); }
        result.warnings.push('resumed rollout is worker-writable history; conversation fidelity is not attested');
      }
      scratch = mkdtempSync(path.join(scratchRoot, 'codex-'));
      const home = path.join(scratch, 'home'), codexHome = path.join(home, '.codex'), tmp = path.join(scratch, 'tmp');
      for (const dir of [codexHome, tmp]) mkdirSync(dir, { recursive: true, mode: 0o700 });
      const homeConfig = path.join(codexHome, 'config.toml');
      const config = `model = ${JSON.stringify(spec.model)}\nmodel_reasoning_effort = ${JSON.stringify(spec.effort)}\nweb_search = "disabled"\n`;
      const configPath = path.join(evidence, 'config.toml');
      pins.set(configPath, freeze(configPath, config)); pins.set(homeConfig, freeze(homeConfig, config));
      result.provenance.configSha256 = pins.get(configPath)!;
      const protectedPaths = [configPath, homeConfig];
      if (options.authFile) {
        const auth = path.join(codexHome, 'auth.json');
        pins.set(auth, freeze(auth, regular(realpathSync(options.authFile), 1_000_000))); protectedPaths.push(auth);
      }
      if (resume) for (const archive of resume.rollouts) {
        if (!inside(archive.file, state) || hashRollout(archive.file) !== archive.sha256) throw new Error('resume rollout hash changed');
        const target = fileUnder(path.join(codexHome, 'sessions'), archive.relative);
        mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); copyFileSync(archive.file, target); chmodSync(target, 0o600);
      }
      const egressPath = path.join(evidence, 'egress.jsonl'); freeze(egressPath, ''); chmodSync(egressPath, 0o600);
      proxy = await startModelProxy({ now: options.now, log: e => appendFileSync(egressPath, JSON.stringify(e) + '\n') });
      const profilePath = path.join(evidence, 'worker.sb');
      if (backend.name === 'darwin-seatbelt') reaper = sandboxReaper(state);
      const profile = seatbeltProfile({ writeRoots: [spec.workdir, scratch],
        readRoots: [...runtimes, ...mounts.filter(p => lstatSync(p).isDirectory())],
        readFiles: [cli, ...mounts.filter(p => lstatSync(p).isFile())],
        protectedPaths: [...protectedPaths, ...mounts], deniedPaths: [state], proxyPort: proxy.port }) + (reaper ? `(allow mach-lookup (global-name ${JSON.stringify(reaper.allow)}))\n(deny mach-lookup (global-name ${JSON.stringify(reaper.deny)}))\n` : '');
      pins.set(profilePath, freeze(profilePath, profile)); result.provenance.profileSha256 = pins.get(profilePath)!;
      // CLI process inherits no user environment or secrets other than its explicit auth copy.
      const env: NodeJS.ProcessEnv = { HOME: home, CODEX_HOME: codexHome, TMPDIR: tmp,
        PATH: options.toolPath ?? '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8',
        USER: process.env.USER ?? 'arm', LOGNAME: process.env.LOGNAME ?? process.env.USER ?? 'arm', TERM: 'dumb',
        HTTP_PROXY: `http://127.0.0.1:${proxy.port}`, HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
        http_proxy: `http://127.0.0.1:${proxy.port}`, https_proxy: `http://127.0.0.1:${proxy.port}`, ALL_PROXY: `http://127.0.0.1:${proxy.port}` };
      const verifyAll = (phase: 'probe' | 'worker'): void => {
        options.beforeLaunch?.({ profilePath, configPath, phase });
        for (const [file, hash] of pins) verify(file, hash);
        if (sha256(regular(cli, 300_000_000)) !== result.provenance.cliSha256) throw new Error('CLI changed before launch');
      };
      const base = { cwd: spec.workdir, env, timeoutMs: spec.timeoutMs };
      const canary = randomBytes(32).toString('hex'), canaryPath = path.join(evidence, 'sealed-canary');
      freeze(canaryPath, canary);
      // Positive control: a missing file must never be mistaken for an access denial.
      if (regular(canaryPath).toString() !== canary) throw new Error('canary fixture unavailable');
      verifyAll('probe');
      const probeCode = `try { require('node:fs').readFileSync(process.argv[1]); process.stdout.write('READABLE'); process.exitCode=7; } catch(e) { if (e.code==='EACCES'||e.code==='EPERM') process.stdout.write('DENIED'); else {process.stdout.write('UNKNOWN');process.exitCode=8;} }`;
      const probe = await runner(backend.wrap(profilePath, { ...base, command: process.execPath, args: ['-e', probeCode, canaryPath] }));
      result.provenance.canary = probe.exitCode === 0 && !probe.timedOut && !probe.truncated && probe.stdout === 'DENIED' ? 'denied' : 'failed';
      if (result.provenance.canary !== 'denied') throw new Error('canary probe was not DENIED');
      const version = await runner(backend.wrap(profilePath, { ...base, command: cli, args: ['--version'] }));
      if (version.exitCode !== 0 || version.timedOut || version.truncated || !version.stdout.trim()) throw new Error(`CLI preflight unavailable (exit ${version.exitCode}, signal ${version.signal}, timeout ${version.timedOut}, truncated ${version.truncated}, stdout bytes ${Buffer.byteLength(version.stdout)})`);
      result.provenance.cliVersion = version.stdout.trim();
      result.provenance.initInventory = [backend.name, 'fresh CODEX_HOME', 'model-api proxy', 'host-owned profile/config'];
      const args = codexArguments(spec, resume?.sessionId);
      const launch: Launch = { ...base, command: cli, args, stdin: spec.resume?.message ?? prompt };
      freeze(path.join(evidence, 'launch.json'), JSON.stringify({ command: cli, args, cwd: spec.workdir }));
      const canaryStream=streamCanary(line=>canaryExposed(line,canary),canary);
      verifyAll('worker'); started = true;
      const wrapped = backend.wrap(profilePath, {...launch,observeStdout:canaryStream.push});
      let outcome = await runner(reaper ? { ...wrapped, overflow:'drain', timeoutSignal: 'SIGTERM', command: reaper.command, args: [...reaper.args, wrapped.command, ...wrapped.args] } : {...wrapped,overflow:'drain'});
      // Only 0/80/90/124 are supervisor reports about the worker. Any other exit (3 listing,
      // 5/7 stop/kill, 18 census budget, setup codes) or a signal is the supervisor's own
      // infrastructure failure: containment is unproven and a later clean census never upgrades it.
      let supervisorFailure: string | null = null;
      if (reaper) {
        const code = outcome.exitCode;
        result.supervisor = { exitCode: code, signal: outcome.signal, survivors: null, census: null };
        if (outcome.signal || code === null || ![0, 80, 90, 124].includes(code)) supervisorFailure = code === 18 ? 'infrastructure census budget exhausted; retry'
          : `infrastructure supervisor failure (${code === null ? `signal ${outcome.signal ?? 'unknown'}` : `exit ${code}`}); containment unproven; retry`;
        let receipt: ReturnType<typeof reaper.outcome> | null = null;
        try { receipt = reaper.outcome(); result.supervisor = { exitCode: code, signal: outcome.signal, survivors: receipt.survivors, census: receipt.census, ...(receipt.matched ? {matched: receipt.matched.map(v=>({...v})), matchedTruncated: receipt.matchedTruncated} : {}) }; }
        catch { result.warnings.push('sandbox supervisor receipt unavailable'); }
        try {
          if (supervisorFailure) {
            result.containment = 'unavailable';
            // Best-effort cleanup census only: it can report a survivor, never prove containment.
            try { if (!reaper.reap()) result.containment = 'survivor-killed'; } catch { /* stays unavailable */ }
          } else if (receipt === null) result.containment = 'unavailable'; // the finally block still runs a cleanup census
          else if (code === 90) {
            result.containment = 'survivor-killed';
            // An observed survivor with an incomplete census: clean up whatever the census could not resolve.
            if (receipt.census === 0) reaper.complete(); else try { reaper.reap(); } catch { /* finally retries */ }
          } else if (outcome.timedOut) result.containment = reaper.reap() ? 'reaped' : 'survivor-killed';
          else { reaper.complete(); result.containment = 'reaped'; }
        } catch { result.containment = 'unavailable'; result.warnings.push('sandbox cleanup census unavailable'); }
        // Worker exit/signal from the receipt drive the worker status; the supervisor's own code is kept in result.supervisor.
        if (receipt) outcome = { ...outcome, exitCode: receipt.exitCode, signal: receipt.signal };
      }
      if (outcome.cleanupFailed) { result.containment = 'unavailable'; result.warnings.push('process group cleanup failed'); }
      const captured: Record<string, string> = {};
      captured[result.eventsPath] = freeze(result.eventsPath, outcome.stdout);
      const stderrPath = path.join(evidence, 'stderr.log'); captured[stderrPath] = freeze(stderrPath, outcome.stderr);
      captured[profilePath] = pins.get(profilePath)!; captured[configPath] = pins.get(configPath)!;
      let trustedChanged = false;
      for (const [file, hash] of pins) try { verify(file, hash); } catch { try{verify(file,hash);}catch{trustedChanged=true;} }
      const limited = rateLimit(outcome.stdout, options.now() / 1000);
      result.rateLimit = { terminal: limited.terminal, signals: limited.signals, resetHint: limited.resetHint }; result.resetAt = limited.resetAt;
      result.text=cliAnswer(outcome.stdout);
      const typed=cliProviderOutcome(outcome.stdout,outcome.stderr);if(typed)result.providerOutcome=typed;
      if(outcome.interruption)result.providerOutcome={type:outcome.interruption,text:'Progress watchdog stopped this session'};
      result.status = outcome.timedOut ? 'timeout' : outcome.signal ? 'agent_error' : limited.terminal ? 'rate_limited' : outcome.exitCode === 0 && events(outcome.stdout).at(-1)?.type === 'turn.completed' ? 'ok' : spec.resume ? 'needs_resume' : 'agent_error';
      const provider=providerError(outcome.stdout,outcome.stderr);if(provider&&!outcome.timedOut){result.status='provider-error';result.warnings.push(provider);}
      if (trustedChanged) { result.status = 'violation'; result.violation={kind:'trusted-path-changed',evidence:'Host protected input hash mismatch confirmed by repeated verification'};result.warnings.push('protected adapter inputs changed; resume refused'); }
      if (canaryStream.finish(outcome.stdout)||scanForCanaries(spec.workdir,[canary]).length>0) { result.status = 'violation'; result.violation={kind:'canary-exposed',evidence:'Host canary matched in captured worker output'};result.warnings.push('sealed canary exposed'); }
      const initial = readRolloutTelemetry(outcome.stdout, {});
      const settled = await settleRollouts(codexHome);
      const { streams, archives, warnings } = captureRollouts(codexHome, initial.sessionId, evidence);
      if (!settled) warnings.push('rollout did not stabilize after process close');
      const telemetry = readVersionedTelemetry(outcome.stdout, streams, resume?.cumulativeUsage ?? null, result.provenance.cliVersion);
      result.provenance.observedModels = telemetry.models; result.provenance.observedEfforts = telemetry.efforts;
      result.provenance.identitySource = telemetry.matchedRollouts.length ? 'codex-session' : 'unavailable';
      result.usage = telemetry.usage; result.quota = telemetry.quota;
      result.usageComplete = telemetry.usageComplete && outcome.exitCode === 0 && !outcome.timedOut && !outcome.signal && !outcome.truncated;
      result.warnings.push(...warnings, ...telemetry.warnings);
      if (!telemetry.verified || warnings.length || !result.usageComplete) {
        result.quota = null;
        result.warnings.push('benchmark provenance unverified');
        if (result.status === 'ok') result.status = 'provenance_unverified';
      }
      result.warnings.push('rollout metadata is worker-writable corroboration, not tamper-proof identity or quota evidence');
      if (supervisorFailure && result.status !== 'violation') { result.status = 'provider-error'; result.warnings.push(supervisorFailure); }
      else if (result.containment !== 'reaped' && result.status !== 'violation') {
        result.status = 'containment_failure'; result.warnings.push('worker sandbox cleanup failed or detached survivor observed');
      }
      // Resume availability depends on stdout identity and raw archive hash, not metadata parsing.
      const matched = archives.filter(a => telemetry.matchedRollouts.includes(a.relative));
      if (!trustedChanged && result.status !== 'violation' && telemetry.sessionId && /^[a-f0-9-]{36}$/.test(telemetry.sessionId) && matched.length === 1) {
        const previous = resume?.cumulativeUsage, current = result.usage;
        const cumulativeUsage = current ? { inputTokens: current.inputTokens + (previous?.inputTokens ?? 0), cachedInputTokens: current.cachedInputTokens + (previous?.cachedInputTokens ?? 0), outputTokens: current.outputTokens + (previous?.outputTokens ?? 0), totalTokens: current.totalTokens + (previous?.totalTokens ?? 0) } : previous ?? null;
        const session: Session = { sessionId: telemetry.sessionId, workdir: spec.workdir, model: spec.model, effort: spec.effort, jobId: spec.jobId,
          rollouts: matched, cumulativeUsage, captured };
        const token = randomUUID(), sessionRoot = path.join(state, 'sessions'); mkdirSync(sessionRoot, { recursive: true, mode: 0o700 });
        freeze(path.join(sessionRoot, token + '.json'), JSON.stringify({ session, hash: canonicalSha256(session) })); result.sessionToken = token;
      }
    } catch (e) {
      result.status = spec.resume && !started ? 'needs_resume' : 'infra_error';
      if(e instanceof TrustedInputChanged)try{if(sha256(regular(e.file))!==e.expected){result.status='violation';result.violation={kind:'trusted-path-changed',evidence:'Host input hash mismatch confirmed twice'};}}catch{}
      result.warnings.push(e instanceof Error ? e.message : String(e));
    } finally {
      try { if (started && reaper && !reaper.reap()) { result.containment = 'survivor-killed'; if (result.status !== 'violation'&&result.status!=='infra_error') result.status = 'containment_failure'; } } catch { result.containment = 'unavailable'; if (result.status !== 'violation'&&result.status!=='infra_error') result.status = 'containment_failure'; } finally { reaper?.close(); }
      if (proxy?.loggingFailed()) result.warnings.push('egress audit unavailable; no unobserved violation inferred');
      try { await proxy?.close(); } catch { result.warnings.push('proxy cleanup unavailable'); }
      if (scratch) try { removeScratch(scratch); } catch { result.warnings.push('scratch cleanup incomplete'); }
      // Partial deliverables survive every terminal path. Missing schemas never count as valid.
      for (const item of spec.expect) {
        try {
          const file = fileUnder(spec.workdir, item.file);
          if (!existsSync(file)) { result.files[item.file] = 'missing'; continue; }
          const bytes = regular(file).toString('utf8'), check = options.schemas?.[item.schema];
          result.files[item.file] = check?.(bytes) === true ? 'valid' : 'invalid';
        } catch { result.files[item.file] = 'invalid'; }
      }
      if (spec.expect.some(e => e.required && result.files[e.file] !== 'valid') && result.status === 'ok') result.status = 'needs_resume';
    }
    return result;
  }
}
