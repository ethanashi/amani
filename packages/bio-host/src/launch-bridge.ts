// Trusted supervisor-gate child. The model cannot read/write authority files.
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { BoundedProcessRunner, type BoundedCommandSpec } from "../../bio-core/src/index.ts";
const [request, response, launchId] = process.argv.slice(2) as [string, string, string];
const spec = JSON.parse(readFileSync(request, "utf8")) as BoundedCommandSpec;
const runner = new BoundedProcessRunner({ now: Date.now });
const result = await runner.run({ ...spec, command: process.execPath,
  args: [fileURLToPath(new URL("./launch-target.ts", import.meta.url)), `--omerta-bio-launch=${launchId}`, request] });
writeFileSync(response, JSON.stringify(result), { mode: 0o600, flag: "wx" });
