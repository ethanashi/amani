# Physical codecs

Host-only, separately executed Python codecs:

- openpyxl: MIT; defusedxml: PSF.
- Pyreadstat 1.3.6: Apache-2.0; its native ReadStat parser: MIT.
- PyArrow 25.0.0: Apache-2.0.
- pandas 3.0.6 and NumPy: BSD-3-Clause.

Versions and transitive libraries are pinned in pixi.lock. No GPL reader is linked
into Amani. The codec accepts bytes and emits only cells and structural storage
metadata. Practice output is rebuilt without source file/column annotations,
notes, arbitrary Parquet metadata, or timestamps. Creation times are canonicalized
so the isolated provenance rebuild can compare exact bytes.
