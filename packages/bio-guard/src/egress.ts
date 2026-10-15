import { isIP } from "node:net";
import { isoTimestamp, result, type GuardResult } from "./validation.ts";

export type NetworkMode = "explore" | "confirm";

/** Exact DNS names (one optional trailing dot) or canonical IP literals; never suffixes/globs. */
function hostName(value: unknown): string | null {
  if (typeof value !== "string" || !value || /[\s/@?#\\%]/.test(value)) return null;
  const host = value.toLowerCase().replace(/\.$/, "");
  if (isIP(host)) return host;
  if (host.startsWith("[") && host.endsWith("]") && isIP(host.slice(1, -1)) === 6) return host.slice(1, -1);
  if (host.length > 253 || /^\d+(?:\.\d+)*$/.test(host)) return null;
  return host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ? host : null;
}

function authority(value: string): string | null {
  const match = /^(\[[a-fA-F0-9:]+\]|[^:]+)(?::([0-9]+))?$/.exec(value);
  if (!match || (match[2] !== undefined && (!/^[1-9]\d*$/.test(match[2]) || Number(match[2]) > 65535))) return null;
  return hostName(match[1]);
}

/** Parse Amani A's timestamp<TAB>kind<TAB>host[:port][<TAB>N bytes in] log.
 * `complete` is host-supplied evidence the logger covered the entire run. Missing,
 * truncated or unavailable logging is not equivalent to zero contacts.
 */
export function checkEgressLog(
  lines: unknown,
  mode: unknown,
  allowlist: unknown,
  evidence: { complete: boolean },
): GuardResult {
  const reasons: string[] = [];
  if (evidence?.complete !== true) reasons.push("egress log unavailable or incomplete");
  if (mode !== "explore" && mode !== "confirm") reasons.push("unknown network mode");
  const hosts = new Set<string>();
  if (!Array.isArray(allowlist)) reasons.push("host allowlist unavailable");
  else for (const entry of allowlist) {
    const host = hostName(entry);
    if (host === null) reasons.push(`invalid allowlist host: ${String(entry)}`);
    else hosts.add(host);
  }
  if (!Array.isArray(lines)) return result([...reasons, "egress log lines unavailable"]);
  for (const [index, line] of lines.entries()) {
    if (typeof line !== "string") { reasons.push(`line ${index + 1}: malformed log entry`); continue; }
    const fields = line.split("\t");
    const [time, kind, address] = fields;
    if (!isoTimestamp(time) || !kind || !["http", "connect", "refused-http", "refused-connect"].includes(kind) ||
      !address || fields.length < 3 || fields.length > 4 ||
      (fields.length === 4 && (kind !== "connect" || !/^\d+ bytes in$/.test(fields[3]!)))) {
      reasons.push(`line ${index + 1}: malformed or unknown log entry`); continue;
    }
    const host = authority(address);
    if (host === null) { reasons.push(`line ${index + 1}: invalid host authority`); continue; }
    if (mode === "confirm") reasons.push(`line ${index + 1}: confirm forbids host contact: ${host}`);
    else if (!hosts.has(host)) reasons.push(`line ${index + 1}: host not allowlisted: ${host}`);
    if (kind.startsWith("refused-")) reasons.push(`line ${index + 1}: refused contact attempt: ${host}`);
  }
  return result(reasons);
}
