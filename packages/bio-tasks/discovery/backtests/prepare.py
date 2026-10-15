#!/usr/bin/env python3
"""Fetch public source bytes before the scoring freeze. No pilot/default lease interaction."""
import argparse
import sys
from pathlib import Path
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'lib'))
from biotasks.discovery.backtest_data import CACHE, canonical, download_minikel, fetch, verify_sources, write_manifest
from biotasks.discovery.backtest_open import load_ot, fetch_mesh_subset


def prepare(as_of):
    download_minikel(retrieved_at=as_of)
    root = CACHE/'dm-bt2-forward-2013'
    url = 'https://media.springernature.com/original/springer-static/esm/art%3A10.1038%2Fng.3314/MediaObjects/41588_2015_BFng3314_MOESM14_ESM.txt'
    item = fetch(url, root/'nelson_similarity.tsv', licence='publisher-supplement-public-analysis-only', retrieved_at=as_of)
    write_manifest(root/'sources.json', {'files':[item]})
    root = CACHE/'dm-bt4-open-chembl-2019'; files=[]
    for name in ('chembl-29-01-2019.json.gz','gwas-28-01-2019.json.gz','eva-29-01-2019.json.gz','gene2phenotype-30-01-2019.json.gz','genomics_england-02-10-2018.json.gz'):
        files.append(fetch('https://ftp.ebi.ac.uk/pub/databases/opentargets/platform/19.02/input/evidence-files/'+name,root/name,licence='CC0-1.0',retrieved_at=as_of))
    files.append(fetch('https://ftp.ebi.ac.uk/pub/databases/opentargets/platform/24.09/input/evidence-files/chembl.json.gz',root/'chembl-24.09.json.gz',licence='CC0-1.0',retrieved_at=as_of))
    write_manifest(root/'sources.json', {'files':files})
    fetch_mesh_subset(root,load_ot(root/'chembl-29-01-2019.json.gz',2019),retrieved_at=as_of)


if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('--as-of',required=True);a=p.parse_args();prepare(a.as_of)
