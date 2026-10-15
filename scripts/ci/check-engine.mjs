import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [repo, out] = process.argv.slice(2);
const policy = await import(pathToFileURL(path.join(repo, 'packages/omb-amani/scripts/medic-release-policy.mjs')));
function walk(dir, rel='') {
  for (const e of readdirSync(dir, {withFileTypes:true})) {
    const p = path.join(rel, e.name), full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full,p);
    else {
      // cli.ts is deliberately replaced by the release entry; all repair files are forbidden.
      if (p !== 'packages/omb-amani/src/cli.ts' && policy.excludesMedicRuntime(p)) throw Error(`repair runtime in release: ${p}`);
      if (/\.(ts|mjs|js)$/.test(p) && /(?:from\s*|import\s*\()['"][^'"]*\/medic\//.test(readFileSync(full,'utf8'))) throw Error(`repair import in release: ${p}`);
    }
  }
}
walk(out); console.log('zero medic repair-runtime files or imports');
