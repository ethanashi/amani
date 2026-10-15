// K0 and K0b safety guard mutations. Run serially from the repository root with Node 24:
//   nice -n 15 node packages/omb-certify/scripts/k0-mutations.mjs [name-prefix]
// Each mutant reverts exactly one K0/K0b fix (needle must occur once), runs its targeted regression
// tests, and is "killed" only when Vitest reports an assertion failure (crashes do not count).
// With a name prefix (e.g. "K0b-") only matching mutants run and the JSON report is not rewritten.
// Sources are restored in finally; the script refuses to start with uncommitted source changes.
// Certify calls use a private, gitignored grading root; the variable is set for children only.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const grading = path.resolve('packages/omb-certify/.grading-k0'); mkdirSync(grading, { recursive: true });
const dirty = spawnSync('git', ['status', '--porcelain', '--', 'packages/omb-certify/src', 'packages/omb-adapters/src', 'packages/omb-gauntlet/src'], { encoding: 'utf8' }).stdout.trim();
if (dirty) throw new Error('commit source changes before mutating:\n' + dirty);
const T = {
  census: 'packages/omb-certify/test/k0-census.test.ts', adapter: 'packages/omb-adapters/test/k0-census.test.ts',
  g3: 'packages/omb-certify/test/k0-g3.test.ts', gauntlet: 'packages/omb-gauntlet/test/k0-g3.test.ts', gates: 'packages/omb-gauntlet/test/gates.test.ts',
  k0bCensus: 'packages/omb-certify/test/k0b-census.test.ts', k0bG3: 'packages/omb-certify/test/k0b-g3.test.ts', parser: 'packages/omb-gauntlet/test/k0b-parser.test.ts',
};
const mutants = [
  ['K0-1 adapter: supervisor exits outside {0,80,90,124} not treated as infrastructure', 'packages/omb-adapters/src/codex.ts',
    'if (outcome.signal || code === null || ![0, 80, 90, 124].includes(code)) supervisorFailure =', 'if (false) supervisorFailure =', [T.adapter]],
  ['K0-1 adapter: clean follow-up census upgrades containment to reaped', 'packages/omb-adapters/src/codex.ts',
    "            result.containment = 'unavailable';\n            // Best-effort cleanup census only", "            result.containment = 'reaped';\n            // Best-effort cleanup census only", [T.adapter]],
  ['K0-1 executor: only exit 18 is infrastructure', 'packages/omb-certify/src/execution.ts',
    'if(reaper&&exitCode!==null&&![0,80,90,124].includes(exitCode))return empty(', 'if(reaper&&exitCode===18)return empty(', [T.census]],
  ['K0-2 supervisor: census failure drops an observed survivor', 'packages/omb-certify/src/native/reap-sandbox.c',
    'return found?found:-code;}', 'return code?-code:found;}', [T.census]],
  ['K0-2 supervisor: stopped match left unkilled when the budget expires', 'packages/omb-certify/src/native/reap-sandbox.c',
    'int killed=kill_stopped(matches,allow,deny,&unresolved);', 'int killed=exhausted?0:kill_stopped(matches,allow,deny,&unresolved);', [T.census]],
  ['K0-2 supervisor: unkillable match reported as killed (90)', 'packages/omb-certify/src/native/reap-sandbox.c',
    'if(code==5||code==7)return -code;return found?found:-code;}', 'return found?found:-code;}', [T.census]],
  ['K0-3 reaper: in-process build reused without source/flag binding', 'packages/omb-certify/src/reaper.ts',
    'if(native?.key!==key){', 'if(!native){', [T.census]],
  ['K0-4 certify: results.json read as strict JSON again', 'packages/omb-certify/src/certify.ts',
    "resultsRead.status==='read'?resultsRead.text:resultsRead.status==='refused'",
    "resultsRead.status==='read'?(t=>{try{JSON.parse(t);return t;}catch{return null;}})(resultsRead.text):resultsRead.status==='refused'", [T.g3]],
  ['K0-4 gauntlet: zero-width characters not folded', 'packages/omb-gauntlet/src/json.ts',
    '.replace(/\\p{Cf}/gu, "")', '', [T.gauntlet, T.g3]],
  ['K0-4 gauntlet: unbindable results.json claims skipped', 'packages/omb-gauntlet/src/primary.ts',
    'const strict = options.reported === true;', 'const strict = false;', [T.gauntlet]],
  ['K0-4 gauntlet: duplicate claim id tolerated', 'packages/omb-gauntlet/src/primary.ts',
    'log.error("duplicate-block", path,', 'log.warn("duplicate-block", path,', [T.gauntlet, T.g3]],
  ['K0-4 gauntlet: zero compared numbers pass G3', 'packages/omb-gauntlet/src/gates-pure.ts',
    '  if (compared === 0) return gateResult("G3", "failed", "no reported numbers were compared with the software recomputation", { claimId, code: "nothing-compared", evidence });\n', '', [T.gauntlet, T.gates]],
  ['K0-4 gauntlet: unkeyed block bound in a multi-claim plan', 'packages/omb-gauntlet/src/certify.ts',
    'const unbound = blocks.has("*") && (plan?.claims.length ?? 0) !== 1;', 'const unbound = false;', [T.gauntlet]],
  ['K0-4 certify: unkeyed block bound without a single locked claim', 'packages/omb-certify/src/producers.ts',
    'if(only===null||blocks.has(only))invalid=true;', 'if(false)invalid=true;', [T.g3]],
  ['K0-4 certify: numbers for unplanned claims ignored', 'packages/omb-certify/src/producers.ts',
    "if(numbers.length)gates.push(gateResult('G3','failed','numbers reported for a claim outside the locked plan", "if(false)gates.push(gateResult('G3','failed','numbers reported for a claim outside the locked plan", [T.g3]],
  // K0-5 as amended by amendment 13 (K0b-5): an uncomputed number is listed as unverified, never silently skipped.
  ['K0-5 certify: numbers without a software computation silently skipped (neither compared nor listed)', 'packages/omb-certify/src/certify.ts',
    'else if(expected===undefined)unverified.push(`${label}.${key}`);', 'else if(expected===undefined){}', [T.g3]],
  ['K0-5 certify: G3 compared count not counted', 'packages/omb-certify/src/certify.ts',
    'else{compared++;if(!equal(key,value,expected))', 'else{if(!equal(key,value,expected))', [T.g3]],
  ['K0-6 integrity: p method accepted for a different estimand', 'packages/omb-certify/src/integrity.ts',
    "const usable=method!==undefined&&claim.kind!=='out-of-sample'&&!methodMatchesEstimand(method,claim)?(flags.push('p method does not match the claim estimand'),undefined):method;", 'const usable=method;', [T.g3]],
  ['K0-6 integrity: p method aliases looked up on a plain object (prototype keys)', 'packages/omb-certify/src/integrity.ts',
    'P_METHODS.get(String(declared).trim().toLowerCase())', '(Object.fromEntries(P_METHODS))[String(declared).trim().toLowerCase()]', [T.g3]],
  ['K0-7 producers: absolute floor in plantedEffect restored', 'packages/omb-certify/src/producers.ts',
    'workerEstimatesMatch &&= numericAgreement(e.estimate,trusted.estimate!);', 'workerEstimatesMatch &&= Math.abs(e.estimate-trusted.estimate!)<=1e-8*Math.max(1,Math.abs(trusted.estimate!));', [T.g3]],
  // ---------------------------------------------------------------- K0b (Codex review of K0)
  ['K0b-1 executor: exit 90 marks cleanup complete without a completed census', 'packages/omb-certify/src/execution.ts',
    '(receipt===null?exitCode!==90:receipt.census===0)', 'true', [T.k0bCensus]],
  ['K0b-2 parser: mixed claims container read as one unkeyed block', 'packages/omb-gauntlet/src/primary.ts',
    'if (nested.length > 0) mixed(log, `${file}.claims`, nested);', 'if (false) mixed(log, `${file}.claims`, nested);', [T.parser, T.k0bG3]],
  ['K0b-2 parser: results.json top-level entry fields beside claim blocks ignored', 'packages/omb-gauntlet/src/primary.ts',
    'if (topLevel.length > 0) mixed(log, file, blocks.map(([k]) => k));', 'if (false) mixed(log, file, blocks.map(([k]) => k));', [T.parser]],
  ['K0b-2 parser: a nested block under an alias-colliding id ("effect") read as an entry field', 'packages/omb-gauntlet/src/primary.ts',
    'isRecord(container[k]) && !CI_KEYS.has(normKey(k))', 'isRecord(container[k]) && !ENTRY_KEYS.has(normKey(k))', [T.parser, T.k0bG3]],
  ['K0b-3 parser: lower/upper beside a ci field ignored (conflicts hidden)', 'packages/omb-gauntlet/src/primary.ts',
    'if (lo || hi) {\n      const bounds', 'if (false) {\n      const bounds', [T.parser, T.k0bG3]],
  ['K0b-3 parser: a lone bound beside a ci field accepted', 'packages/omb-gauntlet/src/primary.ts',
    'const bounds = lo && hi ? readInterval([lo.value, hi.value], log, `${path}.ci_bounds`) : null;', 'const bounds = lo && hi ? readInterval([lo.value, hi.value], log, `${path}.ci_bounds`) : interval;', [T.parser, T.k0bG3]],
  ['K0b-4 certify: refused results.json read as absent', 'packages/omb-certify/src/certify.ts',
    "resultsRead.status==='refused'?{refused:resultsRead.reason}:null),originalPlan)", 'null),originalPlan)', [T.k0bG3]],
  ['K0b-4 gauntlet: refused results.json read as absent (certifyWorkdir)', 'packages/omb-gauntlet/src/certify.ts',
    'resultsRead.status === "refused" ? { refused: resultsRead.reason } : null);', 'null);', [T.parser]],
  ['K0b-4 gauntlet: parseReported treats a refusal as absent', 'packages/omb-gauntlet/src/primary.ts',
    'if (typeof input !== "string") return { status: "invalid"', 'if (typeof input !== "string") return { status: "absent"', [T.parser, T.k0bG3]],
  ['K0b-4 reader: a final symlink is followed', 'packages/omb-gauntlet/src/certify.ts',
    'constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK', 'constants.O_RDONLY | constants.O_NONBLOCK', [T.parser, T.k0bG3]],
  ['K0b-4 reader: size cap not enforced', 'packages/omb-gauntlet/src/certify.ts',
    '    if (stat.size > cap) return refused("size-cap");\n', '', [T.parser, T.k0bG3]],
  ['K0b-5 certify: uncomputed numbers fail G3 again (pre-amendment 13)', 'packages/omb-certify/src/certify.ts',
    'else if(expected===undefined)unverified.push(`${label}.${key}`);', 'else if(expected===undefined)disagreements.push(`${label}.${key}:uncomputed`);', [T.k0bG3]],
  ['K0b-5 certify: uncomputed numbers counted as compared', 'packages/omb-certify/src/certify.ts',
    'else if(expected===undefined)unverified.push(`${label}.${key}`);', 'else if(expected===undefined){compared++;unverified.push(`${label}.${key}`);}', [T.k0bG3, T.g3]],
  ['K0b-5 certify: a malformed number without a counterpart stripped instead of failing', 'packages/omb-certify/src/certify.ts',
    'if(!Number.isFinite(value))disagreements.push(`${label}.${key}`);', 'if(expected===undefined)unverified.push(`${label}.${key}`);else if(!Number.isFinite(value))disagreements.push(`${label}.${key}`);', [T.k0bG3]],
  ['K0b-5 certify: unverified numbers not reported (no warning, no report field)', 'packages/omb-certify/src/certify.ts',
    'const recordUnverified=(claimId:string,checked:{unverified:string[]})=>{if(!checked.unverified.length)return;', 'const recordUnverified=(claimId:string,checked:{unverified:string[]})=>{return;', [T.k0bG3]],
  ["K0b-5 certify: fact metrics take the worker's companions (unverified numbers leak)", 'packages/omb-certify/src/certify.ts',
    'const entry={key:claim.id,estimate:fact.value,p:null,ci:null,se:null,nUnits:null,raw:{}};',
    "const entry={...(findEntry(parsePrimary(first.files['primary.json']??null).primary,claim.metric,true)??{}),key:claim.id,estimate:fact.value,nUnits:null,raw:{}};", [T.k0bG3, T.g3]],
  ['K0b-5 integrity: B7 flags an SE without a trusted counterpart', 'packages/omb-certify/src/integrity.ts',
    'if(entry.se!==null&&fit.se!==null&&!near(entry.se,fit.se))', 'if(entry.se!==null&&!near(entry.se,fit.se))', [T.k0bG3]],
  ['K0b-5 integrity: B7 flags a CI without a trusted counterpart', 'packages/omb-certify/src/integrity.ts',
    'if(entry.ci&&fit.ci&&(!near', 'if(entry.ci&&(!fit.ci||!near', [T.k0bG3]],
  ['K0b-5 integrity: B7 flags a p without a trusted counterpart', 'packages/omb-certify/src/integrity.ts',
    'if(entry.p!==null&&expected!==null&&!near(entry.p,expected))', 'if(entry.p!==null&&!near(entry.p,expected))', [T.k0bG3]],
];
const only = process.argv[2];
const results = [];
for (const [name, file, needle, replacement, tests] of mutants.filter(([name]) => !only || name.startsWith(only))) {
  const source = readFileSync(file, 'utf8');
  if (source.split(needle).length !== 2) throw new Error(`mutation boundary drift: ${name}`);
  const report = path.join(grading, 'mutant-report.json'); rmSync(report, { force: true });
  const started = Date.now();
  try {
    writeFileSync(file, source.replace(needle, () => replacement));
    const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...tests, '--reporter=json', `--outputFile=${report}`, '--maxWorkers=2'],
      { encoding: 'utf8', timeout: 300_000, maxBuffer: 5e7, env: { ...process.env, BIO_GRADING_ROOT: grading } });
    let parsed = null; try { parsed = JSON.parse(readFileSync(report, 'utf8')); } catch { /* unparseable report is not a kill */ }
    const failures = (parsed?.testResults ?? []).flatMap(t => t.assertionResults ?? []).filter(t => t.status === 'failed' && (t.failureMessages ?? []).some(m => /AssertionError/.test(m)));
    results.push({ name, file, tests, killed: run.status !== 0 && failures.length > 0, ms: Date.now() - started, assertions: failures.map(f => f.fullName) });
    process.stdout.write(`${results.at(-1).killed ? 'killed  ' : 'SURVIVED'} ${name} (${results.at(-1).ms} ms, ${failures.length} assertion failure(s))\n`);
  } finally { writeFileSync(file, source); }
}
if (!only) writeFileSync('packages/omb-certify/K0-GUARD-MUTATIONS.json', JSON.stringify({ mutations: results, killed: results.filter(r => r.killed).length, total: results.length,
  k0: { killed: results.filter(r => r.killed && !r.name.startsWith('K0b')).length, total: results.filter(r => !r.name.startsWith('K0b')).length },
  k0b: { killed: results.filter(r => r.killed && r.name.startsWith('K0b')).length, total: results.filter(r => r.name.startsWith('K0b')).length } }, null, 2) + '\n');
if (results.some(r => !r.killed)) process.exitCode = 1;
