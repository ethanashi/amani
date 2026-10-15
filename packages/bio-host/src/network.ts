import { readFileSync } from "node:fs";
import { parseEgressLog } from "../../bio-runner/src/index.ts";
import type { WorkerAudit } from "../../bio-pipeline/src/index.ts";

/** Translate every decision, including refused attempts. Missing/malformed logs throw. */
export function readEgressLog(file: string): WorkerAudit["egress"] {
  const text = readFileSync(file, "utf8");
  if (text && !text.endsWith("\n")) throw new Error("incomplete egress log");
  const lines = parseEgressLog(text).map(entry => {
    if (!/^[a-zA-Z0-9.-]+$/.test(entry.host) || entry.port < 1 || entry.port > 65535) throw new Error("invalid egress authority");
    return `${entry.at}\t${entry.event === "refuse" ? "refused-" : ""}${entry.via}\t${entry.host}:${entry.port}`;
  });
  return { lines, complete: true };
}
