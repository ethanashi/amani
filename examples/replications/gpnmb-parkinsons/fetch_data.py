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
jobs = {'exposure': 'https://ftp.ebi.ac.uk/pub/databases/gwas/summary_statistics/GCST90059001-GCST90060000/GCST90059975/harmonised/GCST90059975.h.tsv.gz', 'outcome1': 'https://ftp.ebi.ac.uk/pub/databases/gwas/summary_statistics/GCST009001-GCST010000/GCST009325/harmonised/GCST009325.h.tsv.gz', 'outcome2': 'https://storage.googleapis.com/finngen-public-data-r12/summary_stats/release/finngen_R12_G6_PARKINSON.gz', 'refvcf': 'https://ftp.1000genomes.ebi.ac.uk/vol1/ftp/data_collections/1000_genomes_project/release/20190312_biallelic_SNV_and_INDEL/ALL.chr7.shapeit2_integrated_snvindels_v2a_27022019.GRCh38.phased.vcf.gz'}
expected = {'exposure': '47d45319cfd9b66fac9eb7b7f2857122453ac66e01755896301dd88ed3a09548', 'outcome1': '50e86e55988d8849f4b57c901adea42401a5541f2fc84145954150c827b4b81b', 'outcome2': '19b386cb712f873de25204ba97d68456679d0f5fa87da1f5d7204aeb6c643a91', 'refsamples': 'b4023dc6ee2d62ee89c8d4d347db4d348e65518d66d346574cdae7a4bbd76858'}
import subprocess
for name, url in jobs.items():
    dest = cache / name
    if not dest.exists():
        subprocess.run([sys.executable, str(HERE / 'rtabix.py'), url, url + '.tbi', '7', '22735967', '23775111', str(dest)], check=True)
    if name in expected and sha(dest.read_bytes()) != expected[name]:
        raise RuntimeError('Region checksum differs: ' + name)
ref = cache / 'refvcf'
if sha(ref.read_bytes()) != '69eeca84f7a55ba64f9d5deb8df49fb4a4028f0d5c1dfab50868285bfb7ae2d2':
    raise RuntimeError('Reference region checksum differs')
(cache / 'refvcf.gz').write_bytes(gzip.compress(ref.read_bytes(), mtime=0))
download('https://ftp.1000genomes.ebi.ac.uk/vol1/ftp/release/20130502/integrated_call_samples_v3.20130502.ALL.panel', cache / 'refsamples', expected['refsamples'])
(cache / 'outcome2std').write_bytes(stage.build_outcome2_std(cache / 'outcome2'))
exp = stage.load(cache / 'exposure', stage.SSF)
o1 = stage.load(cache / 'outcome1', stage.SSF)
o2 = stage.load(cache / 'outcome2', stage.FG)
keys = {stage.vkey(v['pos'], v['ea'], v['oa']) for v in exp + o1 + o2}
dosages, _ = stage.build_refdosage(cache / 'refvcf.gz', cache / 'refsamples', keys)
sources = {'exposure': cache / 'exposure', 'outcome1': cache / 'outcome1', 'outcome2std': cache / 'outcome2std', 'refdosage': dosages}

project(load_recipe(HERE), sources, Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'data', HERE)
