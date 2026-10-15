#!/usr/bin/env python3
"""Local, commit-isolated CI. No network git operations, providers or live runs."""
import concurrent.futures
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from receipt import FAST, FULL, OPTIONAL
from processes import run as run_owned

HERE = Path(__file__).resolve().parent
HOME = Path.home()
REPO = HERE.parents[1]
STATE = HOME / '.omerta-bio/ci'
WORK = HOME / 'projects/omerta-bio-wt/_ci'
NODE = '/opt/homebrew/opt/node@24/bin/node'


def capture(args, cwd=REPO):
    return subprocess.check_output(list(map(str, args)), cwd=cwd, text=True).strip()


def atomic(file, value):
    temp = file.with_name(file.name + f'.{os.getpid()}.tmp')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    temp.replace(file)


def capacity():
    return max(1, min(4, math.floor((os.cpu_count() or 2) - os.getloadavg()[0])))


def shards(files):
    count = min(4, max(1, math.ceil(len(files) / 24)))
    return [files[i::count] for i in range(count)]


SEALED_VARIABLES = ('AMANI_LEAK_CARDS', 'BIO_GRADING_ROOT', 'BIO_SEALING_KEY', 'AMANI_LEAK_SCANNER')
# Optional: 'ROOT=KEY;ROOT=KEY' when the cards come from several grading roots with their own keys.
SEALED_OPTIONAL = ('AMANI_LEAK_KEYS', 'AMANI_LEAK_ALLOW')

def sealed_config(file):
    """Read host-owned paths as data, never execute a shell or inspect their targets."""
    if not file.is_file():
        raise RuntimeError(f'sealed-leakage configuration missing: {file}; see docs/CI.md')
    import shlex
    values = {}
    for line in file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:]
        key, sep, raw = line.partition('=')
        if not sep or key not in SEALED_VARIABLES + SEALED_OPTIONAL or key in values:
            raise RuntimeError('invalid or duplicate sealed-audit configuration variable')
        words = shlex.split(raw, comments=True)
        if len(words) != 1 or not words[0] or '$' in words[0] or '`' in words[0]:
            raise RuntimeError('sealed-audit config requires literal absolute paths, no shell expansion')
        value = words[0]
        if key == 'AMANI_LEAK_KEYS':
            pairs = value.split(';')
            if any(pair.count('=') != 1 for pair in pairs):
                raise RuntimeError('AMANI_LEAK_KEYS must be ROOT=KEY pairs separated by ;')
            paths = [part for pair in pairs for part in pair.split('=')]
        else:
            paths = value.split(':') if key == 'AMANI_LEAK_CARDS' else [value]
        if any(not Path(p).is_absolute() for p in paths):
            raise RuntimeError('sealed-audit config requires absolute paths')
        values[key] = value
    if not set(SEALED_VARIABLES) <= set(values):
        raise RuntimeError('sealed-audit config missing: ' + ', '.join(k for k in SEALED_VARIABLES if k not in values))
    return values


def writable_owned_directories(root):
    """Allow removal of frozen run directories; never follow links or chmod files."""
    mode = root.lstat()
    if not stat.S_ISDIR(mode.st_mode) or mode.st_uid != os.getuid():
        raise RuntimeError('cleanup root must be an owned directory')
    os.chmod(root, stat.S_IMODE(mode.st_mode) | stat.S_IRWXU, follow_symlinks=False)
    with os.scandir(root) as entries:
        for entry in entries:
            if entry.is_dir(follow_symlinks=False):
                writable_owned_directories(Path(entry.path))


def retain_runs(state, keep=2):
    """Prune only recognized, owned pipeline scratch; preserve every run receipt.

    Frozen files may share inodes with caches, so only directory modes are changed.
    Live runs are kept in addition to the two newest directories.
    """
    runs = []
    for root in state.iterdir():
        if not re.fullmatch(r'[0-9a-f]{12}-(?:fast|full)-[a-z0-9_]+', root.name):
            continue
        st = root.lstat()
        if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid():
            continue
        receipt = root / 'receipt.json'
        if receipt.is_symlink() or not receipt.is_file():
            continue
        try:
            data = json.loads(receipt.read_text())
        except (ValueError, OSError):
            continue
        if (not isinstance(data, dict) or data.get('schema') != 'amani-ci/v1' or
                not isinstance(data.get('commit'), str) or
                not re.fullmatch(r'[0-9a-f]{40}', data['commit']) or
                data.get('mode') not in ('fast', 'full') or
                not root.name.startswith(data['commit'][:12] + '-' + data['mode'] + '-') or
                data.get('logs') != str(root) or not isinstance(data.get('started_at'), str)):
            continue
        runs.append((data['started_at'], root.name, root, data))
    removed = []
    for _, _, root, data in sorted(runs, reverse=True)[keep:]:
        pid = data.get('pipeline_pid')
        if data.get('status') == 'running' and isinstance(pid, int) and pid > 0:
            try:
                os.kill(pid, 0)
                continue
            except ProcessLookupError:
                pass
            except PermissionError:
                continue
        saved = state / 'receipts' / 'runs'
        saved.mkdir(parents=True, exist_ok=True)
        atomic(saved / (root.name + '.json'), data)
        writable_owned_directories(root)
        shutil.rmtree(root)
        removed.append(root.name)
    return removed


class Pipeline:
    def __init__(self, mode, ref):
        self.mode = mode
        self.commit = capture(['git', 'rev-parse', '--verify', ref + '^{commit}'])
        self.tree = capture(['git', 'rev-parse', self.commit + '^{tree}'])
        STATE.mkdir(parents=True, exist_ok=True)
        (STATE / 'receipts').mkdir(exist_ok=True)
        self.logs = Path(tempfile.mkdtemp(prefix=self.commit[:12] + '-' + mode + '-', dir=STATE))
        self.receipt = STATE / 'receipts' / f'{self.commit}-{mode}.json'
        self.data = dict(schema='amani-ci/v1', commit=self.commit, tree=self.tree, mode=mode,
                         status='running', stages=[], tools={}, harness_commits={},
                         started_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                         pipeline_commit=capture(['git', 'rev-parse', 'HEAD']), pipeline_pid=os.getpid(), logs=str(self.logs))
        self.save()  # Invalidate any previous green receipt before further startup work.
        self.data['retention_removed'] = retain_runs(STATE)
        # Freeze helpers from the committed pipeline, even when testing an older ref.
        # Ongoing edits or later commits in the driver's worktree cannot change a run.
        harness_root = self.logs / 'harness'
        harness_root.mkdir()
        archive = self.logs / 'harness.tar'
        subprocess.run(['git', 'archive', '-o', str(archive), self.data['pipeline_commit'],
                        'scripts/ci', 'scripts/publish'], cwd=REPO, check=True)
        subprocess.run(['tar', '-xf', str(archive), '-C', str(harness_root)], check=True)
        archive.unlink()
        self.harness = harness_root / 'scripts/ci'
        self.data['pipeline_source_sha256'] = {str(f.relative_to(harness_root)): hashlib.sha256(f.read_bytes()).hexdigest()
            for f in sorted(harness_root.rglob('*')) if f.is_file()}
        self.env = {k: v for k, v in os.environ.items() if k in (
            'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'SHELL', 'TERM', 'PATH',
            'AMANI_CI_REPLAY_BASELINES')}
        self.env.update(CI='true', AMANI_MEDIC='', PYTHONDONTWRITEBYTECODE='1',
                        OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='1', MKL_NUM_THREADS='1',
                        VECLIB_MAXIMUM_THREADS='1', NUMEXPR_NUM_THREADS='1')
        self.checkout = None
        self.scratch = None
        self.packages = []
        self.files = []
        self.sandbox = self.logs / 'offline.sb'
        denied = [HOME / 'omerta-bio-heldout', HOME / '.omerta-bio/oneshot/tierb',
                  HOME / '.omerta-bio/oneshot/tierb2', HOME / '.omerta-bio/keys',
                  HOME / '.omerta-bio/bin', HOME / '.claude', HOME / '.local/share/claude']
        self.sandbox.write_text('(version 1)\n(allow default)\n' + ''.join(
            f'(deny file-read* (subpath {json.dumps(str(p))}))\n' for p in denied) +
            '(deny process-exec (regex #"/(sudo|pkill|killall|claude|codex)$"))\n')
        self.save()

    def save(self):
        atomic(self.logs / 'receipt.json', self.data)
        atomic(self.receipt, self.data)

    def command(self, args, log, cwd=None, env=None, timeout=1200, protected=True, native=False):
        args = list(map(str, args))
        command_env = dict(env or self.env)
        if native:
            command_env['NODE_OPTIONS'] = '--require=' + str(self.harness / 'offline-guard.cjs')
            command_env['PYTHONPATH'] = str(self.harness / 'python-guard')
        if protected and not native and sys.platform == 'darwin':
            args = ['/usr/bin/sandbox-exec', '-f', str(self.sandbox)] + args
        log.write(('$ ' + ' '.join(args) + '\n').encode()); log.flush()
        code = run_owned(args, cwd=cwd or self.checkout, env=command_env,
                         stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
        if code:
            raise RuntimeError(f'command exit {code}')

    def stage(self, name, fn=None, absent=None):
        started = time.monotonic()
        item = dict(name=name, status='running', duration_seconds=0, log=str(self.logs / (name + '.log')))
        self.data['stages'].append(item); self.save()
        with open(item['log'], 'wb') as log:
            try:
                if absent:
                    item.update(status='not present', reason=absent)
                    log.write((absent + '\n').encode())
                else:
                    fn(log)
                    item['status'] = 'passed'
            except BaseException as e:
                item.update(status='failed', reason=str(e))
                log.write((str(e) + '\n').encode())
                if isinstance(e, (KeyboardInterrupt, SystemExit)):
                    item['duration_seconds'] = round(time.monotonic()-started, 3)
                    self.save()
                    raise
        item['duration_seconds'] = round(time.monotonic() - started, 3)
        self.save()
        print(f"{item['status']:11} {name:28} {item['duration_seconds']:8.2f}s", flush=True)
        return item['status'] == 'passed'

    def preflight(self, log):
        for helper in ('pipeline.py', 'receipt.py', 'processes.py'):
            if (HERE / helper).read_bytes() != (self.harness / helper).read_bytes():
                raise RuntimeError('commit CI helper edits before running the pipeline')
        WORK.mkdir(parents=True, exist_ok=True)
        free = shutil.disk_usage(WORK).free
        log.write(f'Free bytes: {free}; required: {15 * 2**30}\n'.encode())
        if free < 15 * 2**30:
            raise RuntimeError('less than 15 GiB free')
        self.data['diff_base'] = capture(['git', 'merge-base', 'origin/main', self.commit])
        for tool in ('git', 'pnpm', 'python3'):
            self.data['tools'][tool] = capture([tool, '--version'])
        self.data['tools']['node'] = capture([NODE, '--version'])
        if not self.data['tools']['node'].startswith('v24.'):
            raise RuntimeError('Node 24 required')
        if self.mode == 'full':
            self.data['tools']['pixi'] = capture(['pixi', '--version'])

    def setup(self, log):
        # Native tests count their scratch directories; never share that namespace
        # with another CI run or a developer's concurrent test process.
        self.scratch = Path(tempfile.mkdtemp(prefix='amani-ci-', dir='/private/tmp'))
        self.env['TMPDIR'] = str(self.scratch)
        self.data['scratch'] = str(self.scratch)
        self.checkout = Path(tempfile.mkdtemp(prefix=self.commit[:12] + '-', dir=WORK))
        self.command(['git', 'worktree', 'add', '--detach', self.checkout, self.commit], log, REPO)
        self.files = capture(['git', 'ls-files', '-z'], self.checkout).split('\0')
        for f in self.files:
            if f.endswith('/package.json') and f.split('/')[0] in ('packages', 'apps'):
                # Nested fixture manifests are not workspace packages.
                if len(Path(f).parts) != 3:
                    continue
                self.packages.append((str(Path(f).parent), json.loads((self.checkout / f).read_text())))
        self.command(['pnpm', 'install', '--frozen-lockfile'], log)
        # Apps may have independent locks and may not yet be in pnpm-workspace.yaml.
        for d, _ in self.packages:
            if (self.checkout / d / 'pnpm-lock.yaml').exists():
                self.command(['pnpm', 'install', '--frozen-lockfile', '--ignore-workspace'], log, self.checkout / d)
        if capture(['git', 'diff', '--name-only', '--', '*lock*'], self.checkout):
            raise RuntimeError('frozen installation changed a tracked lockfile')
        self.data['packages'] = [d for d, _ in self.packages]
        if capture(['git', 'status', '--porcelain', '--untracked-files=normal'], self.checkout):
            raise RuntimeError('checkout was not clean after frozen installation')
        self.data['pnpm_store'] = capture(['pnpm', 'store', 'path'], self.checkout)

    def pixi(self, log):
        manifests = [f for f in self.files if f.endswith('/pixi.toml')]
        if not manifests:
            raise RuntimeError('no pinned analysis environment')
        for f in manifests:
            if not (self.checkout / Path(f).with_name('pixi.lock')).exists():
                raise RuntimeError(f'missing frozen lock for {f}')
            self.command(['pixi', 'install', '--frozen', '--manifest-path', f], log, timeout=1800)
        p = self.checkout / 'packages/bio-baseline/.pixi/envs/default/bin'
        if p.exists():
            self.env['PATH'] = str(p) + ':' + self.env['PATH']
            self.data['tools']['analysis_python'] = capture([p / 'python', '--version'], self.checkout)
            self.data['tools']['R'] = capture([p / 'R', '--version'], self.checkout).splitlines()[0]

    def typecheck(self, log):
        self.command(['pnpm', 'run', 'typecheck'], log)
        for d, p in self.packages:
            if 'typecheck' in p.get('scripts', {}):
                self.command(['pnpm', '--dir', d, 'run', 'typecheck'], log)

    def lint(self, log):
        root = json.loads((self.checkout / 'package.json').read_text())
        for d, p in [('.', root)] + self.packages:
            if 'lint' in p.get('scripts', {}):
                self.command(['pnpm', '--dir', d, 'run', 'lint'], log)

    def affected(self):
        base = self.data.get('diff_base') or capture(['git', 'merge-base', 'origin/main', self.commit])
        self.data['diff_base'] = base
        changed = capture(['git', 'diff', '--name-only', base, self.commit]).splitlines()
        dirs = {d for d, _ in self.packages}
        # Root configuration and unknown components conservatively select everything.
        if any(not any(f.startswith(d + '/') for d in dirs) for f in changed):
            return dirs
        selected = {d for d in dirs if any(f.startswith(d + '/') for f in changed)}
        names = {p.get('name'): d for d, p in self.packages}
        edges = {d: set() for d in dirs}
        for d, p in self.packages:
            for kind in ('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'):
                edges[d].update(names[n] for n in p.get(kind, {}) if n in names)
        # This repository uses direct relative source imports, not only manifest dependencies.
        for f in self.files:
            owner = next((d for d in dirs if f.startswith(d + '/')), None)
            if not owner or not f.endswith(('.ts', '.tsx', '.js', '.mjs')):
                continue
            content = (self.checkout / f).read_text(errors='replace')
            for spec in re.findall(r'''(?:from\s*|import\s*\(?|require\s*\()\s*['"]([^'"]+)''', content):
                if spec.startswith('.'):
                    dest = os.path.normpath(str(Path(f).parent / spec))
                    edges[owner].update(d for d in dirs if dest.startswith(d + '/'))
                else:
                    edges[owner].update(d for n, d in names.items() if n and (spec == n or spec.startswith(n + '/')))
            # Include source/runtime references such as new URL('../other/src/...').
            for spec in re.findall(r"[\"'](\.\.?/[^\"']+)[\"']", content):
                dest = os.path.normpath(str(Path(f).parent / spec))
                edges[owner].update(d for d in dirs if dest.startswith(d + '/'))
            # Nonliteral imports cannot be resolved statically; assume any package.
            if re.search(r"\b(?:import|require)\s*\(\s*[^\s\"'`]", content):
                edges[owner].update(dirs - {owner})
        while True:
            more = selected | {d for d in dirs if edges[d] & selected}
            if more == selected:
                return selected
            selected = more

    def unit(self, log):
        selected = self.affected() if self.mode == 'fast' else {d for d, _ in self.packages}
        self.data['unit_selection'] = sorted(selected)
        tasks = []
        for d, p in self.packages:
            if d not in selected:
                continue
            tests = [f for f in self.files if f.startswith(d + '/test/') and f.endswith('.test.ts')
                     and not (re.search(r'(^|/|[-.])live([-./]|$)', f)
                              and re.search(r'process\.env\.[A-Z_]*LIVE', (self.checkout/f).read_text()))]
            if d.startswith('apps/') or any((self.checkout / d).glob('vitest.config.*')):
                if 'test' in p.get('scripts', {}):
                    tasks.append((d, ['pnpm', 'run', 'test', *(['--maxWorkers=1', '--no-file-parallelism'] if 'vitest' in p['scripts']['test'] else [])], self.checkout / d))
            elif tests:
                for i, files in enumerate(shards(tests), 1):
                    tasks.append((d + '#shard-' + str(i), ['pnpm', 'exec', 'vitest', 'run', '--maxWorkers=1', '--no-file-parallelism', *files], self.checkout))
            elif 'test' in p.get('scripts', {}):
                tasks.append((d, ['pnpm', 'run', 'test', *(['--maxWorkers=1', '--no-file-parallelism'] if 'vitest' in p['scripts']['test'] else [])], self.checkout / d))
            else:
                log.write(f'not present: unit suite in {d}\n'.encode())
        def run(task):
            label, cmd, cwd = task
            d = label.split('#')[0]
            path = self.logs / ('unit-' + label.replace('/', '-') + '.log')
            start = time.monotonic()
            try:
                with path.open('wb') as out:
                    # This legacy suite explicitly reads the real sealing key. Only the
                    # publish scanner has authorization for protected material.
                    uses_sealed_key = any('require_real_key' in (self.checkout / f).read_text(errors='replace')
                        for f in self.files if f.startswith(d + '/test/') and f.endswith('.py'))
                    if uses_sealed_key:
                        out.write(b'FAIL: package suite requires a protected real sealing key; only the publish leak scanner may read it. Migrate these tests to synthetic keys.\n')
                        raise RuntimeError('suite requires prohibited protected-key fixtures')
                    scratch = self.scratch / hashlib.sha256(label.encode()).hexdigest()[:12]
                    scratch.mkdir(exist_ok=True)
                    self.command(cmd, out, cwd, env=dict(self.env, TMPDIR=str(scratch)), timeout=900, native=True)
                return dict(package=d, shard=label, status='passed', log=str(path), duration_seconds=round(time.monotonic()-start, 3))
            except Exception as e:
                return dict(package=d, shard=label, status='failed', log=str(path), reason=str(e), duration_seconds=round(time.monotonic()-start, 3))
        results = []
        # One worker per shard. Fill newly available slots as host load changes;
        # a long numerical suite must not stall every later package in a batch.
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            active = set()
            while tasks or active:
                while tasks and len(active) < capacity():
                    active.add(pool.submit(run, tasks.pop(0)))
                done, active = concurrent.futures.wait(active, timeout=1,
                    return_when=concurrent.futures.FIRST_COMPLETED)
                for future in done:
                    results.append(future.result())
                self.data['unit_suites'] = results
                self.save()
        self.data['unit_suites'] = results
        log.write((json.dumps(results, indent=2) + '\n').encode())
        failures = [r for r in results if r['status'] == 'failed']
        if failures:
            raise RuntimeError(f"{len(failures)} unit suite(s) failed; first log: {failures[0]['log']}")

    def audit(self, log, leak=False):
        dest = self.logs / ('audit-full-tree' if leak else 'audit-tree')
        dest.mkdir()
        archive = self.logs / 'source.tar'
        self.command(['git', 'archive', '-o', archive, self.commit], log)
        self.command(['tar', '-xf', archive, '-C', dest], log)
        archive.unlink()
        try:
            self.command([NODE, self.harness.parent / 'publish/apply-exclusions.mjs', dest,
                          self.harness.parent / 'publish/exclude.txt'], log)
            env = dict(self.env)
            if not leak:
                env.pop('AMANI_LEAK_CARDS', None)
            if leak:
                env.update(sealed_config(STATE / 'sealed-audit.env'))
                # Scan with the tested commit and its pinned environment, not a stale worktree.
                env['AMANI_LEAK_SCANNER'] = str(self.checkout / 'packages/bio-tasks/oneshot/oneshot.sh')
            report = self.logs / ('audit-full.json' if leak else 'audit.json')
            # Only this documented scanner hook may open protected material.
            self.command([NODE, self.harness.parent / 'publish/audit.mjs', dest, '--json', report], log,
                         env=env, protected=not leak)
            if leak and json.loads(report.read_text())['leakageHook']['status'] != 'ran':
                raise RuntimeError('sealed-leakage hook did not run')
        finally:
            if leak and 'report' in locals() and report.is_file():
                self.data['sealed_audit'] = json.loads(report.read_text())['leakageHook']
                self.save()
            shutil.rmtree(dest)

    def diff_scan(self, log):
        base = self.data.get('diff_base') or capture(['git', 'merge-base', 'origin/main', self.commit])
        self.data['diff_base'] = base
        dest = self.logs / 'diff-tree'; dest.mkdir()
        try:
            changes = capture(['git', 'diff', '--name-only', '--diff-filter=ACMRT', '-z', base, self.commit]).split('\0')
            for f in filter(None, changes):
                source = self.checkout / f
                target = dest / f
                target.parent.mkdir(parents=True, exist_ok=True)
                if source.is_symlink():
                    target.symlink_to(os.readlink(source))
                elif source.is_file():
                    shutil.copyfile(source, target)
            self.command([NODE, self.harness / 'scan-diff.mjs', dest], log)
        finally:
            shutil.rmtree(dest)

    def tests(self, log, pattern, env=None):
        files = [f for f in self.files if re.search(pattern, f) and f.endswith('.test.ts')]
        if not files:
            raise RuntimeError('component present but required acceptance tests missing')
        self.command(['pnpm', 'exec', 'vitest', 'run', '--maxWorkers=1', '--no-file-parallelism', *files], log, env=env, native=True)

    def integrity(self, log):
        self.tests(log, r'packages/omb-amani/test/.*integrity')
        baseline = Path(self.env.get('AMANI_CI_REPLAY_BASELINES', HOME / 'projects/omerta-bio-wt/_logs/replay'))
        target = self.logs / 'integrity-replay'; target.mkdir(exist_ok=True)
        identities = {}
        for card in ('c1', 'c2-r2', 'c4-r2'):
            file = baseline / f'tierb-{card}-round2.json'
            content = file.read_bytes()  # public saved replay output, never sealed cards
            (target / file.name).write_bytes(content)
            identities[file.name] = dict(source=str(file), sha256=hashlib.sha256(content).hexdigest())
        atomic(self.logs / 'integrity-baselines.json', identities)
        env = dict(self.env, CARD_REPLAY_LOGS=str(target))
        self.command(['bash', 'packages/omb-amani/scripts/card-integrity-acceptance.sh'], log, env=env, native=True)

    def c1(self, log):
        self.tests(log, r'packages/(?:omb-investigate/test/coloc-pipeline|omb-amani/test/(?:diagnostic-blocks|replay-baseline))')
        candidates = sorted(f for f in self.files if f.startswith('validation/amani-') and f.endswith('/step3-replay.local.ts'))
        if not candidates:
            raise RuntimeError('C1 saved replay acceptance adapter missing')
        script = candidates[-1]
        acceptance = str(Path(script).with_name('step3-acceptance.local.ts'))
        # Adapters keep outputs under ignored .integration; no historical evidence is overwritten.
        for f in (script, acceptance):
            text = (self.checkout / f).read_text()
            for directory in re.findall(r"[\"'](\.integration/[^\"']*/acceptance)/", text):
                (self.checkout / directory).mkdir(parents=True, exist_ok=True)
        self.command([NODE, '--experimental-transform-types', script], log, native=True)
        self.command([NODE, '--experimental-transform-types', acceptance], log, native=True)

    def mutation(self, log):
        # One real, deterministic mutant; baseline must pass, mutant must fail, then restore.
        source = self.checkout / 'packages/omb-amani/src/replay.ts'
        original = source.read_text()
        needle = 'if (insideDirectory(out, root))'
        if original.count(needle) != 1:
            raise RuntimeError('mutation anchor changed; update smoke operator')
        args = ['pnpm', 'exec', 'vitest', 'run', 'packages/omb-amani/test/replay.test.ts', '--maxWorkers=1', '--no-file-parallelism']
        self.command(args, log, native=True)
        try:
            source.write_text(original.replace(needle, 'if (false)', 1))
            # JSON report distinguishes an assertion kill from a compiler/tool crash.
            report = self.logs / 'mutation.json'
            try:
                self.command([*args, '--reporter=json', '--outputFile=' + str(report)], log, native=True)
            except RuntimeError:
                r = json.loads(report.read_text())
                if r.get('numFailedTests', 0) < 1 or r.get('numPassedTests', 0) < 1:
                    raise RuntimeError('mutant crashed rather than being killed by assertions')
            else:
                raise RuntimeError('mutant survived')
        finally:
            source.write_text(original)

    def development(self, log):
        python = self.checkout/'packages/bio-baseline/.pixi/envs/default/bin/python'
        evidence = self.logs/'development-projections'
        env = dict(self.env, BIO_GAUNTLET_PYTHON=str(python),
                   REFERENCE_TEST_PYTHON=str(python), RACE_REFERENCE_EVIDENCE=str(evidence),
                   RACE_AMANI_WORKTREE=str(self.checkout), RACE_DOCTOR_DISK_MIN='20')
        self.command([python, 'race/gauntlet/build.py', '--evidence-dir', evidence], log, env=env, native=True)
        self.command([python, 'race/gauntlet/validate.py', '--evidence-dir', evidence], log, env=env, native=True)
        # The race sandbox tests use the system interpreter they explicitly mount.
        self.command([sys.executable, '-m', 'unittest', 'discover', '-s', 'race/tests', '-p', 'test_*.py'], log, env=env, native=True)
        self.command([python, '-m', 'unittest', 'discover', '-s', 'factory/tests', '-p', 'test_*.py'], log, env=env, native=True)
        self.command([python, '-m', 'unittest', 'discover', '-s', 'factory', '-p', 'test_medic_failures.py'], log, env=env, native=True)

    def race(self, log):
        harness = self.checkout if (self.checkout / 'race/gauntlet.sh').exists() else HOME / 'projects/omerta-bio-wt/race'
        before = capture(['git', 'rev-parse', 'HEAD'], harness)
        self.data['harness_commits']['race'] = before
        if capture(['git', 'status', '--porcelain', '--untracked-files=no', '--', 'race'], harness):
            raise RuntimeError('race harness tracked files are dirty')
        one = HOME / 'projects/omerta-bio-wt/oneshot-harness'
        self.data['harness_commits']['oneshot'] = capture(['git', 'rev-parse', 'HEAD'], one)
        env = dict(self.env, RACE_DOCTOR_LOAD_MAX='30', RACE_DOCTOR_DISK_MIN='20',
                   BIO_GAUNTLET_PYTHON=str(self.checkout/'packages/bio-baseline/.pixi/envs/default/bin/python'))
        env.pop('AMANI_MEDIC', None)
        self.command([env['BIO_GAUNTLET_PYTHON'], harness/'race/gauntlet/build.py', '--evidence-dir', self.logs/'reference-build'], log, harness, env=env, native=True)
        self.data['reference_runs'] = []
        for iteration in range(1, 4):
            before_runs = set((harness/'race/gauntlet/runs').glob('*'))
            try:
                self.command(['sh', harness / 'race/gauntlet.sh', '--fake', '--reference-worker', '--amani', self.checkout,
                              '--cards', ','.join(f'c{i:02}' for i in range(1, 25)), '--jobs', str(min(6, capacity()))],
                             log, harness, env=env, timeout=1800, native=True)
            finally:
                for batch in set((harness/'race/gauntlet/runs').glob('*')) - before_runs:
                    saved = self.logs/f'reference-{iteration}'
                    shutil.copytree(batch, saved)
                    self.data['reference_runs'].append(str(saved/'summary.json'))
                self.save()
        if capture(['git', 'rev-parse', 'HEAD'], harness) != before:
            raise RuntimeError('race harness changed during run')

    def codec_runtime(self, log):
        """Provision a durable host cache addressed by both codec input pins."""
        source = self.checkout / 'packages/omb-investigate/format-runtime'
        pins = {name: (source / name).read_bytes() for name in ('pixi.toml', 'pixi.lock')}
        digest = hashlib.sha256(pins['pixi.toml'] + b'\0' + pins['pixi.lock']).hexdigest()[:16]
        retained = STATE.resolve() / 'runtimes'
        runtime = retained / ('codec-' + digest)
        environment = runtime / '.pixi/envs/default'

        def verify_cache():
            for file in [retained, runtime, environment, *(runtime / name for name in pins)]:
                current = retained
                for part in ('', *file.relative_to(retained).parts):
                    current = current / part
                    if current.is_symlink():
                        raise RuntimeError('pinned codec cache contains a symlink')
                resolved = file.resolve()
                if not resolved.is_relative_to(retained) or resolved.is_relative_to(self.checkout.resolve()):
                    raise RuntimeError('pinned codec cache escapes retained host state')
            for name, raw in pins.items():
                target = runtime / name
                if target.exists() and target.read_bytes() != raw:
                    raise RuntimeError('pinned codec cache inputs changed')

        verify_cache()  # Refuse every escaping path before writing or installing.
        runtime.mkdir(parents=True, exist_ok=True)
        for name, raw in pins.items():
            (runtime / name).write_bytes(raw)
        self.command(['pixi', 'install', '--frozen', '--manifest-path', runtime / 'pixi.toml'], log)
        verify_cache()
        return environment

    def engine(self, log):
        builder = self.checkout / 'packages/omb-amani/scripts/build-release.mjs'
        out = self.logs / 'engine'
        if builder.exists():
            env = dict(self.env, AMANI_CODEC_RUNTIME=str(self.codec_runtime(log)))
            self.command([NODE, builder, self.checkout, out], log, env=env)
            self.command([NODE, self.harness / 'check-engine.mjs', self.checkout, out], log)
            self.command([NODE, '--experimental-transform-types', '--input-type=module', '-e',
                          "await import('./packages/omb-amani/src/engine.ts'); console.log('packaged engine import passed')"], log, out)
        else:
            # Node 24 executes this engine's TypeScript directly. Relative imports cross
            # package boundaries, so a standalone omb-amani npm tarball is insufficient.
            if (self.checkout / 'packages/omb-amani/src/medic').exists():
                raise RuntimeError('medic runtime present without release exclusion policy')
            out.mkdir()
            archive = self.logs / 'engine-source.tar'
            self.command(['git', 'archive', '-o', archive, self.commit], log)
            self.command(['tar', '-xf', archive, '-C', out], log)
            archive.unlink()
            self.command([NODE, self.harness.parent / 'publish/apply-exclusions.mjs', out,
                          self.harness.parent / 'publish/exclude.txt'], log)
            for d in ('apps', 'validation', 'race', 'factory', '.github'):
                shutil.rmtree(out / d, ignore_errors=True)
            for d in out.glob('packages/*'):
                for part in ('test', 'tests', 'integration', 'reports'):
                    shutil.rmtree(d / part, ignore_errors=True)
            if list(out.glob('packages/omb-amani/src/medic/**/*')):
                raise RuntimeError('medic repair runtime leaked into engine package')
            self.command([NODE, '--experimental-transform-types', '--input-type=module', '-e',
                          "await import('./packages/omb-amani/src/cli.ts'); console.log('engine import smoke passed')"], log, out)
        self.command(['tar', '-czf', self.logs / 'engine.tgz', '-C', out, '.'], log)
        log.write(b'Engine source distribution: engine.tgz; zero medic repair-runtime files.\n')
        shutil.rmtree(out)

    def studio(self, log):
        app = self.checkout / 'apps/amani-studio'
        if not (app / 'src-tauri/Cargo.lock').exists():
            raise RuntimeError('Studio Cargo.lock missing')
        cargo = shutil.which('cargo', path=self.env['PATH'])
        if not cargo:
            raise RuntimeError('Cargo missing')
        self.data['tools']['cargo'] = capture([cargo, '--version'])
        wrappers = self.logs / 'frozen-tools'; wrappers.mkdir(exist_ok=True)
        # Tauri's release entry delegates to cargo. Enforce --locked at that boundary.
        import shlex
        wrapper = wrappers / 'cargo'
        wrapper.write_text('#!/bin/sh\ncase "$1" in build|rustc|check|metadata|fetch|test) exec ' + shlex.quote(cargo) + ' "$@" --locked ;;\n*) exec ' + shlex.quote(cargo) + ' "$@" ;;\nesac\n')
        wrapper.chmod(0o755)
        node_runtime = STATE/'runtimes/node-24.19.0-darwin-arm64'
        self.command([sys.executable, app/'scripts/prepare-runtime.py', node_runtime], log, timeout=600)
        env = dict(self.env, AMANI_NODE=str(node_runtime/'node-24'), CARGO_BUILD_JOBS=str(capacity()),
                   PATH=str(wrappers) + ':' + ':'.join(part for part in self.env['PATH'].split(':') if '/.pixi/' not in part),
                   CC='/usr/bin/clang', CXX='/usr/bin/clang++',
                   CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER='/usr/bin/clang')
        env['AMANI_CODEC_RUNTIME'] = str(self.codec_runtime(log))
        # Stable, lock-addressed host tools survive deletion of the CI checkout.
        # They remain external programs; the .app does not link/bundle R or OpenCode.
        for label, source, lock_name in [('analysis', 'packages/bio-baseline', 'pixi.lock'),
                                         ('opencode', '.tools/opencode', 'package-lock.json')]:
            source = self.checkout/source
            digest = hashlib.sha256((source/lock_name).read_bytes()).hexdigest()[:16]
            runtime = STATE/'runtimes'/f'{label}-{digest}'
            runtime.mkdir(parents=True, exist_ok=True)
            for name in ([lock_name, 'pixi.toml'] if label == 'analysis' else [lock_name, 'package.json']):
                shutil.copyfile(source/name, runtime/name)
            if label == 'analysis':
                self.command(['pixi', 'install', '--frozen', '--manifest-path', runtime/'pixi.toml'], log)
                env['AMANI_ANALYSIS_RUNTIME'] = str(runtime/'.pixi/envs/default')
            else:
                binary = runtime/'node_modules/opencode-darwin-arm64/bin/opencode'
                if not binary.is_file():
                    self.command(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], log, runtime)
                env['AMANI_OPENCODE_RUNTIME'] = str(binary)
        lock = (app / 'src-tauri/Cargo.lock').read_bytes()
        self.command(['pnpm', 'run', 'release'], log, app, env=env, timeout=1800)
        if (app / 'src-tauri/Cargo.lock').read_bytes() != lock:
            raise RuntimeError('Studio release changed Cargo.lock; frozen build required')
        bundles = list(app.glob('src-tauri/target/release/bundle/macos/*.app'))
        if len(bundles) != 1:
            raise RuntimeError('expected exactly one Studio .app')
        bundle = bundles[0]
        self.command(['codesign', '--force', '--deep', '--sign', '-', bundle], log)
        self.command(['codesign', '--verify', '--deep', '--strict', bundle], log)
        saved = self.logs / bundle.name
        shutil.move(str(bundle), saved)
        bundle = saved
        binaries = list((bundle / 'Contents/MacOS').iterdir())
        if len(binaries) != 1:
            raise RuntimeError('ambiguous app executable')
        resources = list(bundle.glob('Contents/Resources/**/engine/repo'))
        if len(resources) != 1:
            raise RuntimeError('packaged engine repository missing or ambiguous')
        engine_repo = resources[0]
        self.command([NODE, self.harness / 'check-engine.mjs', self.checkout, engine_repo], log)
        # Launch the real packaged engine with only its launcher port replaced.
        # No smoke test may reach the privileged client, even on an installed host.
        daemon = engine_repo.parent / 'daemon.mjs'
        fixture = self.logs / 'studio-fake-launcher.mjs'
        fixture.write_text("import {serveEngine} from " + json.dumps(daemon.as_uri()) + ";\n" +
            "import {createEngine} from " + json.dumps((engine_repo/'packages/omb-investigate/src/engine-sidecar.ts').as_uri()) + ";\n" +
            "import {LauncherAttestation} from " + json.dumps((engine_repo/'packages/omb-investigate/src/os-attestation.ts').as_uri()) + ";\n" +
            "await serveEngine(process.argv[2],process.argv[3],root=>createEngine(root,undefined,{attestation:new LauncherAttestation({installed:()=>false,client:async()=>{throw Error('fake launcher must not spawn')}})}));\n")
        env.update(AMANI_DAEMON_ENTRY=str(fixture), AMANI_ENGINE_ROOT=str(self.logs/'studio-smoke-state'),
                   AMANI_STUDIO_DIAGNOSTICS='1',
                   NODE_OPTIONS='--require='+str(self.harness/'offline-guard.cjs'),
                   PYTHONPATH=str(self.harness/'python-guard'))
        p = subprocess.Popen([str(binaries[0])], cwd=self.logs, env=env, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 30
            while not (self.logs/'studio-smoke-state/daemon.json').is_file():
                if p.poll() is not None:
                    raise RuntimeError('Studio exited before engine readiness')
                if time.monotonic() >= deadline:
                    raise RuntimeError('Studio engine readiness timed out; inspect studio-smoke-state/desktop diagnostics')
                time.sleep(.1)
            import socket
            native = json.loads((self.logs/'studio-smoke-state/desktop/engine-process.json').read_text())
            if native.get('fixture') is not False or not isinstance(native.get('pid'), int):
                raise RuntimeError('native Studio engine ownership receipt missing')
            owner = json.loads((self.logs/'studio-smoke-state/daemon.json').read_text())
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(10)
                client.connect(owner['socket'])
                client.sendall(b'{"jsonrpc":"2.0","id":1,"method":"system.status","params":{}}\n')
                stream = client.makefile('rb')
                while True:
                    line = stream.readline()
                    if not line:
                        raise RuntimeError('packaged engine closed before status response')
                    reply = json.loads(line)
                    if reply.get('id') == 1:
                        break
                stream.close()
            if reply.get('result', {}).get('launcher', {}).get('state') != 'Not installed':
                raise RuntimeError('packaged engine fake-launcher status smoke failed')
            atomic(self.logs/'studio-launch-smoke.json', reply)
        finally:
            if p.poll() is None:
                p.terminate()
                try: p.wait(timeout=10)
                except subprocess.TimeoutExpired: p.kill(); p.wait()
        shutil.rmtree(app/'src-tauri/target')
        shutil.rmtree(app/'src-tauri/resources', ignore_errors=True)
        log.write(b'Studio ad-hoc signed, launch-smoked with fake launcher, medic exclusion verified; build intermediates removed.\n')

    def paper(self, log):
        self.command([NODE, '--experimental-transform-types', 'scripts/render-sample.ts'], log,
                     self.checkout / 'packages/omb-package', native=True)
        pdfs = list((self.checkout / 'packages/omb-package/.tmp/render-a').rglob('*.pdf'))
        if not pdfs or not all(p.read_bytes().startswith(b'%PDF-') for p in pdfs):
            raise RuntimeError('sample PDF missing or invalid')
        for p in pdfs:
            shutil.copyfile(p, self.logs / p.name)

    def cleanup(self, log):
        try:
            if self.checkout:
                writable_owned_directories(self.checkout)
                self.command(['git', 'worktree', 'remove', '--force', self.checkout], log, REPO)
        finally:
            if self.scratch:
                writable_owned_directories(self.scratch)
                shutil.rmtree(self.scratch)

    def run(self):
        started = time.monotonic()
        try:
            if not self.stage('preflight', self.preflight):
                return
            if not self.stage('checkout-install', self.setup):
                return
            self.stage('typecheck', self.typecheck)
            configured = any('lint' in p.get('scripts', {}) for _, p in self.packages) or 'lint' in json.loads((self.checkout/'package.json').read_text()).get('scripts', {})
            self.stage('lint', self.lint, None if configured else 'no lint configuration')
            if self.mode == 'full':
                self.stage('pixi-environments', self.pixi)
            self.stage('unit-suites', self.unit)
            if self.mode == 'full':
                self.stage('development-suites', self.development)
            self.stage('publish-audit', lambda log: self.audit(log))
            self.stage('diff-secrets-email', self.diff_scan)
            if self.mode == 'full':
                amani = (self.checkout / 'packages/omb-amani').exists()
                absent = None if amani else 'Amani engine component absent'
                self.stage('mutation-smoke', self.mutation, absent)
                self.stage('reference-c01-c24', self.race, absent)
                self.stage('integrity', self.integrity, absent)
                self.stage('blinding', lambda log: self.tests(log, r'packages/omb-amani/test/(?:.*blind.*|served-practice|practice.*)', dict(self.env, AMANI_SERVED_PRACTICE='1')), absent)
                self.stage('replays', lambda log: self.tests(log, r'packages/omb-amani/test/.*replay'), absent)
                self.stage('c1-acceptance', self.c1, absent)
                self.stage('publish-audit-sealed', lambda log: self.audit(log, True))
                self.stage('licences', lambda log: self.command([NODE, self.harness / 'licences.mjs', self.checkout], log))
                self.stage('engine-release', self.engine, absent)
                self.stage('studio-release', self.studio, None if (self.checkout / 'apps/amani-studio').exists() else 'Studio app absent')
                self.stage('paper-pdf', self.paper, None if (self.checkout / 'packages/omb-package').exists() else 'paper toolchain component absent')
        finally:
            if self.checkout or self.scratch:
                self.stage('cleanup', self.cleanup)
            self.data['duration_seconds'] = round(time.monotonic()-started, 3)
            for name in FULL if self.mode == 'full' else FAST:
                if not any(s['name'] == name for s in self.data['stages']):
                    component = OPTIONAL.get(name)
                    missing = component and not capture(['git', 'ls-tree', self.commit, '--', component])
                    self.stage(name, lambda log: (_ for _ in ()).throw(RuntimeError('prerequisite failed; stage could not run')),
                               f'{component} absent' if missing else None)
            failures = [s for s in self.data['stages'] if s['status'] != 'passed' and s['status'] != 'not present']
            self.data['status'] = 'failed' if failures else 'passed'
            self.save()
            summary = f"{self.mode} {self.commit}: {self.data['status']} ({self.data['duration_seconds']:.1f}s)\nReceipt: {self.receipt}\n"
            if failures:
                summary += f"First failure: {failures[0]['name']} — {failures[0]['log']}\n"
            (self.logs / 'summary.txt').write_text(summary)
            print(summary, flush=True)


def main():
    if len(sys.argv) not in (2, 3) or sys.argv[1] not in ('fast', 'full'):
        sys.exit('usage: ci.sh <fast|full> [git-ref]')
    def interrupted(signum, frame):
        raise KeyboardInterrupt(f'terminated by signal {signum}')
    signal.signal(signal.SIGTERM, interrupted)
    p = Pipeline(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else 'HEAD')
    p.run()
    return 0 if p.data['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
