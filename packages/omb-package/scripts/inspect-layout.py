"""Measure shipped figure rectangles and caption/callout pages, using PDF bp.
This is a diagnostic on an already PW8-verified artifact, not an OCR verifier.
"""
import sys,json,re,subprocess,xml.etree.ElementTree as ET
from pypdf import PdfReader
from pypdf.generic import ContentStream
file,manuscript=sys.argv[1:]
m=json.load(open(manuscript));reader=PdfReader(file)
root=ET.fromstring(subprocess.check_output(['pdftotext','-bbox',file,'-']))
pages=root.findall('.//{*}page');words=[]
def tokens(text):return re.findall(r'\w+',text.casefold())
for page in pages:
 row=[]
 for w in page.findall('.//{*}word'):
  box=[float(w.get(k)) for k in ['xMin','yMin','xMax','yMax']]
  row.extend((token,box) for token in tokens(w.text or ''))
 words.append(row)
def find(needle,row):
 values=[x[0] for x in row]
 return next((i for i in range(len(row)-len(needle)+1) if values[i:i+len(needle)]==needle),None)
def mul(a,b):
 return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]
identity=[1,0,0,1,0,0];placements=[]
for page_no,page in enumerate(reader.pages,1):
 matrix=identity;stack=[];objects=page.get('/Resources',{}).get('/XObject',{})
 if hasattr(objects,'get_object'):objects=objects.get_object()
 for args,op in ContentStream(page.get_contents(),reader).operations:
  if op==b'q':stack.append(matrix[:])
  elif op==b'Q':matrix=stack.pop()
  elif op==b'cm':matrix=mul(matrix,list(map(float,args)))
  elif op==b'Do' and objects[args[0]].get_object().get('/Subtype')=='/Form':
   obj=objects[args[0]].get_object();a=mul(matrix,list(map(float,obj.get('/Matrix',identity))));b=list(map(float,obj['/BBox']))
   points=[(a[0]*x+a[2]*y+a[4],a[1]*x+a[3]*y+a[5]) for x in [b[0],b[2]] for y in [b[1],b[3]]]
   rect=[min(x for x,y in points),min(y for x,y in points),max(x for x,y in points),max(y for x,y in points)]
   placements.append({'page':page_no,'rectangle_bp':rect,'width_mm':(rect[2]-rect[0])*25.4/72,'uniformScale':abs(a[0]*a[0]+a[1]*a[1]-a[2]*a[2]-a[3]*a[3])<1e-5})
figures=[];supplement=False
for section in m['sections']:
 if section['id']=='supplement':supplement=True
 for b in section['blocks']:
  if b['kind']=='figure':figures.append({**b,'supplement':supplement})
assert len(figures)==len(placements),'Form/figure count differs'
failures=[];warnings=[]
for f,p in zip(figures,placements):
 p.update({'id':f['figureId'],'number':f['number'],'supplement':f['supplement']})
 row=words[p['page']-1];needle=tokens(f['caption']['text']);at=find(needle,row)
 if at is None:failures.append(f['figureId']+': caption absent from figure page');continue
 boxes=[x[1] for x in row[at:at+len(needle)]]
 p['caption_rectangle_bp_top_origin']=[min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes)]
 callout=tokens('Figure '+str(f['number']));mentions=[]
 for page_no,items in enumerate(words,1):
  for i in range(len(items)-1):
   if [x[0] for x in items[i:i+2]]==callout and not(page_no==p['page'] and at<=i<at+len(needle)):mentions.append(page_no)
 p['first_callout_page']=min(mentions) if mentions else None
 if not mentions or min(mentions)>p['page']:failures.append(f['figureId']+': missing/late callout')
 elif p['page']-min(mentions)>1:warnings.append(f['figureId']+': more than one page after first callout')
 if abs(p['width_mm']-178)>.5 or not p['uniformScale']:failures.append(f['figureId']+': width/aspect mismatch')
 if p['rectangle_bp'][0]<15.5*72/25.4 or p['rectangle_bp'][2]>float(reader.pages[p['page']-1].mediabox.width)-15.5*72/25.4:failures.append(f['figureId']+': margin overlap')
refs=next((i+1 for i,row in enumerate(words) if any(w[0]=='references' for w in row[:5])),None)
if refs and any(p['page']>refs and not p['supplement'] for p in placements):failures.append('main figure after References')
print(json.dumps({'schema':'paper-layout-measurements@1','pdf':file,'references_page':refs,'figures':placements,'failures':failures,'warnings':warnings},indent=2))
if failures:sys.exit(1)
