import { createServer } from 'node:http';
import { connect, isIP, type Socket } from 'node:net';
import { lookup } from 'node:dns/promises';
/** Exact API host names: unlike the pilot proxy, no wildcard openai.com subdomains. */
export const MODEL_API_HOSTS = ['chatgpt.com', 'api.openai.com'] as const;
/** Claude Code (V6): the Messages API plus the OAuth/account hosts the CLI's login session uses.
 * Exact names; the pilot's suffix allowlist (anthropic.com, claude.ai) is narrowed here. */
export const ANTHROPIC_API_HOSTS = ['api.anthropic.com', 'platform.claude.com', 'claude.ai', 'console.anthropic.com'] as const;
export interface EgressRecord { at: number; target: string; allowed: boolean; connected: boolean; reason: string }
export function allowedTarget(target: string, hosts: readonly string[] = MODEL_API_HOSTS): string | null {
  const m = /^([a-z0-9.-]+):443$/i.exec(target);
  return m && hosts.includes(m[1]!.toLowerCase()) ? m[1]!.toLowerCase() : null;
}
function publicAddress(ip: string): boolean {
  // Fail closed on IPv6 for now, avoiding mapped/ULA/link-local surprises.
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a !== 169 && a !== 192 && a !== 198 && a !== 203 && a! < 224 && !(a === 172 && b! >= 16 && b! <= 31) && !(a === 100 && b! >= 64 && b! <= 127);
}
export async function dialModel(host: string): Promise<Socket> {
  const answers = await lookup(host, { all: true, family: 4 });
  if (!answers.length || answers.some(a => !publicAddress(a.address))) throw new Error('non-public API resolution');
  return new Promise((resolve, reject) => {
    const s = connect({ host: answers[0]!.address, port: 443 });
    s.setTimeout(30_000, () => s.destroy(new Error('upstream timeout')));
    s.once('connect', () => resolve(s)); s.once('error', reject);
  });
}
/** CONNECT-only tunnelling, adapted from bio-baseline egress_proxy.py. Host owns the log.
 * TLS is end-to-end: domain containment does not attest HTTP paths within chatgpt.com. */
export async function startModelProxy(options: { now: () => number; log: (e: EgressRecord) => void; dial?: (host: string) => Promise<Socket>; hosts?: readonly string[] }) {
  const sockets = new Set<Socket>();
  let closed = false, loggingFailed = false;
  const log = (record: EgressRecord): void => { try { options.log(record); } catch { loggingFailed = true; } };
  const server = createServer((req, res) => {
    log({ at: options.now(), target: req.url ?? '', allowed: false, connected: false, reason: 'non-connect' });
    res.writeHead(403); res.end();
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); });
  server.on('connect', (req, client, head) => {
    const target = req.url ?? '', host = allowedTarget(target, options.hosts);
    if (!host) {
      log({ at: options.now(), target, allowed: false, connected: false, reason: 'not-allowed' });
      client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); return;
    }
    void (async () => {
      try {
        const upstream = await (options.dial ?? dialModel)(host);
        if (closed || client.destroyed) { upstream.destroy(); return; }
        sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
        upstream.on('error', () => client.destroy()); client.on('close', () => upstream.destroy());
        upstream.on('close', () => client.destroy());
        log({ at: options.now(), target, allowed: true, connected: true, reason: 'model-api' });
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream); upstream.pipe(client);
      } catch {
        log({ at: options.now(), target, allowed: true, connected: false, reason: 'upstream-unavailable' });
        client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
      }
    })();
  });
  server.on('clientError', (_e, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('proxy unavailable');
  return { port: address.port, loggingFailed: () => loggingFailed, close: async (): Promise<void> => {
    closed = true; for (const s of sockets) s.destroy();
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  } };
}
