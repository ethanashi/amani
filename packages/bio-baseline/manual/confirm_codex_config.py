"""Offline installed-CLI check of the exact feature flags shipped in the arm script."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

PKG = Path(__file__).resolve().parents[1]
script = (PKG / 'arms/run-codex-arm.sh').read_text()
flags = re.findall(r'--(disable|enable) ([a-z_0-9]+)', script)
args = [arg for verb, feature in flags for arg in ('--' + verb, feature)]
with tempfile.TemporaryDirectory(prefix='codex-config.', dir=PKG) as td:
    env = dict(os.environ, CODEX_HOME=td)
    run = subprocess.run(['codex', *args, '-c', 'web_search="disabled"', 'features', 'list'],
                         env=env, capture_output=True, text=True, check=True)
    features = {line.split()[0]: line.split()[-1] for line in run.stdout.splitlines()}
    checked = {feature: features.get(feature, 'unknown') for _, feature in flags}
    assert all(checked[name] == ('true' if verb == 'enable' else 'false') for verb, name in flags), checked
    help_text = subprocess.check_output(['codex', 'exec', '--help'], env=env, text=True)
    assert all(flag in help_text for flag in ('--ignore-user-config', '--ignore-rules', '--ephemeral'))
    assert 'web_search="disabled"' in script
    proof = {'version': subprocess.check_output(['codex', '--version'], text=True).strip(),
             'model_call': False, 'features': checked, 'web_search': 'disabled',
             'web_search_evidence': 'explicit -c override in shipped command; no live model probe',
             'config_isolation_flags_accepted': True}
    (PKG / 'manual/codex-config-evidence.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps(proof, indent=2))
