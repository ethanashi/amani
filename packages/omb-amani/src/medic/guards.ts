import { CHECKPOINT_ADAPTER, assertRepairAPI, inspectRegression } from './repair-api.ts';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Narrow positive list. All scientific/control code is protected by default, including
 * this policy, engine orchestration, phase machine, ledger and the outcome classifier. */
export const PLUMBING_PATHS = ['packages/omb-amani/src/transport/'] as const;
export function allowedPath(file: string): boolean {
  if (!/^[A-Za-z0-9._/-]+$/.test(file) || file.split('/').some(x => !x || x === '.' || x === '..')) return false;
  return file === CHECKPOINT_ADAPTER || /^packages\/omb-amani\/test\/medic-regression-[a-z0-9-]+\.test\.ts$/.test(file);
}
export interface PatchFile { file: string; status: string; diff: string }
export function inspectPatch(files: readonly PatchFile[]): string[] {
  const issues: string[] = [];
  if (!files.length) issues.push('empty patch');
  if (!files.some(f => f.status === 'A' && /\/test\/medic-regression-.*\.test\.ts$/.test(f.file))) issues.push('new regression test required');
  for (const f of files) {
    if (!allowedPath(f.file)) issues.push(`protected path: ${f.file}`);
    if (!['A', 'M'].includes(f.status)) issues.push(`delete/rename/type change refused: ${f.file}`);
    const removed = f.diff.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')).map(l => l.slice(1));
    const added = f.diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).join('\n');
    if (/\/test\//.test(f.file) && f.status !== 'A') issues.push(`existing tests are immutable: ${f.file}`);
    // Conservative: changes to checks, error branches, thresholds or imports need normal review.
    if (removed.some(l => /\b(?:if|else|throw|assert|expect|require|check|verify|validate|limit|threshold|timeout|max|min|import|export)\b|[<>!=]=|\d/.test(l))) issues.push(`check or threshold removal refused: ${f.file}`);
    if (/\b(?:skip|todo|only)\s*\(|@ts-(?:ignore|nocheck)|eslint-disable|process\.env|child_process|eval\s*\(|Function\s*\(|import\s*\(/.test(added)) issues.push(`bypass or dynamic execution refused: ${f.file}`);
  }
  return issues;
}
export function git(repo: string, args: string[]): string { return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }); }
/** Include staged, unstaged and untracked edits. Never trust the agent's commit or file list. */
export function collectPatch(repo: string, base: string): { diff: string; files: PatchFile[]; issues: string[] } {
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('full base commit required');
  const untracked = git(repo, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const tracked = git(repo, ['diff', '--no-renames', '--name-status', base, '-z']).split('\0').filter(Boolean);
  const files: PatchFile[] = [], issues: string[] = [];
  for (let i = 0; i < tracked.length; i += 2) {
    const status = tracked[i]!, file = tracked[i + 1]!;
    const diff = git(repo, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3', base, '--', file]);
    files.push({ file, status, diff });
  }
  for (const file of untracked) issues.push(`untracked file must be staged for inspection: ${file}`);
  for (const f of files) {
    if (f.status === 'D') continue;
    const parts = f.file.split('/');let linked=false;
    for (let i = 1; i <= parts.length; i++) {
      const s = lstatSync(path.join(repo, ...parts.slice(0, i)));
      if (s.isSymbolicLink() || i === parts.length && (!s.isFile() || s.nlink !== 1)) { issues.push(`nonregular or linked patch path: ${f.file}`);linked=true;break; }
    }
    if(linked)continue;
    if (f.file === CHECKPOINT_ADAPTER) { try { assertRepairAPI(readFileSync(path.join(repo,f.file),'utf8')); } catch(e) { issues.push(String(e)); } }
    else if (/\/test\//.test(f.file) && f.status === 'A') issues.push(...inspectRegression(readFileSync(path.join(repo,f.file),'utf8')));
    if (/^(?:new|old) mode|^new file mode (?!100644)/m.test(f.diff)) issues.push(`file mode change refused: ${f.file}`);
  }
  return { diff: files.map(f => f.diff).join(''), files, issues: [...issues, ...inspectPatch(files)] };
}
