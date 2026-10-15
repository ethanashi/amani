import { cpSync, mkdirSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// Copy installed, lockfile-resolved production dependencies and their licences.
// Copy named workspace dependencies from the already filtered release tree too.
// No package manager or network is needed at launch.
export function packageDependencies(repo, out, files) {
  const copied = new Map();
  const manifests = files.filter(f => /^packages\/[^/]+\/package.json$/.test(f));
  const workspaces = new Map(manifests.map(file => {
    const manifest = JSON.parse(readFileSync(path.join(repo, file), 'utf8'));
    return [manifest.name, path.dirname(file)];
  }));
  function copy(name, from) {
    const workspace = workspaces.get(name);
    const require = createRequire(path.join(from, 'package.json'));
    const source = workspace ? path.join(repo, workspace) : path.dirname(realpathSync(require.resolve(name + '/package.json')));
    if (copied.has(name)) {
      if (copied.get(name) !== source) throw Error(`conflicting release dependency: ${name}`);
      return;
    }
    copied.set(name, source);
    const target = path.join(out, 'node_modules', name);
    mkdirSync(path.dirname(target), { recursive: true });
    const releasedSource = workspace ? path.join(out, workspace) : source;
    if (!existsSync(releasedSource)) throw Error(`workspace missing from release: ${name}`);
    cpSync(releasedSource, target, { recursive: true, dereference: true, filter: p => !p.slice(releasedSource.length).split(path.sep).includes('node_modules') });
    const manifest = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) copy(dependency, source);
  }
  for (const file of manifests) {
    if (!existsSync(path.join(out, file))) continue;
    const manifest = JSON.parse(readFileSync(path.join(repo, file), 'utf8'));
    for (const name of Object.keys(manifest.dependencies ?? {})) copy(name, path.dirname(path.join(repo, file)));
  }
}
