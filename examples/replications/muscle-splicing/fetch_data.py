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
downloads = {'psi.txt.gz': {'url': 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE86nnn/GSE86356/suppl/GSE86356_DMseq_sample_converted_nonUTR_psi.txt.gz', 'sha256': 'a1db2c3404dc59293b83209e38bed76015494dc8ca97e4898f6d8fd9de2efb2f'}, 'series_matrix.txt.gz': {'url': 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE86nnn/GSE86356/matrix/GSE86356_series_matrix.txt.gz', 'sha256': '129f8c6c31d60f715894c6e5e6d54db773f6bc1850e7cbd9f95f6e21f5a634ae'}}
stage.SRC = cache
for name, info in downloads.items():
    download(info['url'], cache / name, info['sha256'])
stage.main()
sources = {name: cache / filename for name, filename in {'psi':'psimat.tsv.gz','events':'evtype.tsv','samples':'sampmeta.tsv'}.items()}

project(load_recipe(HERE), sources, Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'data', HERE)
