"""Source acquisition: verify every byte against the case's sha256 before anything reads it.

Pre-downloaded local files are preferred. A URL is fetched only when no local copy exists,
only over https (plain http only to loopback, for tests), only when the declared size is at
most 1 GB, and the stream is cut the moment it would exceed the declared size. Downloads land
in the host root's cache, never in the case directory. Every byte the build uses comes from a
private scratch copy that was hashed while it was written, so a file swapped after
verification cannot reach blinding or answer_key.py.
"""
from __future__ import annotations

import hashlib
import ipaddress
import os
import stat
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

MAX_DOWNLOAD_BYTES = 1_000_000_000  # "over 1 GB" is refused; decimal GB is the stricter reading
CHUNK = 1 << 20
LOOPBACK = {'localhost'}


class SourceError(ValueError):
    pass


def _loopback(host: str) -> bool:
    if host in LOOPBACK:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def check_url(url: str) -> str:
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        raise SourceError('source URL unparseable') from None
    host = parts.hostname or ''
    if parts.username is not None or parts.password is not None:
        raise SourceError('source URL must not carry credentials')
    if parts.scheme == 'https' and host:
        return url
    if parts.scheme == 'http' and _loopback(host):
        return url
    raise SourceError('source URL must be https (plain http only to loopback)')


class _CheckedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _opener():
    # No environment proxies: the bytes come from the declared origin or not at all.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), _CheckedRedirect())


def download(url: str, sha256: str, size: int, dest: Path, *, timeout: float = 60.0) -> Path:
    """Fetch url into dest (atomically) or raise. Refuses anything over 1 GB before any request."""
    if type(size) is not int or size < 0:
        raise SourceError('download needs a declared byte size')
    if size > MAX_DOWNLOAD_BYTES:
        raise SourceError('download over 1 GB refused')
    check_url(url)
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    partial = dest.with_name(dest.name + f'.partial-{os.getpid()}')
    request = urllib.request.Request(url, headers={'Accept-Encoding': 'identity', 'User-Agent': 'omerta-bio-oneshot/1'})
    h, total = hashlib.sha256(), 0
    try:
        with _opener().open(request, timeout=timeout) as response:
            length = response.headers.get('Content-Length')
            if length is not None:
                if not length.strip().isdigit():
                    raise SourceError('download length header invalid')
                if int(length) > MAX_DOWNLOAD_BYTES:
                    raise SourceError('download over 1 GB refused')
                if int(length) != size:
                    raise SourceError('download length differs from the declared size')
            fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as out:
                while True:
                    chunk = response.read(CHUNK)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > size or total > MAX_DOWNLOAD_BYTES:
                        raise SourceError('download exceeded its declared size')
                    h.update(chunk)
                    out.write(chunk)
        if total != size:
            raise SourceError('download shorter than its declared size')
        if h.hexdigest() != sha256:
            raise SourceError('download sha256 mismatch')
        os.replace(partial, dest)
        return dest
    except (urllib.error.URLError, OSError, ValueError) as e:
        if isinstance(e, SourceError):
            raise
        raise SourceError(f'download failed: {type(e).__name__}') from None
    finally:
        partial.unlink(missing_ok=True)


def _copy_hashed(src: Path, dest: Path) -> tuple[str, int]:
    """Copy a regular, non-symlink file while hashing exactly the bytes written."""
    s = src.lstat()
    if not stat.S_ISREG(s.st_mode):
        raise SourceError('source is not a regular file (symlinks refused)')
    h, total = hashlib.sha256(), 0
    fd = os.open(src, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    out_fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'rb') as f, os.fdopen(out_fd, 'wb') as out:
        for block in iter(lambda: f.read(CHUNK), b''):
            h.update(block)
            total += len(block)
            out.write(block)
    return h.hexdigest(), total


def local_path(case_dir: Path, source: dict) -> Path | None:
    if source['path'] is None:
        return None
    p = Path(source['path'])
    return p if p.is_absolute() else Path(case_dir) / p


def stage(case: dict, case_dir: Path, scratch: Path, *, cache: Path | None, offline: bool) -> dict[str, dict]:
    """Return {name: {path, sha256, size, decoded_sha256?}} of verified private copies under scratch."""
    scratch = Path(scratch)
    scratch.mkdir(parents=True, mode=0o700)
    staged = {}
    for source in case['sources']:
        name = source['name']
        origin = local_path(case_dir, source)
        if origin is None or not os.path.lexists(origin):
            if source['url'] is None:
                raise SourceError(f'source {name}: local file missing and no URL declared')
            if source['size'] > MAX_DOWNLOAD_BYTES:
                raise SourceError(f'source {name}: download over 1 GB refused; pre-download it and declare its path')
            cached = Path(cache) / source['sha256'] if cache is not None else None
            if cached is None or not os.path.lexists(cached):
                if offline or cached is None:
                    raise SourceError(f'source {name}: not available locally and downloads are disabled')
                download(source['url'], source['sha256'], source['size'], cached)
            origin = cached
        dest = scratch / name
        try:
            digest, size = _copy_hashed(Path(origin), dest)
        except FileNotFoundError:
            raise SourceError(f'source {name}: file missing') from None
        if digest != source['sha256']:
            dest.unlink(missing_ok=True)
            if cache is not None and Path(origin) == Path(cache) / source['sha256']:
                Path(origin).unlink(missing_ok=True)  # a corrupt cache entry is never reused
            raise SourceError(f'source {name}: sha256 mismatch')
        if source['size'] is not None and size != source['size']:
            dest.unlink(missing_ok=True)
            raise SourceError(f'source {name}: size mismatch')
        staged[name] = {'path': dest, 'sha256': digest, 'size': size}
    return staged

