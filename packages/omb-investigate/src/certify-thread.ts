import { mkdirSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { GateAuthority, OfflineExecutor } from "../../omb-certify/src/index.ts";
import { KernelCertifier } from "./kernel.ts";
import { liveContractAuthority, type ThreadCertifierOptions } from "./thread-certifier.ts";
import type { CertifyRequest } from "./ports.ts";

const { options, request } = workerData as { options: ThreadCertifierOptions; request: CertifyRequest };
try {
  mkdirSync(options.executor.scratchRoot, { recursive: true, mode: 0o700 });
  const certifier = new KernelCertifier({
    stateRoot: options.stateRoot, authority: new GateAuthority(Buffer.from(options.hostKey)),
    contractAuthority: liveContractAuthority(options.hostKey), executor: new OfflineExecutor(options.executor),
    now: () => options.fixedNow ?? Date.now(),
    ...(options.simulations === undefined ? {} : { simulations: options.simulations }),
    ...(options.maxPermutations === undefined ? {} : { maxPermutations: options.maxPermutations }),
  });
  parentPort!.postMessage({ result: await certifier.certify(request) });
} catch (error) {
  parentPort!.postMessage({ error: error instanceof Error ? error.message : "checker thread unavailable" });
} finally {
  parentPort!.close();
}
