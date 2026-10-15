import { createHash } from "node:crypto";
import type { AnalysisEnvironment, EnvironmentIdentity } from "../../bio-pipeline/src/index.ts";
import { accessSync, constants, existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HostSandbox, machOLibraryRoots, type SandboxRequest, type SandboxInvocation } from "../../bio-core/src/index.ts";
import { withReexecutionSandbox } from "../../bio-guard/src/index.ts";
import { noLinks } from "./paths.ts";

const baselineManifest = fileURLToPath(new URL("../../bio-baseline/pixi.toml", import.meta.url));

/** The arm runner already installs a fresh locked environment in its host-owned
 * working directory. Reuse it only when both inputs match the repository pins.
 * Resolve before worker dispatch; the selected prefix is read-only to workers. */
export function preparedPixiEnvironment(directory: string, baseline = baselineManifest): AnalysisEnvironment & EnvironmentIdentity {
  const manifest = path.join(directory, "env/pixi.toml"), lockfile = path.join(directory, "env/pixi.lock");
  if (!existsSync(manifest) && !existsSync(lockfile)) return pixiEnvironment(baseline);
  for (const [candidate, expected] of [[manifest, baseline], [lockfile, path.join(path.dirname(baseline), "pixi.lock")]]) {
    noLinks(candidate!); noLinks(expected!);
    if (!readFileSync(candidate!).equals(readFileSync(expected!))) throw new Error("prepared pixi environment differs from repository manifest/lock pins");
  }
  return pixiEnvironment(manifest);
}

/** Host-owned installed pixi prefix only: never solve/install packages during a run. */
export function pixiEnvironment(manifest = baselineManifest): AnalysisEnvironment & EnvironmentIdentity {
  const prefix = path.join(path.dirname(manifest), ".pixi/envs/default");
  const lockfile = path.join(path.dirname(manifest), "pixi.lock");
  for (const file of [manifest, lockfile, path.join(prefix, "conda-meta/history"), path.join(prefix, "bin/python"), path.join(prefix, "bin/Rscript")]) {
    if (!existsSync(file)) throw new Error(`pixi locked R/Python environment unavailable: ${file}; install packages/bio-baseline with pixi install --locked before running`);
  }
  noLinks(manifest); noLinks(lockfile);
  const canonical = realpathSync(prefix);
  for (const name of ["python", "Rscript"]) {
    const binary = realpathSync(path.join(prefix, "bin", name));
    if (!binary.startsWith(`${canonical}${path.sep}`)) throw new Error("pixi interpreter escapes installed prefix");
    accessSync(binary, constants.X_OK);
  }
  return { prefix: canonical, lockfile: realpathSync(lockfile), lockfileHash: createHash("sha256").update(readFileSync(lockfile)).digest("hex") };
}

export function reexecutionAdapter(prefix: string | null, environmentCache?: Parameters<typeof withReexecutionSandbox>[0]["environmentCache"]): typeof withReexecutionSandbox {
  return (input, run, sandbox) => withReexecutionSandbox({ ...input,
    ...(environmentCache ? { environmentCache } : {}),
    environmentRoots: [...input.environmentRoots, ...(prefix ? [prefix] : [])],
    toolPath: prefix ? `${path.join(prefix, "bin")}${path.delimiter}${input.toolPath}` : input.toolPath,
  }, run, sandbox);
}

/** Node's loader dependencies remain explicit, including wrapper-script installs. */
export class AnalysisSandbox extends HostSandbox {
  private runtimeRoots: string[] | undefined;
  override prepare(request: SandboxRequest): SandboxInvocation {
    this.runtimeRoots ??= process.platform === "darwin" ? [...machOLibraryRoots(process.execPath), "/private/var/select"] : [];
    return super.prepare({ ...request, toolchainReadRoots: [...request.toolchainReadRoots ?? [],
      ...this.runtimeRoots] });
  }
}
