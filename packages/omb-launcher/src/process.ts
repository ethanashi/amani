import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
export type ErrorCode = 'unavailable' | 'refused' | 'timeout' | 'request-limit' | 'response-limit' | 'invalid-response' | 'execution';
export class LauncherError extends Error {
  constructor(readonly code: ErrorCode, message: string) { super(message); this.name = 'LauncherError'; }
}
export interface ProcessRequest {
  command: string; args: string[]; input: Uint8Array; outputCap: number; timeoutMs: number;
}
export type Execute = (request: ProcessRequest) => Promise<Buffer>;
export interface ProcessDeps {
  spawn: (command: string, args: string[], options: Parameters<typeof spawn>[2]) => ChildProcessWithoutNullStreams;
  timer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
}
const defaults: ProcessDeps = { spawn: (command, args, options) => spawn(command, args, options) as ChildProcessWithoutNullStreams, timer: setTimeout, clearTimer: clearTimeout };
/** Kills only the exact child this invocation started. The Seatbelt policy forbids
 * process-fork, so analysis cannot create descendants or escape into another group.
 * sudo uses exec when there is no PTY; the runner has its own independent hard deadline.
 */
export function boundedProcess(deps: ProcessDeps = defaults): Execute {
  return request => new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try { child = deps.spawn(request.command, request.args, { cwd: '/', env: { PATH: '/usr/bin:/bin', HOME: '/var/empty', LANG: 'C' }, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { reject(new LauncherError('unavailable', 'launcher unavailable')); return; }
    const chunks: Buffer[] = []; let bytes = 0, error: LauncherError | undefined, settled = false;
    const fail = (value: LauncherError) => {
      if (settled) return;
      error ??= value; settled = true; deps.clearTimer(timer);
      // A sudo child may already have changed UID. The independent trusted
      // runner deadline still applies if this caller cannot signal it.
      try { child.kill('SIGKILL'); } catch { /* never turn EPERM into success */ }
      reject(error);
    };
    const timer = deps.timer(() => fail(new LauncherError('timeout', 'launcher timed out')), request.timeoutMs);
    child.stdout.on('data', (data: Buffer) => { bytes += data.length; if (bytes > request.outputCap) fail(new LauncherError('response-limit', 'response exceeds cap')); else chunks.push(data); });
    // Bound stderr too, and never return potentially private diagnostics to the owner.
    let stderrBytes = 0;
    child.stderr.on('data', (data: Buffer) => { stderrBytes += data.length; if (stderrBytes > 65_536) fail(new LauncherError('response-limit', 'diagnostic cap exceeded')); });
    child.on('error', () => { error ??= new LauncherError('unavailable', 'launcher unavailable'); });
    child.stdin.on('error', () => { error ??= new LauncherError('execution', 'request transport failed'); });
    child.on('close', code => {
      if (settled) return; settled = true; deps.clearTimer(timer);
      if (error) reject(error);
      else if (code !== 0) reject(new LauncherError(code === 64 || code === 77 ? 'refused' : code === 69 ? 'unavailable' : 'execution', 'launcher did not succeed'));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(request.input);
  });
}
