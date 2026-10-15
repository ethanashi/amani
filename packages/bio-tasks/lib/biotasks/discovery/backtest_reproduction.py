"""R-specific BT1 card adapter. Public raw inputs, private published key, trusted re-execution."""
import copy
import json
import math
import os
import shutil
import subprocess
import time
from pathlib import Path
from . import backtest_cards as cards
from .backtest_data import sha
from .backtest_forward import tsv
from .backtest_minikel import execute, authenticate
from .blinding import canonical, digest
from .contracts import evidence, bridge
from .backtest_cards import host_root
from . import sealing
from .metadata import normalize, verify_metadata, copy_analyst
from .card import validate_card
from ..paths import PKG


def grade_r(answer, key, receipt, *, execution=None):
    if not execution or execution.get("executed") is not True or execution.get("script_hash") != key["script_hash"]:
        return False
    if not isinstance(answer, dict) or not isinstance(receipt, dict) or receipt.get('executed') is not True or receipt.get('passed') is not True or not receipt.get('r_version','').startswith('4.2.'):
        return False
    if receipt.get('source_manifest_hash') != key['source_manifest_hash'] or receipt.get('script_hash') != key['script_hash'] or receipt.get('lock_hash') != key['lock_hash']:
        return False
    for area in ('all','neurology'):
        value=answer.get(area); observed=receipt.get('comparisons',{}).get(area,{}).get('estimate')
        if type(value) not in (int,float) or not math.isfinite(value) or type(observed) not in (int,float) or not math.isfinite(observed) or abs(value-observed) > .05 or abs(value-key['expected'][area]) > .05:
            return False
    return True


# The card asks for the unmodified upstream analysis. A constrained launch protocol makes
# the submitted execution request reviewable and prevents untrusted shell code running with
# host secrets. The host validates it and executes that exact hash-pinned R script itself.
RUN_ALL = "#!/bin/sh\nset -eu\n. ./env.sh\nRscript code/gensup_analysis.R\n"


def check_r_attempt(attempt, key, execute_request):
    try:
        attempt = Path(attempt); work = attempt/'workdir'
        if (work/'run_all.sh').is_symlink() or (work/'run_all.sh').read_text() != RUN_ALL:
            return False
        script = work/'code/gensup_analysis.R'
        if script.is_symlink() or sha(script) != key['script_hash']: return False
        # Only after checking the worker's execution request does the trusted host launch R.
        receipt = execute_request()
        claimed = json.loads((work/'results.json').read_bytes())
        return grade_r(claimed, key, receipt, execution={'executed': receipt.get('executed'), 'script_hash': sha(script)})
    except (OSError, KeyError, ValueError, TypeError):
        return False


def naive_python(root):
    """The specified rs2.py naive arm: multiply phase-transition risk ratios, without R's model."""
    from collections import defaultdict
    root=Path(root); pp=list(tsv(root/'data/pp.tsv'))
    indic={r['indication_mesh_id']:r for r in tsv(root/'data/indic.tsv')}
    scores=defaultdict(float)
    for r in tsv(root/'data/merge2.tsv.gz'):
        if r['assoc_source'] in ('NA','intOGen'):continue
        try:
            score=float(r['comb_norm'])
            if r['assoc_source']=='OTG' and float(r['l2g_share'])<.5:continue
        except ValueError:continue
        scores[r['ti_uid']]=max(scores[r['ti_uid']],score)
    results={}
    for area in ('all','neurology'):
        product=1.
        for col in ('succ_1_2','succ_2_3','succ_3_a'):
            totals=[0,0];successes=[0,0]
            for r in pp:
                ind=indic.get(r['indication_mesh_id'])
                if not ind or ind['genetic_insight']=='none' or (area!='all' and area not in ind['areas']) or r[col] not in ('TRUE','FALSE'):continue
                g=int(scores[r['ti_uid']]>=.8);totals[g]+=1;successes[g]+=r[col]=='TRUE'
            if not all(totals) or successes[0]==0:raise ValueError('naive arm undefined')
            product *= (successes[1]/totals[1])/(successes[0]/totals[0])
        results[area]=product
    return results


PROMPT = ('This is a synthetic keyed transition twin of the public reproduction, not the published data. '
    'Use workdir/code/gensup_analysis.R containing the supplied unmodified script, and workdir/run_all.sh with exactly: '
    + json.dumps(RUN_ALL) + ' . Re-execute the supplied script on the supplied data in pinned R 4.2. '
    'Report table_s22 rs_filtered for all and neurology as results.json {"all":number,"neurology":number}. '
    'The host independently reruns the same script and grades within ±0.05. Published numbers are not the answer. '
    'No ranking certification follows.\n')


def reproduction_public(source):
    from .backtest_data import verify_sources
    manifest = verify_sources(source)
    rows = [{'pair':'bundle','target':'upstream-R-analysis','drug':'','indication':'keyed-twin',
             'phase':0,'area':'all','status':'unmatched','support':''}]
    raw = cards.table(rows)
    public = cards.contract(rows,raw,None,canary=None,synthetic=True,source_hash=None,public_only=True)
    structure = public['structure']
    additions = [i for i in manifest['files'] if i['path'].startswith(('data/','src/'))]
    structure['source_files'] += [{'path':i['path'],'sha256':i['sha256']} for i in additions]
    structure['limitations'] = ['Synthetic keyed transition twin; original names retained. Not biological evidence.',
        'The pairs table is a bundle inventory. Upstream TSV headers supply raw-file schemas; detailed per-table K1b semantics are not supplied.']
    for producer in public['producers']: producer['source_bundle_hash']=digest(structure['source_files'])
    public['evidence']=evidence(structure,'/structure')
    return rows, public, additions


def verify_reproduction(path, expected, source):
    rows, content, additions = reproduction_public(source)
    files = cards.analyst_files(path) | {i['path'] for i in additions}
    verify_metadata(path, files)
    if sha(path/'manifest.json') != expected: raise ValueError('manifest changed')
    m=json.loads((path/'manifest.json').read_bytes())
    public={'content':content,'hash':digest(content)}
    payloads={'TASK.md':PROMPT.encode(),'DATA-CONTRACT.json':canonical({'public':public})+b'\n',
              'FEATURES.json':canonical([{'name':'support','storage':'numeric','provenance':'unverified candidate; audit use empirically'}])+b'\n',
              'data/pairs.tsv':cards.table(rows),**{d['file']['path']:raw for d,raw in cards.pair_registries(rows)}}
    hashes={name:__import__('hashlib').sha256(raw).hexdigest() for name,raw in payloads.items()}
    hashes.update({i['path']:i['sha256'] for i in additions})
    expected_manifest={'synthetic':True,'files':hashes,'publicContractHash':public['hash']}
    if (m != expected_manifest or (path/'manifest.json').read_bytes()!=canonical(m)+b'\n' or
        any(sha(path/name)!=h for name,h in hashes.items())): raise ValueError('public byte parity refused')
    return files


def _stage_reproduction(source, runtime, receipt, *, host, analyst, manifest, criteria_hash, fault_at=lambda p:None):
    source,runtime,host,analyst=map(Path,(source,runtime,host,analyst))
    published={r['area']:float(r['rs_filtered']) for r in tsv(source/'display_items/table_s22.tsv') if r['area'] in ('all','neurology')}
    if (manifest.get('derivation',{}).get('kind') != 'keyed-transition-twin-v1' or
        receipt.get('key_origin') != 'keyed-transition-twin-v1' or not receipt.get('hmac') or
        not __import__('hmac').compare_digest(receipt['hmac'], authenticate(receipt, Path(os.environ['BIO_SEALING_KEY']).read_bytes()))):
        raise ValueError('authenticated keyed twin R receipt required')
    expected={k:receipt['comparisons'][k]['estimate'] for k in ('all','neurology')}
    key={'expected':expected,'source_manifest_hash':sha(source/'sources.json'),
         'script_hash':sha(source/'src/gensup_analysis.R'),'lock_hash':sha(runtime/'pixi.lock')}
    if not grade_r(expected,key,receipt,execution={'executed':True,'script_hash':key['script_hash']}):
        raise ValueError('twin receipt binding refused')
    if all(abs(expected[k]-published[k])<=.1 for k in expected):
        raise ValueError('twin does not separate recall; unavailable, never resample')
    rows, public_content, additions = reproduction_public(source)
    cards.write_analyst(analyst,rows,PROMPT,synthetic=True)
    for item in additions:
        result=subprocess.run([os.environ.get('BIO_DISCOVERY_NODE','/opt/homebrew/opt/node@24/bin/node'),
            str(PKG/'discovery/analyst-writer.ts'),str(analyst),'--public-file',item['path'],item['sha256']],
            input=(source/item['path']).read_bytes(),capture_output=True,env={'PATH':'/usr/bin:/bin'})
        if result.returncode: raise ValueError('public bundle writer refused')
    public=bridge(public_content)['public']
    (analyst/'DATA-CONTRACT.json').write_bytes(canonical({'public':public})+b'\n')
    files=cards.analyst_files(analyst)|{i['path'] for i in additions}
    m={'synthetic':True,'files':{name:sha(analyst/name) for name in files if name!='manifest.json'},'publicContractHash':public['hash']}
    (analyst/'manifest.json').write_bytes(canonical(m)+b'\n')
    normalize(analyst,files)
    manifest_hash=sha(analyst/'manifest.json')  # Pin before the private bridge or sealing.
    private_layer=copy.deepcopy(public['content'])
    private_layer.update(schema_version='omb-data-contract-private/v3.1',public_hash=public['hash'],
        planted_defects=[{'id':'sealed-key','description':canonical(key).decode(),'affected_nodes':['upstream-R-analysis']}])
    private_layer['evidence']+=evidence(private_layer['planted_defects'],'/planted_defects')
    dc=bridge(public['content'],private_layer)
    if dc['public']!=public: raise ValueError('sealer changed public bytes')
    host.mkdir(parents=True,mode=0o700)
    canary=__import__('hmac').new(Path(os.environ['BIO_SEALING_KEY']).read_bytes(),host.name.encode(),'sha256').hexdigest()
    sealing.seal_json({'answerKey':key,'dataContract':dc,'canary':canary,'taskId':host.name},host/'SEALED-KEY.json.enc')
    fault_at('private-sealed')
    verify_reproduction(analyst,manifest_hash,source)
    card={'id':host.name,'family':'frozen-backtest','datasetManifestHash':manifest_hash,'prompt':'TASK.md',
        'sealedAnswerKeyRef':'SEALED-KEY.json.enc','tolerance':{'absolute':.05,'relative':0},'plantedFlaws':['sealed:ka1'],
        'negativeControl':False,'positiveControl':False,'heldOut':False,'seed':1,'capMinutes':60,'contaminated':True,
        'truthClass':'frozen-backtest','recallExposure':'high','rungTarget':'4','gateTargets':['D1'],'stratum':'development',
        'powerAtTruth':None,'twinOf':None,'synthetic':True}
    validate_card(card)
    (host/'card.json').write_bytes(canonical(card))
    copy_analyst(analyst,host/'inputs',files)
    for name in ('TASK.md','DATA-CONTRACT.json'):shutil.copyfile(analyst/name,host/name)
    bindings={'criteria_sha256':criteria_hash,'manifest_hash':manifest_hash,'taskId':host.name,'cardHash':digest(card),
        'publicContractHash':dc['public']['hash'],'privateContractHash':dc['sealed_private']['hash'],
        'ciphertextHash':sha(host/'SEALED-KEY.json.enc'),'implementation':cards.implementation_bindings(),
        'source':str(source.resolve()),'runtime':str(runtime.resolve()),'reproduction_code_sha256':sha(__file__)}
    (host/'bindings.json').write_bytes(canonical(bindings))
    naive=naive_python(source)
    with sealing.scratch('ka1-r-calibration.') as scratch:
        outcomes={}
        for arm,answer in [('reference',expected),('naive-python',naive),('recall-only',published),
                           ('recall-rounded',{'all':2.6,'neurology':2.5}),('empty',{}),('always-abstain',{'status':'insufficient'})]:
            work=scratch/arm/'workdir';(work/'code').mkdir(parents=True)
            (work/'results.json').write_bytes(canonical(answer))
            # Every arm, including recall, receives the exact dictated execution request.
            (work/'run_all.sh').write_text(RUN_ALL);shutil.copyfile(source/'src/gensup_analysis.R',work/'code/gensup_analysis.R')
            outcomes[arm]=check_r_attempt(work.parent,key,lambda:receipt)
    (host/'calibration.json').write_bytes(canonical({'outcomes':outcomes,
        'valid':outcomes['reference'] and not outcomes['recall-only'] and not outcomes['recall-rounded'] and not outcomes['empty'] and not outcomes['always-abstain'],
        'key_origin':'keyed-transition-twin-v1','certified':False,'naive_numeric_in_tolerance':all(abs(naive[k]-expected[k])<=.05 for k in expected),
        'note':'Naive Python is diagnostic: it computes from the twin and may be numerically correct.'}))
    for command in ('stage','reference','check'):
        (host/(command+'.py')).write_text('import sys\nfrom pathlib import Path\nsys.path.insert(0,'+repr(str(PKG/'lib'))+')\nfrom biotasks.discovery.backtest_reproduction import dispatch\nraise SystemExit(dispatch('+repr(command)+',Path(__file__).parent,sys.argv[1:]))\n')
    return {'card':card,'naive_estimates':naive}


def dispatch(command,host,argv):
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path);p.add_argument('--attempt',type=Path);p.add_argument('--data',type=Path);a=p.parse_args(argv)
    try:
        host_root();bindings=json.loads((host/'bindings.json').read_bytes());card=json.loads((host/'card.json').read_bytes())
        if sha(__file__)!=bindings['reproduction_code_sha256'] or any(sha(p)!=h for p,h in bindings['implementation'].items()):raise ValueError('code changed')
        files=verify_reproduction(host/'inputs',card['datasetManifestHash'],Path(bindings['source']))
        cards.validate_bindings(host,card)
        private=sealing.load_json(host/'SEALED-KEY.json.enc');cards.validate_private(private,bindings,card)
        if command=='stage':
            if a.out is None or a.out.exists(): raise ValueError('fresh output required')
            copy_analyst(host/'inputs',a.out,files)
            verify_reproduction(a.out,card['datasetManifestHash'],Path(bindings['source']))
            return 0
        with sealing.scratch('ka1-r-reexecute.') as scratch:
            from .backtest_freeze import freeze
            criteria=PKG/'discovery/backtests/criteria-v5.json'
            source=Path(bindings['source']);runtime=Path(bindings['runtime'])
            from .backtest_data import verify_sources
            files=[source/r['path'] for r in verify_sources(source)['files']]+[source/'sources.json',runtime/'pixi.lock']
            plan=freeze(criteria,sha(criteria),files,scratch/'freeze',now=lambda:'host-check')
            def launch():
                return execute(source,runtime,out=scratch/'r',now=time.monotonic,precommit=plan,auth_key=Path(os.environ['BIO_SEALING_KEY']).read_bytes(),derive_twin=True)
            if command=='reference':
                if a.out is None or not a.out.resolve().is_relative_to(host_root()):raise ValueError('private output required')
                receipt=launch();answer={k:r['estimate'] for k,r in receipt.get('comparisons',{}).items()}
                a.out.mkdir(parents=True,exist_ok=True);(a.out/'results.json').write_bytes(canonical(answer));return 0 if receipt.get('passed') else 1
            passed=check_r_attempt(a.attempt,private['answerKey'],launch)
            print(json.dumps({'passed':passed,'certified':False}));return 0 if passed else 1
    except (ValueError,OSError,KeyError,TypeError):
        print('{"passed":false,"status":"unavailable"}');return 1


def stage_reproduction(source, runtime, receipt, **kwargs):
    root = host_root()
    host, analyst = Path(kwargs['host']).resolve(), Path(kwargs['analyst']).resolve()
    if not host.is_relative_to(root) or host.exists() or analyst.exists() or analyst.is_relative_to(root) or root.is_relative_to(analyst):
        raise ValueError('fresh disjoint reproduction roots required')
    try:
        return _stage_reproduction(source, runtime, receipt, **kwargs)
    except BaseException:
        for name in ('host', 'analyst'):
            shutil.rmtree(kwargs[name], ignore_errors=True)
        raise
