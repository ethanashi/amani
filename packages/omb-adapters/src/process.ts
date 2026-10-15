import {processRows} from '../../bio-core/src/index.ts';
import { spawn } from 'node:child_process';
import type { ProcessRunner, ProcessOutcome } from './contracts.ts';
export interface ProcessHooks {
  onCpuProgress?:()=>void;
  sampleCpu?:(pid:number)=>number;
  scheduleCpuPoll?:(poll:()=>void)=>(()=>void);
  /** Inject a deterministic deadline scheduler in integration tests. Production uses timers. */
  scheduleDeadline?: (expire:()=>void, milliseconds:number)=>(()=>void);
  /** Trusted exact-boundary testing seam; expire invokes the real deadline handler. */
  afterExit?: (expire: () => void) => void;
  onStdout?: (expire: () => void) => void;
}
/** One group per launch, pipes owned by the host. No global process census or polling. */
export const processRunner = (hooks: ProcessHooks = {}): ProcessRunner => async launch => new Promise((resolve, reject) => {
  const child = spawn(launch.command, [...launch.args], {
    cwd: launch.cwd, env: launch.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let cpu=0;const seen=new Map<number,number>();
  const sample=hooks.sampleCpu??((pid:number)=>{for(const row of processRows())if(row.pgid===pid&&row.cpuMs!==undefined)seen.set(row.pid,Math.max(seen.get(row.pid)??0,row.cpuMs));return [...seen.values()].reduce((a,b)=>a+b,0);});
  const poll=()=>{if(child.pid)try{const next=sample(child.pid);if(next>cpu){cpu=next;hooks.onCpuProgress?.();}}catch{/* Unavailable census never counts as progress. */}};
  const cancelCpu=hooks.onCpuProgress?(hooks.scheduleCpuPoll?.(poll)??(()=>{const timer=setInterval(poll,5000);return ()=>clearInterval(timer);})()):()=>{};
  let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), timedOut = false, truncated = false, cleanupFailed = false;
  const kill = (signal: NodeJS.Signals = 'SIGKILL'): void => { if (child.pid) try { process.kill(-child.pid, signal); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') cleanupFailed = true; } };
  let exited = false;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  const expire = (): void => {
    if (exited || timedOut) return;
    timedOut = true; kill(launch.timeoutSignal);
    if (launch.timeoutSignal && launch.timeoutSignal !== 'SIGKILL') forceTimer = setTimeout(() => kill(), launch.timeoutMs);
    child.stdin.destroy();
    // Preserve queued stdout/stderr through close. Destroying them here can erase a
    // terminal event already written by the child when the host is under load.
  };
  const cancelDeadline=hooks.scheduleDeadline?hooks.scheduleDeadline(expire,launch.timeoutMs):(()=>{const timer=setTimeout(expire,launch.timeoutMs);return ()=>clearTimeout(timer);})();
  launch.abortSignal?.addEventListener('abort', expire, { once: true });
  if (launch.abortSignal?.aborted) expire();
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  const cap = launch.maxOutputBytes ?? 8_000_000;
  const collect = (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
    const current = stream === 'stdout' ? stdout : stderr;
    if(launch.overflow==='drain'){
      const joined=Buffer.concat([current,chunk]),edge=65536;
      const next=joined.length>edge*2?Buffer.concat([joined.subarray(0,edge),joined.subarray(-edge)]):joined;
      if(joined.length>edge*2)truncated=true;
      if(stream==='stdout')stdout=next;else stderr=next;
      return;
    }
    const remaining = Math.max(0, cap - stdout.length - stderr.length);
    const next = Buffer.concat([current, chunk.subarray(0, remaining)]);
    if (stream === 'stdout') stdout = next; else stderr = next;
    if (chunk.length > remaining) { truncated = true; kill(); }
  };
  child.stdout.on('data', (chunk: Buffer) => { launch.observeStdout?.(chunk); collect(chunk, 'stdout'); hooks.onStdout?.(expire); });
  child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'stderr'));
  child.stdin.on('error', () => {}); child.stdin.end(launch.stdin ?? '');
  // Reap remaining group members even when the leader exits successfully.
  child.once('exit', () => {
    exited = true; cancelCpu();cancelDeadline(); clearTimeout(forceTimer); kill();
    // Only escaped descendants can keep pipes open after leader exit and group kill.
    // Bound that cleanup separately; incomplete capture is explicit, never verified.
    drainTimer = setTimeout(() => { truncated = true; child.stdout.destroy(); child.stderr.destroy(); }, launch.timeoutMs);
    hooks.afterExit?.(expire);
  });
  child.once('error', e => { cancelCpu();cancelDeadline(); launch.abortSignal?.removeEventListener('abort', expire); reject(e); });
  child.once('close', (exitCode, signal) => {
    cancelCpu();cancelDeadline(); clearTimeout(forceTimer); clearTimeout(drainTimer); kill();
    launch.abortSignal?.removeEventListener('abort', expire);
    const result: ProcessOutcome = { exitCode, signal, timedOut, truncated, cleanupFailed, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') };
    resolve(result);
  });
});
export const runProcess = processRunner();

/** Never parse a timed-out/truncated probe as if it were a completed observation. */
export function completedJson(outcome: ProcessOutcome): unknown {
  if (outcome.exitCode !== 0 || outcome.signal || outcome.timedOut || outcome.truncated || outcome.cleanupFailed) {
    throw new Error('JSON probe unavailable: process did not complete with intact output');
  }
  return JSON.parse(outcome.stdout) as unknown;
}
