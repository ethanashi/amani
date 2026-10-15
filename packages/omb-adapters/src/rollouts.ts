import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, writeSync } from 'node:fs';
import path from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';

/** Call only after process close and sandbox reaping: those prove the writers are gone.
 * Three identical inventories additionally detect late/unstable capture. Work is bounded
 * by reads, never by an assumed disk-flush duration. The hook injects exact read races. */
export async function settleRollouts(home: string, afterRead?: (read: number) => void | Promise<void>): Promise<boolean> {
  const root = path.join(home, 'sessions');
  const inventory = (dir: string, depth = 0): string[] => {
    if (depth > 64) throw new Error('rollout depth unavailable');
    return readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap(entry => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return inventory(file, depth + 1);
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return [];
      const st = lstatSync(file, { bigint: true });
      return [`${file}:${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`];
    });
  };
  let previous = '', stable = 0;
  for (let read = 0; read < 8; read++) {
    let current: string;
    try { current = JSON.stringify(inventory(root)); } catch { current = ''; }
    stable = current && current === previous ? stable + 1 : 1;
    previous = current;
    if (stable >= 3 && current) return true;
    await afterRead?.(read);
    await nextTurn();
  }
  return false;
}

/** Fixed-size reads; a tool's enormous response line cannot erase later metadata.
 * Raw history is hashed/copied separately from the bounded metadata parser. */
function scan(file: string, line: (text: string, first: boolean) => boolean, archive?: string): string {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output: number | undefined;
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1) throw new Error('unsafe rollout');
    if (archive) output = openSync(archive, 'wx', 0o400);
    const hash = createHash('sha256'), chunk = Buffer.alloc(65536);
    let pending: Buffer[] = [], size = 0, oversized = false, first = true, stopped = false;
    for (;;) {
      const n = readSync(fd, chunk); if (!n) break;
      const bytes = chunk.subarray(0, n); hash.update(bytes);
      if (output !== undefined) { let offset = 0; while (offset < n) offset += writeSync(output, bytes.subarray(offset)); }
      let start = 0;
      for (let i = 0; i <= n; i++) {
        if (i < n && bytes[i] !== 10) continue;
        const part = bytes.subarray(start, i); size += part.length;
        if (size > 1_000_000) { oversized = true; pending = []; }
        if (!oversized && part.length) pending.push(Buffer.from(part));
        if (i < n) {
          if (!line(oversized ? '' : Buffer.concat(pending).toString('utf8'), first)) { stopped = true; break; }
          first = false; pending = []; size = 0; oversized = false;
        }
        start = i + 1;
      }
      if (stopped) break;
    }
    if (!stopped && size) line(oversized ? '' : Buffer.concat(pending).toString('utf8'), first);
    const after = fstatSync(fd);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error('rollout changed during capture');
    return hash.digest('hex');
  } finally { closeSync(fd); if (output !== undefined) closeSync(output); }
}
export function hashRollout(file: string): string { return scan(file, () => true); }
export interface RolloutArchive { relative: string; file: string; sha256: string }
export function captureRollouts(home: string, sessionId: string | null, evidence: string): {
  streams: Record<string, string>; archives: RolloutArchive[]; warnings: string[];
} {
  const root = path.join(home, 'sessions'), streams: Record<string, string> = {}, archives: RolloutArchive[] = [], warnings: string[] = [];
  if (!sessionId) return { streams, archives, warnings };
  const walk = (dir: string, depth: number): void => {
    if (depth > 64) { warnings.push('rollout depth unavailable'); return; }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        try { walk(file, depth + 1); } catch { warnings.push(`rollout directory unavailable: ${entry.name}`); }
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      try {
        let firstLine = '';
        scan(file, text => { firstLine = text; return false; });
        let first: { type?: string; payload?: { id?: string } };
        try { first = JSON.parse(firstLine); } catch { continue; }
        if (first?.type !== 'session_meta' || first.payload?.id !== sessionId) continue;
        const relative = path.relative(root, file);
        const meta = JSON.stringify({ type: 'session_meta', payload: { id: sessionId } });
        streams[relative] = meta;
        if (!entry.name.endsWith(`-${sessionId}.jsonl`)) continue;
        const archive = path.join(evidence, `rollout-${archives.length}.jsonl`);
        const contexts = new Set<string>(); let count = '', invalidContext = false;
        const hash = scan(file, (text, isFirst) => {
          if (isFirst) return true;
          try {
            const e = JSON.parse(text);
            if (e?.type === 'turn_context') {
              const { model, effort } = e.payload ?? {};
              if (typeof model !== 'string' || typeof effort !== 'string' || model.length > 512 || effort.length > 512 || contexts.size >= 1024) invalidContext = true;
              else contexts.add(JSON.stringify({ type: e.type, payload: { model, effort } }));
            }
            if (e?.type === 'event_msg' && e.payload?.type === 'token_count') count = text;
          } catch { /* oversized/unrelated lines are not telemetry */ }
          return true;
        }, archive);
        if (invalidContext) warnings.push('rollout identity context unavailable or excessive');
        streams[relative] = [meta, ...contexts, count].join('\n');
        archives.push({ relative, file: archive, sha256: hash });
      } catch { warnings.push(`rollout capture unavailable: ${entry.name}`); }
    }
  };
  try { if (lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink()) walk(root, 0); } catch { warnings.push('rollout inventory unavailable'); }
  return { streams, archives, warnings };
}
