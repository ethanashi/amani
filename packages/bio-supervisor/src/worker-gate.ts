// Host-owned launch gate. No target code runs before the owner journals our group.
import { spawn } from "node:child_process";
import type { WorkerSpec } from "./types.ts";
let started = false;
process.on("disconnect", () => { process.kill(-process.pid, "SIGKILL"); });
process.on("message", (message: WorkerSpec) => {
  if (started) return;
  started = true;
  const child = spawn(message.command, message.args, {
    cwd: message.cwd, env: message.env, stdio: "ignore", detached: false,
  });
  child.once("error", () => { process.send?.({ code: null, signal: "spawn-error" }); });
  child.once("exit", (code, signal) => { process.send?.({ code, signal }); });
});
process.send?.({ ready: true });
