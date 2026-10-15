// Core launches this trusted wrapper as a detached session leader. Retain the
// supervisor's launch marker for the entire target lifetime, so a restart can
// discover the session even if the bridge dies before returning its result.
import { execFileSync, spawn } from "node:child_process";
import { closeSync, fsyncSync, openSync, readFileSync, writeFileSync } from "node:fs";
import type { BoundedCommandSpec } from "../../bio-core/src/index.ts";
const [marker, request] = process.argv.slice(2) as [string, string];
if (!/^--omerta-bio-launch=[a-f0-9-]{36}$/.test(marker)) throw new Error("launch marker required");
const spec = JSON.parse(readFileSync(request, "utf8")) as BoundedCommandSpec;
const identity = execFileSync("/bin/ps", ["-p", String(process.pid), "-o", "lstart="], {
  encoding: "utf8", timeout: 30_000, env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
}).trim();
if (!identity) throw new Error("target session identity unavailable");
const fd = openSync(`${request}.group`, "wx", 0o600);
try { writeFileSync(fd, JSON.stringify({ id: process.pid, identity })); fsyncSync(fd); }
finally { closeSync(fd); }
const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: "inherit", detached: false });
child.once("error", () => { process.exitCode = 1; });
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
