import type { SandboxBackend } from './contracts.ts';
import path from 'node:path';
import { homedir } from 'node:os';
/** Adapted from bio-baseline/arms/lib/armlib.py sandbox_profile. Last matching
 * Seatbelt rule wins. Read policy matches B: deny sensitive roots, allow own scope back. */
export function seatbeltProfile(input: {
  writeRoots: string[]; readRoots: string[]; readFiles: string[];
  protectedPaths: string[]; deniedPaths: string[]; proxyPort: number;
}): string {
  if (!Number.isInteger(input.proxyPort) || input.proxyPort < 1 || input.proxyPort > 65535) throw new Error('invalid proxy port');
  const quote = (p: string): string => { if (!path.isAbsolute(p) || /[\n\r\0]/.test(p)) throw new Error('invalid sandbox path'); return JSON.stringify(p); };
  const ancestors = new Set<string>();
  for (const p of [...input.writeRoots, ...input.readRoots, ...input.readFiles]) {
    let parent = path.dirname(p);
    for (;;) { ancestors.add(parent); if (parent === path.dirname(parent)) break; parent = path.dirname(parent); }
  }
  return ['(version 1)', '(allow default)',
    ...[homedir(), '/private/var/tmp/bb', '/private/var/tmp/biobase-arms', '/private/tmp', '/private/var/folders', '/var/folders', '/Volumes', '/Users/Shared'].map(p => `(deny file-read* file-read-metadata (subpath ${quote(p)}))`),
    ...[...input.writeRoots, ...input.readRoots].map(p => `(allow file-read* file-read-metadata (subpath ${quote(p)}))`),
    ...[...ancestors].map(p => `(allow file-read-metadata (literal ${quote(p)}))`),
    ...input.readFiles.map(p => `(allow file-read* file-read-metadata (literal ${quote(p)}))`),
    '(deny file-write*)',
    ...input.writeRoots.map(p => `(allow file-write* (subpath ${quote(p)}))`),
    '(allow file-write* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper") (regex #"^/dev/fd/") (regex #"^/dev/ttys"))',
    ...input.protectedPaths.map(p => `(deny file-write* (subpath ${quote(p)}))`),
    ...input.deniedPaths.map(p => `(deny file-read* file-read-metadata file-write* (subpath ${quote(p)}))`),
    '(deny network*)',
    `(allow network-outbound (remote ip "localhost:${input.proxyPort}"))`, ''].join('\n');
}
export class SeatbeltBackend implements SandboxBackend {
  readonly name = 'darwin-seatbelt';
  wrap(profilePath: string, launch: import('./contracts.ts').Launch): import('./contracts.ts').Launch {
    if (process.platform !== 'darwin') throw new Error('Seatbelt unavailable; no unsandboxed fallback');
    return { ...launch, command: '/usr/bin/sandbox-exec', args: ['-f', profilePath, launch.command, ...launch.args] };
  }
}
