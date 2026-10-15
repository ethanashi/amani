import { excludesMedicRuntime, releaseSource } from '../../../packages/omb-amani/scripts/medic-release-policy.mjs';
import { packageDependencies } from '../../../packages/omb-amani/scripts/package-dependencies.mjs';
import { packageCodecRuntime } from '../../../packages/omb-amani/scripts/package-codec-runtime.mjs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  copyFileSync,
  writeFileSync,
  realpathSync,
  rmSync,
  cpSync,
  readFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function packageEngine({root=path.resolve(appRoot,'../..'),target=path.join(appRoot,'src-tauri/resources/engine'),codecRuntime}={}) {
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const name of ["bridge.mjs", "daemon.mjs", "protocol.mjs"])
  copyFileSync(path.join(appRoot,"engine", name), path.join(target, name));
const files = execFileSync("git", ["ls-files", "packages"], {
  cwd: root,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(
    (f) =>
      /\/src\/|\/vendor\/|^packages\/[^/]+\/(?:[^/]+\.json|LICENSE|NOTICE)$/.test(f) &&
      !f.includes("/test/") && !excludesMedicRuntime(f) &&
      !f.endsWith("BUILD-NOTES.md"),
  );
for (const f of files) {
  const dst = path.join(target, "repo", f);
  mkdirSync(path.dirname(dst), { recursive: true });
  if(/\.(?:ts|js|mjs|json)$/.test(f))writeFileSync(dst,releaseSource(f,readFileSync(path.join(root,f),'utf8')));
  else copyFileSync(path.join(root, f), dst);
}
// Preserve the first-party grants and consolidated dependency attribution in the app.
for (const name of ['LICENSE', 'NOTICE', 'docs/third-party-licenses.md']) {
  if (!existsSync(path.join(root, name))) continue;
  const dest = path.join(target, 'repo', name);
  mkdirSync(path.dirname(dest), { recursive: true }); copyFileSync(path.join(root, name), dest);
}
const releaseCli=path.join(target,'repo/packages/omb-amani/src/release-cli.ts');
packageDependencies(root,path.join(target,'repo'),files);
packageCodecRuntime(root,path.join(target,'repo'),codecRuntime);
if(existsSync(releaseCli))copyFileSync(releaseCli,path.join(target,'repo/packages/omb-amani/src/cli.ts'));
writeFileSync(
  path.join(target, "repo/package.json"),
  JSON.stringify({ type: "module" }),
);
const analysisRuntime = realpathSync(
  process.env.AMANI_ANALYSIS_RUNTIME ?? path.join(root, "packages/bio-baseline/.pixi/envs/default"),
);
mkdirSync(path.join(target,"repo/packages/bio-baseline"),{recursive:true});
writeFileSync(
  path.join(target, "repo/packages/bio-baseline/runtime-location.json"),
  JSON.stringify({ analysisRuntime }),
);
// Local release uses the owner's separately installed analysis environment; never bundle R/GPL tooling.
console.log(
  `Packaged ${files.length} engine source/assets; analysis runtime: ${analysisRuntime}`,
);

const pinFile=path.join(target,'repo/packages/omb-adapters/opencode-pin.json');
const pin=JSON.parse(readFileSync(pinFile,'utf8'));
const executable=realpathSync(process.env.AMANI_OPENCODE_RUNTIME ?? path.join(root,pin.path));

if(createHash('sha256').update(readFileSync(executable)).digest('hex')!==pin.sha256)throw Error('OpenCode runtime hash differs from engine pin');
pin.path=executable;writeFileSync(pinFile,JSON.stringify(pin,null,2));
console.log('Pinned external OpenCode runtime:',executable);

return {target,files};
}
if(process.argv[1]===fileURLToPath(import.meta.url))packageEngine({root:process.argv[2]&&path.resolve(process.argv[2]),target:process.argv[3]&&path.resolve(process.argv[3])});
