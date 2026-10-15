"""Host staging: public-only projection, then separate private sealing; exact analyst allowlist."""
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from . import sealing
from .card import validate_card, load_card, key_path
from ..paths import PKG, REPO
from .blinding import canonical, digest, keyed
from .contracts import public_layer, public_files, bridge, sealable_contract
from .families import generate, reference, grade, naive, recall_only, decode, decode_ld, validate_structure
from .tier_a import ARMS, SELECTION_ARMS, cp
from .metadata import FILES, normalize, verify_metadata, copy_analyst
from .criteria import load_criteria, source_hashes, CRITERIA_HASH

PROMPT = '''Analyze data/summary.tsv and data/ld.tsv. The DATA-CONTRACT.json describes the files.
For each gene report a label, direction sign, estimate and interval when identifiable.
Labels: L2, L3, insufficient, locus-level, direction-conflict, pharmacology-mismatch, no-effect.
Write results.json as {"gene-id":{"label":"...","sign":1,"estimate":0.0,"ci":[0.0,1.0]}}.
Provide run_all.sh sourcing ./env.sh, code/, outputs/, and REPORT.md. Data are synthetic;
results must never enter real evidence or forecasts. Do not treat variant rows as subjects.
'''


ANALYST_FILES = FILES


def write_analyst(analyst, files):
    """Execute with only public observations/contract fields over stdin, and no host env.

    This is data-flow separation, not an OS sandbox: production must additionally isolate
    mounts/UIDs. The private sealer runs later and never supplies a private-layer envelope.
    """
    if set(files) != {'summary.tsv', 'ld.tsv'}:
        raise ValueError('public input allowlist')
    validate_structure(files)
    analyst = Path(analyst)
    analyst.parent.mkdir(parents=True, exist_ok=True)
    public = bridge(public_layer(files))['public']
    payload = {'publicLayer': public['content'], 'files': {k: v.decode('utf-8') for k, v in public_files(files).items()}, 'prompt': PROMPT}
    node = os.environ.get('BIO_DISCOVERY_NODE', '/opt/homebrew/opt/node@24/bin/node')
    result = subprocess.run([node, str(PKG / 'discovery/analyst-writer.ts'), str(analyst)],
                            input=canonical(payload), capture_output=True, env={'PATH': '/usr/bin:/bin'})
    if result.returncode:
        raise ValueError('public projection refused')
    normalize(analyst)
    verify(analyst, hashlib.sha256((analyst / 'manifest.json').read_bytes()).hexdigest())
    return json.loads((analyst / 'DATA-CONTRACT.json').read_bytes())['public']


def host_root():
    # No implicit default lease/key in this harness, even in production.
    if not os.environ.get('BIO_GRADING_ROOT') or not os.environ.get('BIO_SEALING_KEY'):
        raise ValueError('explicit isolated grading root and sealing key required')
    root = Path(os.environ['BIO_GRADING_ROOT']).resolve()
    # Explicit worktree-only synthetic gauntlet; never a default or a sealed-card root.
    development = (os.environ.get('BIO_GAUNTLET_DEVELOPMENT') == '1'
                   and root == (REPO / 'race/gauntlet/root').resolve()
                   and (root / '.race-synthetic').is_file()
                   and Path(os.environ['BIO_SEALING_KEY']).resolve() == (REPO / 'race/gauntlet/key').resolve())
    if root == (Path.home() / '.omerta-bio/grading').resolve() or (root.is_relative_to(REPO.resolve()) and not development):
        raise ValueError('dedicated host root outside the repository required')
    key = Path(os.environ['BIO_SEALING_KEY']).resolve()
    if not key.is_file() or len(key.read_bytes()) < 32 or (key.is_relative_to(REPO.resolve()) and not development):
        raise ValueError('private host key required')
    return root


def stage(family, stratum, seed, replicate, *, host, analyst, fault_at=lambda point: None, calibration_report=None):
    root = host_root()
    host, analyst = Path(host).resolve(), Path(analyst).resolve()
    kp = Path(os.environ['BIO_SEALING_KEY']).resolve()
    if not host.is_relative_to(root) or analyst.is_relative_to(root) or root.is_relative_to(analyst) or kp.is_relative_to(analyst):
        raise ValueError('private/analyst roots overlap')
    if host.exists() or analyst.exists():
        raise ValueError('fresh staging directories required')
    key = kp.read_bytes()
    pack = generate(family, stratum, seed, replicate, key)
    private_canary = keyed(key, 'private-canary', family, stratum, seed, replicate).hex()
    task_id = host.name
    try:
        public = write_analyst(analyst, pack['files'])
        manifest_hash = hashlib.sha256((analyst / 'manifest.json').read_bytes()).hexdigest()
        contract = sealable_contract(public['content'], pack['truth'], private_canary=private_canary)
        if contract['public'] != public:
            raise ValueError('sealer changed public contract')
        public_bytes = canonical({'public': public}) + b'\n'
        host.mkdir(parents=True, mode=0o700)
        # Full private schema and multi-valued generator truth live only in encrypted host files.
        sealing.seal_json({'dataContract': contract, 'answerKey': pack['truth'], 'canary': private_canary,
                           'synthetic': True, 'taskId': task_id, 'generator': {'family': family, 'stratum': stratum}}, host / 'SEALED-KEY.json.enc')
        fault_at('private-sealed')
        # Host card metadata (power, stratum, key ref) is intentionally absent from analyst projection.
        card = {'id': task_id, 'family': 'planted-discovery', 'datasetManifestHash': manifest_hash,
                'prompt': 'TASK.md', 'sealedAnswerKeyRef': 'SEALED-KEY.json.enc',
                'tolerance': {'absolute': .05, 'relative': .05}, 'plantedFlaws': ['sealed:F1'], 'negativeControl': False,
                'positiveControl': False, 'heldOut': True, 'seed': seed, 'capMinutes': 10, 'contaminated': False,
                'truthClass': 'planted', 'recallExposure': 'none', 'rungTarget': '2a' if family == 'PL1' else '3',
                'gateTargets': ['C1', 'C5'] if family == 'PL1' else ['C7', 'C7b'], 'stratum': stratum,
                'powerAtTruth': min(t['power'] for t in pack['truth'].values()),
                'twinOf': f'dm-pl4-forward-{replicate}' if family == 'PL4' and stratum == 'reversed' else None, 'synthetic': True}
        validate_card(card)
        (host / 'card.json').write_bytes(canonical(card) + b'\n')
        (host / 'TASK.md').write_text(PROMPT)
        (host / 'DATA-CONTRACT.json').write_bytes(public_bytes)
        (host / 'bindings.json').write_bytes(canonical({'publicContractHash': contract['public']['hash'],
            'privateContractHash': contract['sealed_private']['hash'], 'manifestHash': card['datasetManifestHash'],
            'cardHash': digest(card), 'taskId': task_id,
            'sealedFile': 'SEALED-KEY.json.enc', 'keyRefResolution': 'host-task-relative'}) + b'\n')
        answer = reference(pack['files']['summary.tsv'], family)
        outcomes = {'empty': False, 'reference': grade(answer, pack['truth']),
                    **{a: grade(recall_only(pack['entities'], family) if a == 'recall-only' else naive(pack['files']['summary.tsv'], family, a, pack['files']['ld.tsv']), pack['truth']) for a in ARMS}}
        (host / 'calibration.json').write_bytes(canonical({'outcomes': outcomes,
            'valid': outcomes['reference'] and not any(outcomes[a] for a in ARMS) and calibration_valid(calibration_report, family, stratum),
            'cardHash': digest(card), 'taskId': task_id, 'report': calibration_report,
            'family': family, 'stratum': stratum,
            'manifestHash': card['datasetManifestHash'], 'ciphertextHash': sealing.ciphertext_sha256(host / 'SEALED-KEY.json.enc')}) + b'\n')
        copy_analyst(analyst, host / 'inputs')
        (host / 'generator.json').write_bytes(canonical({'family': family, 'stratum': stratum, 'seed': seed, 'replicate': replicate}))
        # The standard task entrypoints are host-side only; never copied into analyst inputs.
        for command in ('stage', 'reference', 'check'):
            (host / (command + '.py')).write_text(
                'import sys\nfrom pathlib import Path\n' +
                'sys.path.insert(0, ' + repr(str(PKG / 'lib')) + ')\n' +
                'from biotasks.discovery.cli import dispatch\n' +
                'raise SystemExit(dispatch(' + repr(command) + ', Path(__file__).parent, sys.argv[1:]))\n')
        (host / 'naive').mkdir()
        for arm in ARMS:
            (host / 'naive' / (arm + '.py')).write_text(
                'import sys\nfrom pathlib import Path\n' +
                'sys.path.insert(0, ' + repr(str(PKG / 'lib')) + ')\n' +
                'from biotasks.discovery.cli import dispatch\n' +
                'raise SystemExit(dispatch(' + repr(arm) + ', Path(__file__).parent.parent, sys.argv[1:]))\n')
        fault_at('public-staged')
        verify(analyst, card['datasetManifestHash'])
        return {'card': card, 'publicContractHash': contract['public']['hash'], 'host': host}
    except BaseException:
        shutil.rmtree(analyst, ignore_errors=True)
        shutil.rmtree(host, ignore_errors=True)
        raise


def verify(analyst, expected_hash):
    analyst = Path(analyst)
    verify_metadata(analyst)
    path = analyst / 'manifest.json'
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected_hash:
        raise ValueError('manifest changed')
    m = json.loads(path.read_bytes())
    if set(m) != {'synthetic', 'files', 'publicContractHash'} or m['synthetic'] is not True:
        raise ValueError('synthetic provenance missing')
    actual = {name: hashlib.sha256((analyst / name).read_bytes()).hexdigest()
              for name in ANALYST_FILES if name != 'manifest.json'}
    if actual != m['files']:
        raise ValueError('staged bytes missing, extra, or changed')
    observations = {name: (analyst / 'data' / name).read_bytes() for name in ('summary.tsv', 'ld.tsv')}
    validate_structure(observations)
    # Regenerate every public byte, including alias order, provenance hashes and prose.
    for name, raw in public_files(observations).items():
        if (analyst / 'data' / name).read_bytes() != raw:
            raise ValueError('registry does not match public observations')
    content = public_layer(observations)
    public = {'content': content, 'hash': digest(content)}
    if ((analyst / 'DATA-CONTRACT.json').read_bytes() != canonical({'public': public}) + b'\n' or
            m['publicContractHash'] != public['hash'] or
            (analyst / 'TASK.md').read_text() != PROMPT or path.read_bytes() != canonical(m) + b'\n'):
        raise ValueError('public byte parity or source binding refused')
    return m


def calibration_valid(report, family, stratum):
    """Only a powered, pinned host cohort audit can validate a card. One lucky pack cannot."""
    if family != 'PL4' or stratum not in ('forward', 'reversed'):
        return False  # PL1 is deprecated, regardless of any forged/passing report.
    try:
        criteria = load_criteria(PKG / 'discovery/criteria-v3.json')
        receipt, group = report['receipt'], report['groups'][family + '/' + stratum]
        plan = receipt['plan']
        n, nk = plan['replicates'], plan['keyCount']
        threshold = criteria['calibration']['minimumReferenceLower']
        def auc_valid(metric):
            bounds = metric['bounds']
            return (type(metric['auc']) in (int, float) and isinstance(bounds, list) and len(bounds) == 2 and
                    0 <= bounds[0] <= metric['auc'] <= bounds[1] <= criteria['P7']['maximumArtefactAuc'])
        def audits_valid(audits, count):
            return set(audits) == set(SELECTION_ARMS) and all(a['passed'] is True and a['n'] == count and
                a['power'] >= criteria['artefactArms']['minimumPower'] and
                a['pValue'] > a['alpha'] for a in audits.values())
        return (receipt['criteriaHash'] == CRITERIA_HASH and receipt['criteriaVersion'] == criteria['version'] and
                receipt['planHash'] == digest(plan) and plan['sourceHashes'] == source_hashes() and
                n >= criteria['calibration']['replicatesPerKey'] and nk >= criteria['calibration']['minimumKeys'] and
                group['reference']['n'] == n*nk and cp(group['armPassCounts']['reference'], n*nk, criteria['confidence'])[0] >= threshold and
                group['calibration'] == 'valid' and group['robust'] is True and group['validKeys'] == nk and
                len(group['perKey']) == nk and {r['keyIndex'] for r in group['perKey']} == set(range(nk)) and
                all(r['valid'] is True and r['reference']['n'] == n and
                    cp(r['reference']['count'], n, criteria['confidence'])[0] >= threshold and
                    r['endToEnd']['P1']['passed'] is True and r['endToEnd']['P2']['passed'] is True and
                    audits_valid(r['selectionAudits'], n) for r in group['perKey']) and
                group['artefactsPassed'] is True and auc_valid(group['artefactClassifier']) and
                len(group['leaveOneKeyOutAuc']) == nk and all(auc_valid(c) for c in group['leaveOneKeyOutAuc']) and
                audits_valid(group['selectionAudits'], n*nk))
    except (KeyError, TypeError, ValueError, OSError, IndexError):
        return False


def validate_bindings(host, card):
    host = Path(host)
    bindings = json.loads((host / 'bindings.json').read_bytes())
    calibration = json.loads((host / 'calibration.json').read_bytes())
    kp = key_path(card, host)
    private = sealing.load_json(kp)
    generator = private.get('generator', {})
    if generator.get('family') != 'PL4' or generator.get('stratum') != card['stratum'] or generator.get('family') != calibration.get('family'):
        raise ValueError('sealed generator family refused')
    if (kp.is_symlink() or calibration.get('valid') is not True or
            calibration.get('taskId') != card['id'] or bindings.get('taskId') != card['id'] or
            calibration.get('cardHash') != digest(card) or bindings.get('cardHash') != digest(card) or
            bindings.get('sealedFile') != card['sealedAnswerKeyRef'] or
            calibration.get('manifestHash') != card['datasetManifestHash'] or
            bindings.get('manifestHash') != card['datasetManifestHash'] or
            calibration.get('family') == 'PL1' or
            calibration.get('outcomes', {}).get('empty') is not False or
            calibration.get('outcomes', {}).get('reference') is not True or
            any(calibration.get('outcomes', {}).get(a) is not False for a in ARMS) or
            calibration.get('ciphertextHash') != sealing.ciphertext_sha256(kp) or
            not calibration_valid(calibration.get('report'), calibration.get('family'), card['stratum'])):
        raise ValueError('card calibration binding refused')
    manifest = verify(host / 'inputs', card['datasetManifestHash'])
    if manifest['publicContractHash'] != bindings['publicContractHash']:
        raise ValueError('manifest public binding refused')
    public = json.loads((host / 'DATA-CONTRACT.json').read_bytes())['public']
    if public['hash'] != bindings['publicContractHash']:
        raise ValueError('public binding refused')
    return bindings


def check(attempt, sealed_key, *, host=None):
    # Legacy two-argument API resolves its host from the key parent. CLI always supplies
    # its own card directory; an override can never redirect that authority.
    try:
        host_root()
        host = Path(host) if host is not None else Path(sealed_key).parent
        card = load_card(host)
        kp = key_path(card, host)
        if Path(sealed_key).resolve() != kp.resolve():
            raise ValueError('key override refused')
        bindings = validate_bindings(host, card)
        private = sealing.load_json(kp)
        if (private['taskId'] != card['id'] or
                private['dataContract']['sealed_private']['hash'] != bindings['privateContractHash'] or
                private['dataContract']['public']['hash'] != bindings['publicContractHash']):
            raise ValueError('private binding refused')
        answer = json.loads((Path(attempt) / 'results.json').read_text())
        return {'passed': grade(answer, private['answerKey']), 'status': 'graded'}
    except (Exception, SystemExit):
        return {'passed': False, 'status': 'refused'}
