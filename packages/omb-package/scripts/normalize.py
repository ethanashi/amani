"""Pinned PDF/DOCX read-back and canonicalization. No system font dependencies."""
import sys, json, hashlib, zipfile, re, uuid
from pathlib import Path
import xml.etree.ElementTree as ET
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, ByteStringObject, TextStringObject, DictionaryObject, NameObject

EPOCH='2000-01-01T00:00:00Z'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
ET.register_namespace('w',W); ET.register_namespace('r',R)
def w(tag): return '{'+W+'}'+tag
def xml(data): return ET.fromstring(data)
def dump(root): return ET.tostring(root,encoding='utf-8',xml_declaration=True)
def archive(path,files):
    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for name,data in sorted(files.items()):
            i=zipfile.ZipInfo(name,(2000,1,1,0,0,0)); i.compress_type=zipfile.ZIP_DEFLATED; i.external_attr=0o100644<<16
            z.writestr(i,data)
def files(path):
    with zipfile.ZipFile(path) as z:
        if len(z.namelist())!=len(set(z.namelist())): raise ValueError('duplicate DOCX ZIP members')
        if sum(i.file_size for i in z.infolist())>50_000_000: raise ValueError('DOCX size limit')
        return {n:z.read(n) for n in z.namelist()}
def inspect_docx(path):
    fs=files(path); allxml='\n'.join(data.decode() for n,data in fs.items() if n.endswith('.xml'))
    if re.search(r'<(?:\w+:)?(?:vanish|webHidden|commentRangeStart|commentReference)\b',allxml) or any('comments' in n and (len(xml(data)) or ''.join(xml(data).itertext()).strip()) for n,data in fs.items() if n.endswith('.xml')): raise ValueError('hidden DOCX runs or comments')
    body=xml(fs['word/document.xml'])
    text='\n'.join(''.join(p.itertext()) for p in body.iter(w('p')))
    # itertext includes field instructions; also return every XML part for PW8.
    return {'text':text,'xml':allxml,'fonts':[n for n in fs if n.startswith('word/fonts/')]}

def docx(source,out,fontdir,double,line,closed_world=False):
    fs=files(source); inspect_docx(source)
    styles=xml(fs['word/styles.xml'])
    for elem in styles.iter(w('rFonts')):
        for key in ('ascii','hAnsi','eastAsia','cs'):elem.set(w(key),'Source Serif 4')
        for key in list(elem.attrib):
            if 'Theme' in key: del elem.attrib[key]
    for st in styles.iter(w('style')):
        if st.get(w('styleId')) in ('Normal','BodyText','FirstParagraph','Table'):
            rp=st.find(w('rPr'))
            if rp is None:rp=ET.SubElement(st,w('rPr'))
            size=rp.find(w('sz'))
            if size is None:size=ET.SubElement(rp,w('sz'))
            size.set(w('val'),'24')
            pp=st.find(w('pPr'))
            if pp is None:pp=ET.SubElement(st,w('pPr'))
            sp=pp.find(w('spacing'))
            if sp is None:sp=ET.SubElement(pp,w('spacing'))
            sp.set(w('line'),'480' if double else '276');sp.set(w('lineRule'),'auto')
    fs['word/styles.xml']=dump(styles)
    body=xml(fs['word/document.xml'])
    for sect in body.iter(w('sectPr')):
        mar=sect.find(w('pgMar'))
        if mar is not None:
            for x in ('top','bottom','left','right'):mar.set(w(x),'1440')
        size=sect.find(w('pgSz'))
        if size is not None:size.set(w('w'),'12240');size.set(w('h'),'15840')
        if line:
            ln=ET.SubElement(sect,w('lnNumType'));ln.set(w('countBy'),'1');ln.set(w('start'),'1');ln.set(w('restart'),'continuous');ln.set(w('distance'),'360')
    # The first Abstract heading starts after the title page in the shared source.
    for p in body.iter(w('p')):
        if ''.join(t.text or '' for t in p.iter(w('t')))=='Abstract':
            pp=p.find(w('pPr'))
            if pp is None:pp=ET.SubElement(p,w('pPr'))
            ET.SubElement(pp,w('pageBreakBefore'));break
    if not closed_world:
        REL='http://schemas.openxmlformats.org/package/2006/relationships'
        docrels=xml(fs['word/_rels/document.xml.rels'])
        ET.SubElement(docrels,'{'+REL+'}Relationship',{'Id':'pw9PageFooter','Type':R+'/footer','Target':'pw9-footer.xml'})
        for sect in body.iter(w('sectPr')):
            for ref in list(sect.findall(w('footerReference'))):sect.remove(ref)
            sect.insert(0,ET.Element(w('footerReference'),{w('type'):'default',f'{{{R}}}id':'pw9PageFooter'}))
        footer=ET.Element(w('ftr'));p=ET.SubElement(footer,w('p'));pp=ET.SubElement(p,w('pPr'));ET.SubElement(pp,w('jc'),{w('val'):'center'})
        field=ET.SubElement(p,w('fldSimple'),{w('instr'):'PAGE'});run=ET.SubElement(field,w('r'));rp=ET.SubElement(run,w('rPr'));ET.SubElement(rp,w('rFonts'),{w('ascii'):'Source Serif 4',w('hAnsi'):'Source Serif 4'});ET.SubElement(rp,w('sz'),{w('val'):'20'});ET.SubElement(run,w('t')).text='1'
        fs['word/pw9-footer.xml']=dump(footer);fs['word/_rels/document.xml.rels']=dump(docrels)
        fs['word/document.xml']=dump(body)
    fs['word/document.xml']=dump(body)
    table=xml(fs['word/fontTable.xml'])
    font=next((f for f in table if f.get(w('name'))=='Source Serif 4'),None)
    if font is None:font=ET.SubElement(table,w('font'),{w('name'):'Source Serif 4'})
    REL='http://schemas.openxmlformats.org/package/2006/relationships'
    rels=xml(fs.get('word/_rels/fontTable.xml.rels',f'<Relationships xmlns="{REL}"/>'.encode()))
    for i,(name,style) in enumerate([('Regular','embedRegular'),('Bold','embedBold'),('It','embedItalic')]):
        data=bytearray((Path(fontdir)/f'SourceSerif4-{name}.ttf').read_bytes())
        key=uuid.UUID(bytes=hashlib.sha256(data).digest()[:16]); obfuscator=key.bytes[::-1]
        for j in range(32):data[j]^=obfuscator[j%16]
        target=f'fonts/source-serif-{name}.odttf';fs['word/'+target]=bytes(data);rid='pw9font'+str(i)
        ET.SubElement(font,w(style),{f'{{{R}}}id':rid,w('fontKey'):'{'+str(key).upper()+'}'})
        ET.SubElement(rels,'{'+REL+'}Relationship',{'Id':rid,'Type':R+'/font','Target':target})
    fs['word/fontTable.xml']=dump(table);fs['word/_rels/fontTable.xml.rels']=dump(rels)
    CT='http://schemas.openxmlformats.org/package/2006/content-types';ct=xml(fs['[Content_Types].xml'])
    if not closed_world:ET.SubElement(ct,'{'+CT+'}Override',{'PartName':'/word/pw9-footer.xml','ContentType':'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'})
    ET.SubElement(ct,'{'+CT+'}Default',{'Extension':'odttf','ContentType':'application/vnd.openxmlformats-officedocument.obfuscatedFont'})
    fs['[Content_Types].xml']=dump(ct)
    settings=xml(fs['word/settings.xml']);ET.SubElement(settings,w('embedTrueTypeFonts'));fs['word/settings.xml']=dump(settings)
    if 'docProps/core.xml' in fs:
        core=fs['docProps/core.xml'].decode();core=re.sub(r'(<dcterms:(?:created|modified)[^>]*>).*?(</dcterms:(?:created|modified)>)',lambda m:m[1]+EPOCH+m[2],core);fs['docProps/core.xml']=core.encode()
    if 'docProps/custom.xml' in fs:
        custom=xml(fs['docProps/custom.xml'])
        for prop in custom:
            if prop.get('name') in ('bibliography','csl'):
                for value in prop:value.text=Path(value.text or '').name
        fs['docProps/custom.xml']=dump(custom)
    archive(out,fs)

def pdf(source,out):
    reader=PdfReader(source); writer=PdfWriter(clone_from=reader)
    writer.add_metadata({'/CreationDate':'D:20000101000000Z','/ModDate':'D:20000101000000Z','/Producer':'PW9 / pinned renderer + pypdf','/Creator':'PW9'})
    # Chrome accessibility node IDs depend on allocation timing. Rebase only the
    # structural ID/name-tree namespace, preserving table header relationships.
    mapping={}
    for obj in writer._objects:
        if isinstance(obj,DictionaryObject) and obj.get('/Type')=='/StructElem':
            old=obj.get('/ID')
            if isinstance(old,str) and re.fullmatch(r'node[0-9]+',old):mapping[old]=f'node{len(mapping)+1:08d}'
    def replace(value):
        if isinstance(value,TextStringObject) and value in mapping:return TextStringObject(mapping[value])
        if isinstance(value,ArrayObject):return ArrayObject([replace(x) for x in value])
        return value
    def walk(obj):
        if isinstance(obj,DictionaryObject):
            for k,v in list(obj.items()):
                if k in ('/ID','/Headers','/Names','/Limits'):obj[k]=replace(v)
                else:walk(v)
        elif isinstance(obj,ArrayObject):
            for item in obj:walk(item)
    for obj in writer._objects:walk(obj)
    writer._ID=ArrayObject([ByteStringObject(b'PW9-determinism!'),ByteStringObject(b'PW9-determinism!')])
    with open(out,'wb') as f:writer.write(f)

def extract_pdf_text(page):
    # pypdf 6.1.1 uses abs(TJ adjustment) when inferring spaces. Positive TJ
    # values tighten kerning, so they cannot denote a space (PDF 32000-1 9.4.3).
    # Zero those adjustments in an extraction-only in-memory stream. Delivered
    # PDF bytes and all glyph codes/negative word spacing remain unchanged.
    from pypdf.generic import ContentStream, NumberObject, NameObject
    stream=ContentStream(page.get_contents(),page.pdf,"bytes")
    # XeTeX emits word spacing as TJ offsets. Source Serif's actual space is
    # narrower than pypdf's fallback half-average-glyph estimate. Use the pinned
    # font's metric; change extraction only, never PDF bytes or glyph codes.
    from fontTools.ttLib import TTFont
    from pypdf._cmap import build_char_map
    metrics={}
    for key,font in page.get('/Resources',{}).get('/Font',{}).items():
        name=str(font.get_object().get('/BaseFont','')).split('+')[-1]
        if name in ('AmaniJournalSerif-Regular','AmaniJournalSerif-Bold','AmaniJournalSerif-Italic'):
            f=TTFont(Path(__file__).resolve().parents[1]/'vendor/fonts'/(name+'.ttf'))
            actual=f['hmtx'][f.getBestCmap()[32]][0]*1000/f['head'].unitsPerEm
            metrics[key]=(actual/2,build_char_map(key,200,page)[1]+1)
    current=None
    for operands,operator in stream.operations:
        if operator==b'Tf':current=operands[0]
        if operator==b'TJ':
            for i,v in enumerate(operands[0]):
                if isinstance(v,(int,float)) and v>0:operands[0][i]=NumberObject(0)
                elif isinstance(v,(int,float)) and current in metrics and v < -metrics[current][0]:operands[0][i]=NumberObject(-max(-v,metrics[current][1]))
    page[NameObject('/Contents')]=stream
    return page.extract_text() or ''

def inspect_pdf(path):
    r=PdfReader(path); fonts=[];images=set();seen=set()
    def resources(res):
        if hasattr(res,'get_object'):res=res.get_object()
        for f in res.get('/Font',{}).values():
            f=f.get_object();d=f.get('/DescendantFonts',[f])[0].get_object();desc=d.get('/FontDescriptor')
            embedded=bool(desc and any(k in desc.get_object() for k in ['/FontFile','/FontFile2','/FontFile3']))
            fonts.append({'name':str(f.get('/BaseFont','')),'embedded':embedded,'type':str(f.get('/Subtype',''))})
        for obj in res.get('/XObject',{}).values():
            key=(getattr(obj,'idnum',id(obj)),getattr(obj,'generation',0))
            if key in seen:continue
            seen.add(key);v=obj.get_object()
            if v.get('/Subtype')=='/Image':images.add(key)
            if '/Resources' in v:resources(v['/Resources'])
    for p in r.pages:resources(p.get('/Resources',{}))
    return {'text':'\n'.join(extract_pdf_text(p) for p in r.pages),'pages':len(r.pages),'fonts':fonts,'imageCount':len(images),'metadata':dict(r.metadata or {})}

if __name__=='__main__':
    mode=sys.argv[1]
    if mode=='pdf':pdf(*sys.argv[2:])
    elif mode=='docx':docx(sys.argv[2],sys.argv[3],sys.argv[4],sys.argv[5]=='true',sys.argv[6]=='true',len(sys.argv)>7 and sys.argv[7]=='closed-world')
    elif mode=='inspect-pdf':print(json.dumps(inspect_pdf(sys.argv[2])))
    elif mode=='inspect-docx':print(json.dumps(inspect_docx(sys.argv[2])))
    else:raise ValueError('unknown operation')
