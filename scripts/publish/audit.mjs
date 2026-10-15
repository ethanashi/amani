#!/usr/bin/env node
// Pre-publication audit for an exported Amani tree. Node 24, no dependencies.
//
//   node scripts/publish/audit.mjs TREE [--json FILE] [--rename-debt FILE]
//
// Fails (exit 1) when the tree contains secrets, personal email addresses, absolute home paths,
// names of the owner's other private projects, files over 5 MB, third_party/ files without a
// licence file, or sealed-benchmark leakage found by the repository's own scanner.
//
// Matched secret values are never printed: findings carry the category, a rule name, the file
// and the line number only. Rename-debt matches ("Omerta Bio", omerta-bio, omb-*) are
// informational: they are counted and optionally listed, but they do not fail the audit.
//
// Optional sealed-leakage hook. Set AMANI_LEAK_CARDS to a path-delimited (":") list of host-held
// card directories, plus BIO_GRADING_ROOT and BIO_SEALING_KEY as the scanner requires (and
// AMANI_LEAK_SCANNER if the staged tree has no pixi environment). The audit then runs `oneshot.sh scan CARD TREE` for each card (the scanner loads its protected tokens
// itself) and reports only counts and paths. Without it, the audit reports the hook as not run.

import { createHash } from 'node:crypto';
import { loadAllowlist, allowFinding } from './leak-allow.mjs';
import upstreamNotices from './upstream-notices.json' with { type: 'json' };
import { spawnSync } from 'node:child_process';
import { lstatSync, openSync, closeSync, readSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 5 * 1024 * 1024;
const j = (...parts) => parts.join('');

// Patterns are assembled from fragments so that this file does not match its own rules.
const SECRET_RULES = [
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai-key', /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/],
  ['openrouter-key', /\bsk-or-v1-[A-Za-z0-9]{20,}/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['private-key-block', new RegExp(j('-----BEGIN ', '(?:[A-Z]+ )?PRIVATE KEY', '-----'))],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['cloudflare-token-assignment', /\b(?:CLOUDFLARE|CF)_(?:API_)?(?:TOKEN|KEY)\s*[=:]\s*['"]?[A-Za-z0-9_-]{30,}/],
  ['bearer-token', /\bAuthorization:\s*Bearer\s+[A-Za-z0-9._~+/-]{24,}/i],
  ['generic-secret-assignment', /\b(?:api[_-]?key|secret|token|passwd|password)\b['"]?\s*[:=]\s*['"][A-Za-z0-9/+_=-]{24,}['"]/i],
];
const SECRET_FILE_NAMES = [/^sealed-(?:audit\.env|leak-allow\.json)$/i, /^\.env(?:\..*)?$/i, /\.pem$/i, /^id_(?:rsa|dsa|ecdsa|ed25519)$/, /\.p12$/i, /\.pfx$/i, /^\.npmrc$/, /^\.netrc$/];

const EMAIL_RULE = new RegExp(`[A-Za-z0-9._%+-]+@(?:${j('rocket', 'mail')}|${j('g', 'mail')})\\.com`, 'i');
const HOME_RULE = /\/Users\/(?!Shared(?:\/|[\'"`\s,;\]]|$))[A-Za-z0-9._-]+/;

// Names of the owner's other private projects. The one that is also an ordinary English word is
// matched case-sensitively and not when followed by "state"; the rest are case-insensitive.
const PROJECT_RULES = [
  // Capitalised prose use of the parent project's name. Lowercase identifiers (arm ids, directory
  // names) and the old product name ("Omerta Bio", omerta-bio) are rename debt, reported separately.
  [j('Ome', 'rta', '-project'), new RegExp(`\\b${j('Ome', 'rta')}\\b(?![ -]?[Bb]io)`)],
  [j('Ny', 'x'), new RegExp(`\\b${j('Ny', 'x')}\\b|\\.${j('ny', 'x')}\\b`)],
  [j('Solana', 'V2'), new RegExp(j('solana', '[-_ ]?', 'v2'), 'i')],
  [j('solana', '-pipeline'), new RegExp(j('solana', '[-_ ]pipeline'), 'i')],
  [j('Lot', 'Sniper'), new RegExp(j('lot', '[-_ ]?', 'sniper'), 'i')],
  [j('Caring', ' Grove'), new RegExp(j('caring', '[-_ ]?', 'grove'), 'i')],
  [j('Candy', ' Corn'), new RegExp(j('candy', '[-_ ]?', 'corn'), 'i')],
  [j('Stea', 'dy'), new RegExp(j('\\bStea', 'dy\\b(?![- ]state)'))],
  [j('Liquor', ' Express'), new RegExp(j('liquor', '[-_ ]?', 'express'), 'i')],
  [j('Magic', ' City Chairs'), new RegExp(j('magic', '[-_ ]?', 'city', '[-_ ]?', 'chairs'), 'i')],
  [j('FBM', ' Sniper'), new RegExp(j('fbm', '[-_ ]?', 'sniper'), 'i')],
  [j('sync', 'plane'), new RegExp(j('sync', 'plane'), 'i')],
];

// Informational: the pre-rename product name and the omb-* prefixes.
const RENAME_RULES = [
  ['omerta-bio', new RegExp(j('ome', 'rta'), 'i')],
  ['omb', /(?<![A-Za-z0-9])(?:omb|OMB)(?:[-_.]|(?![A-Za-z0-9]))|_omb(?![a-z])/],
];

function isBinary(file, size) {
  if (size === 0) return false;
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(8192, size));
    readSync(fd, buf, 0, buf.length, 0);
    return buf.includes(0);
  } finally {
    closeSync(fd);
  }
}

function* walk(root, rel = '') {
  for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (entry.name === '.git' && rel === '') continue;
    const r = path.join(rel, entry.name);
    if (entry.isDirectory()) yield* walk(root, r);
    else yield r;
  }
}

export function auditTree(root, env = process.env) {
  let allowHash;
  if (env.AMANI_LEAK_ALLOW) {
    try { allowHash = createHash('sha256').update(readFileSync(env.AMANI_LEAK_ALLOW)).digest('hex'); } catch { /* hook fails closed */ }
  }
  const findings = [];
  const rename = new Map(); // file -> Map(term -> line[])
  const add = (category, rule, file, line) => findings.push({ category, rule, file, ...(line ? { line } : {}) });
  const files = [...walk(root)].sort();
  const thirdPartyDirs = new Set();
  for (const f of files) if (f.startsWith('third_party/')) thirdPartyDirs.add(path.dirname(f));

  for (const rel of files) {
    const abs = path.join(root, rel);
    const st = lstatSync(abs);
    const base = path.basename(rel);
    if (st.size > MAX_BYTES) add('large-file', `${(st.size / 1048576).toFixed(1)} MB`, rel);
    if (SECRET_FILE_NAMES.some(re => re.test(base))) add('secret', 'secret-file-name', rel);
    if (st.isSymbolicLink()) continue;
    if (allowHash && st.isFile() && createHash('sha256').update(readFileSync(abs)).digest('hex') === allowHash)
      add('secret', 'host-leakage-allowlist', rel);
    if (isBinary(abs, st.size)) continue;
    if (st.size > 64 * 1048576) continue;
    const raw = readFileSync(abs);
    const upstreamNotice = upstreamNotices[rel] === createHash('sha256').update(raw).digest('hex');
    const lines = raw.toString('utf8').split('\n');
    lines.forEach((text, i) => {
      const line = i + 1;
      if (text.length > 20000) return; // minified or data blobs: still scanned by the secret rules below
      for (const [rule, re] of SECRET_RULES) if (re.test(text)) add('secret', rule, rel, line);
      if (!upstreamNotice && EMAIL_RULE.test(text)) add('personal-email', 'personal-email-address', rel, line);
      if (HOME_RULE.test(text)) add('home-path', 'absolute-home-path', rel, line);
      for (const [rule, re] of PROJECT_RULES) if (re.test(text)) add('private-project-name', rule, rel, line);
      for (const [term, re] of RENAME_RULES) {
        if (!re.test(text)) continue;
        if (!rename.has(rel)) rename.set(rel, new Map());
        const perFile = rename.get(rel);
        if (!perFile.has(term)) perFile.set(term, []);
        perFile.get(term).push(line);
      }
    });
    if (text_overlong(lines)) {
      for (const text of lines) {
        if (text.length <= 20000) continue;
        for (const [rule, re] of SECRET_RULES) if (re.test(text)) add('secret', rule, rel);
      }
    }
  }

  // third_party/: every file needs a licence file in its own directory or an ancestor below third_party/.
  const hasLicence = dir => files.some(f => path.dirname(f) === dir && /^(?:licen[sc]e|copying|notice|unlicense)(?:[.\-_].*)?$/i.test(path.basename(f)));
  for (const f of files) {
    if (!f.startsWith('third_party/')) continue;
    let dir = path.dirname(f), ok = false;
    while ((dir === 'third_party' || dir.startsWith('third_party/')) && !ok) {
      ok = hasLicence(dir);
      dir = path.dirname(dir);
    }
    if (!ok) add('third-party-no-licence', 'no licence file in or above the directory', f);
  }
  return { files: files.length, findings, rename };
}

const text_overlong = lines => lines.some(l => l.length > 20000);

export function runLeakageHook(tree, env = process.env) {
  const cards = (env.AMANI_LEAK_CARDS || '').split(':').filter(Boolean);
  if (!cards.length) return { status: 'not-run', reason: 'AMANI_LEAK_CARDS is not set', findings: [] };
  // The scanner needs the pinned pixi environment, which a staged export does not have. Point
  // AMANI_LEAK_SCANNER at oneshot.sh in a checkout that has run `pixi install` to scan from there.
  const script = env.AMANI_LEAK_SCANNER || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../packages/bio-tasks/oneshot/oneshot.sh');
  if (!existsSync(script)) return { status: 'not-run', reason: 'oneshot.sh is missing from this tree', findings: [] };
  // AMANI_LEAK_KEYS ('ROOT=KEY;ROOT=KEY') scans cards from several grading roots, each with its own
  // sealing key; a card is ROOT/cards/NAME, and a card under no listed root fails closed.
  const keys = new Map((env.AMANI_LEAK_KEYS || '').split(';').filter(Boolean).map(pair => {
    const i = pair.indexOf('=');
    return [path.resolve(pair.slice(0, i)), pair.slice(i + 1)];
  }));
  let allowlist;
  try { allowlist = loadAllowlist(env.AMANI_LEAK_ALLOW, tree); }
  catch { return { status: 'error', reason: 'invalid host leakage allowlist', findings: [], failed: 1 }; }
  const findings = [], allowlisted = [];
  let failed = 0;
  for (const card of cards) {
    let cardEnv = env;
    if (keys.size) {
      const root = path.resolve(card, '..', '..');
      if (!keys.has(root)) { failed += 1; continue; }
      cardEnv = { ...env, BIO_GRADING_ROOT: root, BIO_SEALING_KEY: keys.get(root) };
    }
    const r = spawnSync('sh', [script, 'scan', card, path.resolve(tree)], { encoding: 'utf8', env: cardEnv, maxBuffer: 16 << 20 });
    let parsed;
    try { parsed = JSON.parse((r.stdout || '').trim().split('\n').pop() || ''); } catch { parsed = null; }
    if (r.error || !parsed || !['clean', 'findings'].includes(parsed.status) || !Array.isArray(parsed.findings)
      || (parsed.status === 'clean' && r.status !== 0) || ![0, 1].includes(r.status)) { failed += 1; continue; }
    for (const f of parsed.findings) {
      if (!f || typeof f.category !== 'string' || typeof f.path !== 'string' ||
          typeof f.card !== 'string' || !f.card ||
          !(f.term_sha256 === null || /^[a-f0-9]{64}$/.test(f.term_sha256))) { failed += 1; continue; }
      const finding = { category: 'sealed-leakage', rule: f.category, file: f.path,
                        card: f.card, term_sha256: f.term_sha256 };
      (allowFinding(f, allowlist, tree) ? allowlisted : findings).push(finding);
    }
  }
  return { status: failed ? 'error' : 'ran', cards: cards.length, failed, findings, allowlisted,
           allowlist_sha256: allowlist.sha256,
           allowlistedCounts: Object.fromEntries([...new Set(allowlisted.map(f => f.rule))].sort()
             .map(category => [category, allowlisted.filter(f => f.rule === category).length])) };
}

function main(argv) {
  const args = [...argv];
  const tree = args.shift();
  if (!tree || tree.startsWith('--')) {
    process.stderr.write('usage: audit.mjs TREE [--json FILE] [--rename-debt FILE]\n');
    return 2;
  }
  const opts = new Map();
  while (args.length) {
    const k = args.shift(), v = args.shift();
    if (!['--json', '--rename-debt'].includes(k) || !v) { process.stderr.write(`invalid argument: ${k}\n`); return 2; }
    opts.set(k, v);
  }
  const { files, findings, rename } = auditTree(tree);
  const hook = runLeakageHook(tree);
  findings.push(...hook.findings);
  const failing = ['secret', 'personal-email', 'home-path', 'private-project-name', 'large-file', 'third-party-no-licence', 'sealed-leakage'];
  const counts = Object.fromEntries(failing.map(c => [c, findings.filter(f => f.category === c).length]));
  const renameTotals = { files: rename.size, occurrences: [...rename.values()].reduce((n, m) => n + [...m.values()].reduce((a, l) => a + l.length, 0), 0) };

  const byRule = {};
  for (const f of findings) { const k = `${f.category}/${f.rule}`; byRule[k] = (byRule[k] ?? 0) + 1; }
  const out = { filesScanned: files, counts, byRule, leakageHook: { status: hook.status, ...(hook.reason ? { reason: hook.reason } : {}), ...(hook.cards ? { cards: hook.cards, failed: hook.failed, allowlist_sha256: hook.allowlist_sha256, allowlistedCounts: hook.allowlistedCounts, allowlisted: hook.allowlisted } : {}) }, renameDebt: renameTotals, findings };
  if (opts.has('--json')) writeFileSync(opts.get('--json'), JSON.stringify(out, null, 2) + '\n');
  if (opts.has('--rename-debt')) writeFileSync(opts.get('--rename-debt'), renderRenameDebt(rename));

  const shown = findings.slice(0, 60);
  for (const f of shown) process.stdout.write(`${f.category}\t${f.rule}\t${f.file}${f.line ? ':' + f.line : ''}${f.card ? `\t${f.card}\t${f.term_sha256}` : ''}\n`);
  if (findings.length > shown.length) process.stdout.write(`... ${findings.length - shown.length} more (use --json for the full list)\n`);
  process.stdout.write(`\nscanned ${files} files\n`);
  for (const [c, n] of Object.entries(counts)) process.stdout.write(`  ${c.padEnd(24)} ${n}\n`);
  process.stdout.write(`  sealed-leakage hook      ${hook.status}${hook.reason ? ` (${hook.reason})` : ''}\n`);
  process.stdout.write(`  rename debt (info)       ${renameTotals.occurrences} lines in ${renameTotals.files} files\n`);
  process.stdout.write(`  allowlisted by category  ${JSON.stringify(hook.allowlistedCounts || {})}\n`);
  const bad = Object.values(counts).reduce((a, b) => a + b, 0) + (hook.status === 'error' ? 1 : 0);
  process.stdout.write(bad ? `AUDIT FAILED: ${bad} blocking finding(s)\n` : 'AUDIT PASSED\n');
  return bad ? 1 : 0;
}

function renderRenameDebt(rename) {
  const rows = [...rename.entries()].sort(([a], [b]) => a.localeCompare(b));
  const total = rows.reduce((n, [, m]) => n + [...m.values()].reduce((a, l) => a + l.length, 0), 0);
  const out = [
    '# Rename debt',
    '',
    'Every remaining occurrence of the old product name ("Omerta Bio", `omerta-bio`) or the `omb` prefix, by file.',
    'Package names (`omb-*`, `bio-*`, `@omerta-bio/*`) and code identifiers are intentionally unchanged for now.',
    `This file is generated by \`scripts/publish/audit.mjs --rename-debt\` and is excluded from the public snapshot.`,
    '',
    `Totals: ${total} lines in ${rows.length} files.`,
    '',
    '| File | Old name (lines) | omb prefix (lines) |',
    '|---|---|---|',
  ];
  const fmt = lines => (lines ? `${lines.length}: ${lines.slice(0, 12).join(', ')}${lines.length > 12 ? ', ...' : ''}` : '');
  for (const [file, m] of rows) out.push(`| \`${file}\` | ${fmt(m.get('omerta-bio'))} | ${fmt(m.get('omb'))} |`);
  return out.join('\n') + '\n';
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
