"""Stub: only the hashing helper references use for provenance notes in key material."""
import hashlib
from pathlib import Path


def sha256_file(p):
    try:
        return hashlib.sha256(Path(p).read_bytes()).hexdigest()
    except OSError:
        return "unavailable-in-calibration-sandbox"
