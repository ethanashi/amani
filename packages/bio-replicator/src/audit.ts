import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { contains, nonempty, record } from './files.ts';

export interface TranscriptScope {
  workspace: string;
  stagedData: string;
  toolchainRoots: string[];
  forbiddenPaths: string[];
}

/** Literal-path audit, NOT an OS read barrier or a shell/interpreter verifier.
 * JSONL cannot reveal reads hidden inside programs; see BUILD-NOTES before deploying.
 * Unknown tools remain rejected by the protocol parser, even after a clean audit.
 */
export function auditTranscript(stdout: string, scope: TranscriptScope): string | null {
  const allowed = [scope.workspace, scope.stagedData, ...scope.toolchainRoots];
  const spellings = (file: string): string[] => {
    const absolute = path.resolve(file);
    // Resolve the nearest existing ancestor too: newly-created files can sit behind a symlink.
    let ancestor = absolute;
    while (!existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
    return [absolute, path.resolve(realpathSync.native(ancestor), path.relative(ancestor, absolute))];
  };
  const denied = scope.forbiddenPaths.flatMap(spellings);
  const grants = allowed.flatMap(spellings);
  const permitted = (file: string, cwd: string): boolean => {
    if (!nonempty(file) || /[\p{Cc}\p{Cf}]/u.test(file) || /[~$`*?{}]/.test(file)) return false;
    return spellings(path.resolve(cwd, file)).every(target =>
      !denied.some(root => contains(root, target)) && grants.some(root => contains(root, target)));
  };
  for (const line of stdout.split(/\r?\n/).filter(line => line.trim())) {
    const event: unknown = JSON.parse(line);
    if (!record(event) || !record(event.item)) continue;
    const item = event.item;
    if (['agent_message', 'reasoning', 'todo_list'].includes(String(item.type))) continue;
    const cwd = typeof item.cwd === 'string' ? item.cwd : scope.workspace;
    if (!permitted(cwd, scope.workspace)) return 'transcript contains an outside working directory';
    if (item.type === 'command_execution') {
      if (!nonempty(item.command)) return 'transcript command audit unavailable';
      // Expansion, directory changes, escapes and control characters defeat literal interpretation.
      // Shell quoting and string newlines occur in ordinary CLI command events. Remove
      // only those escapes; obfuscated paths (e.g. /et\\c) still fail closed.
      const command = item.command.replace(/\\['"nt]/g, ' ');
      if (/[~$`\\]|\b(?:cd|pushd|popd|eval|source)\b|[\p{Cf}]/u.test(command)) {
        return 'transcript contains an unauditable command';
      }
      // Inspect paths embedded in shell strings, interpreter snippets, assignments and redirects.
      const tokens = command.match(/(?:\/|\.\.\/|\.\/)?[\p{L}\p{N}_.@+%/-]+/gu) ?? [];
      for (const token of tokens) {
        if ((token.includes('/') || existsSync(path.resolve(cwd, token))) && !permitted(token, cwd)) {
          return 'transcript command touches a path outside staged data/work or toolchain';
        }
      }
    }
    const inspectPaths = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.every(inspectPaths);
      if (!record(value)) return true;
      return Object.entries(value).every(([key, child]) => {
        if (/^(?:path|file|file_path|filepath|cwd|working_directory)$/.test(key)) {
          return typeof child === 'string' && permitted(child, cwd);
        }
        return typeof child !== 'object' || inspectPaths(child);
      });
    };
    if (!inspectPaths(item)) return 'transcript file access touches a forbidden or outside path';
  }
  return null;
}
