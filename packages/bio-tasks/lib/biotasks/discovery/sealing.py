"""Discovery-local reuse of authenticated sealing with a PATH-only OpenSSL child.

Load private module instances so legacy byte-pinned task calibrations and the shared
baseline module are unchanged. No process-global monkeypatch or environment mutation.
"""
import importlib.util
import subprocess
from ..paths import PKG, ARM_LIB


def isolated(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_adapter = isolated('biotasks._discovery_sealing', PKG / 'lib/biotasks/sealing.py')
_seal = isolated('biotasks._discovery_envelope', ARM_LIB / 'seal.py')


def _openssl(args, **kwargs):
    kwargs['env'] = {'PATH': '/usr/bin:/bin'}
    return subprocess.run(['/usr/bin/openssl', *args], **kwargs)


_seal._openssl = _openssl
_adapter.seal = _seal
seal_json = _adapter.seal_json
opened = _adapter.opened
load_json = _adapter.load_json
ciphertext_sha256 = _adapter.ciphertext_sha256

scratch = _adapter.scratch
