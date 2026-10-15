#!/usr/bin/env python3
"""Sequential archive → small MeSH/reference join. Archive removed on every extraction exit."""
import argparse
import sys
from datetime import date
from pathlib import Path
sys.dont_write_bytecode = True
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'lib'))
from biotasks.discovery.backtest_data import CACHE, fetch, floor, canonical
from biotasks.discovery.backtest_open import extract_mesh_dump, CHEMBL_RELEASE_DATES

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--release',type=int,required=True);p.add_argument('--sha256',required=True);p.add_argument('--as-of',required=True);p.add_argument('--retrieved-at',required=True);a=p.parse_args()
    if a.release not in CHEMBL_RELEASE_DATES or date.fromisoformat(CHEMBL_RELEASE_DATES[a.release]) > date.fromisoformat(a.as_of):raise ValueError('unknown or post-snapshot ChEMBL release')
    root=CACHE/'dm-bt4-open-chembl-2019'
    root.mkdir(parents=True,exist_ok=True)
    if list(root.glob('chembl_*_sqlite.tar.gz')) or (root/'sqlite-work/chembl.sqlite').exists():
        raise ValueError('previous ChEMBL archive must be removed before another download')
    # Reserve space for compressed AND expanded archive; runtime checks exact member size.
    floor(root,20*1024**3)
    name=f'chembl_{a.release}_sqlite.tar.gz'
    item=fetch(f'https://ftp.ebi.ac.uk/pub/databases/chembl/ChEMBLdb/releases/chembl_{a.release}/'+name,root/name,
               licence='CC-BY-SA-3.0',retrieved_at=a.retrieved_at,expected=a.sha256)
    result=extract_mesh_dump(root/name,root/f'chembl-{a.release}-mesh.tsv',work=root/'sqlite-work')
    result['source']=item
    result['release_date']=CHEMBL_RELEASE_DATES[a.release]
    result['release']=a.release
    (root/f'chembl-{a.release}-mesh.manifest.json').write_bytes(canonical(result))
    print('Verified derived MeSH join retained; SQLite archive and database deleted.')
