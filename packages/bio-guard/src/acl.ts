import { execFileSync } from "node:child_process";

/** Mode bits do not describe macOS extended ACL grants. Conservatively refuse
 * every extended ACL, including read-only/deny-only ACLs. BSD find does not follow
 * symlinks by default; the inspector independently admits/enumerates targets.
 * A failed, unavailable or timed-out probe throws rather than certifying safety.
 */
export function assertNoExtendedAcl(file: string, recursive = false): void {
  if (process.platform !== "darwin") return;
  const evidence = execFileSync("/usr/bin/find", [file, ...recursive ? [] : ["-prune"], "-acl", "-print", "-quit"],
    { encoding: "utf8", timeout: 1000, maxBuffer: 64 * 1024 });
  if (evidence.length !== 0) throw new Error(`extended ACL refused: ${file}`);
}
