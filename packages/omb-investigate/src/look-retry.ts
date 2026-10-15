/** Only affirmative, internally consistent host evidence can unspend an invocation.
 * Callers must journal this receipt before using it to authorize another execution.
 * Missing legacy fields deliberately fail closed. */
export function mayRetryLook(r: {
  status?: unknown; category?: unknown; hardStop?: unknown;
  workerStarted?: unknown; kind?: unknown; cleanReceipt?: unknown;
  outputFiles?: unknown; outputsHash?: unknown;
}): boolean {
  return r.status === 'crash' && r.category === 'infra' && !r.hardStop &&
    r.outputFiles === 0 && r.outputsHash === null &&
    (r.workerStarted === false || r.kind === 'census-fault' && r.cleanReceipt === true);
}
