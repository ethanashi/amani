import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
/** Record a host-owned codec environment; never copy its interpreter or dependencies. */
export function packageCodecRuntime(repo, out, runtime = process.env.AMANI_CODEC_RUNTIME ?? path.join(repo, 'packages/omb-investigate/format-runtime/.pixi/envs/default')) {
  const source = path.join(repo, 'packages/omb-investigate/format-runtime');
  runtime = realpathSync(runtime);
  if (!runtime.endsWith(path.join('.pixi', 'envs', 'default'))) throw Error('Codec runtime must be a pinned .pixi/envs/default environment');
  const installed = path.resolve(runtime, '../../..'), python = path.join(runtime, 'bin/python');
  const pins = {};
  for (const [file, field] of [['pixi.lock', 'lockSha256'], ['pixi.toml', 'manifestSha256']]) {
    pins[field] = sha(path.join(source, file));
    if (sha(path.join(installed, file)) !== pins[field]) throw Error('Codec runtime pins differ from release source');
  }
  if (!statSync(python).isFile() || !(statSync(python).mode & 0o111) || !realpathSync(python).startsWith(runtime + path.sep)) throw Error('Codec Python must be executable inside the pinned environment');
  const target = path.join(out, 'packages/omb-investigate/format-runtime');
  mkdirSync(target, { recursive: true });
  for (const file of ['pixi.lock', 'pixi.toml', 'LICENSES.md']) copyFileSync(path.join(source, file), path.join(target, file));
  const location = { schema: 'omb-investigate/codec-runtime@1', codecRuntime: runtime, ...pins, pythonSha256: sha(python) };
  writeFileSync(path.join(target, 'runtime-location.json'), JSON.stringify(location, null, 2) + '\n');
  return location;
}
