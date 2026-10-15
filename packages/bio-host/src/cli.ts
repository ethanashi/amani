#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { InvestigationConfig, PipelineDependencies } from "../../bio-pipeline/src/index.ts";
import type { TurnTimeouts } from "./worker.ts";
import type { HostOptions } from "./index.ts";
import { privateFile } from "./paths.ts";

export function parseArgs(args: string[]): { action?: "investigate" | "abandon"; directory: string; mode: "confirm" | "explore"; approval: "prompt" | "auto"; turnTimeouts?: Partial<TurnTimeouts>; resultsSchema?: string } {
  const usage = "Usage: node packages/bio-host/src/cli.ts investigate|abandon <investigation-dir> [--mode explore|confirm] [--approve auto|prompt] [--draft-timeout-ms N] [--code-timeout-ms N] [--interpret-timeout-ms N] [--results-schema FILE]";
  if (!["investigate", "abandon"].includes(args[0] ?? "") || !args[1] || args[1].startsWith("--") || args.length % 2 !== 0) throw new Error(usage);
  let mode: "confirm" | "explore" = "confirm", approval: "prompt" | "auto" = "prompt";
  const turnTimeouts: Partial<TurnTimeouts> = {};
  let resultsSchema: string | undefined;
  const seen = new Set<string>();
  for (let i = 2; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    if (seen.has(key)) throw new Error(usage); seen.add(key);
    if (key === "--mode" && (value === "confirm" || value === "explore")) mode = value;
    else if (key === "--approve" && (value === "auto" || value === "prompt")) approval = value;
    else if (key === "--results-schema" && value && !value.startsWith("--")) resultsSchema = path.resolve(value);
    else if (/^--(draft|code|interpret)-timeout-ms$/.test(key) && value && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 2_147_483_647) {
      turnTimeouts[key.slice(2, -11) as keyof TurnTimeouts] = Number(value);
    } else throw new Error(usage);
  }
  return { ...(args[0] === "abandon" ? { action: "abandon" as const } : {}), directory: path.resolve(args[1]), mode, approval, ...(Object.keys(turnTimeouts).length ? { turnTimeouts } : {}),
    ...(resultsSchema ? { resultsSchema } : {}) };
}

export const terminalApproval: PipelineDependencies["approve"] = async ({ experiment, plan, amendment }) => {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return false;
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    process.stderr.write(`\n${amendment ? "Amended" : "Locked"} confirmatory plan ${experiment.payload.data.planHash}\n${JSON.stringify(plan, null, 2)}\n`);
    return (await terminal.question("Approve this plan? Type yes: ")).trim().toLowerCase() === "yes";
  } finally { terminal.close(); }
};

export async function runCli(args: string[], injected: Partial<HostOptions> = {}, output: (text: string) => void = text => process.stdout.write(text)): Promise<number> {
  const { action, directory, mode, approval, turnTimeouts, resultsSchema } = parseArgs(args);
  const file = path.join(directory, "investigation.json"); privateFile(file);
  const config = JSON.parse(readFileSync(file, "utf8")) as InvestigationConfig | import('./tier-c.ts').TierCConfig;
  if ('tier' in config && config.tier === 'C') {
    if (action === 'abandon' || turnTimeouts || resultsSchema || mode === 'explore') throw new Error('Tier C uses its own literature/runtime settings; legacy options are unavailable');
    const { runTierCInvestigation } = await import('./index.ts');
    const { InvestigationPaused } = await import('../../omb-investigate/src/pause.ts');
    const result = await runTierCInvestigation(directory, config, { now: injected.now ?? Date.now, ...injected.tierC,
      approval: { approve: async request => {
        if (approval === 'auto') return { actor: 'policy' };
        if (process.stdin.isTTY && process.stderr.isTTY) {
          const terminal = createInterface({ input: process.stdin, output: process.stderr });
          try {
            process.stderr.write(JSON.stringify(request, null, 2) + '\n');
            if ((await terminal.question('Approve this plan? Type yes: ')).trim().toLowerCase() === 'yes') return { actor: 'owner' };
          } finally { terminal.close(); }
        }
        throw new InvestigationPaused('provider', 'Owner plan approval required', 'plan-lock');
      } } });
    output(JSON.stringify(result) + '\n');
    return result.status === 'complete' ? 0 : 1;
  }
  // Trusted operator input: an owner-controlled, link-free schema file (content is pinned, not the path).
  if (resultsSchema) privateFile(resultsSchema);
  const schema: unknown = resultsSchema ? JSON.parse(readFileSync(resultsSchema, "utf8")) : undefined;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  try {
    const { runInvestigation, abandonInvestigation } = await import("./index.ts");
    const result = await (action === "abandon" ? abandonInvestigation : runInvestigation)(directory, config as InvestigationConfig, { now: Date.now, approve: terminalApproval, signal: controller.signal,
      ...injected, mode, approval, ...(turnTimeouts ? { turnTimeouts: { ...injected.turnTimeouts, ...turnTimeouts } } : {}),
      ...(schema !== undefined ? { resultsSchema: schema } : {}) });
    output(JSON.stringify(result) + "\n");
    return result.status === "completed" || (action === "abandon" && result.cleanupStatus !== "unproven") ? 0 : 1;
  } finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // The merged pipeline contains TS parameter properties. Keep the documented
  // plain `node cli.ts` command working with Node's built-in transformer; never
  // transpile or write another package and never propagate a loader to workers.
  const packages = new URL("../../", import.meta.url).href;
  registerHooks({ load(url, context, nextLoad) {
    if (url.startsWith(packages) && url.endsWith(".ts")) return { format: "module", shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "transform", sourceUrl: url }) };
    return nextLoad(url, context);
  } });
  runCli(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1;
  });
}
