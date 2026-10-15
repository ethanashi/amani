// Adapted from Amani A/packages/harness/src/egress-proxy.ts (ea326c85). Changes: the proxy enforces an allowlist
// (explore mode) instead of letting every host through; every decision is logged as one JSON line before anything is
// forwarded, and a request whose log line cannot be written is refused; time comes from an injected clock; the upstream
// connector is injectable (tests use loopback servers, never the network) and the default one refuses names that
// resolve to private addresses. See PROVENANCE.md.
import { appendFileSync, mkdirSync } from "node:fs";
import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";

import { hostAllowed, isPrivateAddress, isPrivateHost, normalizeHost, validateAllowedHosts, validHostSyntax } from "./network-policy.ts";

import { registerProxy } from "./proxy-binding.ts";

/**
 * The explore-mode lane for research workers. The Claude worker's OS sandbox still confines files (secrets stay
 * unreadable) but routes all of its network traffic here instead of to its own proxy. This proxy passes only the
 * allowlisted hosts and logs every request it sees, allowed or refused (when, which host and port, how many bytes), so
 * what an investigation touched is on record for the egress checker. It refuses private and link-local addresses even
 * when a name was allowlisted (cloud metadata, the home network). It cannot see inside TLS: downloads must also be
 * hashed by the host.
 */
export interface EgressProxy {
  port: number;
  allowedHosts: readonly string[];
  close(): Promise<void>;
  hosts(): string[];
}

export type EgressEvent = "allow" | "refuse" | "close";
export type EgressVia = "connect" | "http";

/** One line of the egress log. Keys are fixed; `parseEgressLog` refuses anything else. */
export interface EgressLogEntry {
  at: string;
  event: EgressEvent;
  via: EgressVia;
  host: string;
  port: number;
  reason: string | null;
  bytesIn: number | null;
  bytesOut: number | null;
}

/** Opens the upstream connection. The default resolves with `guardedLookup`; tests inject loopback sockets. */
export type EgressConnector = (host: string, port: number) => net.Socket;

export interface EgressProxyOptions {
  logFile: string;
  allowedHosts: string[];
  now: () => number;
  connect?: EgressConnector;
  signal?: AbortSignal;
}

/** One proxy per investigation run, started the first time a worker needs it. */
export function lazyEgressProxy(o: EgressProxyOptions): () => Promise<EgressProxy> {
  let started: Promise<EgressProxy> | undefined;
  return () => (started ??= startEgressProxy(o));
}

export function refused(host: string): boolean { return isPrivateHost(host); }

export async function startEgressProxy(o: EgressProxyOptions): Promise<EgressProxy> {
  if (o.signal?.aborted) throw new Error("egress proxy run aborted");
  const allowedHosts = Object.freeze(validateAllowedHosts(o.allowedHosts));
  const connect = o.connect ?? defaultConnector;
  mkdirSync(path.dirname(o.logFile), { recursive: true, mode: 0o700 });
  const seen = new Set<string>();
  const sockets = new Set<Duplex>();
  /** False when the line could not be written: the caller must then refuse, so nothing passes unlogged. */
  const log = (entry: Omit<EgressLogEntry, "at">): boolean => {
    seen.add(`${entry.host}:${entry.port}`);
    try {
      const line: EgressLogEntry = { at: new Date(o.now()).toISOString(), event: entry.event, via: entry.via, host: entry.host,
        port: entry.port, reason: entry.reason, bytesIn: entry.bytesIn, bytesOut: entry.bytesOut };
      appendFileSync(o.logFile, `${JSON.stringify(line)}\n`, { mode: 0o600 });
      return true;
    } catch { return false; }
  };
  const decide = (host: string, port: number): string | null =>
    isPrivateHost(host) ? "private-address" : hostAllowed(allowedHosts, host, port) ? null : "not-allowlisted";

  const server = http.createServer((req, res) => {
    // Plain HTTP through a proxy: the request line carries the absolute URL.
    let url: URL | undefined;
    try { url = new URL(req.url ?? ""); } catch { /* malformed below */ }
    const authority = /^http:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(req.url ?? "")?.[1];
    const authorityTarget = authority && parseConnectTarget(authority.includes(":") ? authority : `${authority}:80`);
    if (!url || url.protocol !== "http:" || !authorityTarget || url.username || url.password || url.hash
      || /[\\\s]/.test(req.url ?? "")) {
      log({ event: "refuse", via: "http", host: String(req.url ?? "").slice(0, 255), port: 0, reason: "malformed-request", bytesIn: null, bytesOut: null });
      res.writeHead(400).end("absolute http URL required");
      return;
    }
    const { host, port } = authorityTarget;
    const refusal = decide(host, port);
    if (refusal) {
      log({ event: "refuse", via: "http", host, port, reason: refusal, bytesIn: null, bytesOut: null });
      res.writeHead(403).end(`refused by the egress proxy: ${refusal}`);
      return;
    }
    if (!log({ event: "allow", via: "http", host, port, reason: null, bytesIn: null, bytesOut: null })) {
      res.writeHead(502).end("egress log unavailable");
      return;
    }
    let bytesIn = 0, bytesOut = 0, finished = false;
    const finish = (reason: string | null) => {
      if (finished) return; finished = true;
      log({ event: "close", via: "http", host, port, reason, bytesIn, bytesOut });
    };
    const headers = { ...req.headers };
    for (const name of Object.keys(headers)) if (name.startsWith("proxy-")) delete headers[name];
    headers.host = url.host; // the target, never whatever the client put there
    const up = http.request({ host, port, method: req.method, path: url.pathname + url.search, headers, createConnection: (_options, callback) => {
      try { const socket = connect(host, port); sockets.add(socket); socket.once("close", () => sockets.delete(socket)); return socket; }
      catch (error) { queueMicrotask(() => callback(error as Error, undefined as never)); return undefined as never; }
    } }, upstream => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.on("data", (chunk: Buffer) => { bytesIn += chunk.length; });
      upstream.on("end", () => finish(null));
      upstream.on("error", error => finish(error.message));
      upstream.pipe(res);
    });
    up.on("error", error => {
      finish(error.message);
      if (!res.headersSent) res.writeHead(502).end(`egress upstream failed: ${error.message}`);
      else res.destroy();
    });
    req.on("data", (chunk: Buffer) => { bytesOut += chunk.length; });
    req.on("aborted", () => up.destroy());
    res.on("close", () => { up.destroy(); finish(null); });
    req.pipe(up);
  });

  server.on("connect", (req: http.IncomingMessage, client: Duplex, head: Buffer) => {
    // HTTPS: a CONNECT tunnel to host:port; the proxy never sees inside TLS.
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("error", () => { /* the tunnel's close path logs */ });
    const target = parseConnectTarget(String(req.url ?? ""));
    if (!target) {
      log({ event: "refuse", via: "connect", host: String(req.url ?? "").slice(0, 255), port: 0, reason: "malformed-request", bytesIn: null, bytesOut: null });
      client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    const { host, port } = target;
    const refusal = decide(host, port);
    if (refusal) {
      log({ event: "refuse", via: "connect", host, port, reason: refusal, bytesIn: null, bytesOut: null });
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    if (!log({ event: "allow", via: "connect", host, port, reason: null, bytesIn: null, bytesOut: null })) {
      client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      return;
    }
    let bytesIn = 0, bytesOut = 0, established = false, finished = false;
    const finish = (reason: string | null) => {
      if (finished) return; finished = true;
      log({ event: "close", via: "connect", host, port, reason, bytesIn, bytesOut });
    };
    let upstream: net.Socket;
    try { upstream = connect(host, port); }
    catch (error) { finish((error as Error).message); client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); return; }
    sockets.add(upstream);
    upstream.once("connect", () => {
      established = true;
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) { bytesOut += head.length; upstream.write(head); }
      upstream.on("data", (chunk: Buffer) => { bytesIn += chunk.length; });
      client.on("data", (chunk: Buffer) => { bytesOut += chunk.length; });
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", error => {
      finish(error.message);
      if (!established) client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); else client.destroy();
    });
    upstream.on("close", () => { sockets.delete(upstream); finish(null); client.destroy(); });
    client.on("close", () => upstream.destroy());
  });

  // HTTP and SOCKS settings both point here. Non-HTTP protocols (including SOCKS)
  // are deliberately denied, never delegated to Claude's unlogged default proxy.
  const rejected = new WeakSet<Duplex>();
  server.on("clientError", (_error, socket) => {
    if (rejected.has(socket)) return;
    rejected.add(socket);
    log({ event: "refuse", via: "http", host: "", port: 0, reason: "malformed-request", bytesIn: null, bytesOut: null });
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("upgrade", (req, socket) => {
    log({ event: "refuse", via: "http", host: String(req.url ?? "").slice(0, 255), port: 0, reason: "unsupported-upgrade", bytesIn: null, bytesOut: null });
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address() as net.AddressInfo;
  server.unref();
  const unregister = registerProxy(address.port, allowedHosts);
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= new Promise<void>(resolve => {
    unregister();
    o.signal?.removeEventListener("abort", onAbort);
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections();
    server.close(() => resolve());
  }));
  const onAbort = () => { void close(); };
  o.signal?.addEventListener("abort", onAbort, { once: true });
  if (o.signal?.aborted) { await close(); throw new Error("egress proxy run aborted"); }
  return Object.freeze({ port: address.port, allowedHosts, close, hosts: () => [...seen] });
}

/** `host:port` or `[v6]:port` from a CONNECT request line; null when malformed. */
export function parseConnectTarget(target: string): { host: string; port: number } | null {
  const match = /^(\[[0-9a-fA-F:.]+\]|[^:\s/[\]]+):(\d{1,5})$/.exec(target);
  if (!match) return null;
  const port = Number(match[2]);
  if (port < 1 || port > 65535) return null;
  const host = normalizeHost(match[1]!);
  return (validHostSyntax(match[1]!) || (match[1]!.startsWith("[") && net.isIPv6(host))) ? { host, port } : null;
}

/** Strict egress log reader for checkers: any line that is not exactly an `EgressLogEntry` throws. */
export function parseEgressLog(text: string): EgressLogEntry[] {
  return text.split("\n").filter(line => line.trim()).map((line, index) => {
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error(`egress log line ${index + 1} is not JSON`); }
    const entry = value as Record<string, unknown>;
    const ok = typeof entry === "object" && entry !== null && !Array.isArray(entry)
      && Object.keys(entry).sort().join(",") === "at,bytesIn,bytesOut,event,host,port,reason,via"
      && typeof entry.at === "string" && Number.isFinite(Date.parse(entry.at))
      && (entry.event === "allow" || entry.event === "refuse" || entry.event === "close")
      && (entry.via === "connect" || entry.via === "http")
      && typeof entry.host === "string" && Number.isInteger(entry.port)
      && (entry.reason === null || typeof entry.reason === "string")
      && (entry.bytesIn === null || Number.isInteger(entry.bytesIn)) && (entry.bytesOut === null || Number.isInteger(entry.bytesOut));
    if (!ok) throw new Error(`egress log line ${index + 1} is outside the format`);
    return entry as unknown as EgressLogEntry;
  });
}

/** Resolve, then refuse when any address is private (a public name pointed at the home network or metadata service). */
export function guardedLookup(resolve: typeof dns.lookup = dns.lookup): net.LookupFunction {
  return ((hostname: string, options: dns.LookupOptions, callback: (error: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void) => {
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) { callback(error); return; }
      const list = addresses as unknown as dns.LookupAddress[];
      if (!Array.isArray(list) || list.length === 0 || list.some(entry => isPrivateAddress(entry.address))) {
        callback(Object.assign(new Error(`egress refused: ${hostname} resolves to a private address`), { code: "EGRESS_PRIVATE_ADDRESS" }));
        return;
      }
      if (options.all) callback(null, list);
      else callback(null, list[0]!.address, list[0]!.family);
    });
  }) as unknown as net.LookupFunction;
}

const defaultConnector: EgressConnector = (host, port) => net.connect({ host, port, lookup: guardedLookup() });
