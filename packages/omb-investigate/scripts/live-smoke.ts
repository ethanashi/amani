#!/usr/bin/env node
// LIVE smoke of omb-investigate on pilot tasks w0, p1 and p10 with real Codex workers (Claude as the
// G7 replicator). Spends Codex and Claude quota. Run ONLY after the locked pilot has finished (quiet
// machine) and, for anything above Tentative later, after the owner's OS-user setup and V5 wiring.
//
//   export PATH=/opt/homebrew/opt/node@24/bin:$PATH
//   OMB_LIVE=1 OMB_LIVE_PILOT_DONE=1 BIO_GRADING_ROOT=$HOME/.omerta-bio/grading-v7-smoke \
//     nice -n 10 node --experimental-transform-types --no-warnings packages/omb-investigate/scripts/live-smoke.ts \
//       [--tasks w0-venet,p1-esr1,p10-pseudorep] [--root $HOME/.omerta-bio/v7-smoke/<stamp>] [--load-ceiling 9]
//
// Optional env: OMB_CODEX_CLI (default /opt/homebrew/bin/codex), OMB_CLAUDE_CLI (default the pinned
// build), OMB_CLAUDE_MODEL (default claude-opus-5-5), OMB_CODEX_MODEL (scheduler default gpt-6-luna),
// BIO_SEALING_KEY (host seal-v2 key for the sealed w0 public contract; default
// ~/.omerta-bio/keys/sealing.key; without it w0 stops as preflight-failed before any model turn).
// Output: <root>/summary.json (wall time, scheduled turns, network events) and one deliverable
// (report.md, paper-input.json, manifest.json) per investigation under <root>/host.
// V7-wire: each task's bio-tasks host contract is pinned (author-draft policy approval, journaled)
// and verified before any model turn; OS-user separation is attested via cert-launch when the
// launcher is installed, but route P still executes outside it, so labels stay Tentative.
// (--experimental-transform-types: omb-sched uses TypeScript parameter properties, which Node's
// default strip-only mode rejects.)
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_DEFAULTS, runLiveSmoke, SMOKE_TASKS } from "../src/live.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  if (process.env.OMB_LIVE !== "1") { process.stderr.write("refusing: set OMB_LIVE=1 (this spends Codex and Claude quota)\n"); return 2; }
  if (process.env.OMB_LIVE_PILOT_DONE !== "1") { process.stderr.write("refusing: the locked pilot must have finished (set OMB_LIVE_PILOT_DONE=1 once it has)\n"); return 2; }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const result = await runLiveSmoke({
    repoRoot,
    root: arg("--root") ?? path.join(homedir(), ".omerta-bio", "v7-smoke", stamp),
    tasks: (arg("--tasks") ?? SMOKE_TASKS.join(",")).split(",").filter(Boolean),
    codexCli: process.env.OMB_CODEX_CLI ?? LIVE_DEFAULTS.codexCli,
    claudeCli: process.env.OMB_CLAUDE_CLI ?? LIVE_DEFAULTS.claudeCli,
    claudeModel: process.env.OMB_CLAUDE_MODEL ?? LIVE_DEFAULTS.claudeModel,
    ...(process.env.OMB_NETWORK_CAP_MS ? { networkCapMs: Number(process.env.OMB_NETWORK_CAP_MS) } : {}),
    ...(process.env.OMB_SILENCE_MS ? { silenceMs: Number(process.env.OMB_SILENCE_MS) } : {}),
    ...(arg("--load-ceiling") ? { loadCeiling: Number(arg("--load-ceiling")) } : {}),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.investigations.every((i) => i.status !== "error") ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }).catch((e) => { process.stderr.write(String(e?.stack ?? e) + "\n"); process.exitCode = 2; });
