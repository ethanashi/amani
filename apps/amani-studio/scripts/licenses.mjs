import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  realpathSync,
  mkdirSync,
} from "node:fs";
import { dirname, resolve, join } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const visited = new Map();
function locate(req, name) {
  try {
    return req.resolve(name + "/package.json");
  } catch {
    let p;
    try {
      p = dirname(req.resolve(name));
    } catch {
      return null;
    }
    while (p !== dirname(p)) {
      if (existsSync(join(p, "package.json"))) {
        const f = join(p, "package.json");
        try {
          if (JSON.parse(readFileSync(f, "utf8")).name === name) return f;
        } catch {}
      }
      p = dirname(p);
    }
    return null;
  }
}
function walk(file, kind = "runtime") {
  file = realpathSync(file);
  if (visited.has(file)) return;
  const p = JSON.parse(readFileSync(file, "utf8"));
  const dir = dirname(file);
  visited.set(file, {
    name: p.name,
    version: p.version,
    license:
      typeof p.license === "string"
        ? p.license
        : JSON.stringify(p.license ?? p.licenses ?? "UNDECLARED"),
    kind,
    dir,
  });
  const req = createRequire(file);
  for (const name of Object.keys({
    ...p.dependencies,
    ...p.optionalDependencies,
  })) {
    const f = locate(req, name);
    if (f) walk(f, kind);
  }
}
const app = JSON.parse(readFileSync("package.json", "utf8"));
const req = createRequire(resolve("package.json"));
for (const name of Object.keys(app.dependencies)) {
  const f = locate(req, name);
  if (f) walk(f);
}
for (const name of Object.keys(app.devDependencies)) {
  const f = locate(req, name);
  if (f) walk(f, "build/test");
}
const records = [...visited.values()].sort((a, b) =>
  a.name.localeCompare(b.name),
);
let output =
  "Amani Studio 0.1.0 — third-party licences\n\nSource licence: MIT\nNo GPL-only dependency is accepted. MPL-2.0 build/test tooling is recorded separately; the requested strict allowlist exception is pending owner decision. For dual-licensed dependencies, use the permissive option shown. Platform-inapplicable Cargo packages are excluded. Node includes additional permissive Unicode/OpenSSL/zlib notices; these are preserved in full below.\n\nJAVASCRIPT DEPENDENCIES\n" +
  records
    .map((r) => `${r.name}@${r.version} | ${r.license} | ${r.kind}`)
    .join("\n") +
  "\n";
let rust = [];
if (process.argv.includes("--rust")) {
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--locked",
        "--offline",
        "--format-version",
        "1",
        "--filter-platform",
        "aarch64-apple-darwin",
      ],
      {
        cwd: "src-tauri",
        encoding: "utf8",
        maxBuffer: 30 * 1024 * 1024,
        env: { ...process.env, CARGO_TARGET_DIR: resolve("src-tauri/target") },
      },
    ),
  );
  const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  const active = new Set();
  function visit(id) {
    if (active.has(id)) return;
    active.add(id);
    for (const d of nodes.get(id)?.deps ?? []) visit(d.pkg);
  }
  visit(metadata.resolve.root);
  const runtimeTree = execFileSync(
    "cargo",
    [
      "tree",
      "--locked",
      "--offline",
      "--edges",
      "normal,no-proc-macro",
      "--prefix",
      "none",
      "--format",
      "{p}",
      "--target",
      "aarch64-apple-darwin",
    ],
    {
      cwd: "src-tauri",
      encoding: "utf8",
      env: { ...process.env, CARGO_TARGET_DIR: resolve("src-tauri/target") },
    },
  );
  const runtime = new Set(
    runtimeTree
      .split("\n")
      .map((line) => line.split(" ").slice(0, 2).join(" ")),
  );
  rust = metadata.packages
    .filter((p) => active.has(p.id))
    .map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license ?? "UNDECLARED",
      dir: dirname(p.manifest_path),
      kind: runtime.has(`${p.name} v${p.version}`) ? "runtime" : "build/test",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  output +=
    "\nRUST DEPENDENCIES (macOS graph, includes build scripts)\n" +
    rust
      .map((r) => `${r.name}@${r.version} | ${r.license} | ${r.kind}`)
      .join("\n") +
    "\n";
}
for (const r of [...records, ...rust]) {
  const license = r.license;
  if (
    r.kind === "runtime" &&
    /MPL|GPL/.test(license) &&
    !/MIT|Apache|BSD|ISC/.test(license)
  )
    throw Error(`Nonpermissive runtime dependency: ${r.name} ${license}`);
  if (
    !/(MIT|Apache|BSD|ISC|CC0|Unicode|Zlib|Unlicense|BSL|OpenSSL|MPL|CC-BY)/i.test(
      license,
    )
  )
    throw Error(`Review licence: ${r.name} ${license}`);
  output += `\n\n======== ${r.name}@${r.version} (${r.license}) ========\n`;
  for (const file of readdirSync(r.dir).filter((n) =>
    /^(licen[cs]e|copying|notice)([._-]|$)/i.test(n),
  )) {
    try {
      output += readFileSync(join(r.dir, file), "utf8") + "\n";
    } catch {}
  }
}
output +=
  "\n\n======== Bundled Node 24: complete notices ========\n" +
  readFileSync("Node-LICENSE.txt", "utf8");
writeFileSync("THIRD-PARTY-LICENSES.txt", output);
mkdirSync("public", { recursive: true });
writeFileSync("public/THIRD-PARTY-LICENSES.txt", output);
writeFileSync(
  "dependency-licenses.json",
  JSON.stringify(
    [...records, ...rust].map(({ dir, ...r }) => r),
    null,
    2,
  ),
);
console.log(
  `${records.length} JavaScript, ${rust.length} Rust packages recorded; ${output.length} notice characters`,
);
