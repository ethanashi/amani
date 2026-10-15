import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { canonicalPath, overlaps } from "../../bio-core/src/index.ts";
import type { AnalysisEnvironment, AnalysisRuntime, EnvironmentIdentity } from "./types.ts";

export function codeName(runtime: AnalysisRuntime = "node"): string {
  return { node: "analysis.mjs", r: "analysis.R", python: "analysis.py" }[runtime];
}

/** No PATH lookup or worker-selected interpreter. Symlinks inside a pixi prefix
 * are allowed only when the interpreter resolves inside that same prefix. */
export function nativeRuntime(environment: AnalysisEnvironment, runtime: AnalysisRuntime, investigation: string): {
  identity: EnvironmentIdentity; command: string; args: string[]; toolPath: string;
} {
  function canonical(file: string): string {
    if (typeof file !== "string" || !path.isAbsolute(file)) throw new Error("environment paths must be absolute and canonical");
    const rejectAlias = (value: string) => {
      if (/^\/System\/Volumes\/Data(?:\/|$)/i.test(path.resolve(value))) throw new Error("environment firmlink alias refused");
    };
    rejectAlias(file);
    const resolved = canonicalPath(file); rejectAlias(resolved);
    if (file !== resolved) throw new Error("environment paths must be absolute and canonical");
    return resolved;
  }
  const root = canonicalPath(investigation);
  for (const file of [environment.prefix, environment.lockfile]) {
    const resolved = canonical(file);
    if (overlaps(root, resolved)) throw new Error("environment overlaps investigation");
  }
  if (!lstatSync(environment.prefix).isDirectory() || !lstatSync(environment.lockfile).isFile()) throw new Error("environment prefix or lockfile unavailable");
  const binary = { node: "node", r: "Rscript", python: "python" }[runtime];
  const command = path.join(environment.prefix, "bin", binary), resolved = canonicalPath(command);
  if (!resolved.startsWith(`${environment.prefix}${path.sep}`) || !lstatSync(resolved).isFile()) throw new Error("runtime escapes environment prefix");
  return {
    identity: { prefix: environment.prefix, lockfileHash: createHash("sha256").update(readFileSync(environment.lockfile)).digest("hex") },
    command, args: runtime === "r" ? ["--vanilla"] : runtime === "python" ? ["-I", "-B"] : [],
    toolPath: path.join(environment.prefix, "bin"),
  };
}
