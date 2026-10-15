import type { RunOptions } from './run.ts';
import type { ReplayOptions } from './replay.ts';
export function parseArgs(args: string[]): RunOptions {
  if (args.shift() !== 'run') throw new Error('usage: amani run --task DIR --out DIR [--mode pilot|card] [--cap-minutes N]');
  const flags = new Map<string, string>();
  while (args.length) {
    const key = args.shift()!, value = args.shift();
    if (!['--task', '--out', '--mode', '--cap-minutes'].includes(key) || !value || flags.has(key)) throw new Error(`invalid argument: ${key}`);
    flags.set(key, value);
  }
  const task = flags.get('--task'), out = flags.get('--out'), mode = flags.get('--mode');
  if (!task || !out) throw new Error('--task and --out are required');
  if (mode !== undefined && mode !== 'pilot' && mode !== 'card') throw new Error('mode must be pilot or card');
  return { task, out, ...(mode ? { mode } : {}), ...(flags.has('--cap-minutes') ? { capMinutes: Number(flags.get('--cap-minutes')) } : {}) };
}
export function parseReplayArgs(args: string[]): ReplayOptions {
  if (args.shift() !== 'replay') throw new Error('usage: amani replay --task DIR --attempt DIR --out FILE');
  const flags = new Map<string, string>();
  while (args.length) {
    const key = args.shift()!, value = args.shift();
    if (!['--task', '--attempt', '--out'].includes(key) || !value || value.startsWith('--') || flags.has(key)) throw new Error(`invalid argument: ${key}`);
    flags.set(key, value);
  }
  const task = flags.get('--task'), attempt = flags.get('--attempt'), out = flags.get('--out');
  if (!task || !attempt || !out) throw new Error('--task, --attempt and --out are required');
  return { task, attempt, out };
}
