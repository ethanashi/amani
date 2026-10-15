/** Trusted layout adapter only. Scientific results still go through the baseline grader. */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalSha256, SqliteEventStore, type ProofArtifactRef } from '../../bio-core/src/index.ts';

import { codePolicyCompliant } from './collector-policy.ts';

const pkg = fileURLToPath(new URL('../', import.meta.url));
const names = ['clinical_patient.tsv', 'clinical_sample.tsv', 'clinical_attributes.tsv', 'expression_mrna.tsv'];
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
function save(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file + '.new', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(file + '.new', file);
}
export function prepare(root: string, home: string, model: string, timeoutMs: number, smoke = false, taskManifest?: string, manifestSha?: string, taskId?: string) {
  root = realpathSync(root);
  const work = path.join(root, 'work'), investigation = path.join(root, 'investigation');
  mkdirSync(investigation, { mode: 0o700 });
  const task = readFileSync(path.join(work, 'TASK.md'), 'utf8');
  const plan = {
    exploratory: true,
    instructions: 'Draft your own exploratory plan for every question in TASK.md. Use fixed seeds. ' +
      'Choose python or r. Include results.json and metrics.json as planned outputs; metrics.json contains flat numeric claims. ' +
      'Use BIO_DATA_DIR for the input files and BIO_OUTPUT_DIR for every generated file. ' +
      'The baseline adapter exports your frozen analysis as code/, creates run_all.sh sourcing env.sh, ' +
      'and exports the trusted report as REPORT.md. Put tables in flat TSV/JSON outputs. ' +
      'Include all task methods, exclusions and caveats in the plan and interpretation. No web access.',
  };
  // Only the public task reaches the worker. The manifest's derivation/clean entries never do.
  const metadata = taskManifest ? undefined : json(path.join(pkg, 'data/metabric.manifest.json'));
  let taskEntries: { path: string; bytes: number; sha256: string }[] | undefined;
  if (taskManifest) {
    const raw = readFileSync(taskManifest);
    if (!manifestSha || sha(raw) !== manifestSha) throw new Error('task manifest pin mismatch');
    const manifest = JSON.parse(raw.toString());
    if (manifest.schema !== 'bio-tasks/manifest@1' || manifest.task !== taskId || !Array.isArray(manifest.files))
      throw new Error('invalid task manifest');
    const seen = new Set<string>();
    for (const entry of manifest.files) {
      if (!entry || typeof entry.path !== 'string' ||
          !(entry.path === 'TASK.md' || /^data\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.path)) ||
          seen.has(entry.path) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
          typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('invalid task entry');
      seen.add(entry.path);
      const file = path.join(work, entry.path);
      if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) throw new Error('unsafe task file');
      const bytes = readFileSync(file);
      if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256) throw new Error('task file mismatch');
    }
    if (!seen.has('TASK.md') || lstatSync(path.join(work, 'data')).isSymbolicLink()) throw new Error('invalid task layout');
    taskEntries = manifest.files.filter((e: {path: string}) => e.path.startsWith('data/'));
    if (!taskEntries?.length || readdirSync(path.join(work, 'data')).sort().join('\n') !==
        taskEntries.map(e => e.path.slice(5)).sort().join('\n')) throw new Error('unexpected task data');
  }
  const files = (taskEntries ? taskEntries.map(e => e.path.slice(5)) : names).map(name => {
    const bytes = readFileSync(path.join(work, 'data', name));
    if (taskEntries) return { path: name, sourcePath: path.join(work, 'data', name),
      source: 'bio-tasks staged manifest', accession: taskId!, url: `urn:sha256:${manifestSha}`,
      retrievedAt: '1970-01-01T00:00:00.000Z', terms: { access: 'public', license: 'task-fixture' },
      sha256: sha(bytes), bytes: bytes.length };
    const entry = metadata.files.find((f: { path: string }) => f.path === `arm/${name}`);
    if (!entry?.retrievedAt) throw new Error('arm retrieval metadata missing');
    return { path: name, sourcePath: path.join(work, 'data', name), source: 'cBioPortal', accession: smoke ? 'synthetic_armc_smoke' : 'brca_metabric',
      url: 'https://www.cbioportal.org/study/summary?id=brca_metabric', retrievedAt: new Date(entry.retrievedAt).toISOString(),
      terms: { access: 'public', license: 'cBioPortal-public' }, sha256: sha(bytes), bytes: bytes.length };
  });
  writeFileSync(path.join(investigation, 'TASK.md'), task);
  writeFileSync(path.join(investigation, 'question.md'), task);
  save(path.join(investigation, 'plan-input.json'), plan);
  save(path.join(investigation, 'host.json'), { intent: 'exploratory', allowedHosts: [], entityKeys: [] });
  save(path.join(investigation, 'investigation.json'), {
    id: 'baseline-' + sha(Buffer.from(root)).slice(0, 20), question: task + '\n\n' + plan.instructions + ` Overall wall-clock cap: ${timeoutMs} milliseconds from arm launch, shared by all work, including checking and repairs; turns never reset this budget.`,
    successCriterion: 'Answer every question and supply every deliverable specified in TASK.md; unverified results remain tentative.',
    files, model, home: realpathSync(home), node: process.execPath,
    toolPath: `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`, timeoutMs,
  });
}

type Event = ReturnType<SqliteEventStore['readStream']>[number];
function events(file: string, id: string): Event[] {
  if (!existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const store = new SqliteEventStore(db);
    if (!store.verifyStream(id).valid) throw new Error('journal integrity failure');
    return store.readStream(id);
  } finally { db.close(); }
}
const obj = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

/** Structural checks supplement the chain; full ledger state replay belongs to bio-ledger. */
function ledgerStructure(ledger: Event[]): boolean {
  if (ledger[0]?.type !== 'ledger.created') return false;
  const earlier = new Set<string>();
  for (const event of ledger) {
    if (event.producerPlaneId !== 'bio-ledger' || !event.type.startsWith('ledger.')) return false;
    if (!['ledger.recorded', 'ledger.planned', 'ledger.locked', 'ledger.probed'].includes(event.type)) continue;
    const payload = obj(event.payload);
    if (typeof payload.token !== 'string' || !payload.token) return false;
    const records = [payload.record, ...(event.type === 'ledger.locked' && payload.amendment !== null ? [payload.amendment] : [])];
    for (const value of records) {
      const record = obj(value), p = obj(record.payload);
      if (typeof record.id !== 'string' || record.id !== canonicalSha256(p) ||
          !Array.isArray(p.parents) || !p.parents.every(parent => earlier.has(obj(parent).id))) return false;
      earlier.add(record.id);
    }
  }
  return true;
}

/** Every turn must reconcile its write audit before another turn starts. A later
 * successful turn cannot erase unavailable or violating evidence from an earlier one. */
function workerAuditsComplete(pipeline: Event[], host: Event[]): boolean {
  let pending: string | undefined, audited = false, turns = 0;
  for (const event of pipeline) {
    const payload = obj(event.payload);
    if (event.type === 'worker-started') {
      if (pending !== undefined || !['draft', 'amend', 'code', 'interpret'].includes(payload.phase)) return false;
      pending = payload.phase; audited = false; turns++;
    } else if (event.type.startsWith('audit.')) {
      const writes = obj(payload.writes);
      if (pending === undefined || event.type !== `audit.${pending}` || audited || (payload.unavailable !== undefined && payload.unavailable !== false) ||
          !Array.isArray(writes.outsideWrites) || writes.outsideWrites.length !== 0 ||
          !(writes.status === 'complete' || pending === 'code' && writes.status === 'policy-enforced' &&
            writes.basis === 'sandbox-and-reconciled-tool-receipts')) return false;
      audited = true;
    } else if (event.type === 'worker-audited') {
      if (pending === undefined || payload.phase !== pending || !audited) return false;
      pending = undefined;
    }
  }
  if (pending !== undefined || turns === 0) return false;
  const boundaries = host.filter(e => e.type === 'worker-boundary');
  const audits = host.filter(e => e.type === 'worker-tool-audit');
  const nonces = boundaries.map(e => obj(e.payload).nonce);
  return boundaries.length === turns && audits.length === turns && new Set(nonces).size === turns &&
    nonces.every(nonce => typeof nonce === 'string' && nonce.length > 0) && boundaries.every(boundary => {
      const matches = audits.filter(e => obj(e.payload).nonce === obj(boundary.payload).nonce);
      const audit = obj(matches[0]?.payload);
      return matches.length === 1 && (audit.unavailable === undefined || audit.unavailable === false) &&
        Array.isArray(audit.violations) && audit.violations.length === 0 &&
        Array.isArray(audit.missing) && audit.missing.length === 0;
    });
}

/** Export software check receipts only. Missing gates never mean duplicate-free. */
export function duplicateGate(ledger: Event[]) {
  if (!ledgerStructure(ledger)) return { available: false, flagged: null, checks: [], findings: [] };
  const observations = ledger.filter(e => e.type === 'ledger.recorded').map(e => obj(obj(e.payload).record)).filter(r => {
    const p = obj(r.payload), value = obj(obj(p.data).value);
    return r.id === canonicalSha256(p) && p.kind === 'observation' && obj(p.actor).kind === 'software' &&
      value.check === 'content-duplicates' && Array.isArray(value.groups) && value.groups.length > 0 &&
      value.groups.every((g: unknown) => Array.isArray(g) && g.length > 1 && new Set(g).size === g.length && g.every(id => typeof id === 'string' && id.length > 0));
  });
  const failedFindings = new Set<string>();
  const checks = ledger.filter(e => e.type === 'ledger.recorded').flatMap(e => {
    const r = obj(obj(e.payload).record), p = obj(r.payload), d = obj(p.data);
    if (r.id !== canonicalSha256(p) || p.kind !== 'check' || obj(p.actor).kind !== 'software' ||
        !['content-duplicates', 'contentDuplicates', 'detectContentDuplicates'].includes(d.name)) return [];
    const linked = observations.filter(o => p.parents.some((parent: { id: string }) => o.id === parent.id));
    if (d.status === 'failed') for (const observation of linked) failedFindings.add(observation.id);
    return [{ recordId: r.id, name: d.name, status: d.status, detected: linked.length > 0 }];
  });
  return { available: checks.length > 0, flagged: checks.some(c => c.status === 'failed' && c.detected) ? true :
    checks.length > 0 && checks.every(c => c.status === 'passed') ? false : null, checks,
    findings: observations.filter(o => failedFindings.has(o.id))
      .map(o => ({ recordId: o.id, unit: o.payload.data.unit, groups: o.payload.data.value.groups })) };
}

export function collect(root: string, result: string) {
  root = path.resolve(root);
  const investigation = path.join(root, 'investigation'), authority = path.join(investigation, 'authority');
  const configFile = path.join(investigation, 'investigation.json');
  if (!existsSync(configFile)) throw new Error('investigation inputs unavailable');
  const config = json(configFile), work = path.join(root, 'work');
  const evidence = path.join(result, 'omerta');
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const metaFile = path.join(result, 'meta.json'), meta = json(metaFile);
  // A failed recollection must not leave a successful receipt behind.
  rmSync(path.join(evidence, 'validity-gate.json'), { force: true });
  save(metaFile, { ...meta, host_evidence_complete: false, worker_transcript_complete: false,
    no_web_check: 'FAIL-or-unknown', validity_gate: { available: false, flagged: null } });
  // Evidence is host-owned, outside every worker write root. Do not collect staged data twice.
  for (const name of ['authority', 'report', 'results', 'TASK.md', 'question.md', 'plan-input.json', 'host.json', 'investigation.json']) {
    const source = path.join(investigation, name);
    if (existsSync(source)) cpSync(source, path.join(evidence, name), { recursive: true, dereference: false });
  }
  const pipeline = events(path.join(authority, 'pipeline.sqlite'), config.id);
  const host = events(path.join(authority, 'host.sqlite'), config.id);
  const ledger = events(path.join(authority, 'ledger.sqlite'), `bio-ledger:${config.id}`);
  save(path.join(evidence, 'journal.json'), { pipeline, host, ledger });
  const artifact = (value: unknown) => {
    const ref = obj(value) as ProofArtifactRef;
    if (!/^[a-f0-9]{64}$/.test(ref.sha256)) throw new Error('invalid artifact reference');
    const file = path.join(authority, 'artifacts', ref.sha256);
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('invalid artifact file');
    const bytes = readFileSync(file);
    if (sha(bytes) !== ref.sha256 || bytes.length !== ref.sizeBytes) throw new Error('artifact integrity failure');
    return bytes;
  };
  const latest = (type: string) => obj(pipeline.findLast(e => e.type === type)?.payload);
  // The outer stdout is a host terminal receipt, not the worker transcript.
  const transcript = path.join(result, 'transcript.jsonl');
  if (existsSync(transcript) && !existsSync(path.join(result, 'host-stdout.jsonl'))) cpSync(transcript, path.join(result, 'host-stdout.jsonl'));
  const raw: string[] = [], phases: string[] = [];
  let phase: string | undefined, started = 0, captured = 0;
  for (const event of pipeline) {
    if (event.type === 'worker-started') { phase = String(obj(event.payload).phase); started++; }
    if (event.type === 'process-result' && phase) { raw.push(artifact(obj(event.payload).stdout).toString()); phases.push(phase); captured++; phase = undefined; }
  }
  writeFileSync(transcript, raw.join('\n'));
  const transcriptComplete = started > 0 && captured === started && raw.every(s => s.trim() && s.trim().split('\n').every(line => {
    try { return !!JSON.parse(line); } catch { return false; }
  }));
  let gate: Record<string, unknown> = duplicateGate(ledger);
  const current = latest('analysis-validity');
  if (current.artifact) {
    const checked = JSON.parse(artifact(current.artifact).toString());
    if (canonicalSha256(checked) !== canonicalSha256(current.evidence) || !Array.isArray(checked.datasets)) throw new Error('validity receipt artifact mismatch');
    const records = ledger.filter(e => e.type === 'ledger.recorded').map(e => obj(obj(e.payload).record));
    const datasets = checked.datasets.map((d: Record<string, any>) => {
      const finding = d.findings?.find((f: Record<string, any>) => f.name === 'content-duplicates');
      const backed = records.some(r => r.id === canonicalSha256(r.payload) && obj(r.payload).kind === 'check' &&
        obj(obj(r.payload).actor).kind === 'software' && obj(obj(r.payload).data).name === `${d.file}: content-duplicates` &&
        obj(obj(r.payload).data).status === (finding?.passed ? 'passed' : 'failed') &&
        obj(obj(r.payload).data).dataHashes?.includes(current.artifact.sha256));
      return { file: d.file, available: backed && finding?.evidence?.checked === true, allowed: d.allowed,
        effectiveN: d.effectiveN, rowCount: d.rowCount, groups: finding?.evidence?.groups ?? [],
        sparseRows: finding?.evidence?.information?.insufficient ?? [], status: finding?.evidence?.status ?? 'unavailable' };
    });
    const available = ledgerStructure(ledger) && datasets.length > 0 && datasets.every((d: Record<string, any>) => d.available);
    gate = { available, allowed: available ? checked.allowed : null,
      flagged: !available ? null : datasets.some((d: Record<string, any>) => d.groups.length > 0) ? true :
        datasets.every((d: Record<string, any>) => d.status === 'no-duplicates') ? false : null,
      checks: datasets, findings: available ? datasets.filter((d: Record<string, any>) => d.groups.length > 0).map((d: Record<string, any>) =>
        ({ unit: 'sample', file: d.file, groups: d.groups.map((g: Record<string, any>) => g.ids), effectiveN: d.effectiveN })) : [] };
  }
  const terminal = latest('terminal');
  save(path.join(evidence, 'cleanup.json'), { terminal: terminal.cleanupStatus ?? 'unavailable',
    pipeline: pipeline.filter(e => e.type === 'cleanup'), host: host.filter(e => e.type === 'worker-cleanup') });
  const frozen = latest('frozen-code');
  if (frozen.code) {
    const runtime = obj(frozen.analysis).runtime ?? 'node';
    const extension = { python: 'py', r: 'R', node: 'mjs' }[runtime as string];
    const binary = { python: 'python', r: 'Rscript', node: 'node' }[runtime as string];
    if (!extension || !binary) throw new Error('unknown analysis runtime');
    mkdirSync(path.join(work, 'code'), { recursive: true });
    writeFileSync(path.join(work, `code/analysis.${extension}`), artifact(frozen.code));
    writeFileSync(path.join(work, 'run_all.sh'), `#!/usr/bin/env bash\nset -euo pipefail\nsource ./env.sh\nmkdir -p outputs\nexport BIO_DATA_DIR="$PWD/data" BIO_OUTPUT_DIR="$PWD/outputs"\n${binary} code/analysis.${extension}\ncp outputs/results.json results.json\n`, { mode: 0o700 });
  }
  // Block 7j: the pipeline's software-generated deliverable (artifact-verified) replaces the
  // template above, so run_all.sh recreates the analysed inputs from the raw ./data.
  for (const [name, ref] of Object.entries(obj(latest('deliverable').files))) {
    if (!/^(?:run_all\.sh|prepare\/(?:prepare_data\.py|spec\.json)|code\/analysis\.(?:py|R|mjs))$/.test(name)) throw new Error('unsafe deliverable name');
    mkdirSync(path.dirname(path.join(work, name)), { recursive: true });
    writeFileSync(path.join(work, name), artifact(ref), { mode: name === 'run_all.sh' ? 0o700 : 0o600 });
  }
  const outputs = obj(latest('step.execute.completed').files);
  mkdirSync(path.join(work, 'outputs'), { recursive: true });
  for (const [name, ref] of Object.entries(outputs)) {
    if (!/^[A-Za-z0-9_.-]+\.(json|tsv)$/.test(name)) throw new Error('unsafe output name');
    const bytes = artifact(ref);
    writeFileSync(path.join(work, 'outputs', name), bytes);
    if (name === 'results.json') writeFileSync(path.join(work, name), bytes);
  }
  if (terminal.report) writeFileSync(path.join(work, 'REPORT.md'), artifact(terminal.report));
  const configured = obj(host.find(e => e.type === 'configured')?.payload);
  const boundaries = host.filter(e => e.type === 'worker-boundary');
  save(path.join(evidence, 'worker-settings.json'), boundaries);
  const tools = ['Read', 'Write', 'Edit'];
  const underRoot = (p: unknown) => typeof p === 'string' && path.isAbsolute(p) &&
    path.resolve(p).startsWith(root + path.sep);
  const initByWorker = raw.map(s => s.split('\n').flatMap(line => {
    try { const e = JSON.parse(line); return e?.type === 'system' && e.subtype === 'init' ? [e] : []; }
    catch { return []; }
  }));
  const init = initByWorker.flat();
  const auditsComplete = workerAuditsComplete(pipeline, host);
  const noWeb = auditsComplete && boundaries.length > 0 && boundaries.every((e, i) => {
    const boundary = obj(e.payload), settings = obj(boundary.settings), sandbox = obj(settings.sandbox);
    const net = obj(sandbox.network), fs = obj(sandbox.filesystem), permissions = obj(settings.permissions);
    const code = boundary.phase === 'code';
    const allowedTools = [...tools, ...(code ? ['Bash'] : [])];
    const environment = obj(host.findLast(e => e.type === 'environment-checked')?.payload);
    const audit = host.find(e => e.type === 'worker-tool-audit' && obj(e.payload).nonce === boundary.nonce)?.payload;
    return ['draft', 'amend', 'code', 'interpret'].includes(boundary.phase) && boundary.phase === phases[i] &&
      Array.isArray(boundary.tools) && boundary.tools.length === allowedTools.length && allowedTools.every(t => boundary.tools.includes(t)) &&
      Array.isArray(permissions.allow) && permissions.allow.length === 0 &&
      Array.isArray(permissions.deny) && [...(!code ? ['Bash'] : []), 'WebFetch', 'WebSearch', 'Agent', 'Task'].every(t => permissions.deny.includes(t)) &&
      (!code || !permissions.deny.some((rule: unknown) => typeof rule === 'string' && /^Bash(?:$|\()/.test(rule))) &&
      ['PreToolUse', 'UserPromptSubmit'].every(event => {
        const hooks = obj(settings.hooks)[event];
        return Array.isArray(hooks) && hooks.some(group => obj(group).matcher === '' &&
          Array.isArray(obj(group).hooks) && obj(group).hooks.some((h: unknown) => {
            const hook = obj(h);
            return hook.type === 'command' && typeof hook.command === 'string' && hook.command.trim() && hook.onFailure === 'block';
          }));
      }) && sandbox.enabled === true && sandbox.allowUnsandboxedCommands === false && net.strictAllowlist === true &&
      Array.isArray(net.allowedDomains) && net.allowedDomains.length === 0 &&
      (code ? codePolicyCompliant(boundary, raw[i] ?? '', audit, environment.prefix) :
        Array.isArray(fs.denyRead) && [config.home, '/private/tmp', '/private/var/folders'].every(p => fs.denyRead.includes(p)) &&
        Array.isArray(fs.allowRead) && fs.allowRead.every(underRoot)) &&
      Array.isArray(fs.allowWrite) && fs.allowWrite.length > 0 && fs.allowWrite.every(underRoot);
  }) && boundaries.length === raw.length && initByWorker.length > 0 && initByWorker.every((events, i) => events.length === 1 && events.every(e =>
    Array.isArray(e.tools) && e.tools.length > 0 && e.tools.every((t: unknown) => [...tools, "StructuredOutput", ...(phases[i] === "code" ? ["Bash"] : [])].includes(t as string)) &&
    ["mcp_servers", "plugins", "skills", "slash_commands"].every(field => Array.isArray(e[field]) && e[field].length === 0)));
  const complete = !!terminal.status && ['proven', 'observed-clean'].includes(terminal.cleanupStatus) && auditsComplete && noWeb && transcriptComplete;
  const verifiedGate = complete ? gate : { available: false, flagged: null, checks: [], findings: [] };
  // Publish only after ALL artifact, journal, containment and transcript checks.
  save(path.join(evidence, 'validity-gate.json'), verifiedGate);
  save(metaFile, { ...meta, model: config.model, model_reported: init.map(e => e.model),
    cli_version: obj(configured.executable).version ?? meta.cli_version ?? 'unavailable',
    host_result: terminal, worker_transcript_complete: transcriptComplete,
    no_web_check: noWeb && transcriptComplete ? 'pass' : 'FAIL-or-unknown', validity_gate: verifiedGate,
    host_evidence_complete: complete });
}

/** The grader checks exports against host-owned journal commitments, never a self-check
 * in an editable run_all.sh. Returns only hashes/sizes, never preparation IDs or data. */
export function verifyDeliverable(attempt: string): Record<string, { sha256: string; sizeBytes: number }> {
  const evidence = path.join(attempt, 'omerta');
  const config = json(path.join(evidence, 'investigation.json'));
  const pipeline = events(path.join(evidence, 'authority/pipeline.sqlite'), config.id);
  const record = obj(pipeline.findLast(e => e.type === 'deliverable')?.payload);
  const extension = { python: 'py', r: 'R', node: 'mjs' }[record.runtime as string];
  const files = obj(record.files);
  const expected = ['run_all.sh', 'prepare/prepare_data.py', 'prepare/spec.json', `code/analysis.${extension}`].sort();
  if (record.executionPolicy !== 'seatbelt-readonly-prepared-v1' || record.preparedBy !== 'host' || !extension || Object.keys(files).sort().join() !== expected.join()) throw new Error('complete host-prepared deliverable unavailable');
  const pins: Record<string, { sha256: string; sizeBytes: number }> = {};
  for (const name of expected) {
    const ref = obj(files[name]);
    if (!/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.sizeBytes) || ref.sizeBytes < 0) throw new Error('invalid deliverable pin');
    const components = name.split('/');
    for (let i = 1; i <= components.length; i++) {
      if (lstatSync(path.join(attempt, 'workdir', ...components.slice(0, i))).isSymbolicLink()) throw new Error('linked deliverable refused');
    }
    const file = path.join(attempt, 'workdir', name), st = lstatSync(file);
    if (!st.isFile() || st.nlink !== 1) throw new Error('non-regular deliverable refused');
    const bytes = readFileSync(file);
    if (sha(bytes) !== ref.sha256 || bytes.length !== ref.sizeBytes) throw new Error('exported deliverable integrity failure');
    pins[name] = { sha256: ref.sha256, sizeBytes: ref.sizeBytes };
  }
  for (const directory of ['code', 'prepare']) {
    if (readdirSync(path.join(attempt, 'workdir', directory)).sort().join() !== expected.filter(n => n.startsWith(directory + '/')).map(n => n.slice(directory.length + 1)).sort().join()) throw new Error('unexpected deliverable file');
  }
  return pins;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [action, root, ...args] = process.argv.slice(2);
  if (!root) throw new Error('missing arm root');
  if (action === 'prepare') prepare(root, args[0]!, args[1]!, Number(args[2]), args[3] === "1", args[4] || undefined, args[5], args[6]);
  else if (action === 'collect') collect(root, args[0]!);
  else if (action === 'verify-deliverable') process.stdout.write(JSON.stringify(verifyDeliverable(root)) + '\n');
  else throw new Error('unknown arm adapter action');
}
