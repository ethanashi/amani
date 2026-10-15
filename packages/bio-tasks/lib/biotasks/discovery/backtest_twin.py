"""Keyed BT1 development twin; original cached sources are never modified."""
import csv
import io
import gzip
import shutil
from pathlib import Path
from .backtest_data import verify_sources, sha
from .blinding import canonical, keyed


def perturb_pp(raw, key):
    reader = csv.DictReader(io.StringIO(raw.decode()), delimiter='\t')
    columns = reader.fieldnames
    rows = list(reader)
    outcomes = [c for c in columns if c.startswith('succ_')]
    if not rows or not outcomes or 'ti_uid' not in columns:
        raise ValueError('invalid twin input')
    # Jointly permute the transition vector, preserving missingness and internal
    # transition dependence while breaking its alignment to genetic support.
    order = sorted(range(len(rows)), key=lambda i: keyed(key, 'bt1-transition-twin-v1', rows[i]['ti_uid'], str(i)))
    result = [{**row, **{c: rows[j][c] for c in outcomes}} for row, j in zip(rows, order)]
    out = io.StringIO(); writer = csv.DictWriter(out, fieldnames=columns, delimiter='\t', lineterminator='\n')
    writer.writeheader(); writer.writerows(result)
    return out.getvalue().encode()


def propagate_transitions(source, dest, pp_raw):
    """R consumes cached merge2 fields; keep them aligned to the perturbed pp table."""
    reader=csv.DictReader(io.StringIO(pp_raw.decode()),delimiter='\t')
    outcomes=[c for c in reader.fieldnames if c.startswith('succ_')]
    values={}
    for row in reader:
        values.setdefault(row['ti_uid'],{c:row[c] for c in outcomes})
    with gzip.open(source,'rt',newline='') as src, Path(dest).open('xb') as encoded:
        reader=csv.DictReader(src,delimiter='\t')
        if not set(outcomes).issubset(reader.fieldnames):raise ValueError('cached transitions absent')
        with gzip.GzipFile(filename='',mode='wb',fileobj=encoded,mtime=0) as compressed:
            with io.TextIOWrapper(compressed,encoding='utf-8',newline='') as out:
                writer=csv.DictWriter(out,fieldnames=reader.fieldnames,delimiter='\t',lineterminator='\n')
                writer.writeheader()
                for row in reader:
                    if row['ti_uid'] not in values:raise ValueError('cached transition key absent from pp')
                    row.update(values[row['ti_uid']]);writer.writerow(row)


def prepare_twin(source, dest, key):
    source, dest = Path(source), Path(dest)
    manifest = verify_sources(source)
    dest.mkdir(parents=True, exist_ok=False)
    try:
        items = []
        pp_raw=perturb_pp((source/'data/pp.tsv').read_bytes(),key)
        for item in manifest['files']:
            path = dest/item['path']; path.parent.mkdir(parents=True, exist_ok=True)
            if item['path'] == 'data/pp.tsv':
                path.write_bytes(pp_raw)
            elif item['path'] == 'data/merge2.tsv.gz':
                propagate_transitions(source/item['path'],path,pp_raw)
            else:
                shutil.copyfile(source/item['path'], path)
            items.append({**item, 'sha256':sha(path), 'bytes':path.stat().st_size})
        result = {**manifest, 'files':items, 'derivation':{'kind':'keyed-transition-twin-v1',
                  'parent_manifest_hash':sha(source/'sources.json'), 'synthetic':True,
                  'cached_transition_join':'data/merge2.tsv.gz'}}
        (dest/'sources.json').write_bytes(canonical(result))
        verify_sources(dest)
        return result
    except BaseException:
        shutil.rmtree(dest, ignore_errors=True)
        raise
