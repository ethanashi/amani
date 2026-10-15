// omb-check dispatcher. Each command returns a ToolResult; usage and input errors exit 2 and are
// never reported as "no problems found".

import { InputError, UsageError } from "./args.ts";
import { emit, result, TOOL_VERSION, type Io, type ToolResult } from "./io.ts";
import { citationsCommand } from "./commands/citations.ts";
import { gates, infer } from "./commands/gates.ts";
import { reproduce } from "./commands/reproduce.ts";
import { donorSplit, duplicates, effectiveUnitsCommand, nearDuplicates, pseudorep } from "./commands/validity.ts";
import { FULL_ONLY_COMMANDS, type Profile } from "./profile.ts";

type Command = (argv: readonly string[], io: Io) => Promise<ToolResult>;

export const COMMANDS: Readonly<Record<string, Command>> = {
  duplicates: (argv, io) => duplicates(argv, io.cwd),
  "near-duplicates": (argv, io) => nearDuplicates(argv, io.cwd),
  "effective-units": (argv, io) => effectiveUnitsCommand(argv, io.cwd),
  pseudorep: (argv, io) => pseudorep(argv, io.cwd),
  "donor-split": (argv, io) => donorSplit(argv, io.cwd),
  infer: (argv, io) => infer(argv, io.cwd),
  gates: (argv, io) => gates(argv, io.cwd),
  citations: (argv, io) => citationsCommand(argv, io.cwd),
  reproduce: (argv, io) => reproduce(argv, io.cwd, io.env),
};

export function commandsFor(profile: Profile): string[] {
  return Object.keys(COMMANDS).filter((name) => profile === "full" || !FULL_ONLY_COMMANDS.includes(name));
}

const usage = (profile: Profile) => `usage: omb-check <command> [options]   (see TOOLS.md for exact semantics)
commands: ${commandsFor(profile).join(", ")}
exit codes: 0 verified (no problem found); 1 problem found or not established; 2 usage or input error
`;

/** --json-out is accepted by every command; it is located here so even a refused invocation
 * writes its JSON document where the caller asked. */
function jsonOut(argv: readonly string[]): string | undefined {
  const stop = argv.indexOf("--");
  const head = stop < 0 ? argv : argv.slice(0, stop);
  for (let i = 0; i < head.length; i += 1) {
    if (head[i] === "--json-out") return head[i + 1];
    if (head[i]!.startsWith("--json-out=")) return head[i]!.slice("--json-out=".length);
  }
  return undefined;
}

/** `profile` is the installed tool pack's profile; the default is the minimum, `checks`. */
export async function main(argv: readonly string[], io: Io, profile: Profile = "checks"): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === "--help" || name === "-h" || name === "help") {
    io.stdout(usage(profile));
    return name === undefined ? 2 : 0;
  }
  if (name === "--version") {
    io.stdout(`omb-check ${TOOL_VERSION}\n`);
    return 0;
  }
  const command = commandsFor(profile).includes(name) ? COMMANDS[name] : undefined;
  if (!command) {
    io.stderr(`omb-check: unknown command ${JSON.stringify(name)}${(Object.hasOwn(COMMANDS, name) || FULL_ONLY_COMMANDS.includes(name)) ? ` (not in tool pack profile ${profile})` : ""}\n${usage(profile)}`);
    return 2;
  }
  let outcome: ToolResult;
  try {
    outcome = await command(rest, io);
  } catch (error) {
    const kind = error instanceof UsageError ? "usage-error" : error instanceof InputError ? "input-error" : "error";
    const message = error instanceof Error ? error.message : String(error);
    outcome = result(2, kind, message, {});
  }
  try {
    emit(name, outcome, io, jsonOut(rest));
  } catch (error) {
    io.stderr(`omb-check ${name}: cannot write output: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  return outcome.exitCode;
}
