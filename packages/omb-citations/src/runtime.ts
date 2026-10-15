/** CLI-only per-host pacing. Retries and the total budget belong to HttpClient. */
export function pacedFetch(options: { now: () => number; wait: (ms: number) => Promise<void>; fetch?: typeof fetch }): typeof fetch {
  const previous = new Map<string, number>();
  return async (input, init) => {
    const host = new URL(String(input)).hostname;
    const delay = Math.max(0, 400 - (options.now() - (previous.get(host) ?? -Infinity)));
    if (delay) await options.wait(delay);
    if (init?.signal?.aborted) throw new Error('request aborted during pacing');
    previous.set(host, options.now());
    return (options.fetch ?? fetch)(input, init);
  };
}
