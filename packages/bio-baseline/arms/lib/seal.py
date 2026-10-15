#!/usr/bin/env python3
"""Authenticated v2 sealing. `migrate-v1 FILE [--legacy-hex]` is the only v1 reader.

Envelope: version marker, 32-byte HMAC-SHA256, salted OpenSSL AES-256-CTR ciphertext.
MAC covers marker and ciphertext, using a domain-separated key derived from all key bytes.
Sidecars hash the envelope, NEVER plaintext. Key/passphrase never enter argv or environment.
"""
from __future__ import annotations
import contextlib
import hashlib
import hmac
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import operation

KEY_PATH = Path.home() / '.omerta-bio/keys/sealing.key'
ENC_SUFFIX = '.enc'
CIPHER = 'aes-256-ctr'
MAGIC = b'OMERTA-BIO-SEAL-v2\n'
MAC_LABEL = b'omerta-bio/seal/v2/authentication-key\x00'


def key_path() -> Path:
    return Path(os.environ.get('BIO_SEALING_KEY', str(KEY_PATH)))


def ensure_key() -> Path:
    kp = key_path()
    if kp.exists():
        if kp.stat().st_size < 32:
            raise SystemExit('sealing key too short')
        return kp
    kp.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(kp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
    with os.fdopen(fd, 'wb') as f:
        f.write(os.urandom(48))
    return kp


def require_key() -> Path:
    kp = key_path()
    if not kp.is_file():
        raise SystemExit('sealing key missing')
    return kp


def _openssl(args: list[str], **kw) -> subprocess.CompletedProcess:
    exe = '/usr/bin/openssl' if Path('/usr/bin/openssl').exists() else shutil.which('openssl') or 'openssl'
    return subprocess.run([exe, *args], **kw)


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


@contextlib.contextmanager
def scratch():
    with tempfile.TemporaryDirectory(prefix='biobase-seal.', dir=operation.root()) as td:
        yield Path(td)


def crypt(src: Path, dst: Path, raw: bytes, tmp: Path, *, decrypt=False, legacy_raw=False):
    password = tmp / 'passphrase'
    fd = os.open(password, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(raw if legacy_raw else raw.hex().encode('ascii'))
        args = ['enc', '-' + CIPHER, '-d' if decrypt else '-e', '-pbkdf2', '-salt',
                '-pass', f'file:{password}', '-in', str(src), '-out', str(dst)]
        r = _openssl(args, capture_output=True)
        if r.returncode:
            raise SystemExit('openssl operation failed')
    finally:
        password.unlink(missing_ok=True)


def mac_for(cipher: Path, raw: bytes) -> bytes:
    key = hmac.digest(raw, MAC_LABEL, 'sha256')
    mac = hmac.new(key, MAGIC, 'sha256')
    with cipher.open('rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            mac.update(block)
    return mac.digest()


def envelope(src: Path, dst: Path, raw: bytes, tmp: Path):
    cipher = tmp / 'cipher'
    crypt(src, cipher, raw, tmp)
    with dst.open('wb') as f, cipher.open('rb') as c:
        f.write(MAGIC + mac_for(cipher, raw))
        shutil.copyfileobj(c, f)


def sidecar(dst: Path):
    dst.with_name(dst.name + '.sha256').write_text(sha256_file(dst) + '  ' + dst.name + '\n')


@operation.guarded
def seal_file(src: Path, remove_plaintext: bool = True) -> Path:
    raw = ensure_key().read_bytes()
    src = Path(src)
    if src.suffix == ENC_SUFFIX:
        raise SystemExit('already an .enc file')
    dst = src.with_name(src.name + ENC_SUFFIX)
    with scratch() as tmp:
        staged = tmp / 'sealed'
        envelope(src, staged, raw, tmp)
        # All production locations share the home filesystem; fail closed on EXDEV.
        os.replace(staged, dst)
        sidecar(dst)
    if remove_plaintext:
        src.unlink()
    return dst


def decrypt_verified(src: Path, dst: Path, raw: bytes, tmp: Path):
    # Snapshot ciphertext while authenticating: an attacker cannot swap it between MAC and AES.
    cipher = tmp / 'verified-cipher'
    with src.open('rb') as f, cipher.open('wb') as c:
        if f.read(len(MAGIC)) != MAGIC:
            raise SystemExit('v1 or unknown seal format refused; use migrate-v1 explicitly')
        expected = f.read(32)
        shutil.copyfileobj(f, c)
    if not hmac.compare_digest(expected, mac_for(cipher, raw)):
        raise SystemExit('seal MAC mismatch')
    crypt(cipher, dst, raw, tmp, decrypt=True)


@operation.guarded
def open_to(src_enc: Path, dest: Path) -> Path:
    dest = Path(dest)
    if not dest.resolve().is_relative_to(operation.root()):
        raise RuntimeError('plaintext destination must be inside the denied grading root')
    raw = require_key().read_bytes()
    with scratch() as tmp:
        plain = tmp / 'plain'
        decrypt_verified(Path(src_enc), plain, raw, tmp)
        side = Path(str(src_enc) + '.sha256')
        if not side.is_file():
            raise RuntimeError('missing ciphertext integrity sidecar')
        if side.read_text().split()[0] != sha256_file(Path(src_enc)):
            raise SystemExit('ciphertext integrity mismatch')
        dest.parent.mkdir(parents=True, exist_ok=True)
        os.replace(plain, dest)
    return dest


@operation.guarded
def open_bytes(src_enc: Path) -> bytes:
    with scratch() as tmp:
        out = tmp / 'plain'
        open_to(Path(src_enc), out)
        return out.read_bytes()


@operation.guarded
def migrate_v1(src: Path, *, legacy_hex=False) -> Path:
    """Explicitly retire v1 in place only after old integrity and v2 round-trip verification."""
    src = Path(src)
    with src.open('rb') as f:
        if f.read(8) != b'Salted__':
            raise SystemExit('migration requires an OpenSSL v1 artifact')
    raw = require_key().read_bytes()
    with scratch() as tmp:
        plain, new, check = tmp / 'plain', tmp / 'new', tmp / 'check'
        crypt(src, plain, raw, tmp, decrypt=True, legacy_raw=not legacy_hex)
        side = Path(str(src) + '.sha256')
        if not side.is_file() or side.read_text().split()[0] != sha256_file(plain):
            raise SystemExit('v1 integrity mismatch; original preserved')
        envelope(plain, new, raw, tmp)
        decrypt_verified(new, check, raw, tmp)
        if sha256_file(plain) != sha256_file(check):
            raise SystemExit('migration round trip failed; original preserved')
        os.replace(new, src)
        sidecar(src)
    return src


def read_text_sealed(plain: Path) -> str | None:
    plain = Path(plain)
    if plain.exists():
        return plain.read_text(errors='replace')
    enc = Path(str(plain) + ENC_SUFFIX)
    return open_bytes(enc).decode('utf-8', 'replace') if enc.exists() else None


def materialize(plain: Path, into: Path) -> Path | None:
    plain, into = Path(plain), Path(into)
    if plain.exists():
        into.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(plain, into)
        return into
    enc = Path(str(plain) + ENC_SUFFIX)
    return open_to(enc, into) if enc.exists() else None


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else ''
    if cmd == 'init':
        print(ensure_key())
    elif cmd == 'seal':
        for p in argv[2:]:
            print(seal_file(Path(p)))
    elif cmd == 'migrate-v1':
        print(migrate_v1(Path(argv[2]), legacy_hex='--legacy-hex' in argv[3:]))
    elif cmd == 'open':
        sys.stdout.buffer.write(open_bytes(Path(argv[2])))
    elif cmd == 'open-to':
        print(open_to(Path(argv[2]), Path(argv[3])))
    elif cmd == 'status':
        for p in argv[2:]:
            print(('plaintext' if Path(p).exists() else 'sealed' if Path(p + '.enc').exists() else 'missing') + '\t' + p)
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
