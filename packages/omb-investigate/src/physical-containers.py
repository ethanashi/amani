"""Host-only container codec. openpyxl (MIT), defusedxml (PSF) and Python stdlib.
Never extract archive paths, execute formulas, or return source bytes to worker metadata.
"""
import base64, io, json, sys, zipfile
sys.dont_write_bytecode = True
from datetime import datetime

def b64(b): return base64.b64encode(b).decode('ascii')
def un64(s): return base64.b64decode(s)
def workbook(raw):
    import openpyxl
    return openpyxl.load_workbook(io.BytesIO(raw), data_only=False)
def layout(ws, depth):
    return {'sheet': ws.title, 'state': 'visible', 'rows': ws.max_row, 'columns': ws.max_column,
            'merges': sorted(str(r) for r in ws.merged_cells.ranges), 'headerRows': depth,
            'headers': [[str(c.value) if c.value is not None else '' for c in row] for row in ws.iter_rows(max_row=depth)],
            'formats': [[c.number_format for c in row] for row in ws.iter_rows()]}
def run(q):
    if q['kind'] in ('xpt','sav','dta','parquet'):
        from physical_statistical import run as statistical
        return statistical(q,un64,b64)
    # Write accepts a structural projection only. Source bytes are never an output template.
    if q['op'] == 'write' and q['kind'] == 'zip':
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as dest:
            for e in q['entries']:
                if e['name'] not in q['members']: raise ValueError('untransformed zip member')
                i=zipfile.ZipInfo(e['name']);i.compress_type=e['compression']
                dest.writestr(i,un64(q['members'][e['name']]))
        return b64(out.getvalue())
    if q['op'] == 'write':
        import openpyxl
        from openpyxl.cell.cell import MergedCell
        wb=openpyxl.Workbook();wb.remove(wb.active)
        order=q['tables'][0]['layout']['sheetOrder']
        if len(order)!=len(set(order)) or set(order)!={t['sheet'] for t in q['tables']}:
            raise ValueError('invalid served sheet order')
        for t in sorted(q['tables'],key=lambda t:order.index(t['sheet'])):
            ws=wb.create_sheet(t['sheet']);depth=t['layout']['headerRows']
            for row in t['layout']['headers']: ws.append(row)
            for i,row in enumerate(t['rows']):
                for j,value in enumerate(row):
                    c=ws.cell(depth+1+i,j+1)
                    kind='n' if all(r[j]=='n' for r in t['types']) else 's'
                    c.value=None if value=='' else float(value) if kind=='n' else value
                    if value!='' and kind=='s': c.data_type='s'
            for j in range(len(t['header'])):
                formats=sorted(set(row[j] for row in t['layout']['formats']))
                if any(any(c in fmt for c in ['"', '_', '*', '[', ']']) for fmt in formats):
                    raise ValueError('unsafe custom workbook number format')
                # Column inventory only: no source row-aligned format descriptors.
                for i in range(ws.max_row): ws.cell(i+1,j+1).number_format=formats[0]
            for merged in t['layout']['merges']: ws.merge_cells(merged)
        wb.properties.created=wb.properties.modified=datetime(1980,1,1)
        out=io.BytesIO();wb.save(out)
        stable=io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(out.getvalue())) as source, zipfile.ZipFile(stable,'w') as dest:
            for name in sorted(source.namelist()):
                data=source.read(name)
                if name=='docProps/core.xml':
                    import re
                    data=re.sub(rb'<dcterms:modified[^>]*>.*?</dcterms:modified>',b'<dcterms:modified xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="dcterms:W3CDTF">1980-01-01T00:00:00Z</dcterms:modified>',data)
                info=zipfile.ZipInfo(name);info.compress_type=zipfile.ZIP_DEFLATED;dest.writestr(info,data)
        return b64(stable.getvalue())
    raw = un64(q['bytes'])
    if q['kind'] == 'zip':
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            infos=z.infolist()
            if q['op']=='audit': return not z.comment and all(not i.comment and not i.extra for i in infos)
            if len({i.filename for i in infos}) != len(infos): raise ValueError('duplicate zip members')
            if any(i.file_size > 64000000 for i in infos) or sum(i.file_size for i in infos)>128000000: raise ValueError('archive size cap')
            return [{'name':i.filename,'compression':i.compress_type,'directory':i.is_dir(),'bytes':b64(z.read(i))} for i in infos]
    wb=workbook(raw)
    if q['op']=='audit':
        props=['title','subject','description','keywords','category','identifier','contentStatus','lastModifiedBy']
        return (not wb.defined_names and not wb.custom_doc_props and not wb._external_links
                and all(not getattr(wb.properties,p,None) for p in props)
                and wb.properties.creator in [None,'openpyxl']
                and all(ws.sheet_state=='visible' and all(c.comment is None and c.hyperlink is None for row in ws for c in row) for ws in wb))
    if q['op']=='read':
        out=[]
        for ws in wb:
            # A top merged band is part of the header, never a record. Include the
            # first unmerged leaf row; no data-driven endpoint/name heuristics.
            depth=1
            for r in sorted(ws.merged_cells.ranges,key=lambda r:r.min_row):
                if r.min_row<=depth: depth=max(depth,r.max_row+(r.max_col>r.min_col))
            depth=min(depth,ws.max_row)
            def header(column):
                c=ws.cell(depth,column)
                for merged in ws.merged_cells.ranges:
                    if merged.min_col<=column<=merged.max_col and merged.min_row<=depth<=merged.max_row:
                        c=ws.cell(merged.min_row,merged.min_col);break
                return str(c.value) if c.value is not None else ''
            if any(c.data_type=='f' for row in ws for c in row): raise ValueError('formula workbook needs a declared recalculation policy')
            out.append({'sheet':ws.title,'layout':{**layout(ws,depth), 'sheetOrder':wb.sheetnames},
                        'header':[header(column) for column in range(1,ws.max_column+1)],
                        'rows':[[str(c.value) if c.value is not None else '' for c in row] for row in ws.iter_rows(min_row=depth+1)],
                        'types':[[c.data_type for c in row] for row in ws.iter_rows(min_row=depth+1)]})
        return out
try: json.dump(run(json.load(sys.stdin)),sys.stdout,allow_nan=False)
except Exception as e: sys.stderr.write(str(e)); sys.exit(1)
