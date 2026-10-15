import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  SandboxAdapter,
  SandboxClass,
  SandboxInvocation,
  SandboxRequest,
} from "./contracts.ts";

const SEATBELT = "/usr/bin/sandbox-exec";
const VENDORED_SEATBELT_POLICY = fileURLToPath(
  new URL("../../../../third_party/codex-sandboxing/seatbelt_base_policy.sbpl", import.meta.url),
);

export class HostSandbox implements SandboxAdapter {
  readonly #platform: NodeJS.Platform;
  readonly #bwrapPath: string | null;
  readonly #sandboxClass: SandboxClass;

  constructor(input: {
    platform?: NodeJS.Platform;
    bwrapPath?: string | null;
    bwrapProbe?: (path: string) => boolean;
  } = {}) {
    this.#platform = input.platform ?? process.platform;
    this.#bwrapPath = input.bwrapPath === undefined ? discoverBubblewrap() : input.bwrapPath;
    this.#sandboxClass = detectSandboxClass(
      this.#platform,
      this.#bwrapPath,
      input.bwrapProbe ?? probeBubblewrap,
    );
  }

  prepare(request: SandboxRequest): SandboxInvocation {
    validateRequest(request);
    const sandboxClass = this.#sandboxClass;
    const environmentManifest = sandboxEnvironment(request);
    if (request.loopbackPorts !== undefined && sandboxClass !== "seatbelt") {
      return { sandboxClass, environmentManifest, spec: null, refusalReason: "scoped loopback ports are not supported by this sandbox backend" };
    }
    if (sandboxClass === "refuse") {
      return {
        sandboxClass,
        environmentManifest,
        spec: null,
        refusalReason:
          this.#platform === "linux" && this.#bwrapPath
            ? "bubblewrap cannot create the required Linux namespaces"
            : `no supported host sandbox for ${this.#platform}`,
      };
    }
    const readable = sandboxReadRoots(request, this.#platform);
    environmentManifest.AMANI_SANDBOX_READ_ROOTS = JSON.stringify(readable);
    environmentManifest.AMANI_SANDBOX_WRITE_ROOTS = JSON.stringify(uniqueRealRoots(request.writableRoots));
    return sandboxClass === "seatbelt"
      ? seatbeltInvocation(request, environmentManifest, readable)
      : bwrapInvocation(request, environmentManifest, required(this.#bwrapPath), readable);
  }
}

export function detectSandboxClass(
  platform: NodeJS.Platform = process.platform,
  bwrapPath: string | null = discoverBubblewrap(),
  bwrapProbe: (path: string) => boolean = probeBubblewrap,
): SandboxClass {
  if (platform === "darwin" && existsSync(SEATBELT)) return "seatbelt";
  if (
    platform === "linux" &&
    bwrapPath &&
    path.isAbsolute(bwrapPath) &&
    existsSync(bwrapPath) &&
    bwrapProbe(bwrapPath)
  ) {
    return "bwrap";
  }
  return "refuse";
}

function seatbeltInvocation(
  request: SandboxRequest,
  environmentManifest: Record<string, string>,
  readable: string[],
): SandboxInvocation {
  const writable = uniqueRealRoots(request.writableRoots);
  const definitions = writable.map((root, index) => `-DWRITABLE_ROOT_${index}=${root}`);
  definitions.push(...readable.map((root, index) => `-DREADABLE_ROOT_${index}=${root}`));
  const readRules = readable.map((_, index) => `(allow file-read* (subpath (param "READABLE_ROOT_${index}")))`).join("\n");
  // Ancestor directory metadata is needed for path resolution, but never
  // grants data access to siblings (including HOME, credentials or other repos).
  const ancestors = new Set<string>();
  for (const root of readable) {
    let ancestor = path.dirname(root);
    while (!ancestors.has(ancestor)) { ancestors.add(ancestor); if (ancestor === path.dirname(ancestor)) break; ancestor = path.dirname(ancestor); }
  }
  const metadataRules = [...ancestors].map(root => `(allow file-read-metadata (literal ${JSON.stringify(root)}))`).join("\n");
  // dyld opens the root directory as an anchor. Literal directory access does
  // not authorize reads of its children, unlike the previous global rule.
  const loaderAnchor = '(allow file-read-data (literal "/"))';
  const writeRules = writable
    .map((_, index) => `(allow file-write* (subpath (param "WRITABLE_ROOT_${index}")))`)
    .join("\n");
  const loopbackRules = request.allowLoopback === true
    ? (request.loopbackPorts ?? ["*"]).map(port => `(allow network-inbound (local ip "localhost:${port}"))\n(allow network-outbound (remote ip "localhost:${port}"))`).join("\n")
    : "";
  // Chromium registers one rendezvous service named after its own PID, which a check cannot know in advance.
  const browserRules = request.allowBrowser === true && request.allowLoopback === true
    ? '(allow mach-register (global-name-regex #"^org\\.chromium\\.Chromium\\.MachPortRendezvousServer\\.[0-9]+$"))\n'
      + '(allow mach-lookup (global-name-regex #"^org\\.chromium\\.Chromium\\.MachPortRendezvousServer\\.[0-9]+$"))\n'
      + '(allow mach-lookup (global-name "com.apple.bsd.dirhelper"))'
    : "";
  const policy = `${readFileSync(VENDORED_SEATBELT_POLICY, "utf8")}\n${readRules}\n${metadataRules}\n${loaderAnchor}\n${writeRules}\n${loopbackRules}\n${browserRules ? `${browserRules}\n` : ""}`;
  return {
    sandboxClass: "seatbelt",
    environmentManifest,
    refusalReason: null,
    spec: {
      command: SEATBELT,
      args: ["-p", policy, ...definitions, "--", realpathSync(request.command), ...request.args],
      cwd: realpathSync(request.cwd),
      env: environmentManifest,
      timeoutMs: request.timeoutMs,
      ...(request.maxOutputBytes === undefined
        ? {}
        : { maxOutputBytes: request.maxOutputBytes }),
    },
  };
}

function bwrapInvocation(
  request: SandboxRequest,
  environmentManifest: Record<string, string>,
  bwrapPath: string,
  readable: string[],
): SandboxInvocation {
  const writable = uniqueRealRoots(request.writableRoots);
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--clearenv",
  ];
  // Bubblewrap starts from an empty mount tree. Never bind the host filesystem
  // root; only declared inputs, runtime dependencies and private output exist.
  for (const root of readable) args.push("--ro-bind", root, root);
  for (const [name, value] of Object.entries(environmentManifest).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    args.push("--setenv", name, value);
  }
  for (const root of writable) args.push("--bind", root, root);
  // Parent directories created by bwrap live on its otherwise writable root
  // tmpfs. Lock that mount too; explicit writable submounts remain writable.
  args.push("--remount-ro", "/");
  args.push("--chdir", realpathSync(request.cwd), "--", realpathSync(request.command), ...request.args);
  return {
    sandboxClass: "bwrap",
    environmentManifest,
    refusalReason: null,
    spec: {
      command: realpathSync(bwrapPath),
      args,
      cwd: realpathSync(request.cwd),
      env: environmentManifest,
      timeoutMs: request.timeoutMs,
      ...(request.maxOutputBytes === undefined
        ? {}
        : { maxOutputBytes: request.maxOutputBytes }),
    },
  };
}

function sandboxEnvironment(request: SandboxRequest): Record<string, string> {
  const artifactRoot = realpathSync(request.artifactRoot);
  const home = path.join(artifactRoot, "home");
  const temporary = path.join(artifactRoot, "tmp");
  mkdirSync(home, { recursive: true });
  mkdirSync(temporary, { recursive: true });
  validateToolPath(request.toolPath);
  return {
    HOME: home,
    LANG: "C.UTF-8",
    PATH: request.toolPath,
    TMPDIR: temporary,
    AMANI_SANDBOX_NETWORK_DISABLED: "1",
    AMANI_SANDBOX_LOOPBACK_ALLOWED: request.allowLoopback === true ? "1" : "0",
    // Present only when granted, so every existing manifest (and its hash) is unchanged.
    ...(request.allowBrowser === true && request.allowLoopback === true ? { AMANI_SANDBOX_BROWSER_ALLOWED: "1" } : {}),
    AMANI_SANDBOX_LOOPBACK_PORTS: JSON.stringify(request.loopbackPorts ?? null),
  };
}

function validateRequest(request: SandboxRequest): void {
  if (request.loopbackPorts !== undefined && (request.allowLoopback !== true
    || !Array.isArray(request.loopbackPorts) || request.loopbackPorts.length < 1 || request.loopbackPorts.length > 32
    || new Set(request.loopbackPorts).size !== request.loopbackPorts.length
    || request.loopbackPorts.some(port => !Number.isInteger(port) || port < 1 || port > 65535))) {
    throw new Error("sandbox scoped loopback ports must be unique valid ports with loopback enabled");
  }
  for (const [label, value] of [
    ["command", request.command],
    ["cwd", request.cwd],
    ["artifactRoot", request.artifactRoot],
  ] as const) {
    if (!path.isAbsolute(value)) throw new Error(`sandbox ${label} must be absolute`);
  }
  if (!existsSync(request.command)) throw new Error(`sandbox command unavailable:${request.command}`);
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1) {
    throw new Error("sandbox timeout must be a positive integer");
  }
  if (!request.writableRoots.includes(request.artifactRoot)) {
    throw new Error("sandbox artifact root must be explicitly writable");
  }
  for (const root of [...request.readableRoots, ...request.writableRoots, ...(request.toolchainReadRoots ?? [])]) {
    if (!path.isAbsolute(root)) throw new Error(`sandbox root must be absolute:${root}`);
    if (realpathSync(root) === path.parse(root).root) throw new Error("sandbox cannot expose the filesystem root");
  }
}

function sandboxReadRoots(request: SandboxRequest, platform: NodeJS.Platform): string[] {
  const system = platform === "darwin"
    ? ["/usr/bin", "/bin", "/usr/lib", "/System/Library", "/Library/Apple/System/Library", "/System/Volumes/Preboot/Cryptexes/OS", "/System/Cryptexes/OS", "/private/var/db/dyld", "/private/etc/localtime", "/opt/homebrew/etc/openssl@3/openssl.cnf", "/usr/local/etc/openssl@3/openssl.cnf",
      // The system TLS configuration and public CA bundle: cargo's bundled curl reads them at startup even offline.
      "/private/etc/ssl",
      // The system time zone database (zoneinfo, date libraries); public data.
      "/usr/share/zoneinfo", "/private/var/db/timezone",
      // System libiconv reads public esdb/csmapper databases for charset conversion.
      "/usr/share/i18n", "/dev/null", "/dev/urandom", "/dev/random"]
    : ["/usr/bin", "/bin", "/usr/lib", "/lib", "/lib64", "/usr/lib64", "/etc/ld.so.cache", "/etc/ssl", "/etc/localtime", "/dev/null", "/dev/urandom", "/dev/random"];
  const declared = [...request.readableRoots, ...request.writableRoots, ...(request.toolchainReadRoots ?? []),
    path.dirname(realpathSync(request.command)), ...request.toolPath.split(path.delimiter)];
  for (const root of declared) if (!existsSync(root)) throw new Error(`sandbox declared dependency unavailable:${root}`);
  const libraries = platform === "darwin" ? machOLibraryRoots(request.command) : [];
  // Keep aliases on Linux: /bin/sh and /lib64/ld-linux*.so may be ELF/shebang paths.
  const roots = [...declared, ...system.filter(root => existsSync(root)), ...libraries];
  return [...new Set([...roots, ...roots.map(root => realpathSync(root))])]
    .sort((a, b) => a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b));
}

/** Resolve native loader dependencies of the host executable, not a whole Homebrew prefix. */
export function machOLibraryRoots(executable: string): string[] {
  const roots = new Set<string>();
  const visited = new Set<string>();
  const pending = [realpathSync(executable)];
  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    if (visited.size > 128) throw new Error("sandbox native dependency graph exceeds bound");
    let output: string;
    try { output = execFileSync("/usr/bin/otool", ["-L", file], { encoding: "utf8", timeout: 2000, maxBuffer: 128 * 1024, stdio: ["ignore", "pipe", "ignore"] }); }
    catch { continue; } // Script/static executable: caller must declare any interpreter/packages.
    for (const line of output.split("\n").slice(1)) {
      const dependency = line.trim().split(" (compatibility version")[0];
      if (!dependency) continue;
      const resolved = dependency.startsWith("@loader_path/") ? path.resolve(path.dirname(file), dependency.slice(13))
        : dependency.startsWith("@rpath/") ? path.resolve(path.dirname(executable), "..", "lib", dependency.slice(7)) : dependency;
      if (!path.isAbsolute(resolved) || !existsSync(resolved) || resolved.startsWith("/usr/lib/") || resolved.startsWith("/System/Library/")) continue;
      const real = realpathSync(resolved);
      roots.add(path.dirname(resolved));
      roots.add(path.dirname(real));
      pending.push(real);
    }
  }
  return [...roots];
}

function validateToolPath(value: string): void {
  const entries = value.split(path.delimiter);
  if (entries.length === 0 || entries.some((entry) => !entry || !path.isAbsolute(entry))) {
    throw new Error("sandbox PATH must contain only host-owned absolute entries");
  }
}

function uniqueRealRoots(roots: string[]): string[] {
  return [...new Set(roots.map((root) => realpathSync(root)))].sort();
}

function discoverBubblewrap(): string | null {
  for (const candidate of ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function probeBubblewrap(executable: string): boolean {
  try {
    execFileSync(
      executable,
      [
        "--die-with-parent",
        "--new-session",
        "--unshare-all",
        "--ro-bind",
        "/",
        "/",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--",
        "/bin/true",
      ],
      { stdio: "ignore", timeout: 5_000 },
    );
    return true;
  } catch {
    return false;
  }
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error("required sandbox value missing");
  return value;
}
