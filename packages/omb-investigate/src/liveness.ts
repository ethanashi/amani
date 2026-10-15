import {ProgressWatchdog,progressFingerprint} from '../../omb-adapters/src/provider-policy.ts';
import { processRunner, type ProcessRunner } from "../../omb-adapters/src/index.ts";

/** Host-observed stdout progress buys silence time, never more hard-ceiling time. */
export class ProgressDeadline {
  readonly #start: number;
  #last: number;
  constructor(private readonly now: () => number, readonly hardMs: number, readonly silenceMs: number) {
    if (![hardMs, silenceMs].every(n => Number.isFinite(n) && n > 0)) throw new Error("invalid deadline");
    this.#start = this.#last = now();
  }
  progress(): void { this.#last = this.now(); }
  remaining(): number { return Math.max(0, Math.min(this.#start + this.hardMs, this.#last + this.silenceMs) - this.now()); }
  expired(): boolean { return this.remaining() === 0; }
}

export function phaseBudget(phase: string, ceiling: number): number {
  const minutes: Record<string, number> = { plan: 20, code: 60, replicate: 45, interpret: 15 };
  return Math.min(ceiling, (minutes[phase] ?? 20) * 60_000);
}

/** Uses the existing exact-process-group supervisor. stderr chatter cannot extend the deadline.
 * Captured rollout stdout is telemetry only; it never certifies an output or a scientific claim.
 */
export function progressRunner(o: { now: () => number; silenceMs?: number; structuredEvents?: boolean;
  schedule?: (callback: () => void, ms: number) => () => void }): ProcessRunner {
  return async launch => {
    const deadline = new ProgressDeadline(o.now, launch.timeoutMs, Math.min(launch.timeoutMs, o.silenceMs ?? 20 * 60_000));
    const schedule = o.schedule ?? ((fn: () => void, ms: number) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); });
    let cancel = () => {}, expire = () => {}, stopped = false;
    let interruption:"stall"|"loop"|"transport"|undefined, buffer="";const watch=new ProgressWatchdog(o.now,o.silenceMs??20*60_000);
    const arm = () => { cancel(); if (!stopped) cancel = schedule(() => { if (deadline.expired()) {interruption=watch.lastAction?"stall":"transport";expire();} else arm(); }, deadline.remaining()); };
    const hooks={
      scheduleDeadline: (stop:()=>void) => { expire = stop; arm(); return () => { stopped = true; cancel(); }; },
      onStdout: () => { if(!o.structuredEvents){deadline.progress(); arm();} },
      ...(!o.structuredEvents?{onCpuProgress: () => { deadline.progress(); arm(); }}:{}),
    };
    const result=await processRunner(hooks)({...launch,overflow:"drain",observeStdout:chunk=>{
      launch.observeStdout?.(chunk);if(!o.structuredEvents)return;buffer+=chunk.toString();if(buffer.length>1_000_000)buffer=buffer.slice(-1_000_000);
      for(;;){const i=buffer.indexOf("\n");if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const e=JSON.parse(line);if(typeof e.type!=="string")continue;
       const action=progressFingerprint(e);
       if(watch.event(action)==="loop"){interruption="loop";expire();}else{deadline.progress();arm();}
      }catch{}}
    }});return {...result,...(interruption?{interruption}:{})};
  };
}
