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
downloads = {'GSE40566_non_normalized.txt.gz': ('https://ftp.ncbi.nlm.nih.gov/geo/series/GSE40nnn/GSE40566/suppl/GSE40566_non_normalized.txt.gz', '00d1d4558ee836362596f15deaf543ed2a22a085cc8ca856d160d2f025fe6e46'), 'GSE40566_gsm_brief.soft': ('https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE40566&targ=gsm&form=text&view=brief', '03c0142157f13a43089bddfb4da47002d0ae3136008df233eccaf85b570196ec'), 'GSE61901_gsm_brief.soft': ('https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE61901&targ=gsm&form=text&view=brief', '549be256f26a1bb4396cea2a972f25590e24200c8c5a74ee68556eff96d8595b')}
for name, (url, expected) in downloads.items():
    download(url, cache / name, expected)
stage.here = cache
stage.main()
sources = {'expr': cache / 'GSE40566_non_normalized.txt.gz', 'samples': cache / 'labels_from_geo.tsv'}

project(load_recipe(HERE), sources, Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'data', HERE)
