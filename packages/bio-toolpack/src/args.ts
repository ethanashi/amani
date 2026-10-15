// Strict command-line parsing for omb-check. Unknown, repeated or value-less flags are usage
// errors (exit 2); nothing is guessed.

export class UsageError extends Error {}
/** Unreadable or malformed input: nothing was checked. */
export class InputError extends Error {}

export type FlagKind = "string" | "boolean" | "multi";
export type FlagSpec = Readonly<Record<string, FlagKind>>;

export interface ParsedArgs {
  positionals: string[];
  strings: Map<string, string>;
  booleans: Set<string>;
  multi: Map<string, string[]>;
  /** Arguments after a literal `--`, or null when absent. */
  rest: string[] | null;
}

export function parseArgs(argv: readonly string[], spec: FlagSpec): ParsedArgs {
  const parsed: ParsedArgs = { positionals: [], strings: new Map(), booleans: new Set(), multi: new Map(), rest: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--") {
      parsed.rest = argv.slice(i + 1);
      break;
    }
    if (!arg.startsWith("--") || arg === "-") {
      if (arg.startsWith("-") && arg !== "-") throw new UsageError(`unknown option ${arg}`);
      parsed.positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
    const kind = Object.hasOwn(spec, name) ? spec[name] : undefined;
    if (kind === undefined) throw new UsageError(`unknown option --${name}`);
    if (kind === "boolean") {
      if (eq >= 0) throw new UsageError(`--${name} takes no value`);
      if (parsed.booleans.has(name)) throw new UsageError(`--${name} given twice`);
      parsed.booleans.add(name);
      continue;
    }
    let value: string;
    if (eq >= 0) value = arg.slice(eq + 1);
    else {
      if (i + 1 >= argv.length) throw new UsageError(`--${name} needs a value`);
      value = argv[++i]!;
    }
    if (kind === "multi") {
      const list = parsed.multi.get(name) ?? [];
      list.push(value);
      parsed.multi.set(name, list);
    } else {
      if (parsed.strings.has(name)) throw new UsageError(`--${name} given twice`);
      parsed.strings.set(name, value);
    }
  }
  return parsed;
}

export function optional(args: ParsedArgs, name: string): string | undefined {
  return args.strings.get(name);
}

export function required(args: ParsedArgs, name: string, why = ""): string {
  const value = args.strings.get(name);
  if (value === undefined || value.trim() === "") throw new UsageError(`--${name} is required${why ? ` ${why}` : ""}`);
  return value;
}

/** Comma-separated non-blank names, unique. */
export function nameList(args: ParsedArgs, name: string): string[] | undefined {
  const value = args.strings.get(name);
  if (value === undefined) return undefined;
  const items = value.split(",");
  if (items.some((item) => item.trim() === "" || item !== item.trim())) throw new UsageError(`--${name} must be a comma-separated list of non-blank names`);
  if (new Set(items).size !== items.length) throw new UsageError(`--${name} repeats a name`);
  return items;
}

export function numberFlag(args: ParsedArgs, name: string, options: { min?: number; max?: number; minExclusive?: boolean; maxExclusive?: boolean; integer?: boolean }): number | undefined {
  const raw = args.strings.get(name);
  if (raw === undefined) return undefined;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim())) throw new UsageError(`--${name} must be a number`);
  const value = Number(raw);
  const bad = !Number.isFinite(value) || (options.integer === true && !Number.isSafeInteger(value)) ||
    (options.min !== undefined && (options.minExclusive ? value <= options.min : value < options.min)) ||
    (options.max !== undefined && (options.maxExclusive ? value >= options.max : value > options.max));
  if (bad) {
    const range = `${options.min !== undefined ? `${options.minExclusive ? ">" : ">="} ${options.min}` : ""}${options.min !== undefined && options.max !== undefined ? " and " : ""}${options.max !== undefined ? `${options.maxExclusive ? "<" : "<="} ${options.max}` : ""}`;
    throw new UsageError(`--${name} must be ${options.integer ? "an integer" : "a finite number"}${range ? ` ${range}` : ""}`);
  }
  return value;
}

export function onePositional(args: ParsedArgs, what: string): string {
  if (args.positionals.length !== 1) throw new UsageError(`expected exactly one ${what}`);
  return args.positionals[0]!;
}

export function noRest(args: ParsedArgs): void {
  if (args.rest !== null) throw new UsageError("unexpected `--`");
}
