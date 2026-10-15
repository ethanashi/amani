import { canonicalJson, canonicalSha256 } from "../../bio-core/src/index.ts";
import { keys, nonempty, record, relativeFile } from "./files.ts";

/** Structurally compatible with bio-guard; terms authorization belongs to the caller. */
export interface DatasetManifest {
  version: 1;
  files: Array<{
    path: string; source: string; accession: string; url: string; retrievedAt: string;
    sha256: string; bytes: number;
    terms: { access: "public"; license: string };
  }>;
}

export interface BlindInput {
  lockedPreRegistration: string;
  /** canonicalSha256(lockedPreRegistration), pinned by the trusted ledger. */
  lockedPlanHash: string;
  manifest: DatasetManifest;
  /** canonicalSha256(manifest), pinned by the trusted host. */
  manifestHash: string;
  dataDirectory: string;
}

export type ReplicationStatus = "agrees" | "disagrees" | "inconclusive" | "failed";
export interface AnalystReport {
  status: ReplicationStatus;
  numbers: Record<string, number>;
  codeFiles: string[];
  outputFiles: string[];
}

export function validateInput(input: BlindInput): void {
  if (!record(input) || !keys(input, ["lockedPreRegistration", "lockedPlanHash", "manifest", "manifestHash", "dataDirectory"])) {
    throw new Error("blind input contains missing or unexpected fields");
  }
  if (!nonempty(input.lockedPreRegistration) || Buffer.byteLength(input.lockedPreRegistration) > 32_768
    || canonicalSha256(input.lockedPreRegistration) !== input.lockedPlanHash) throw new Error("locked plan commitment mismatch or invalid text");
  const manifest = input.manifest;
  if (!record(manifest) || !keys(manifest, ["version", "files"]) || manifest.version !== 1
    || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 10_000) throw new Error("invalid manifest");
  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (!record(file) || !keys(file, ["path", "source", "accession", "url", "retrievedAt", "sha256", "bytes", "terms"])
      || !relativeFile(file.path) || file.path === "manifest.json" || file.path.startsWith("manifest.json/")
      || ![file.source, file.accession, file.url, file.retrievedAt].every(nonempty)
      || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0
      || !record(file.terms) || !keys(file.terms, ["access", "license"])
      || file.terms.access !== "public" || !nonempty(file.terms.license)) throw new Error("invalid manifest file");
    const folded = file.path.normalize("NFC").toLowerCase();
    if (paths.has(folded)) throw new Error("duplicate manifest path");
    paths.add(folded);
  }
  if (canonicalSha256(manifest) !== input.manifestHash) throw new Error("manifest commitment mismatch");
}

/** Only these three inputs cross the analyst prompt boundary. No arbitrary context slot. */
export function buildBlindPrompt(input: BlindInput): string {
  validateInput(input);
  const prompt = [
    "You are an independent blind second analyst. Implement and run the locked pre-registration from scratch.",
    "Use only the supplied manifest and read-only data directory. Do not seek any earlier analysis.",
    "Network is disabled. Write code and outputs only in the current workspace.",
    "Status describes agreement with the locked prediction, never with an unseen analyst's results.",
    "If the plan cannot be evaluated, report inconclusive; execution failure is failed. Never invent missing evidence.",
    "Return one JSON object with exactly: status (agrees|disagrees|inconclusive|failed), numbers (finite numeric values by name), codeFiles, outputFiles (workspace-relative file paths).",
    "For agrees or disagrees, include nonempty numbers, codeFiles and outputFiles. The host computes all hashes.",
    "BLIND_INPUT_JSON",
    canonicalJson({ lockedPreRegistration: input.lockedPreRegistration, manifest: input.manifest, dataDirectory: input.dataDirectory }),
  ].join("\n");
  if (Buffer.byteLength(prompt) > 96 * 1024) throw new Error("blind prompt exceeds argument byte bound");
  return prompt;
}

export function parseReport(text: string): AnalystReport {
  const value: unknown = JSON.parse(text);
  if (!record(value) || !keys(value, ["status", "numbers", "codeFiles", "outputFiles"])
    || typeof value.status !== "string" || !["agrees", "disagrees", "inconclusive", "failed"].includes(value.status)
    || !record(value.numbers) || Object.keys(value.numbers).length > 1_000
    || Object.entries(value.numbers).some(([name, number]) => !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) || typeof number !== "number" || !Number.isFinite(number))) {
    throw new Error("invalid analyst report");
  }
  for (const field of ["codeFiles", "outputFiles"] as const) {
    const files = value[field];
    if (!Array.isArray(files) || files.length > 1_000 || files.some(file => !relativeFile(file))
      || new Set(files.map(file => (file as string).normalize("NFC").toLowerCase())).size !== files.length) throw new Error("invalid artifact list");
  }
  const codePaths = new Set((value.codeFiles as string[]).map(file => file.normalize("NFC").toLowerCase()));
  if ((value.outputFiles as string[]).some(file => codePaths.has(file.normalize("NFC").toLowerCase()))) {
    throw new Error("code and output artifacts must be disjoint");
  }
  if (["agrees", "disagrees"].includes(String(value.status))
    && (!Object.keys(value.numbers).length || !(value.codeFiles as string[]).length || !(value.outputFiles as string[]).length)) {
    throw new Error("agreement requires numbers, code and outputs");
  }
  return value as unknown as AnalystReport;
}

/** Conservative one-turn JSONL protocol: unknown/failed/skipped items never establish success. */
export function parseCodexOutput(stdout: string): AnalystReport {
  let thread = false, started = false, completed = false;
  let finalMessage: string | undefined;
  const pending = new Set<string>();
  const finished = new Set<string>();
  const knownItems = new Set(["agent_message", "reasoning", "command_execution", "file_change", "todo_list"]);
  for (const line of stdout.split(/\r?\n/).filter(line => line.trim())) {
    const event: unknown = JSON.parse(line);
    if (!record(event) || !nonempty(event.type) || completed) throw new Error("invalid or trailing Codex event");
    if (event.type === "thread.started") {
      if (thread || started || !nonempty(event.thread_id)) throw new Error("invalid thread start");
      thread = true;
    } else if (event.type === "turn.started") {
      if (!thread || started) throw new Error("invalid turn start");
      started = true;
    } else if (["item.started", "item.updated", "item.completed"].includes(event.type)) {
      const item = event.item;
      if (!started || !record(item) || !nonempty(item.id) || !knownItems.has(String(item.type))) throw new Error("unknown Codex item");
      if (finished.has(item.id)) throw new Error("duplicate completed item");
      if (item.status !== undefined && !["in_progress", "completed"].includes(String(item.status))) throw new Error("unsuccessful Codex item");
      if (event.type !== "item.completed") pending.add(item.id);
      if (event.type === "item.completed") {
        if (item.status !== undefined && item.status !== "completed") throw new Error("item did not complete");
        pending.delete(item.id);
        finished.add(item.id);
        if (item.type === "command_execution" && (item.exit_code !== 0 || item.status !== "completed")) throw new Error("command did not pass");
        if (item.type === "file_change" && item.status !== "completed") throw new Error("file change did not pass");
        if (item.type === "agent_message") {
          if (!nonempty(item.text)) throw new Error("missing agent message");
          finalMessage = item.text;
        }
      }
    } else if (event.type === "turn.completed") {
      if (!started || finalMessage === undefined || pending.size) throw new Error("missing completed report or unfinished items");
      completed = true;
    } else { throw new Error("unknown or unsuccessful Codex event"); }
  }
  if (!completed || finalMessage === undefined) throw new Error("Codex did not complete");
  return parseReport(finalMessage);
}
