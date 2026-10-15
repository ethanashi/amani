#!/usr/bin/env python3
"""Convert cached JATS with pinned pandoc. All prose stays in the ignored cache."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json,re,subprocess,xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[1];cache=ROOT/'.cache/genre-exemplars';pandoc=ROOT/'.pixi/envs/default/bin/pandoc'
items=[(p,e) for f in sorted((ROOT/'genres').glob('*.json')) for p in [json.loads(f.read_text())] for e in p['exemplars']]
def convert(item):
 p,e=item;root=ET.fromstring((cache/(e['pmcid']+'.xml')).read_bytes());boxes=[]
 # Pandoc flattens boxed-text into prose. Preserve each as a figure-shaped carrier,
 # then change that carrier to Div.box in the AST, before counting or linting.
 for i,box in enumerate([*root.iter('boxed-text'),*root.iter('glossary'),*[s for s in [*root.iter('sec'),*root.iter('def-list')] if re.search(r'^Nonstandard Abbreviations',s.findtext('title') or '',re.I)]]):
  box.tag='fig';box.set('id','genre-box-'+str(i));children=list(box);box[:]=[];caption=ET.SubElement(box,'caption');caption.text=box.text;box.text=None;caption.extend(children);boxes.append(box.get('id'))
 meta=root.find('front/article-meta');declarations=[]
 # Preserve semantically typed JATS metadata that pandoc omits or flattens. No
 # profile/exemplar-specific expected values are consulted.
 ids={'conflict':'competing_interests','conflict-of-interest':'competing_interests','coi':'competing_interests','con':'contributions','contribution':'contributions','author-contributions':'contributions','financial-disclosure':'funding','funding':'funding','data-availability':'data_availability','data-availability-statement':'data_availability','ethics':'ethics'}
 for node in root.iter():
  kind=ids.get(node.get('fn-type','')) or ids.get(node.get('sec-type',''))
  if node.tag=='funding-group':kind='funding'
  if node.tag=='contrib-group' and any(x.tag=='role' for x in node.iter()):kind='contributions'
  if kind:
   text=' '.join(' '.join(node.itertext()).split())
   if text:declarations.append({'id':kind,'text':text,'source':node.tag+':'+(node.get('id') or node.get('fn-type') or node.get('sec-type') or '')})
 
 for history in meta.findall('history'):meta.remove(history)
 abstracts=meta.findall('abstract');main=next((a for a in abstracts if a.get('abstract-type') not in ['graphical','teaser','key-points','toc','editor','summary']),abstracts[0] if abstracts else None)
 for a in abstracts:
  if a is not main:meta.remove(a)
 front=root.find('front')
 for note in front.findall('notes'):front.remove(note)
 back=root.find('back')
 if back is not None:
  children=list(back);back[:]=[];container=ET.SubElement(back,'sec');ET.SubElement(container,'title').text='Back matter';container.extend(children)
 data=json.loads(subprocess.check_output([str(pandoc),'-f','jats','-t','json'],input=ET.tostring(root),stderr=subprocess.PIPE))
 def walk(v):
  if isinstance(v,list):return [walk(x) for x in v]
  if not isinstance(v,dict):return v
  if v.get('t')=='Header' and any(n.get('c')=='Back' for n in v['c'][2]) and any(n.get('c')=='matter' for n in v['c'][2]):v['c'][0]=1
  if v.get('t')=='Figure' and v['c'][0][0] in boxes:
   return {'t':'Div','c':[[v['c'][0][0],['box'],[]],v['c'][1][1]]}
  return {k:walk(x) for k,x in v.items()}
 data=walk(data)
 data['meta']['jats-statements']={'t':'MetaList','c':[{'t':'MetaMap','c':{k:{'t':'MetaString','c':v} for k,v in d.items()}} for d in declarations]}
 title=meta.find('title-group/article-title')
 if title is not None:data['meta']['title']={'t':'MetaInlines','c':[{'t':'Str','c':' '.join(''.join(title.itertext()).split())}]}
 # Some publishers put editorial received/revised dates in front notes or body preambles.
 if data['blocks'] and data['blocks'][0].get('t')=='Para':
  first=' '.join(n.get('c','') for n in data['blocks'][0]['c'] if n.get('t')=='Str')
  if re.match(r'^(Received|Revised|Accepted) \d{4}',first):data['blocks'].pop(0)
 (cache/(e['pmcid']+'.ast.json')).write_text(json.dumps(data,separators=(',',':')))
 return {'genre':p['genre'],'id':e['id'],'pmcid':e['pmcid'],'boxes_preserved':len(boxes),'metadata_statements':len(declarations)}
with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(convert,items))
(ROOT/'reports/genre-conversion-round3.json').write_text(json.dumps(results,indent=2)+'\n')
print('Converted',len(results),'exemplars; preserved',sum(r['boxes_preserved'] for r in results),'boxes')
