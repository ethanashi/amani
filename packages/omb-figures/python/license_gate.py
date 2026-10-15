"""Audit Python package metadata AND native runtime files. Strict product whitelist.

This gate intentionally refuses the reference environment's NumPy Zlib component and
SciPy Fortran runtimes; product SVG rendering remains TypeScript. No metadata-only pass.
"""
import importlib.metadata as md
import json
from pathlib import Path
import sys

ALLOW={'MIT','MIT-CMU','BSD-2-Clause','BSD-3-Clause','ISC','Apache-2.0','CC0-1.0','OFL-1.1','0BSD'}
ALIASES={'MIT License':'MIT','BSD License':'BSD-3-Clause','Python Software Foundation License':'LicenseRef-Matplotlib','Apache Software License; BSD License':'Apache-2.0 OR BSD-3-Clause','BSD License; Apache Software License':'Apache-2.0 OR BSD-3-Clause'}
def audit():
    inventory=[];errors=[]
    for d in sorted(md.distributions(),key=lambda x:x.metadata['Name'].lower()):
        name=d.metadata['Name'];lic=d.metadata.get('License-Expression')
        if not lic:
            categories=[v.split(' :: ')[-1] for v in d.metadata.get_all('Classifier',[]) if v.startswith('License :: OSI Approved ::')]
            lic='; '.join(categories) or d.metadata.get('License','UNKNOWN')
        lic=ALIASES.get(lic,lic)
        inventory.append({'name':name,'version':d.version,'license':lic})
        tokens=lic.replace('(','').replace(')','').replace(' OR ',' AND ').split(' AND ')
        if not (name.lower()=='matplotlib' and lic=='LicenseRef-Matplotlib') and not all(t in ALLOW for t in tokens):errors.append(f'{name}: {lic}')
        for f in d.files or []:
            if any(t in str(f).lower() for t in ['libgfortran','libquadmath','libgcc_s']):errors.append(f'{name}: forbidden bundled native runtime {f}')
    return inventory,errors
if __name__=='__main__':
    inventory,errors=audit()
    if '--inventory' in sys.argv:print(json.dumps(inventory,indent=2))
    else:
        print(json.dumps({'scope':'Python reference environment; NOT product-approved','errors':errors},indent=2))
        sys.exit(1 if errors else 0)
