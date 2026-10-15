"""Build, verify, serve and grade one-shot cards.

Host layout (all inside the explicit host root, BIO_GRADING_ROOT; see discovery/staging.host_root):

    CARD/card.json               discovery-schema TaskCard (validated by discovery/card.validate_card)
    CARD/criteria.json           host view of the criteria (no expected values)
    CARD/oneshot.json            bindings: card, manifest, criteria, public contract, ciphertext, calibration
    CARD/calibration.json        reference passes; empty, verdict flips and author naive reports fail
    CARD/SEALED-KEY.json.enc     seal v2: expected values, protected terms, canary, all binding hashes
    CARD/SEALED-KEY.json.enc.sha256
    CARD/stage.py, CARD/check.py KA0-style host entrypoints (serve / grade)
    CARD/inputs/                 the analyst projection (KA0 metadata and lstat rules)

Serving and grading re-verify every byte and binding, decrypt the seal, and re-run calibration
from the sealed expectations before anything is copied or graded. Any failure refuses.
"""
from __future__ import annotations

import csv
import os
import platform
import shutil
import stat
from pathlib import Path

from ..discovery import sealing
from ..discovery.blinding import keyed
from ..discovery.card import CardError, CardRegistry, validate_card
from ..discovery.metadata import copy_analyst
from ..discovery.policy import forbidden_feature
from ..discovery.staging import host_root
from ..paths import BASELINE, PKG, REPO, TASK_ID
from . import answer as answerkey
from . import case as casemod
from . import criteria as crit
from . import jsonio, leakage, projection, sources, tables
from .registry import OneShotRegistry, RegistryError

CARD_SCHEMA = 'omb-oneshot-card/v1'
SEALED_SCHEMA = 'omb-oneshot-key/v1'
CALIBRATION_SCHEMA = 'omb-oneshot-calibration/v1'
CARD_FILES = ('card.json', 'criteria.json', 'oneshot.json', 'calibration.json', 'SEALED-KEY.json.enc',
              'SEALED-KEY.json.enc.sha256', 'stage.py', 'check.py')
BINDING_KEYS = ('schema', 'taskId', 'caseId', 'variant', 'cardHash', 'manifestHash', 'criteriaHash',
                'publicContractHash', 'ciphertextHash', 'calibrationHash', 'keyId', 'buildId')
SEALED_BINDINGS = ('taskId', 'caseId', 'variant', 'cardHash', 'manifestHash', 'criteriaHash', 'publicContractHash',
                   'buildId')
REGISTRY = 'oneshot-registry.sqlite'
DOWNLOADS = 'oneshot-downloads'
MAX_NAIVE = 32
MAX_REPORT = 1 << 20


class OneShotError(ValueError):
    pass


def _roots() -> tuple[Path, Path]:
    root = host_root()  # explicit BIO_GRADING_ROOT + BIO_SEALING_KEY, outside the repository
    return root, Path(os.environ['BIO_SEALING_KEY']).resolve()


def _case_dir(case_dir) -> Path:
    d = Path(case_dir).resolve()
    if not d.is_dir():
        raise OneShotError('case directory missing')
    development = (os.environ.get('BIO_GAUNTLET_DEVELOPMENT') == '1'
                   and d.parent == (REPO / 'race/gauntlet/cases').resolve()
                   and d.name in {f'c{i:02d}' for i in range(13,37)}
                   and casemod.load_case(d)['synthetic'])
    if d.is_relative_to(REPO.resolve()) and not development:
        raise OneShotError('case directory must live outside the repository')
    return d


def card_document(case: dict, task_id: str, manifest_hash: str, key: bytes | None) -> dict:
    c = case['card']
    seed = int.from_bytes(keyed(key, 'oneshot-seed', task_id)[:4], 'big') if key else 0
    return {'id': task_id, 'family': casemod.TRUTH_CLASSES[c['truthClass']], 'datasetManifestHash': manifest_hash,
            'prompt': 'TASK.md', 'sealedAnswerKeyRef': 'SEALED-KEY.json.enc', 'tolerance': c['tolerance'],
            'plantedFlaws': [], 'negativeControl': c['negativeControl'], 'positiveControl': c['positiveControl'],
            'heldOut': True, 'seed': seed, 'capMinutes': c['capMinutes'], 'contaminated': c['contaminated'],
            'truthClass': c['truthClass'], 'recallExposure': c['recallExposure'], 'rungTarget': c['rungTarget'],
            'gateTargets': c['gateTargets'], 'stratum': c['stratum'], 'powerAtTruth': None, 'twinOf': None,
            'synthetic': case['synthetic']}


def _check_card_overrides(case: dict) -> None:
    try:
        validate_card(card_document(case, 'oneshot-probe', '0' * 64, None))
    except CardError as e:
        raise OneShotError(f'card overrides refused: {e}') from None


def _describe(col: dict, plan, public_of: dict) -> dict:
    d = {'name': col['public'], 'role': col['role']}
    role = col['role']
    if role == 'id':
        d.update(storage='string', namespace=col['namespace'])
        if col['separator']:
            d.update(separator=col['separator'], list_order='keyed' if col['list_order'] == 'keyed' else 'source')
    elif role == 'decimal':
        d.update(storage='decimal', precision=col['precision'])
        if col.get('perturb'):
            d['perturb'] = col['perturb']
    elif role == 'categorical':
        levels = plan.levels[col['public']].values() if col['levels'] == 'keyed' else col['levels'].values()
        d.update(storage='string', levels=sorted(set(levels)))
    elif role in ('integer', 'position'):
        d['storage'] = 'integer'
        if role == 'position':
            d.update(chromosome=public_of[col['chromosome']], coordinates='remapped' if col['mode'] == 'remap' else 'shifted')
    else:
        d['storage'] = 'string'
    return d


def _placeholder_levels(case: dict, plan) -> dict:
    levels, ambiguous = {}, set()
    for spec in case['blinding']['tables'].values():
        for col in spec['columns']:
            if col['role'] != 'categorical':
                continue
            mapping = plan.levels.get(col['public'], {}) if col['levels'] == 'keyed' else col['levels']
            if col['public'] in levels and levels[col['public']] != mapping:
                ambiguous.add(col['public'])
            levels[col['public']] = mapping
    return {k: v for k, v in levels.items() if k not in ambiguous}


def answer_maps(plan, levels: dict, criteria: list[dict] = ()) -> dict:
    """Every map a criterion `namespace` may name (see case.answer_maps). The position map (one
    entry per coordinate) is only built when a criterion uses it."""
    maps = {**plan.namespaces, 'dataset': plan.datasets, 'chromosome': plan.chromosomes,
            **{f'level/{k}': v for k, v in levels.items()}}
    if any(c.get('namespace') == 'position' for c in criteria):
        maps['position'] = plan.position_map()
    return maps


def _visible_cells(analyst: Path, content: dict, wanted: set) -> set:
    """Which of `wanted` are printed as a whole cell of a projected table outside coordinate columns."""
    found = set()
    for t in content['tables']:
        skip = {i for i, c in enumerate(t['columns']) if c['role'] == 'position'}
        with open(analyst / t['path'], newline='', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter='\t', strict=True)
            next(reader, None)
            for row in reader:
                found.update(v for i, v in enumerate(row) if v in wanted and i not in skip)
                if found >= wanted:
                    return found
    return found


def _naive_reports(case_dir: Path, criteria: list[dict], maps: dict) -> dict:
    folder = case_dir / 'naive'
    if not os.path.lexists(folder):
        return {}
    if not stat.S_ISDIR(folder.lstat().st_mode):
        raise OneShotError('naive/ must be a directory')
    out = {}
    for path in sorted(folder.iterdir()):
        if path.name.startswith('.'):
            continue  # Finder/editor droppings are not reports
        if not path.name.endswith('.json'):
            raise OneShotError('naive/ may only hold *.json reports')
        if len(out) >= MAX_NAIVE:
            raise OneShotError('too many naive reports')
        try:
            report = jsonio.load_file(path, limit=MAX_REPORT)
        except (OSError, ValueError):
            raise OneShotError(f'naive report {path.name} unreadable') from None
        out[path.stem] = crit.map_report(criteria, report, maps)
    return out


def assemble(case: dict, case_dir: Path, scratch: Path, key: bytes, key_path: Path, variant: int, *, offline: bool, root: Path) -> dict:
    """Everything up to (not including) sealing. All plaintext stays under scratch in the host root."""
    staged = sources.stage(case, case_dir, scratch / 'sources', cache=root / DOWNLOADS, offline=offline)
    tbls = tables.open_tables(case, {name: info['path'] for name, info in staged.items()})
    for name, spec in case['blinding']['tables'].items():
        for col in spec['columns']:
            if col['role'] != 'drop' and (forbidden_feature(col['header']) or forbidden_feature(col['public'])):
                raise OneShotError(f'table {name}: an outcome-derived feature column must be dropped')
    plan = tables.plan(case, tbls, key, variant)
    public_tables = []
    blinded = scratch / 'blinded'
    blinded.mkdir(mode=0o700)
    for name, spec in case['blinding']['tables'].items():
        header, rows, digest = tables.blind(name, spec, tbls[name], plan, key, blinded / f'{name}.tsv')
        public_of = {c['header']: c.get('public') for c in spec['columns']}
        kept = [c for c in spec['columns'] if c['role'] != 'drop']
        order = {h: i for i, h in enumerate(tbls[name].header)}
        kept.sort(key=lambda c: order[c['header']])
        matrix = None
        if spec['layout'] == 'matrix':
            cells = {'role': spec['cells']['role']}
            if spec['cells']['precision'] is not None:
                cells['precision'] = spec['cells']['precision']
            if spec['cells'].get('perturb'):
                cells['perturb'] = spec['cells']['perturb']
            matrix = {'header_namespace': spec['header_namespace'], 'columns': len(plan.columns[(name, '*')]),
                      'cells': cells, 'order': 'keyed' if spec['column_order'] == 'keyed' else 'source'}
        letter = plan.datasets[tables.dataset_of(case, name)]
        public_tables.append({'path': projection.table_path(letter, spec['public_name']),
                              'dataset': letter, 'layout': spec['layout'],
                              'file': blinded / f'{name}.tsv', 'sha256': digest, 'header': header, 'rows': rows,
                              'columns': [_describe(c, plan, public_of) for c in kept], 'matrix': matrix,
                              'row_order': 'keyed' if spec['row_order'] == 'keyed' else 'source',
                              'missing': spec['missing'], 'subset': spec.get('rows') is not None})
    public_tables.sort(key=lambda t: t['path'])
    registries = {ns: {'kind': case['blinding']['namespaces'][ns]['kind'], 'tokens': sorted(m.values())}
                  for ns, m in plan.namespaces.items() if m}
    report = crit.public_view(case['criteria'])
    attachments = [{'path': 'data/'+filename, 'file': staged[name]['path'], 'sha256': staged[name]['sha256'], **({'columns':case['attachment_schemas'][name]} if name in case.get('attachment_schemas',{}) else {})}
                   for name, filename in case.get('public_files', {}).items()]
    # Copy: answer sandbox still needs the private source copy.
    for item in attachments:
        copied = blinded / Path(item['path']).name
        shutil.copyfile(item['file'], copied)
        item['file'] = copied
    listing = [a['path'] for a in attachments] + [t['path'] for t in public_tables] + [f'data/{ns}-aliases.tsv' for ns in sorted(registries)]
    task_md, _ = projection.render_task(case['prompt'], namespaces=plan.namespaces, datasets=plan.datasets,
                                        levels=_placeholder_levels(case, plan), files=listing, report=report)
    analyst = scratch / 'analyst'
    manifest_hash, files = projection.write(analyst, tables=public_tables, registries=registries, task_md=task_md,
                                            report=report, datasets=list(plan.datasets.values()), synthetic=case['synthetic'], attachments=attachments)
    manifest, content, _ = projection.verify(analyst, manifest_hash, deep=True)
    answer_inputs = tables.answer_sources(case, tbls, plan, key, staged, scratch / 'answer-sources')
    answer, answer_digest, script_sha = answerkey.run(case_dir, answer_inputs, scratch / 'answer',
                                                      timeout=case['answer_key']['timeout_seconds'],
                                                      runs=case['answer_key']['runs'], denied_reads=[key_path],
                                                      private_root=root)
    maps = answer_maps(plan, _placeholder_levels(case, plan), case['criteria'])
    expected = crit.resolve_expected(case['criteria'], answer, maps)
    canary = keyed(key, 'oneshot-canary', plan.context).hex()
    raw_answer = jsonio.canonical(answer)
    plaintext = {s['sha256'] for s in staged.values()} | {h for t in tbls.values() for h in t.decoded.values()} | {
        jsonio.sha256_bytes(raw_answer), jsonio.sha256_bytes(raw_answer + b'\n')}
    protected = leakage.protected_terms(case, plan, expected, case['criteria'], plaintext, canary)
    protected['synthetic_attachments'] = {a['path']: a['sha256'] for a in attachments}
    # A card whose expected value names an original the analyst never sees can never be passed
    # honestly, yet would calibrate (the reference report is built from the same values).
    problems = leakage.inexpressible(case['criteria'], expected, protected, plan.coordinates(),
                                     lambda wanted: _visible_cells(analyst, content, wanted))
    if problems:
        raise OneShotError('; '.join(problems))
    naive = _naive_reports(case_dir, case['criteria'], maps)
    outcomes, valid = crit.calibrate(case['criteria'], expected, naive)
    if leakage.collisions(protected, (t for m in plan.namespaces.values() for t in m.values())):
        raise OneShotError('an identifier token equals an original value; rebuild with another variant or key, or set a namespace prefix')
    if leakage.collisions(protected, (t for m in plan.levels.values() for t in m.values())):
        raise OneShotError('a keyed level token (L1, L2, ...) equals an original value; map those levels explicitly')
    if leakage.collisions(protected, plan.chromosomes.values()):
        raise OneShotError('a chromosome token (c1, c2, ...) equals an original value; keep or relabel those chromosomes')
    findings = leakage.Scanner(protected).scan_projection(analyst, files)
    if findings:
        raise leakage.LeakageError(findings)
    return {'analyst': analyst, 'files': files, 'manifest_hash': manifest_hash, 'public_hash': manifest['publicContractHash'],
            'content': content, 'expected': expected, 'naive': naive, 'outcomes': outcomes, 'valid': valid,
            'protected': protected, 'answer_digest': answer_digest, 'script_sha': script_sha, 'context': plan.context,
            'sources': {name: info['sha256'] for name, info in staged.items()},
            'filters': {name: spec['rows'] for name, spec in case['blinding']['tables'].items() if spec.get('rows')}}


HARNESS_PYTHON = BASELINE / '.pixi' / 'envs' / 'default' / 'bin' / 'python'


def wrapper(command: str, *, harness_root: Path | None = None) -> str:
    """Card entrypoint source (byte-pinned). Any python may start it: a different interpreter
    re-executes itself as the harness (pixi) python, the only one guaranteed to carry the stack;
    if that is missing, the in-process CLI refuses with one JSON object instead of a traceback."""
    harness_python = HARNESS_PYTHON if harness_root is None else harness_root / 'packages/bio-baseline/.pixi/envs/default/bin/python'
    library = PKG / 'lib' if harness_root is None else harness_root / 'packages/bio-tasks/lib'
    return ('import os\nimport sys\n'
            f'PYTHON = {str(harness_python)!r}\n'
            "if (os.path.realpath(sys.executable) != os.path.realpath(PYTHON) and 'oneshot-reexec' not in sys._xoptions\n"
            '        and os.access(PYTHON, os.X_OK)):\n'
            "    os.execv(PYTHON, [PYTHON, '-B', '-X', 'oneshot-reexec', os.path.abspath(__file__), *sys.argv[1:]])\n"
            f'sys.path.insert(0, {str(library)!r})\n'
            'try:\n'
            '    from pathlib import Path\n'
            '    from biotasks.oneshot.cli import card_entry\n'
            'except Exception as e:\n'
            "    sys.stdout.write('{\"error\": \"harness unavailable: ' + type(e).__name__ + '\", \"status\": \"refused\"}\\n')\n"
            '    raise SystemExit(1)\n'
            f'raise SystemExit(card_entry({command!r}, Path(__file__).resolve().parent, sys.argv[1:]))\n')


def _scan_entrypoint_matches(raw: bytes, command: str) -> bool:
    """Read-only scans may inspect cards built in another checkout. Never execute
    entrypoints or follow their embedded paths. Only the two coherent harness path
    literals may differ; every other byte must match the known wrapper template.
    Serving/grading retain the original strict local byte pin.
    """
    import ast
    try:
        tree = ast.parse(raw)
        assignment = tree.body[2]
        if not (isinstance(assignment, ast.Assign) and len(assignment.targets) == 1
                and isinstance(assignment.targets[0], ast.Name) and assignment.targets[0].id == 'PYTHON'
                and isinstance(assignment.value, ast.Constant) and isinstance(assignment.value.value, str)):
            return False
        python = Path(assignment.value.value)
        if not python.is_absolute() or len(python.parents) < 7:
            return False
        root = python.parents[6]
        return raw == wrapper(command, harness_root=root).encode()
    except (SyntaxError, ValueError, IndexError):
        return False


def _write(path: Path, raw: bytes) -> None:
    with open(path, 'xb') as f:
        f.write(raw)


def build_card(case_dir, out_dir, *, variant: int = 0, offline: bool = False, fault_at=lambda point: None) -> dict:
    root, key_path = _roots()
    case_dir = _case_dir(case_dir)
    out = Path(out_dir).resolve()
    if not out.is_relative_to(root) or out == root:
        raise OneShotError('card directory must be inside the host root')
    if not TASK_ID.match(out.name):
        raise OneShotError(f'card directory name must match {TASK_ID.pattern} (it becomes the card id)')
    if os.path.lexists(out_dir) or out.exists():
        raise OneShotError('fresh card directory required')
    if out.is_relative_to(case_dir) or case_dir.is_relative_to(out):
        raise OneShotError('case and card directories overlap')
    if type(variant) is not int or not 0 <= variant < 2 ** 31:
        raise OneShotError('variant must be a non-negative integer')
    key = key_path.read_bytes()
    case = casemod.load_case(case_dir)
    _check_card_overrides(case)
    with sealing.scratch('oneshot-build.') as scratch:
        built = assemble(case, case_dir, scratch, key, key_path, variant, offline=offline, root=root)
        if not built['valid']:
            failed = sorted(k for k, v in built['outcomes'].items() if (k == 'reference') != v)
            raise OneShotError('calibration refused: ' + ', '.join(failed))
        # The card id travels in grade output; it must not name the case either.
        if leakage.Scanner(built['protected']).originals.find(out.name, prose=True):
            raise OneShotError('card directory name contains a protected term; choose a neutral card id')
        out.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        out.mkdir(mode=0o700)
        build_id = os.urandom(16).hex()  # per build: deterministic rebuilds must not share a seal
        try:
            cipher_hash = _write_card(out, case, built, key, variant, build_id, fault_at)
            fault_at('written')
            state = verify_card(out, deep=True, pending=(cipher_hash, build_id))
            # Registered only once the new card verifies; from here every earlier build of this
            # card id (any directory) is revoked.
            OneShotRegistry(root / REGISTRY).register_build(state['card']['id'], cipher_hash, build_id)
        except BaseException:
            shutil.rmtree(out, ignore_errors=True)
            raise
    return {'status': 'built', 'card': state['card']['id'], 'manifestHash': state['card']['datasetManifestHash'],
            'files': len(state['files']), 'criteria': [c['name'] for c in case['criteria']],
            'calibration': built['outcomes']}


def _write_card(out: Path, case: dict, built: dict, key: bytes, variant: int, build_id: str, fault_at) -> str:
    copy_analyst(built['analyst'], out / 'inputs', built['files'])
    criteria_raw = jsonio.canonical_line(crit.host_view(case['criteria']))
    _write(out / 'criteria.json', criteria_raw)
    criteria_hash = jsonio.sha256_bytes(criteria_raw)
    card = card_document(case, out.name, built['manifest_hash'], key)
    validate_card(card, out)
    _write(out / 'card.json', jsonio.canonical_line(card))
    card_hash = jsonio.digest(card)
    payload = {'schema': SEALED_SCHEMA, 'taskId': card['id'], 'caseId': case['id'], 'variant': variant,
               'cardHash': card_hash, 'manifestHash': built['manifest_hash'], 'criteriaHash': criteria_hash,
               'publicContractHash': built['public_hash'], 'expected': built['expected'], 'naive': built['naive'],
               'protected': built['protected'], 'answerKeySha256': built['script_sha'],
               'answerSha256': built['answer_digest'], 'sources': built['sources'], 'filters': built['filters'],
               'python': platform.python_version(), 'buildId': build_id}
    sealing.seal_json(payload, out / 'SEALED-KEY.json.enc')
    fault_at('sealed')
    cipher_hash = jsonio.sha256_file(out / 'SEALED-KEY.json.enc')
    if sealing.ciphertext_sha256(out / 'SEALED-KEY.json.enc') != cipher_hash:
        raise OneShotError('ciphertext sidecar disagrees')
    calibration = {'schema': CALIBRATION_SCHEMA, 'outcomes': built['outcomes'], 'valid': True, 'cardHash': card_hash,
                   'manifestHash': built['manifest_hash'], 'criteriaHash': criteria_hash, 'ciphertextHash': cipher_hash}
    calibration_raw = jsonio.canonical_line(calibration)
    _write(out / 'calibration.json', calibration_raw)
    bindings = {'schema': CARD_SCHEMA, 'taskId': card['id'], 'caseId': case['id'], 'variant': variant,
                'cardHash': card_hash, 'manifestHash': built['manifest_hash'], 'criteriaHash': criteria_hash,
                'publicContractHash': built['public_hash'], 'ciphertextHash': cipher_hash,
                'calibrationHash': jsonio.sha256_bytes(calibration_raw), 'keyId': keyed(key, 'oneshot-key-id')[:8].hex(),
                'buildId': build_id}
    _write(out / 'oneshot.json', jsonio.canonical_line(bindings))
    for command in ('stage', 'check'):
        _write(out / f'{command}.py', wrapper(command).encode())
    return cipher_hash


def _canonical_file(path: Path, limit: int = 8 << 20):
    raw = jsonio.read_regular(path, limit=limit)
    value = jsonio.loads(raw)
    if raw != jsonio.canonical_line(value):
        raise OneShotError(f'{path.name} is not canonical')
    return value, raw


def verify_card(card_dir, *, decrypt: bool = True, deep: bool = False, pending: tuple[str, str] | None = None, _scan_only: bool = False) -> dict:
    """Every binding, every byte, the seal, calibration re-run from the sealed expectations, and
    the build pin: the ciphertext and build id must be the latest build registered for this card
    id (`pending` is the build being written, before it registers)."""
    root, _ = _roots()
    given = Path(card_dir)
    d = given.resolve()
    if not d.is_relative_to(root) or d == root or not stat.S_ISDIR(given.lstat().st_mode):
        raise OneShotError('card directory must be a real directory inside the host root')
    entries = {p.name: p.lstat() for p in d.iterdir()}
    if set(entries) != set(CARD_FILES) | {'inputs'}:
        raise OneShotError('card directory allowlist refused (missing or extra entries)')
    for name in CARD_FILES:
        if not stat.S_ISREG(entries[name].st_mode) or entries[name].st_nlink != 1:
            raise OneShotError('card files must be single-link regular files')
    if not stat.S_ISDIR(entries['inputs'].st_mode):
        raise OneShotError('card inputs must be a directory')
    card, _ = _canonical_file(d / 'card.json')
    validate_card(card, d)
    bindings, _ = _canonical_file(d / 'oneshot.json')
    if not isinstance(bindings, dict) or set(bindings) != set(BINDING_KEYS) or bindings['schema'] != CARD_SCHEMA:
        raise OneShotError('card bindings refused')
    criteria_doc, criteria_raw = _canonical_file(d / 'criteria.json')
    criteria = crit.validate_host_view(criteria_doc)
    calibration, calibration_raw = _canonical_file(d / 'calibration.json')
    cipher_hash = jsonio.sha256_file(d / 'SEALED-KEY.json.enc')
    if (bindings['taskId'] != card['id'] or bindings['cardHash'] != jsonio.digest(card) or
            bindings['manifestHash'] != card['datasetManifestHash'] or
            bindings['criteriaHash'] != jsonio.sha256_bytes(criteria_raw) or
            bindings['ciphertextHash'] != cipher_hash or sealing.ciphertext_sha256(d / 'SEALED-KEY.json.enc') != cipher_hash or
            bindings['calibrationHash'] != jsonio.sha256_bytes(calibration_raw)):
        raise OneShotError('card binding hashes refused')
    latest = pending if pending is not None else OneShotRegistry(root / REGISTRY).latest_build(card['id'])
    if latest != (cipher_hash, bindings['buildId']):
        raise OneShotError('card build revoked or unregistered (not the latest build of this card id)')
    if (not isinstance(calibration, dict) or calibration.get('schema') != CALIBRATION_SCHEMA or calibration.get('valid') is not True or
            calibration.get('cardHash') != bindings['cardHash'] or calibration.get('manifestHash') != bindings['manifestHash'] or
            calibration.get('criteriaHash') != bindings['criteriaHash'] or calibration.get('ciphertextHash') != cipher_hash):
        raise OneShotError('card calibration binding refused')
    for command in ('stage', 'check'):
        raw = jsonio.read_regular(d / f'{command}.py', limit=1 << 16)
        if raw != wrapper(command).encode() and not (_scan_only and _scan_entrypoint_matches(raw, command)):
            raise OneShotError('card entrypoint changed')
    manifest, content, files = projection.verify(d / 'inputs', card['datasetManifestHash'], deep=deep)
    if manifest['publicContractHash'] != bindings['publicContractHash']:
        raise OneShotError('public contract binding refused')
    payload = None
    if decrypt:
        payload = {k: v for k, v in sealing.load_json(d / 'SEALED-KEY.json.enc').items() if k != '_nonce'}
        for k in SEALED_BINDINGS:
            if payload.get(k) != bindings[k]:
                raise OneShotError('sealed key is bound to a different card')
        if payload.get('schema') != SEALED_SCHEMA or set(payload.get('expected', {})) != {c['name'] for c in criteria}:
            raise OneShotError('sealed key schema refused')
        outcomes, valid = crit.calibrate(criteria, payload['expected'], payload['naive'])
        if not valid or outcomes != calibration['outcomes']:
            raise OneShotError('sealed calibration does not reproduce')
    return {'dir': d, 'card': card, 'bindings': bindings, 'criteria': criteria, 'manifest': manifest,
            'content': content, 'files': files, 'payload': payload}


def serve(card_dir, out_dir, context_id: str) -> dict:
    root, key_path = _roots()
    state = verify_card(card_dir)
    out = Path(out_dir).resolve()
    if os.path.lexists(out_dir) or out.exists():
        raise OneShotError('fresh analyst directory required')
    if out.is_relative_to(root) or root.is_relative_to(out) or key_path.is_relative_to(out) or state['dir'].is_relative_to(out):
        raise OneShotError('analyst and host roots overlap')
    CardRegistry(root / 'card-registry.sqlite').reserve(context_id, state['card'])  # KA0 entrypoint rules
    OneShotRegistry(root / REGISTRY).reserve_look(context_id, state['bindings']['caseId'], state['card']['id'],
                                                  state['bindings']['ciphertextHash'])
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        copy_analyst(state['dir'] / 'inputs', out, state['files'])
        projection.verify(out, state['card']['datasetManifestHash'], deep=False)
        findings = leakage.Scanner(state['payload']['protected']).scan_projection(out, state['files'])
        if findings:
            raise leakage.LeakageError(findings)
    except BaseException:
        shutil.rmtree(out, ignore_errors=True)
        raise
    return {'status': 'served', 'files': len(state['files'])}


def refused(reason: str, card: str | None = None) -> dict:
    return {'status': 'refused', 'card': card, 'verdict': 'fail', 'reason': reason, 'criteria': []}


def grade(card_dir, report_path, *, context_id: str | None = None, audit: bool = False) -> dict:
    """Per-criterion pass/fail and a total verdict. Never an expected value, never a reported value."""
    if (context_id is None) == (not audit):
        return refused('usage: exactly one of a context id or audit mode')
    try:
        state = verify_card(card_dir)
    except (Exception, SystemExit):
        return refused('card-integrity')
    card_id = state['card']['id']
    try:
        if context_id is not None:
            root, _ = _roots()
            OneShotRegistry(root / REGISTRY).burn_grade(context_id, state['bindings']['caseId'],
                                                        state['bindings']['ciphertextHash'])
    except RegistryError:
        return refused('registry', card_id)
    except (Exception, SystemExit):
        return refused('unavailable', card_id)
    try:
        report = jsonio.load_file(report_path, limit=MAX_REPORT)
        valid = isinstance(report, dict)
    except (OSError, ValueError):
        report, valid = None, False
    try:
        results = crit.evaluate(state['criteria'], state['payload']['expected'], report if valid else None)
    except (Exception, SystemExit):
        return refused('unavailable', card_id)
    passed = sum(r['passed'] for r in results)
    return {'status': 'graded', 'card': card_id, 'mode': 'audit' if audit else 'context',
            'report': 'valid' if valid else 'invalid', 'verdict': 'pass' if valid and passed == len(results) else 'fail',
            'criteria': results, 'passed': passed, 'total': len(results)}


def scan(card_dir, tree, *, detailed=False) -> list:
    state = verify_card(card_dir, _scan_only=True)
    return leakage.Scanner(state['payload']['protected']).scan_tree(
        Path(tree), card=state['card']['id'], detailed=detailed)


def dry_run(case_dir, *, variant: int = 0) -> dict:
    """Validate a case end to end (sources, blinding, answer key, criteria, calibration, leakage)
    with an ephemeral key. Nothing is sealed and no card directory is written."""
    root, key_path = _roots()
    case_dir = _case_dir(case_dir)
    case = casemod.load_case(case_dir)
    _check_card_overrides(case)
    with sealing.scratch('oneshot-dry-run.') as scratch:
        built = assemble(case, case_dir, scratch, os.urandom(48), key_path, variant, offline=True, root=root)
    content = built['content']
    return {'status': 'ok' if built['valid'] else 'refused', 'case': case['id'], 'sources': len(case['sources']),
            'tables': [{'path': t['path'], 'rows': t['rows'], 'columns': len(t['columns']) + (t['matrix']['columns'] if t['matrix'] else 0)}
                       for t in content['tables']],
            'namespaces': {n['id']: n['entries'] for n in content['namespaces']},
            'criteria': [c['name'] for c in case['criteria']], 'calibration': built['outcomes']}
