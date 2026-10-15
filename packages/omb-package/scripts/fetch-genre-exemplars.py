#!/usr/bin/env python3
"""Fetch calibration inputs into the ignored cache; never vendor exemplar prose."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json,urllib.request,hashlib
ROOT=Path(__file__).resolve().parents[1]
cache=ROOT/'.cache/genre-exemplars';cache.mkdir(parents=True,exist_ok=True)
items=[(p['genre'],e) for f in sorted((ROOT/'genres').glob('*.json')) for p in [json.loads(f.read_text())] for e in p['exemplars']]
def fetch(item):
 slug,e=item;pmc=e['pmcid'];target=cache/(pmc+'.xml')
 try:
  if not target.exists():
   req=urllib.request.Request('https://www.ebi.ac.uk/europepmc/webservices/rest/'+pmc+'/fullTextXML',headers={'User-Agent':'omerta-genre-calibration/1.0'})
   with urllib.request.urlopen(req,timeout=45) as response:raw=response.read(15_000_000)
   assert b'<article' in raw,'not JATS XML'
   target.write_bytes(raw)
  raw=target.read_bytes();print(slug,e['id'],len(raw),flush=True)
  return {'genre':slug,'id':e['id'],'pmcid':pmc,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'ok':True}
 except Exception as exc:return {'genre':slug,'id':e['id'],'pmcid':pmc,'ok':False,'error':str(exc)}
with ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(fetch,items))
(ROOT/'reports/genre-fetch-round2.json').write_text(json.dumps(results,indent=2)+'\n')
print('Fetched',sum(r['ok'] for r in results),'/',len(results),'bytes',sum(r.get('bytes',0) for r in results),flush=True)
raise SystemExit(0 if all(r['ok'] for r in results) else 1)
