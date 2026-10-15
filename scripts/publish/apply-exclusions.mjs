#!/usr/bin/env node
// Remove the paths listed in an exclusion file from a staged tree.
//   node apply-exclusions.mjs TREE EXCLUDE_FILE
// Prints one line per removed path and a final count. Never touches anything outside TREE.
import { globSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const [tree, listFile] = process.argv.slice(2);
if (!tree || !listFile) {
  process.stderr.write('usage: apply-exclusions.mjs TREE EXCLUDE_FILE\n');
  process.exit(2);
}
const root = path.resolve(tree);
const patterns = readFileSync(listFile, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
// Keep the requested directory through broad removals. Descendant matches still
// obey their own exclusions (credentials, local state, reports, and so on).
const keeps = patterns.filter(p => p.startsWith('!')).map(p => p.slice(1));
let removed = 0;
for (const pattern of patterns.filter(p => !p.startsWith('!'))) {
  for (const hit of globSync(pattern, { cwd: root })) {
    if (keeps.some(k => hit === k || k.startsWith(hit + '/'))) continue;
    const abs = path.resolve(root, hit);
    if (abs === root || !abs.startsWith(root + path.sep)) continue;
    rmSync(abs, { recursive: true, force: true });
    process.stdout.write(`excluded ${hit}\n`);
    removed += 1;
  }
}
process.stdout.write(`${removed} path(s) excluded\n`);
