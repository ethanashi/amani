// Host-only exceptions. No protected plaintext belongs in this format or its diagnostics.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const categories = new Set(['identifier', 'dataset', 'level', 'column', 'chromosome', 'filename', 'case', 'url', 'redact']);
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const invalid = () => { throw new Error('invalid host leakage allowlist'); };

export function loadAllowlist(file, tree) {
  if (!file) return { sha256: null, entries: [] };
  const repository = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
  if (inside(repository, realpathSync(file))) invalid();
  if (!path.isAbsolute(file) || inside(realpathSync(tree), realpathSync(file)) || !lstatSync(file).isFile()) invalid();
  const raw = readFileSync(file);
  let entries;
  try { entries = JSON.parse(raw); } catch { invalid(); }
  if (!Array.isArray(entries)) invalid();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) invalid();
    const term = Object.hasOwn(entry, 'term_sha256');
    const fields = term ? ['term_sha256', 'category', 'cards', 'reason'] : ['path', 'file_sha256', 'category', 'reason'];
    if (Object.keys(entry).length !== fields.length || fields.some(k => !Object.hasOwn(entry, k))) invalid();
    if (!categories.has(entry.category) || typeof entry.reason !== 'string' || entry.reason.trim().length < 20) invalid();
    if (term) {
      if (!hash(entry.term_sha256) || !Array.isArray(entry.cards) || !entry.cards.length ||
          entry.cards.some(c => typeof c !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(c)) ||
          new Set(entry.cards).size !== entry.cards.length) invalid();
    } else {
      if (!hash(entry.file_sha256) || typeof entry.path !== 'string' || !entry.path ||
          entry.path.includes('\\') || path.posix.isAbsolute(entry.path) ||
          entry.path.split('/').some(p => !p || p === '.' || p === '..')) invalid();
    }
  }
  return { sha256: sha(raw), entries };
}

export function allowFinding(finding, allowlist, tree) {
  return allowlist.entries.some(entry => {
    if (entry.category !== finding.category || !hash(finding.term_sha256)) return false;
    if (entry.term_sha256) return entry.term_sha256 === finding.term_sha256 && entry.cards.includes(finding.card);
    if (entry.path !== finding.path) return false;
    const file = path.join(tree, entry.path);
    try {
      if (!lstatSync(file).isFile() || !inside(realpathSync(tree), realpathSync(file))) return false;
      const raw = readFileSync(file);
      // Byte coincidences may exempt binary data only, never a text document.
      let binary = raw.includes(0);
      try { new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { binary = true; }
      return binary && sha(raw) === entry.file_sha256;
    } catch { return false; }
  });
}
