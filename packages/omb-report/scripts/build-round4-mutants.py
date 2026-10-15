"""Directed edits of all surviving guards and the new structural boundaries.
No missing source site is skipped by the runner; replacements are audited here.
"""
import json
from pathlib import Path
p=Path(__file__).resolve().parents[1];rows=[];retired=[]
for r in json.loads((p/'scripts/round3-mutants.json').read_text()):
 if (p/'src'/r['file']).read_text().count(r['from'])==1:rows.append(r)
 else:retired.append({'id':r['id'],'reason':'Round-four replacement of this exact source site; superseded by registered noun phrases, generated regions, structural frames, or atomic slot neighbours. Historical edit retained in round3-mutants.json.'})
def add(id,file,a,b,test='round4-partials'):
 assert (p/'src'/file).read_text().count(a)==1,(id,a)
 rows.append(dict(id=id,file=file,**{'from':a,'to':b},test=test))
add('R4-region-runtime','boundaries.ts',"requireThat([...RESULT_REGIONS,...NARRATIVE_REGIONS].includes(region)","requireThat(true || [...RESULT_REGIONS,...NARRATIVE_REGIONS].includes(region)")
add('R4-default-ignorables','normalise.ts',r'requireThat(!/\p{Default_Ignorable_Code_Point}',r'requireThat(true || !/\p{Default_Ignorable_Code_Point}','round4-technical')
add('R4-structure-call','wording.ts','checkStructure(ctx,s,region);','','round4-partials')
add('R4-generated-only','boundaries.ts',"requireThat(claim,'result-bearing", "requireThat(true,'result-bearing")
for region in ['title','abstract','abstract-results','abstract-conclusions','results','key-points','conclusion','plain-summary','plain-summary-results']:
 add('R4-region-'+region,'boundaries.ts',"'"+region+"',",'', 'round4-partials') if region!='plain-summary-results' else add('R4-region-'+region,'boundaries.ts',",'plain-summary-results'",'')
add('R4-own-result','boundaries.ts','requireThat(!own.test(key)','requireThat(true || !own.test(key)')
add('R4-definite-result','boundaries.ts','requireThat(!resultFrame.test(key)','requireThat(true || !resultFrame.test(key)')
add('R4-alias-predicate','boundaries.ts',"requireThat(neutral,'claim entity", "requireThat(true,'claim entity")
add('R4-literature-frame','boundaries.ts',r'requireThat(!/\b(?:earlier',r'requireThat(true || !/\b(?:earlier')
for role in ['exposure','outcome','adjustment','covariates','entities','aliases','synonyms','abbreviations','symbols']:
 # Arrays occur in two loops; find the unique top-level list.
 a="['exposure','outcome','adjustment','covariates','entities','aliases','synonyms','abbreviations','symbols']"
 add('R4-alias-'+role,'boundaries.ts',a,a.replace("'"+role+"',",'').replace(",'"+role+"'",''))
add('R4-role-aliases','boundaries.ts',"visit(plan[`${role}_${key}`]);",'')
add('R4-nested-aliases','boundaries.ts',"Object.values(record(value)).forEach(visit);",'void value;')
add('R4-alias-case','boundaries.ts','const key=lexicalKey(text);','const key=text;')
add('R4-noun-registry','prose.ts','requireThat(names.some(name=>','requireThat(true || names.some(name=>')
add('R4-plan-validation','context.ts',"validatePlan(plan,[...PLAN_NOUNS,...input.variables.filter(v=>v.claimId===found.claimId).map(v=>v.name),...input.entities.filter(e=>e.claimIds.includes(found.claimId)).map(e=>e.canonicalForm)]);",'', 'round4-plan')
for field in ['exposure','outcome','one_sided_justification','controls_source']:
 a="['exposure','outcome','one_sided_justification','controls_source']"
 add('R4-field-'+field,'prose.ts',a,a.replace("'"+field+"',",'').replace(",'"+field+"'",''),'round4-plan')
for field in ['adjustment','exclusions']:
 add('R4-field-'+field,'prose.ts',"['adjustment','exclusions']", "['"+('exclusions' if field=='adjustment' else 'adjustment')+"']",'round4-plan')
add('R4-procedure-call','prose.ts','requireThat(!procedureAssertion(key)','requireThat(true || !procedureAssertion(key)','round4-narrative')
add('R4-procedure-citation','wording.ts',"requireThat(!procedureAssertion(s.prose)","requireThat(true || !procedureAssertion(s.prose)",'round4-structure')
add('R4-controls-source','prose.ts',r'||/\bcontrols?',r'||false && /\bcontrols?')
add('R4-archive-statement','prose.ts',r'||/\b(?:code|files|data|protocol)',r'||false && /\b(?:code|files|data|protocol)')
add('R4-procedure-predicate','prose.ts',r'return /\b(?:pre-?regist',r'return false && /\b(?:pre-?regist')
add('R4-version-atomic','render.ts',"['v','r'].includes(p.kind)||",'', 'round4-technical')
add('R4-neighbours-call','render.ts',"if(!bound.claims.length)assertNumericNeighbours(s.text,p,p.kind==='c');",'', 'round4-technical')
add('R4-unit-suffix','render.ts',r'requireThat(/^(?:$|[.),!?]',r'requireThat(true || /^(?:$|[.),!?]')
add('R4-unit-prefix','render.ts','requireThat(citation||word===undefined||','requireThat(true || citation||word===undefined||')
add('R4-ratio-prefix','render.ts',r'requireThat(!/[/:;]$/u.test(left)',r'requireThat(true || !/[/:;]$/u.test(left)')
add('R4-division','grammar.ts','÷','','round4-partials')
add('R4-archive-hash','procedures.ts',r'/^[a-f0-9]{64}$/u.test(a.sha256)',r'/^[a-zA-Z0-9]{63,65}$/u.test(a.sha256)','round4-technical')
add('R4-generic-limitation','boundaries.ts','&&genericLimitation(key)','&&false','round4-narrative')
add('R4-generic-limitation-tail','boundaries.ts','[.!?]$/iu.test(text);','[.!?]/iu.test(text);')
add('R4-vague-quantity','english.ts','zero|one|two','many|most|multiple|both|zero|one|two')
# Retarget changed guard isolation probes, keeping old edits in the denominator.
for r in rows:
 if r['id'] in ['R3-filler','R3-filler-115f','R3-filler-1160','R3-plan-fragment','R3-plan-quantities','R3-implicit-claim','R3-entity-predicate','R21-unbound-metric','R21-entity-unbound','R3-source-own-study']:r['test']='round4-partials'
seen=set();unique=[]
for r in rows:
 k=(r['file'],r['from'],r['to'])
 if k not in seen:seen.add(k);unique.append(r)
(p/'scripts/round4-mutants.json').write_text(json.dumps(unique,indent=2)+'\n')
(p/'scripts/round4-retired-mutants.json').write_text(json.dumps(retired,indent=2)+'\n')
print(len(unique),'current mutants;',len(retired),'replaced source sites')
