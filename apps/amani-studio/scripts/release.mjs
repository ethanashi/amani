import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, cpSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(".");
const jobs = Number(process.env.CARGO_BUILD_JOBS ?? '2');
if (!Number.isSafeInteger(jobs) || jobs < 1) throw Error('CARGO_BUILD_JOBS must be a positive integer');
const df = execFileSync("df", ["-k", root], { encoding: "utf8" });
console.log(df);
const free = Number(df.trim().split("\n").at(-1).trim().split(/\s+/)[3]) * 1024;
if (free < 50 * 2 ** 30)
  throw Error("Stopped: less than 50 GiB free before Rust build");
const node = process.env.AMANI_NODE ?? resolve(".runtime/node-24");
const version = execFileSync(node, ["-p", "process.versions.node"], {
  encoding: "utf8",
}).trim();
if (!version.startsWith("24.")) throw Error("Node 24 is required");
function systemLibraries(binary){
  const linked=execFileSync("otool",["-L",binary],{encoding:"utf8"}).trim().split("\n").slice(1).map(line=>line.trim().split(" ")[0]);
  if(!linked.length||linked.some(dep=>!dep.startsWith("/usr/lib/")&&!dep.startsWith("/System/Library/")))
    throw Error("Release executable must depend only on macOS system libraries: "+binary);
}
systemLibraries(node);
mkdirSync("src-tauri/resources", { recursive: true });
copyFileSync(node, "src-tauri/resources/node");
chmodSync("src-tauri/resources/node", 0o755);
execFileSync(process.execPath,["scripts/package-engine.mjs"],{stdio:"inherit"});
console.log("Bundling Node", version);
const result = spawnSync(
  process.execPath,
  ["node_modules/@tauri-apps/cli/tauri.js", "build", "--bundles", "app"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CARGO_TARGET_DIR: resolve("src-tauri/target"),
      CARGO_BUILD_JOBS: String(jobs),
    },
  },
);
if(result.status===0)systemLibraries(resolve("src-tauri/target/release/amani-studio"));
process.exit(result.status ?? 1);
