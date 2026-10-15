// Tool pack builder (trusted host side; never shipped inside the bundle).
//
//   node build.ts check [--profile checks|full] [--lock FILE]   sources match the pin?  (exit 0/3)
//   node build.ts build --profile P --out DIR [--lock FILE]     write the bundle, refuse unless it matches the pin
//   node build.ts hash DIR                                      tree hash of an installed bundle
//   node build.ts pin                                           rewrite toolpack.lock.json from the sources
//
// Exit codes: 0 ok, 2 usage, 3 pin mismatch / refused (the written directory is removed).

import { rmSync, chmodSync, readdirSync, lstatSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildBundle, bundleDigest, digestDiff, hashTree, isProfile, LOCK_FILE, makeLock, PROFILES, readLock, writeBundle, type Profile } from "./bundle.ts";

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value`);
  return value;
}

function removeTree(dir: string): void {
  const unlock = (p: string): void => {
    try { if (lstatSync(p).isDirectory()) { chmodSync(p, 0o700); for (const n of readdirSync(p)) unlock(path.join(p, n)); } } catch { /* absent */ }
  };
  unlock(dir);
  rmSync(dir, { recursive: true, force: true });
}

function profileArg(argv: string[], required: boolean): Profile[] {
  const value = arg(argv, "profile");
  if (value === undefined) {
    if (required) throw new Error("--profile is required (checks|full)");
    return [...PROFILES];
  }
  if (!isProfile(value)) throw new Error(`unknown tool pack profile ${JSON.stringify(value)} (checks|full)`);
  return [value];
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  try {
    if (command === "pin") {
      writeFileSync(LOCK_FILE, JSON.stringify(makeLock(), null, 2) + "\n");
      const lock = readLock();
      for (const p of PROFILES) process.stdout.write(`${p} ${lock.profiles[p].sha256}\n`);
      return 0;
    }
    if (command === "hash") {
      const dir = rest[0];
      if (!dir) throw new Error("usage: build.ts hash DIR");
      process.stdout.write(`${hashTree(path.resolve(dir)).sha256}\n`);
      return 0;
    }
    if (command === "check") {
      const lock = readLock(arg(rest, "lock") ?? LOCK_FILE);
      let ok = true;
      for (const p of profileArg(rest, false)) {
        const digest = bundleDigest(buildBundle(p));
        if (digest.sha256 === lock.profiles[p].sha256) process.stdout.write(`${p} ${digest.sha256} matches the pin\n`);
        else {
          ok = false;
          process.stderr.write(`${p}: sources hash to ${digest.sha256}, pinned ${lock.profiles[p].sha256}: ${digestDiff(lock.profiles[p].files, digest.files).join(", ")}\n`);
        }
      }
      return ok ? 0 : 3;
    }
    if (command === "build") {
      const [profile] = profileArg(rest, true) as [Profile];
      const out = arg(rest, "out");
      if (!out) throw new Error("--out is required");
      const lock = readLock(arg(rest, "lock") ?? LOCK_FILE);
      const outDir = path.resolve(out);
      writeBundle(buildBundle(profile), outDir);
      const installed = hashTree(outDir);
      if (installed.sha256 !== lock.profiles[profile].sha256) {
        removeTree(outDir);
        process.stderr.write(`refusing: tool pack ${profile} hashes to ${installed.sha256}, pinned ${lock.profiles[profile].sha256}: ${digestDiff(lock.profiles[profile].files, installed.files).join(", ")}\n`);
        return 3;
      }
      process.stdout.write(`${installed.sha256}\n`);
      return 0;
    }
    process.stderr.write("usage: build.ts check|build|hash|pin (see header)\n");
    return 2;
  } catch (error) {
    process.stderr.write(`build.ts: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
