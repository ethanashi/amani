// Network modes for Omerta Bio workers. The host-name rule and the private-address list are adapted from Amani
// A/packages/harness/src/mission-contract.ts (validateMissionNetwork) and egress-proxy.ts (refused), both ea326c85.
// See PROVENANCE.md.
import net from "node:net";
import { requireProxy } from "./proxy-binding.ts";

/**
 * - `confirm`: no network at all. The worker's sandbox allows no host, there is no proxy, and web tools are denied.
 *   Confirmation runs against pre-staged data only.
 * - `explore`: the worker's sandboxed traffic goes only to the host's logging egress proxy, which passes allowlisted
 *   hosts and refuses (and logs) everything else. Web tools stay denied, because their requests would bypass the proxy.
 */
export type NetworkPolicy =
  | { mode: "confirm" }
  | { mode: "explore"; allowedHosts: readonly string[]; proxyPort: number };

export type NetworkMode = NetworkPolicy["mode"];

export const MAX_ALLOWED_HOSTS = 32;

/** A host name, optionally "*." for its subdomains and ":port"; never an IP literal or a bare top-level wildcard. */
const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/;

export function validateAllowedHosts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ALLOWED_HOSTS) {
    throw new Error(`explore mode allows 1 to ${MAX_ALLOWED_HOSTS} hosts`);
  }
  for (const entry of value) {
    if (typeof entry !== "string" || !HOST.test(entry) || !validHostSyntax(entry.split(":")[0]!.replace(/^\*\./, ""))) throw new Error(`network policy host not allowed: ${String(entry)}`);
    const [name = "", portText] = entry.split(":");
    if (name.startsWith("*.") && name.split(".").length < 3) throw new Error(`network policy host not allowed: ${entry}`);
    if (name.split(".").every((label) => label === "*" || /^\d+$/.test(label))) throw new Error(`network policy host must be a name, not an address: ${entry}`);
    if (isPrivateHost(name.replace(/^\*\./, ""))) throw new Error(`network policy host is private: ${entry}`);
    if (portText !== undefined && (Number(portText) < 1 || Number(portText) > 65535)) throw new Error(`network policy port out of range: ${entry}`);
  }
  return [...new Set(value as string[])];
}

/** Exact-keys validation; anything unknown or missing refuses. */
export function validateNetworkPolicy(value: unknown): NetworkPolicy {
  const policy = value as Record<string, unknown> | null;
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) throw new Error("network policy is required");
  const keys = Object.keys(policy).sort().join(",");
  if (policy.mode === "confirm") {
    if (keys !== "mode") throw new Error("confirm network policy takes no hosts and no proxy");
    return { mode: "confirm" };
  }
  if (policy.mode === "explore") {
    if (keys !== "allowedHosts,mode,proxyPort") throw new Error("explore network policy needs exactly allowedHosts and proxyPort");
    const port = policy.proxyPort;
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("explore network policy needs the egress proxy's port");
    return { mode: "explore", allowedHosts: requireProxy(port, policy.allowedHosts), proxyPort: port };
  }
  throw new Error("network policy mode must be explore or confirm");
}

/**
 * Does the allowlist admit `host:port`? A pattern without a port admits the web ports 80 and 443 only; with a port,
 * exactly that port. "*.example.org" admits subdomains of example.org, not example.org itself.
 */
export function hostAllowed(allowedHosts: readonly string[], host: string, port: number): boolean {
  const name = normalizeHost(host);
  if (!validHostSyntax(host) || net.isIP(name) || !Number.isInteger(port) || port < 1 || port > 65535) return false;
  return allowedHosts.some((pattern) => {
    const [patternName = "", portText] = pattern.split(":");
    const portOk = portText === undefined ? port === 80 || port === 443 : Number(portText) === port;
    if (!portOk) return false;
    return patternName.startsWith("*.") ? name.endsWith(patternName.slice(1)) && name.length > patternName.length - 1 : name === patternName;
  });
}

/** ASCII DNS syntax only. No URL normalization, userinfo, escapes, whitespace or empty labels. */
export function validHostSyntax(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  return name.length <= 253 && name.split(".").every(label =>
    label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/** Never a research worker's business: loopback, private and link-local networks, cloud metadata. */
export function isPrivateHost(host: string): boolean {
  const name = normalizeHost(host);
  if (net.isIP(name)) return isPrivateAddress(name);
  return name === "localhost" || name.endsWith(".localhost") || name === "metadata.google.internal" || name === "metadata";
}

export function isPrivateAddress(address: string): boolean {
  const value = normalizeHost(address);
  if (net.isIPv4(value)) {
    const [a = -1, b = -1] = value.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (net.isIPv6(value)) {
    // Normalize all compressed, expanded and dotted forms before classifying.
    const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const halves = normalized.split("::");
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves[1] ? halves[1].split(":") : [];
    const words = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right].map(w => parseInt(w, 16));
    // Fail closed for non-global ranges and translation/tunneling prefixes (including NAT64 and 6to4).
    // Only native global unicast 2000::/3 is eligible, excluding special-use 2001::/23 and 2002::/16.
    return (words[0]! & 0xe000) !== 0x2000 || words[0] === 0x2002
      || (words[0] === 0x2001 && words[1]! < 0x0200);

  }
  return true; // not an address at all: refuse rather than guess
}
