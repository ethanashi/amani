# Workbook practice codec

openpyxl (>=3.1.5,<4), MIT/Expat licence, is a direct conda-forge dependency in
packages/omb-investigate/format-runtime/pixi.toml; the resolved version is pinned in its pixi.lock. This host-only runtime is separate
from the numerical analysis runtime; existing calibration bindings stay valid.
Official licence: https://openpyxl.readthedocs.io/en/stable/ (License: MIT/Expat).
Source: https://foss.heptapod.net/openpyxl/openpyxl

The codec also uses defusedxml (PSF licence) for XML parser hardening and Python's
standard-library zipfile. No GPL dependency was introduced for workbook writing.

The transitive XML writer et_xmlfile is MIT-licensed. The isolated interpreter
uses the exact readline build already pinned in bio-baseline (not an additional
GPL package/build). The lockfile comparison in
validation/amani-fix5g/dependency-licences.json records every newly introduced
archive and its licence; none is GPL.
