import { treeHash } from '../../omb-investigate/src/bundle.ts';
import {markedIntegrityRoots} from './integrity-result.ts';
import { synthesisSchema } from '../../omb-investigate/src/synthesis-schema.ts';
import { createHash } from 'node:crypto';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { openSync, readSync, closeSync, existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { object, pointer, type Json } from './results.ts';
import type { StagedData } from '../../omb-investigate/src/ports.ts';

export interface Task {
  dir: string; dataRoot: string; taskText?: string; prompt: string; template: Json; mode: 'card' | 'pilot';
  datasetId: string; expectedManifestHash?: string; publicContract?: Json; identity: NonNullable<StagedData['synthesisSchema']>; warnings: string[];
}
/** Resolve one component at a time, checking a link's destination before touching it. */
function canonicalPath(input: string, isDenied: (candidate: string) => boolean, depth = 0): string {
  if (depth > 40) throw new Error('too many path aliases');
  const p = path.resolve(input), root = path.parse(p).root;
  const parts = p.slice(root.length).split(path.sep).filter(Boolean);
  let at = root;
  for (const [i, part] of parts.entries()) {
    at = path.join(at, part);
    if (isDenied(at)) throw new Error('refusing protected research path');
    let stat;
    try { stat = lstatSync(at); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return path.join(at, ...parts.slice(i + 1));
      throw error;
    }
    if (stat.isSymbolicLink()) {
      const target = path.resolve(path.dirname(at), readlinkSync(at), ...parts.slice(i + 1));
      if (isDenied(target)) throw new Error('refusing protected research path');
      return canonicalPath(target, isDenied, depth + 1);
    }
  }
  return at;
}
export function safePath(input: string): string {
  const p = path.resolve(input);
  const home = realpathSync(homedir()), homes = new Set([path.resolve(homedir()), home]);
  const deniedRoots = [...homes].flatMap(base => ['omerta-bio-heldout', '.omerta-bio/oneshot/tierb', '.omerta-bio/oneshot/tierb2', '.omerta-bio/keys', '.omerta-bio/pilots', '.omerta'].map(x => path.join(base, x)));
  const isDenied = (candidate: string) => deniedRoots.some(denied => candidate === denied || candidate.startsWith(denied + path.sep));
  if (isDenied(p)) throw new Error('refusing protected research path');
  // Resolve only the allowed parent of each root. Never stat, open or traverse a
  // protected root merely to validate an unrelated task. Parent directory entries
  // can identify a root alias without reading it; an uninspectable root alias is
  // fail-closed, since its target cannot safely be authenticated here.
  for (const denied of [...deniedRoots]) {
    const parent = canonicalPath(path.dirname(denied), isDenied);
    deniedRoots.push(path.join(parent, path.basename(denied)));
    if (existsSync(parent)) {
      const entry = readdirSync(parent, { withFileTypes: true }).find(e => e.name === path.basename(denied));
      if (entry?.isSymbolicLink()) throw new Error('refusing protected research path: root alias cannot be inspected');
    }
  }
  const ancestor = canonicalPath(p, isDenied);
  if (isDenied(ancestor)) throw new Error('refusing protected research path');
  // Development checkouts avoid unrelated owner projects. Released engines may
  // load served tasks anywhere outside the protected research roots above.
  if (process.env.OMB_DEVELOPMENT === '1') {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const allowed = path.basename(path.dirname(repo)).endsWith('-wt') ? path.dirname(repo) : repo;
    const projects = path.join(home, 'projects');
    if (ancestor.startsWith(projects + path.sep) && ancestor !== allowed && !ancestor.startsWith(allowed + path.sep) && !allowed.startsWith(ancestor + path.sep)) throw new Error('refusing unrelated private project path');
  }
  return ancestor;
}
export function readJson(file: string): Json { return JSON.parse(readFileSync(file, 'utf8')) as Json; }
export function assertPlainTree(dir: string): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, ent.name);
    if (ent.isSymbolicLink() || !ent.isDirectory() && !ent.isFile()) throw new Error('task data must contain ordinary files only');
    if (ent.isFile() && lstatSync(f).nlink !== 1) throw new Error('task data must not contain hard-linked files');
    if (ent.isDirectory()) assertPlainTree(f);
  }
}
export function loadTask(input: string, mode?: 'card' | 'pilot'): Task {
  const dir = safePath(input);
  assertPlainTree(dir);
  const prompt = readFileSync(path.join(dir, 'TASK.md'), 'utf8');
  const actualMode = mode ?? (existsSync(path.join(dir, 'DATA-CONTRACT.json')) ? 'card' : 'pilot');
  const envelope = actualMode === 'card' && existsSync(path.join(dir, 'DATA-CONTRACT.json')) ? readJson(path.join(dir, 'DATA-CONTRACT.json')) : null;
  const content = object(envelope) && object(envelope.public) && object(envelope.public.content) ? envelope.public.content : envelope;
  if (object(envelope) && object(envelope.public) && envelope.public.hash !== canonicalSha256(envelope.public.content)) throw new Error('public contract hash mismatch');
  verifyManifest(dir);
  // Optional report[].integrity marks arbitrary report pointers as trusted-only.
  // It defaults to absent and does not authorize a detector mapping or worker answer.
  if (actualMode === 'card') markedIntegrityRoots(content);
  if (object(envelope) && object(envelope.public) && existsSync(path.join(dir, 'manifest.json'))) {
    const manifest = readJson(path.join(dir, 'manifest.json'));
    if (object(manifest) && manifest.publicContractHash !== undefined && envelope.public.hash !== undefined && manifest.publicContractHash !== envelope.public.hash) throw new Error('manifest public contract hash mismatch');
  }
  const names = actualMode === 'card' ? ['report-template.json', 'report.template.json', 'REPORT-TEMPLATE.json', 'report.json'] : ['results-template.json'];
  const criteria = object(content) && Array.isArray(content.report) ? content.report : [];
  const fromCriteria = criteria.length ? templateFromCriteria(criteria) : undefined;
  const files = readdirSync(dir).filter(name => names.includes(name));
  const inline = extractTemplate(prompt, actualMode, criteria);
  if (files.length > 1 || files.length && inline !== undefined) throw new Error('ambiguous template: use exactly one explicit source');
  const template = files.length ? readJson(path.join(dir, files[0]!)) : inline ?? fromCriteria;
  if (template !== undefined) validateTemplate(template);
  if (!object(template)) throw new Error(`no readable ${actualMode === 'card' ? 'report' : 'results'} template in task`);
  const dataRoot = safePath(path.join(dir, 'data'));
  if (!lstatSync(dataRoot).isDirectory()) throw new Error('task data/ is not a directory');
  assertPlainTree(dataRoot);
  let datasetId = path.basename(dir);
  if (existsSync(path.join(dir, 'card.json'))) { const c = readJson(path.join(dir, 'card.json')); if (object(c) && typeof c.id === 'string') datasetId = c.id; }
  if (existsSync(path.join(dir, 'manifest.json'))) { const m = readJson(path.join(dir, 'manifest.json')); if (object(m) && typeof m.task === 'string') datasetId = m.task; }
  const warnings: string[] = [], identity: Task['identity'] = [];
  if (actualMode === 'card') {
    const file = path.join(dir, 'DATA-CONTRACT.json');
    if (existsSync(file)) {
      identity.push(...synthesisSchema(content));
      warnings.push('Served card contract is translated in host to an unauthenticated K1 v3.1 contract; the G1a integrity inventory is computed by host code before the first model turn.');
      if (!identity.length) warnings.push('No recognized table identity declarations in DATA-CONTRACT.json.');
    } else warnings.push('DATA-CONTRACT.json unavailable; no contract gate can pass.');
  }
  const context = actualMode === 'card' && object(content) ? '\n\nPUBLIC SERVED DATA CONTRACT (metadata, not an authenticated K1 contract):\n' + JSON.stringify(content) + '\nThe contract is embedded here for planning and implementation. DATA-CONTRACT.json is metadata, not a file in the execution data/ mount. Freeze any needed public metadata under code/. Registry cells original/canonical/target are JSON-encoded identifiers; decode them before joining. During synthetic validation, nonpublic IDs become consistent pseudonyms; IDs explicitly named in TASK.md remain addressable. Public report criteria are task answers; do not invent statistical hypotheses for identifier lists, rankings or counts. Claims must reference existing source tables/columns; use exploratory claims when the registered kernel cannot represent a matrix join. Compute every requested task answer in outputs/task-results.json regardless of kernel claim eligibility. Never weaken the frozen computation or create dummy primary estimates to pass a dry run.' : '';
  return { dir, dataRoot, expectedManifestHash: treeHash(dataRoot), taskText: prompt, prompt: prompt + (actualMode === 'card' ? CARD_CLAIM_GUIDANCE : '') + context, publicContract: content, template, mode: actualMode, datasetId, identity, warnings };
}

export function templateFromCriteria(criteria: Json[]): Json {
  const out: Record<string, Json> = {}, paths: string[][] = [];
  for (const c of criteria) {
    if (!object(c) || typeof c.report !== 'string' || !c.report.startsWith('/') || /~(?![01])/.test(c.report)) throw new Error('invalid public report criterion');
    const parts = c.report.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (parts.some(p => ['__proto__', 'prototype', 'constructor'].includes(p))) throw new Error('unsafe report pointer');
    if (paths.some(p => p.slice(0, Math.min(p.length, parts.length)).every((v, i) => v === parts[i]))) throw new Error('overlapping or duplicate report pointers');
    paths.push(parts);
    if (c.kind === 'verdict' && (!Array.isArray(c.allowed) || !c.allowed.length || c.allowed.some(v => typeof v !== 'string' || !v.trim() || v.includes('|')) || new Set(c.allowed).size !== c.allowed.length)) throw new Error('ambiguous verdict allowed values: pipes and duplicates are forbidden');
    let dest: any = out;
    for (const [i, part] of parts.entries()) {
      if (Array.isArray(dest) && (!/^(0|[1-9][0-9]*)$/.test(part) || Number(part) > 10000)) throw new Error('invalid report array index');
      if (i === parts.length - 1) dest[part] = c.kind === 'verdict' ? (c.allowed as string[]).join(' | ') : c.kind === 'set' ? [] : c.kind === 'band' || c.kind === 'sign' ? 0 : null;
      else { if (!Object.hasOwn(dest, part)) dest[part] = /^(0|[1-9][0-9]*)$/.test(parts[i + 1]!) ? [] : {}; dest = dest[part]; }
    }
  }
  return out;
}
function validateTemplate(v: Json): void {
  if (typeof v === 'string' && v.includes('|')) {
    const values = v.split(' | ');
    if (values.length < 2 || values.some(x => !x || x.trim() !== x || x.includes('|')) || new Set(values).size !== values.length) throw new Error('ambiguous template enum: use distinct values separated by exactly " | "');
  } else if (v && typeof v === 'object') for (const [key, child] of Object.entries(v)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('unsafe template key'); validateTemplate(child);
  }
}

function fileHash(file: string): string {
  const fd = openSync(file, 'r'), h = createHash('sha256'), buf = Buffer.alloc(65536);
  try { let n: number; while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); return h.digest('hex'); }
  finally { closeSync(fd); }
}
function verifyManifest(dir: string): void {
  if (!existsSync(path.join(dir, 'manifest.json'))) return;
  const manifest = readJson(path.join(dir, 'manifest.json'));
  if (!object(manifest)) throw new Error('invalid task manifest');
  const files = Array.isArray(manifest.files) ? Object.fromEntries(manifest.files.filter(object).map(f => [String(f.path), f.sha256])) : manifest.files;
  if (!object(files)) throw new Error('invalid manifest files');
  const declaredData = new Set(Object.keys(files).filter(f => f.startsWith('data/')));
  const visit = (sub: string): void => { for (const entry of readdirSync(path.join(dir, sub), { withFileTypes: true })) { const rel = sub + '/' + entry.name; if (entry.isDirectory()) visit(rel); else if (!declaredData.delete(rel)) throw new Error('undeclared data file in task manifest'); } };
  visit('data');
  if (declaredData.size) throw new Error('missing data file in task manifest');
  for (const [file, hash] of Object.entries(files)) {
    if (path.isAbsolute(file) || file.split('/').includes('..') || typeof hash !== 'string') throw new Error('invalid manifest path/hash');
    const full = path.join(dir, file);
    if (lstatSync(full).isSymbolicLink() || fileHash(full) !== hash) throw new Error(`task manifest mismatch: ${file}`);
  }
}

/** Canonical kinds and aliases from omb-gauntlet's claim registry. */
export const CARD_CLAIM_GUIDANCE = `
CARD CLAIM KINDS: use effect-size (estimation/estimate), effect-exists (association/difference), out-of-sample (prediction), or data-integrity (actual integrity findings only). A prespecified equivalence claim may use null with a meaningful margin. Reproduction claims are unavailable on a blinded card without a supplied published numeric target. A question asking to evaluate a published claim must be answered by estimating/testing from the served data; never invent the publication's target or change scientific claims into integrity findings. Use canonical kind strings above, not prose labels. Statistical claims require exposure, outcome, estimand, test and a scientifically justified finite nonzero mei; declare existing source column names, and explain matrix joins in the plan. Report requested counts/rankings separately as frozen computed outputs, not artificial scientific claims.
`;

/** Exactly one explicitly headed source. Headings and blocks are scanned once;
 * unrelated examples never win a heuristic score or a later-block tie. */
export function extractTemplate(prompt: string, _mode: 'card' | 'pilot', criteria: Json[] = []): Json | undefined {
  const fields = criteria.flatMap(c => object(c) && typeof c.report === 'string' ? [c.report] : []);
  const candidates: Json[] = [];
  let heading = '';
  const lines = prompt.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const title = /^#{1,6}[ \t]+([^\r\n]+)$/.exec(line);
    if (title) { heading = title[1]!.trim(); continue; }
    if (!/^```json[ \t]*$/.test(line)) continue;
    const start = ++i;
    while (i < lines.length && !/^```[ \t]*$/.test(lines[i]!)) i++;
    if (i === lines.length) throw new Error('unclosed JSON template block');
    const explicit = /^(report|results?)(?:[ \t]+(?:template|format|json))?$/i.test(heading);
    let value: Json;
    try { value = JSON.parse(lines.slice(start, i).join('\n')); } catch { if (explicit) throw new Error('invalid explicit template JSON'); continue; }
    const covers = fields.some(p => pointer(value, p) !== undefined);
    if (!explicit && covers) throw new Error('decoy template block outside the explicit report heading');
    if (explicit) { if (!object(value)) throw new Error('template must be an object'); validateTemplate(value); candidates.push(value); }
  }
  if (candidates.length > 1) throw new Error('duplicate template blocks: use exactly one explicit source');
  return candidates[0];
}
