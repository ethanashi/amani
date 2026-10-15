#!/usr/bin/env python3
"""Write synthetic structural fixtures. No scientific results or exemplar prose.
Regex witnesses exercise the data-driven rules; independent real-exemplar checks
live in calibrate-genres. Run only when intentionally updating fixture goldens.
"""
from pathlib import Path
import json,re
from re import _parser as parser, _constants as C
ROOT=Path(__file__).resolve().parents[1]
def witness(pattern):
 def emit(nodes):
  out=''
  for op,v in nodes:
   if op==C.LITERAL:out+=chr(v)
   elif op==C.NOT_LITERAL:out+=' ' if v!=32 else 'x'
   elif op==C.ANY:out+='x'
   elif op==C.IN:
    if v[0][0]==C.NEGATE:out+=' '
    else:out+=emit([v[0]])
   elif op==C.RANGE:out+=chr(v[0])
   elif op==C.CATEGORY:out+='1' if v==C.CATEGORY_DIGIT else ' ' if v==C.CATEGORY_SPACE else 'a'
   elif op==C.SUBPATTERN:out+=emit(v[-1])
   elif op==C.BRANCH:out+=emit(v[1][0])
   elif op in [C.MAX_REPEAT,C.MIN_REPEAT]:out+=emit(v[2])*max(v[0],1 if v[1]>0 else 0)
   elif op==C.ASSERT:out+=emit(v[1])
  return out
 result=emit(parser.parse(pattern,flags=re.I))
 return result if re.search(pattern,result,re.I) else None
def example(patterns):
 for p in patterns:
  s=witness(p)
  if s is not None:return s
 raise ValueError(patterns)
def wc(s):return len(re.findall(r"[A-Za-z0-9][A-Za-z0-9'.,%/\-]*",s))
mapping={}
for f in sorted((ROOT/'genres').glob('*.json')):
 p=json.loads(f.read_text())
 for c in p['checklists']:
  if c['kind']=='reporting_guideline':mapping[c['name']]='checklists/'+re.sub('[^a-zA-Z0-9_-]','-',c['name'])+'.json'
(ROOT/'genre-checklists.json').write_text(json.dumps(mapping,indent=2)+'\n')
for f in sorted((ROOT/'genres').glob('*.json')):
 p=json.loads(f.read_text());slug=p['genre']; sections={s['id']:s for s in p['sections']}; parts=[]
 variant=next((v['order'] for v in p['section_order_variants'] if all(x in v['order'] for x in ['introduction','methods','results','discussion'])),p['section_order_variants'][0]['order'])
 order=[s for s in variant if s in ['introduction','methods','results','discussion']]
 order.insert(order.index('discussion')+1,'limitations')
 order=['title','abstract']+order+[s['id'] for s in p['sections'] if s['level']=='required' and not s.get('venue_governed') and s['id'] not in order+['title','abstract']]
 if 'supplement' in order:order.remove('supplement')
 statements={}
 for st in p['required_statements']:
  if st['level']!='required':continue
  where=next((x for x in st['placement'] if x in sections and x not in ['abstract','title']), 'data_availability')
  statements.setdefault(where,[]).append(st)
 limslots=[{'id':l['id'],'status':'addressed','text':'Synthetic limitation: '+l['text']} for l in p['limitations']['standard_items'] if l['level']!='optional']
 for sid in order:
  s=sections.get(sid,{'id':sid,'heading':sid.title(),'elements':[],'subsections':[],'words':p['limitations']['words']})
  body=[]
  for el in s['elements']:
   if el['level']=='required' and el['detect']:
    if el['id']=='registration_id' and any(st['id']=='registration' for st in statements.get(sid,[])):continue
    body.append('Observed '+example(el['detect'])+'.')
  if sid=='title':parts.append('::: {.title-page section-id="title"}\n# Synthetic structural validation fixture: '+ ' '.join(body)+'\n:::');continue
  if sid=='limitations':body.extend(slot['text'] for slot in limslots)
  for st in statements.get(sid,[]):body.append('::: {statement-id="'+st['id']+'"}\n'+example(st['detect'])+'.\n:::')
  if sid=='abstract':
   body=[example(e['detect'])+'.' for e in p['abstract']['elements'] if e['level']=='required']
   target=p['abstract']['words']['typical'];body.append(' '.join(['fixture']*max(0,target-wc(' '.join(body)))))
   text='\n\n'.join(body)
   if p['abstract']['format']=='structured':
    heads=p['abstract']['heading_sets'][0]['headings'];text='\n\n'.join('## '+h+'\n\n'+(text if i==0 else 'Synthetic abstract subsection.') for i,h in enumerate(heads))
   parts.append('::: {.abstract section-id="abstract"}\n'+text+'\n:::');continue
  subs=[h for h in s['subsections'] if h['level']=='required' and not re.search('limitation',h['heading'],re.I)]
  body.extend('## '+h['heading']+'\n\nSynthetic description.' for h in subs)
  target=(s.get('words') or {}).get('typical',20)
  if sid=='results' and not subs:body.append('## Synthetic results\n\nSynthetic description.')
  body.append(' '.join(['fixture']*max(0,target-wc(' '.join(body)))))
  parts.append('# '+s['heading']+' {#sec-'+sid+' section-id="'+sid+'"}\n\n'+'\n\n'.join(body))
 manifest=[];supp=['# Supplementary materials {section-id="supplement"}']
 # Required main and supplement display inventories, plus the MR owner-requested regional plot.
 for d in p['display_items']:
  if d.get('venue_governed') or (d['level']!='required' and d['id']!='regional_association_plot'):continue
  caption=example(d['detect'])+'. Synthetic '+d['id']+' display.'
  if d['id']=='surrogacy_scatter':caption+=' Shading shows the 95% prediction band.'
  count=max(1,d['count']['min'])
  for i in range(count):
   itemid=d['id']+str(i)
   if d['placement']=='supplement':manifest.append({'title':caption,'kind':d['id'],'caption':caption,'path':'supplement/'+itemid});continue
   if d['type']=='figure':display='!['+caption+'](synthetic.svg){#fig-'+itemid+' kind="'+d['id']+'"}'
   else:display='::: {.table kind="'+d['id']+'"}\n| Synthetic | Value |\n|---|---|\n| Fixture | 1 |\n\n'+caption+'\n:::'
   parts.append(display)
 for s in p['supplement']:
  if s['level']=='required':manifest.append({'title':s['item'],'genre_item':s['id'],'path':'supplement/'+s['id']});supp.append('## '+s['item']+'\n\nSynthetic supplement content.')
 refs=p['references']['typical'];parts.append('::: {.references}\n'+'\n\n'.join('::: {.csl-entry}\nSynthetic reference '+str(i)+'.\n:::' for i in range(refs))+'\n:::')
 kinds={'sr-ma-adverse-events-rct':'synthesis','trial-level-surrogate-evaluation':'synthesis','cis-mr-colocalisation-drug-target':'causal-genetic','crispr-dependency-target-selectivity':'functional-genomics','single-cell-atlas-drug-sensitivity':'single-cell','ai-research-agent-methods':'system-paper'}
 checklists={mapping[c['name']]:{'name':c['name'],'attribution':'SYNTHETIC structural fixture; not a completed real reporting guideline.','items':[{'id':'synthetic','text':'Synthetic slot','anchor':'methods','excerpt':'fixture','status':'software'}]} for c in p['checklists'] if c['kind']=='reporting_guideline'}
 record={'declaration':{'genre':slug,'claim_kinds':[kinds[slug]],'design_flags':{'systematic_search':True,'ipd':False,'network_ma':False,'multi_instrument':False,'proteome_wide':False,'drug_selectivity_claim':False,'new_wet_lab_data':False}},'venue':{'id':'synthetic-uncapped-genre-control','summaryLayers':[],'displayCap':100},'manifest':manifest,'checklists':checklists,'checklistMapping':mapping,'limitations':limslots,'waivers':[],'ownerActions':[],'ownerActor':'synthetic-owner','asOf':'2026-10-13'}
 dest=ROOT/'test/fixtures/genres'/slug;dest.mkdir(exist_ok=True)
 (dest/'paper.md').write_text('\n\n'.join(parts)+'\n');(dest/'supplement.md').write_text('\n\n'.join(supp)+'\n');(dest/'records.json').write_text(json.dumps(record,indent=2)+'\n')
 print(slug)
