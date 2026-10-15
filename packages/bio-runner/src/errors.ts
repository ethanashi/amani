// RunnerStoppedError and RunnerExecutionTimeoutError are copied from Amani L/packages/kernel/src/runtime/errors.ts
// (last changed c9253150, read at eff73a44), unchanged; bio-core does not carry them. See PROVENANCE.md.

/** A bounded runner stopped without claiming a complete candidate. Not proof failure. */
export class RunnerStoppedError extends Error {
  readonly status: "blocked" | "inconclusive";
  readonly reason: string;

  constructor(status: "blocked" | "inconclusive", reason: string) {
    super(`runner ${status}:${reason}`);
    this.name = "RunnerStoppedError";
    this.status = status;
    this.reason = reason;
  }
}

/** Only a host process runner with a confirmed terminal/reaped deadline may
 * produce this classification. Model-reported inconclusive is not equivalent. */
export class RunnerExecutionTimeoutError extends RunnerStoppedError {
  constructor(reason = "runner execution deadline reached after process cleanup") {
    super("inconclusive", reason);
    this.name = "RunnerExecutionTimeoutError";
  }
}
