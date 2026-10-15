/** Host-only registry: a port is usable only while this exact immutable policy owns it. */
const bindings = new Map<number, readonly string[]>();
export function registerProxy(port: number, hosts: readonly string[]): () => void {
  if (bindings.has(port)) throw new Error("egress proxy port already bound");
  bindings.set(port, hosts);
  return () => { if (bindings.get(port) === hosts) bindings.delete(port); };
}
export function requireProxy(port: number, hosts: unknown): readonly string[] {
  const bound = bindings.get(port);
  if (!bound || bound !== hosts) throw new Error("network policy must use the live egress proxy's port and allowedHosts object");
  return bound;
}
