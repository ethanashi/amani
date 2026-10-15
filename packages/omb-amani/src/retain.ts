import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Reviewed adaptation of keep-adapter-evidence.patch. No scratch/auth, keychains,
// resume receipts, sessions, or arbitrary worker filenames enter this export.
const EVIDENCE = ['events.jsonl', 'egress.jsonl', 'stderr.log', 'launch.json', 'worker.sb', 'probe.sb', 'config.toml', 'claude-settings.json', 'refusal.json'];
const plainDir = (p: string) => { try { const st = lstatSync(p); return st.isDirectory() && !st.isSymbolicLink(); } catch { return false; } };
function ensureDir(p: string): void { if (!existsSync(p)) mkdirSync(p, { mode: 0o700 }); if (!plainDir(p)) throw new Error('linked diagnostics directory'); }
export function retainAdapterEvidence(root: string, limits = { perFile: 8 << 20, total: 256 << 20 }) {
  if (![limits.perFile, limits.total].every(n => Number.isSafeInteger(n) && n >= 128)) throw new Error('invalid evidence limits');
  const diagnostics = path.join(root, 'diagnostics'); ensureDir(diagnostics);
  const destRoot = path.join(diagnostics, 'adapters'); ensureDir(destRoot);
  const summary = { files: 0, bytes: 0, truncated: 0, skipped: 0 };
  // Recount existing evidence: the outer cleanup must share the engine's budget.
  const count = (dir: string): void => { for (const n of readdirSync(dir)) { const f = path.join(dir, n), st = lstatSync(f); if (st.isSymbolicLink() || st.nlink > 1 && st.isFile()) throw new Error('linked retained evidence'); if (st.isDirectory()) count(f); else if (st.isFile()) { summary.files++; summary.bytes += st.size; } } };
  count(destRoot);
  const prior = path.join(diagnostics, 'adapters.json');
  if (existsSync(prior) && lstatSync(prior).isFile() && lstatSync(prior).nlink === 1) { try { summary.truncated = JSON.parse(readFileSync(prior, 'utf8')).truncated ?? 0; } catch { /* rebuild counts */ } }
  for (const family of ['codex', 'claude']) {
    const adapterRoot = path.join(root, 'adapters'), state = path.join(adapterRoot, `${family}-state`), runs = path.join(state, 'runs');
    if (![adapterRoot, state, runs].every(plainDir)) continue;
    for (const id of readdirSync(runs).filter(n => /^[0-9a-f-]{36}$/.test(n)).sort()) {
      const turn = path.join(runs, id);
      if (!plainDir(turn)) { summary.skipped++; continue; }
      for (const name of EVIDENCE) {
        const src = path.join(turn, name), dest = path.join(destRoot, family, id, name);
        let fd: number | undefined;
        try {
          const st = lstatSync(src);
          if (!st.isFile() || st.nlink !== 1) { summary.skipped++; continue; }
          const budget = Math.min(limits.perFile, limits.total - summary.bytes);
          if (existsSync(dest)) continue;
          if (budget < 128) { summary.skipped++; continue; }
          fd = openSync(src, constants.O_RDONLY | constants.O_NOFOLLOW);
          const opened = fstatSync(fd);
          if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== st.ino || opened.dev !== st.dev) { summary.skipped++; continue; }
          const truncated = opened.size > budget;
          const marker = truncated ? Buffer.from('\n[amani: middle bytes omitted]\n') : Buffer.alloc(0);
          const take = Math.min(opened.size, budget - marker.length), head = truncated ? Math.floor(take / 2) : take;
          const buf = Buffer.alloc(take);
          if (readSync(fd, buf, 0, head, 0) !== head || take > head && readSync(fd, buf, head, take - head, opened.size - (take - head)) !== take - head) throw new Error('evidence changed during copy');
          const body = Buffer.concat([buf.subarray(0, head), marker, buf.subarray(head)]);
          ensureDir(path.join(destRoot, family)); ensureDir(path.join(destRoot, family, id));
          writeFileSync(dest, body, { mode: 0o600, flag: 'wx' });
          summary.files++; summary.bytes += body.length; if (truncated) summary.truncated++;
        } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') summary.skipped++; }
        finally { if (fd !== undefined) closeSync(fd); }
      }
    }
  }
  // Do not follow an attacker-supplied summary path either.
  const summaryFile = path.join(diagnostics, 'adapters.json');
  const fd = openSync(summaryFile, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try { if (fstatSync(fd).nlink !== 1) throw new Error('linked evidence summary'); }
  finally { closeSync(fd); }
  // Atomic replacement also makes a second cleanup safe after an interrupted first one.
  // Summary size is metadata, excluded from the evidence-byte budget.
  const tmp = path.join(diagnostics, 'adapters.json.tmp');
  writeFileSync(tmp, JSON.stringify(summary) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(tmp, summaryFile);
  return summary;
}
