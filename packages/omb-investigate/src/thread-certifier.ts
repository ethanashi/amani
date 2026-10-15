import {InvestigationPaused} from "./pause.ts";
import { createHmac } from "node:crypto";
import { Worker, type WorkerOptions } from "node:worker_threads";
import { ContractAuthority, type ExecutorOptions } from "../../omb-certify/src/index.ts";
import type { CertifyPort, CertifyRequest, CertifyResult } from "./ports.ts";

/** Host contract authority, domain-separated from the gate key. */
export function liveContractAuthority(hostKeyBytes: Uint8Array): ContractAuthority {
  return new ContractAuthority(createHmac("sha256", hostKeyBytes).update("omb-investigate/contract-authority/v1").digest());
}

export interface ThreadCertifierOptions {
  stateRoot: string;
  /** Host-only: transferred only to our trusted checker thread, never an AI worker. */
  hostKey: Uint8Array;
  executor: Pick<ExecutorOptions, "scratchRoot" | "toolPath" | "runtimeRoots" | "timeoutMs">;
  simulations?: boolean;
  maxPermutations?: number;
  /** Deterministic clock for tests; production reads Date.now in the checker thread. */
  fixedNow?: number;
}

/** Keep synchronous calibration off the scheduler/child-reaping event loop. Each call owns a
 * separate trusted checker thread. No scientific settings or sandbox policies are relaxed. */
export class ThreadKernelCertifier implements CertifyPort {
  constructor(private readonly options: ThreadCertifierOptions,
    private readonly start: (url: URL, options: WorkerOptions) => Worker = (url, options) => new Worker(url, options)) {}

  async certify(request:CertifyRequest):Promise<CertifyResult>{
    let last:unknown;for(let attempt=0;attempt<3;attempt++){try{return await this.once(request);}catch(e){last=e;}}
    throw new InvestigationPaused("system-bug",`Checker unavailable after three attempts: ${String(last)}`,"certify");
  }
  private once(request: CertifyRequest): Promise<CertifyResult> {
    return new Promise((resolve, reject) => {
      const worker = this.start(new URL("./certify-thread.ts", import.meta.url), {
        workerData: { options: this.options, request },
        execArgv: ["--experimental-transform-types", "--no-warnings"],
      });
      let reply: { result?: CertifyResult; error?: string } | undefined;
      let fault: Error | undefined;
      worker.on("message", (value: typeof reply) => {
        if (reply !== undefined) fault = new Error("checker thread returned multiple results");
        else reply = value;
      });
      worker.on("error", (error) => { fault = error; });
      worker.once("exit", (code) => {
        if (fault) reject(fault);
        else if (code !== 0) reject(new Error(`checker thread exited ${code}`));
        else if (reply?.error) reject(new Error(reply.error));
        else if (reply?.result && Array.isArray(reply.result.claims) && Array.isArray(reply.result.gates)) resolve(reply.result);
        else reject(new Error("checker thread exited without a certification result"));
      });
    });
  }
}
