// Real operating-system identity probe for the OS attestation check. No caller can replace it (no
// callback parameter anywhere); only a test module mock can.
import { execFileSync } from "node:child_process";

/** Resolves a system account by name from the OS user database; null when absent or unreadable. */
export function systemUid(name: "_ombcert" | "_ombrun"): number | null {
  try {
    const out = execFileSync("/usr/bin/id", ["-u", name], { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"], env: {} }).trim();
    return /^[0-9]+$/.test(out) ? Number(out) : null;
  } catch { return null; }
}
