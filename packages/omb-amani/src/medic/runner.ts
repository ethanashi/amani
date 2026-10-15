import { runProcess, type ProcessOutcome, type ProcessRunner } from '../../../omb-adapters/src/index.ts';
/** Medic tools can print full test logs. Preserve complete telemetry up to the existing
 * configured byte cap; overflow is a terminal failure, never a truncated success.
 * The scientific adapters and their retention/containment policies are unchanged. */
export const medicRunner:ProcessRunner=launch=>{
  const {overflow: _retention, ...bounded}=launch;
  return runProcess({...bounded,maxOutputBytes:launch.maxOutputBytes??8_000_000});
};

/** A process exit alone is not a gate receipt: incomplete capture/cleanup always refuses. */
export function gateProcessPassed(r:ProcessOutcome):boolean {
  return r.exitCode===0&&r.signal===null&&!r.timedOut&&!r.truncated&&!r.cleanupFailed;
}
