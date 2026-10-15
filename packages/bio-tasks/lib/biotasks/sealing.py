"""Shared authenticated v2 sealing; plaintext scratch is always removed."""
from __future__ import annotations

import contextlib
import json
import os
import shutil
import tempfile
from pathlib import Path

from .paths import use_baseline

use_baseline()
import operation  # noqa: E402
import seal  # noqa: E402

NONCE_FIELD = "_nonce"


def canonical(obj) -> bytes:
    return (json.dumps(obj, indent=2, sort_keys=True) + "\n").encode()


@contextlib.contextmanager
def scratch(prefix: str):
    """A private temp dir beneath the grading root, held under the grading lease, always removed."""
    with operation.lease():
        tmp = Path(tempfile.mkdtemp(prefix=prefix, dir=operation.root())).resolve()
        try:
            os.chmod(tmp, 0o700)
            yield tmp
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


def seal_file(plain: Path, tmp: Path) -> Path:
    return seal.seal_file(Path(plain))


def seal_json(obj: dict, dest: Path) -> Path:
    """Seal `obj` (plus a fresh nonce) to `dest` (…/SEALED-KEY.json.enc) and its .sha256 sidecar."""
    dest = Path(dest)
    if dest.name != "SEALED-KEY.json.enc":
        raise SystemExit("sealed key destination must be named SEALED-KEY.json.enc")
    if NONCE_FIELD in obj:
        raise SystemExit(f"key must not already carry {NONCE_FIELD}")
    with scratch("biotasks-seal.") as tmp:
        plain = tmp / dest.name[: -len(".enc")]
        plain.write_bytes(canonical({**obj, NONCE_FIELD: os.urandom(16).hex()}))
        enc = seal_file(plain, tmp)                       # removes the plaintext
        side = enc.with_name(enc.name + ".sha256")
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(enc), str(dest))
        shutil.move(str(side), str(dest.with_name(dest.name + ".sha256")))
        if plain.exists():
            raise SystemExit("plaintext key survived sealing")
    return dest


@contextlib.contextmanager
def opened(enc: Path):
    """Yield a plaintext copy of a sealed file inside a grading-root temp dir; removed on exit.
    Decryption verifies the v2 MAC and ciphertext sidecar, so a wrong key or corrupt file refuses."""
    enc = Path(enc)
    if not enc.name.endswith(".enc"):
        raise SystemExit("not a sealed .enc file")
    with scratch("biotasks-key.") as tmp:
        plain = tmp / enc.name[: -len(".enc")]
        seal.open_to(enc, plain)
        yield plain


def load_json(enc: Path) -> dict:
    """Decrypt and parse a sealed JSON key (kept in memory only). Callers must never print it."""
    with opened(enc) as plain:
        return json.loads(plain.read_text())


def strip_nonce(key: dict) -> dict:
    return {k: v for k, v in key.items() if k != NONCE_FIELD}


def ciphertext_sha256(enc: Path) -> str:
    side = Path(enc).with_name(Path(enc).name + ".sha256")
    return side.read_text().split()[0]
