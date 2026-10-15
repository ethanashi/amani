// Narrow JSON bridge for the Python controller; no keys, agent prose or file paths are printed.
import { readFileSync } from "node:fs";
import { canonicalSha256 } from "../../bio-core/src/index.ts";
import { scorePilot } from "./pilot-score.ts";
try {
  const value = JSON.parse(readFileSync(0, "utf8"));
  const command = process.argv[2];
  let output: unknown;
  if (command === "hash") output = canonicalSha256(value);
  else if (command === "hashes") {
    if (!Array.isArray(value)) throw new Error("hashes needs an array");
    output = value.map(item => canonicalSha256(item));
  } else if (command === "score") output = scorePilot(value);
  else throw new Error("unknown command");
  process.stdout.write(JSON.stringify(output) + "\n");
} catch {
  process.stderr.write("pilot bridge refused invalid input\n");
  process.exitCode = 2;
}
