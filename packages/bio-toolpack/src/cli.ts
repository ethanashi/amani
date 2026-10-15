// Installed omb-check entry. Missing or malformed profile markers never select a fallback.
import { readFileSync } from "node:fs";
import { main } from "./main.ts";
import { isProfile } from "./profile.ts";

try {
  const profile = readFileSync(new URL("../../../../PROFILE", import.meta.url), "utf8").trim();
  if (!isProfile(profile)) throw new Error("unknown tool pack profile");
  process.exitCode = await main(process.argv.slice(2), {
    stdout: (text) => { process.stdout.write(text); },
    stderr: (text) => { process.stderr.write(text); },
    cwd: process.cwd(), env: process.env,
  }, profile);
} catch (error) {
  process.stderr.write(`omb-check: profile unavailable: ${String(error)}\n`);
  process.exitCode = 2;
}
