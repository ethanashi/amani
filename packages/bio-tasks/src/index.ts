/**
 * bio-tasks: pilot task suite (Block 9). The task library, staging, sealing, calibration and
 * grading are Python (bio-baseline pixi env); this entry point exposes the committed task cards
 * and calibration records to TypeScript consumers such as bio-bench, without answer content.
 */
import { readdirSync, readFileSync, existsSync, lstatSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const tasksRoot: string = fileURLToPath(new URL("../tasks/", import.meta.url));

/** bio-bench `TaskCard` fields plus the Block 9 extensions. */
export interface PilotTaskCard {
  id: string;
  family: "reproduction" | "negative" | "planted-flaw" | "held-out" | "recovery";
  datasetManifestHash: string;
  prompt: string;
  sealedAnswerKeyRef: string;
  tolerance: { absolute: number; relative: number };
  plantedFlaws: readonly string[];
  negativeControl: boolean;
  positiveControl: boolean;
  heldOut: boolean;
  seed: number;
  capMinutes: number;
  contaminated: boolean;
}

type Outcome = "passed" | "failed" | "error";
/** Same shape as `@omerta-bio/checks` `validity.CalibrationInput` (empty, reference, permuted). */
export interface CalibrationInputRecord {
  empty: Outcome;
  reference: Outcome;
  permuted: Outcome[];
}
export interface CalibrationRecord {
  schema: "bio-tasks/calibration@1";
  task: string;
  status: string;
  reasons: string[];
  calibrationInput: CalibrationInputRecord;
  mapping: { empty: "empty"; reference: "reference"; naive: "permuted" };
  bindings: { datasetManifestHash: string; [key: string]: unknown };
}

export function listTaskIds(root: string = tasksRoot): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(path.join(root, d.name, "card.json")))
    .map(d => d.name)
    .sort();
}

export function readTaskCard(id: string, root: string = tasksRoot): PilotTaskCard {
  return JSON.parse(readFileSync(path.join(root, id, "card.json"), "utf8")) as PilotTaskCard;
}

/** The bio-bench TaskCard view of a pilot card (drops the Block 9 extensions). */
export function toBenchTaskCard(card: PilotTaskCard) {
  const { seed: _seed, capMinutes: _cap, contaminated: _contaminated, ...bench } = card;
  return bench;
}

/**
 * Runner form for bio-bench's `calibration` dependency (`validity.calibrateTask` runner API): each
 * runner replays the recorded outcome; an unavailable or errored control throws (inconclusive).
 */
export function calibrationRunners(id: string, root: string = tasksRoot) {
  const input = readCalibrationInput(id, root);
  const replay = (outcome: Outcome | undefined) => (): boolean => {
    if (outcome === "passed") return true;
    if (outcome === "failed") return false;
    throw new Error(`calibration control unavailable for ${id}`);
  };
  return { runEmpty: replay(input.empty), runReference: replay(input.reference), runPermuted: () => {
    if (input.permuted.some(o => o === 'error')) throw new Error('calibration control unavailable');
    return input.permuted.some(o => o === 'passed');
  } };
}

const packageRoot = path.resolve(tasksRoot, '..');
const repoRoot = path.resolve(packageRoot, '../..');
const digest = (p: string) => {
  if (!lstatSync(p).isFile() || lstatSync(p).isSymbolicLink()) throw new Error('unsafe binding');
  return createHash('sha256').update(readFileSync(p)).digest('hex');
};
function treeDigest(root: string): string {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === '__pycache__' || name.endsWith('.pyc')) continue;
      const file = path.join(dir, name);
      if (lstatSync(file).isSymbolicLink()) throw new Error('unsafe tree binding');
      if (lstatSync(file).isDirectory()) visit(file); else files.push(path.relative(root, file));
    }
  };
  visit(root);
  const h = createHash('sha256');
  for (const rel of files.sort()) h.update(rel + '\0' + digest(path.join(root, rel)) + '\n');
  return h.digest('hex');
}
function currentBindings(dir: string, card: PilotTaskCard) {
  const files = Object.fromEntries(['card.json', 'TASK.md', 'stage.py', 'reference.py', 'check.py']
    .map(name => [name, digest(path.join(dir, name))]));
  const shared: Record<string, string> = {};
  for (const name of ['checks.py', 'calibrate.py', 'staging.py', 'sealing.py', 'card.py', 'grading.py'])
    shared['lib/biotasks/' + name] = digest(path.join(packageRoot, 'lib/biotasks', name));
  for (const rel of ['packages/bio-baseline/arms/lib/armlib.py', 'packages/bio-baseline/arms/lib/seal.py',
    'packages/bio-baseline/grading/grade.py', 'packages/bio-baseline/pixi.lock']) shared[rel] = digest(path.join(repoRoot, rel));
  const extra = path.join(dir, 'bindings.json');
  if (existsSync(extra)) {
    for (const rel of JSON.parse(readFileSync(extra, 'utf8'))) {
      if (typeof rel !== 'string' || !rel.startsWith('packages/') || rel.split('/').includes('..')) throw new Error('unsafe binding');
      shared[rel] = digest(path.join(repoRoot, rel));
    }
    files['bindings.json'] = digest(extra);
  }
  if (!card.sealedAnswerKeyRef.startsWith('packages/') || card.sealedAnswerKeyRef.split('/').includes('..')) throw new Error('unsafe key ref');
  const key = path.join(repoRoot, card.sealedAnswerKeyRef);
  return { datasetManifestHash: card.datasetManifestHash, files, shared, naiveTree: treeDigest(path.join(dir, 'naive')),
    sealedKey: { path: card.sealedAnswerKeyRef, sha256: digest(key),
      ciphertextSha256: readFileSync(key + '.sha256', 'utf8').trim().split(/\s+/)[0] } };
}
const canonical = (x: any): string => JSON.stringify(x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, JSON.parse(canonical(x[k]))])) : x);

/**
 * The recorded calibration outcomes, in `calibrateTask` input form. Fails closed: a missing,
 * unparseable or foreign record, or one bound to a different staged manifest, yields an input that
 * calibrateTask refuses as inconclusive.
 */
export function readCalibrationInput(id: string, root: string = tasksRoot): CalibrationInputRecord {
  const inconclusive: CalibrationInputRecord = { empty: "error", reference: "error", permuted: ["error"] };
  try {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return inconclusive;
    const record = JSON.parse(readFileSync(path.join(root, id, "calibration.json"), "utf8")) as CalibrationRecord;
    const card = readTaskCard(id, root);
    if (record.schema !== "bio-tasks/calibration@1" || record.task !== id || record.status !== "valid" || card.id !== id ||
        canonical(record.bindings) !== canonical(currentBindings(path.join(root, id), card)) ||
        record.bindings?.datasetManifestHash !== card.datasetManifestHash) return inconclusive;
    const input = record.calibrationInput;
    const ok = (v: unknown): v is Outcome => v === "passed" || v === "failed" || v === "error";
    if (!input || !ok(input.empty) || !ok(input.reference) || !Array.isArray(input.permuted) ||
        input.permuted.length === 0 || !input.permuted.every(ok)) return inconclusive;
    return { empty: input.empty, reference: input.reference, permuted: [...input.permuted] };
  } catch {
    return inconclusive;
  }
}
