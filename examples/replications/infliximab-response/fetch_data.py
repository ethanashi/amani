#!/usr/bin/env python3
"""Download original public sources and recreate the retired blinded inputs."""
import gzip
import importlib.util
import json
import sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from fetch_utils import download, project, load_recipe, sha
spec = importlib.util.spec_from_file_location('stage_data', HERE / 'stage_data.py')
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)
cache = HERE / '.source-cache'
cache.mkdir(exist_ok=True)
downloads = {'pub_m': {'url': 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE12nnn/GSE12251/matrix/GSE12251_series_matrix.txt.gz', 'sha256': '2c750c3504fa500a1a1d0da382eb82e1fb4e09f645e370cbb247b66a19ffc367'}, 'pub_l': {'url': 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE16nnn/GSE16879/matrix/GSE16879_series_matrix.txt.gz', 'sha256': '8874d0d40217c3b92c44cead29bf15a0b157e45f62825c95b3c5183c0f513602'}, 'pub_a': {'url': 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE23nnn/GSE23597/matrix/GSE23597_series_matrix.txt.gz', 'sha256': 'd36fe4df1b6903c2be9de761a66deb92598cce84105d26be48e956ea5a26ce50'}, 'pub_annot': {'url': 'https://ftp.ncbi.nlm.nih.gov/geo/platforms/GPLnnn/GPL570/annot/GPL570.annot.gz', 'sha256': 'd7cd44352127b1e34f3a720ebea86093ef255a38f1612a85a2962b71bde8f394'}, 'pub_sets': {'url': 'https://data.broadinstitute.org/gsea-msigdb/msigdb/release/2024.1.Hs/h.all.v2024.1.Hs.symbols.gmt', 'sha256': 'ee2463540042078bfa3f67828e1e223bb354446d9fbb4d22845866835ba5c772'}}
for name, info in downloads.items():
    download(info['url'], cache / name, info['sha256'])
sources = stage.rederive(cache)

project(load_recipe(HERE), sources, Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'data', HERE)
