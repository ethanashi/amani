import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
/** Only host-authored release metadata may relocate the pinned codec runtime. */
export function codecPython(root = fileURLToPath(new URL('../format-runtime/', import.meta.url))): string {
  const file = path.join(root, 'runtime-location.json');
  if (!existsSync(file)) return path.join(root, '.pixi/envs/default/bin/python');
  const location: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!location || typeof location !== 'object' || Array.isArray(location)) throw Error('Invalid packaged codec runtime metadata');
  const value = location as Record<string, unknown>;
  const fields = ['schema', 'codecRuntime', 'lockSha256', 'manifestSha256', 'pythonSha256'];
  if (Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key)) ||
      value.schema !== 'omb-investigate/codec-runtime@1' || typeof value.codecRuntime !== 'string' ||
      !path.isAbsolute(value.codecRuntime) || !value.codecRuntime.endsWith(path.join('.pixi', 'envs', 'default')) ||
      ['lockSha256', 'manifestSha256', 'pythonSha256'].some(key => typeof value[key] !== 'string' || !/^[a-f0-9]{64}$/.test(value[key] as string))) throw Error('Invalid packaged codec runtime metadata');
  const runtime = realpathSync(value.codecRuntime), installed = path.resolve(runtime, '../../..');
  if (runtime !== value.codecRuntime || !runtime.endsWith(path.join('.pixi', 'envs', 'default'))) throw Error('Packaged codec runtime location changed');
  for (const [pin, field] of [['pixi.lock', 'lockSha256'], ['pixi.toml', 'manifestSha256']] as const) {
    if (sha(path.join(root, pin)) !== value[field] || sha(path.join(installed, pin)) !== value[field]) throw Error('Packaged codec runtime pins changed');
  }
  const python = path.join(runtime, 'bin/python');
  if (!statSync(python).isFile() || !(statSync(python).mode & 0o111) || !realpathSync(python).startsWith(runtime + path.sep) || sha(python) !== value.pythonSha256) throw Error('Packaged codec Python changed');
  return python;
}
