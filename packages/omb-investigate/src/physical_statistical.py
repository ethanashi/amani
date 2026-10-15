"""Permissive statistical codecs: Pyreadstat/ReadStat and PyArrow.
Only storage types and numeric value-label dictionaries cross the host boundary.
No file/column labels, notes, user metadata, timestamps or source templates do.
"""
import io, tempfile, re
from pathlib import Path
import pandas as pd
import pyreadstat
import pyarrow as pa
import pyarrow.parquet as pq

def read(raw,kind):
    with tempfile.TemporaryDirectory() as tmp:
        p=Path(tmp)/('data.'+kind);p.write_bytes(raw)
        labels={}
        if kind=='parquet':
            tab=pq.read_table(p)
            if any(not (pa.types.is_integer(f.type) or pa.types.is_floating(f.type) or pa.types.is_string(f.type) or pa.types.is_boolean(f.type)) for f in tab.schema):
                raise ValueError('Unsupported Parquet storage type')
            types=['integer' if pa.types.is_integer(f.type) else 'number' if pa.types.is_floating(f.type) else 'boolean' if pa.types.is_boolean(f.type) else 'string' for f in tab.schema]
            df=tab.to_pandas()
        else:
            df,meta=getattr(pyreadstat,'read_'+('xport' if kind=='xpt' else kind))(p)
            types=['number' if pd.api.types.is_numeric_dtype(df[c]) else 'string' for c in df]
            labels={c:{format(float(k),'.17g'):v for k,v in vals.items()} for c,vals in meta.variable_value_labels.items()}
        rows=[['' if pd.isna(v) else '1' if v is True else '0' if v is False else str(v) for v in row] for row in df.itertuples(index=False,name=None)]
        return {'header':list(df.columns),'rows':rows,'storage':types,'labels':labels}

def write(t,kind):
    cols={}
    for j,(name,typ) in enumerate(zip(t['header'],t['storage'])):
        v=[r[j] for r in t['rows']]
        if typ=='string':cols[name]=v
        elif typ=='boolean':cols[name]=[None if x=='' else bool(int(x)) for x in v]
        elif typ=='integer':cols[name]=pd.array([None if x=='' else int(float(x)) for x in v],dtype='Int64')
        else:cols[name]=[float(x) if x else float('nan') for x in v]
    df=pd.DataFrame(cols)
    with tempfile.TemporaryDirectory() as tmp:
        p=Path(tmp)/('data.'+kind)
        if kind=='parquet':
            tab=pa.Table.from_pandas(df,preserve_index=False).replace_schema_metadata(None)
            pq.write_table(tab,p,compression='NONE',store_schema=False)
        elif kind=='xpt':pyreadstat.write_xport(df,p,file_format_version=5,table_name='PRACTICE')
        else:getattr(pyreadstat,'write_'+kind)(df,p,variable_value_labels={c:{float(k):v for k,v in vals.items()} for c,vals in t['labels'].items()})
        raw=p.read_bytes()
        # Canonical creation times ensure byte-for-byte isolated rebuild auditing.
        if kind=='xpt':raw=re.sub(rb'\d{2}[A-Z]{3}\d{2}:\d{2}:\d{2}:\d{2}',b'01JAN00:00:00:00',raw)
        if kind=='sav':raw=raw[:92]+b'01 Jan 00'+b'00:00:00'+raw[109:]
        if kind=='dta':raw=re.sub(rb'(<timestamp>)[^<]*(</timestamp>)',lambda m:m[1]+bytes([17])+b'01 Jan 2000 00:00'+m[2],raw)
        return raw

def run(q,un64,b64):
    if q['op']=='write':return b64(write(q['tables'][0],q['kind']))
    raw=un64(q['bytes']);t=read(raw,q['kind'])
    if q['op']=='audit':return raw==write(t,q['kind'])
    return t
