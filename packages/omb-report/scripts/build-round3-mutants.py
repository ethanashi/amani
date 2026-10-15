"""Pin current directed guard edits. Retire removed policies, never silently skip at run time."""
import json
from pathlib import Path
p=Path(__file__).resolve().parents[1]
old=json.loads((p/'scripts/round2-mutants.json').read_text());rows=[];retired=[]
for r in old:
 if (p/'src'/r['file']).read_text().count(r['from'])==1: rows.append(r)
 else: retired.append({'id':r['id'],'reason':'Source policy replaced in round 3; see narrative/procedure/normalization guards in the current catalog.'})
def add(id,file,a,b,test='round3-partials'):
 assert (p/'src'/file).read_text().count(a)==1,(id,a)
 rows.append(dict(id=id,file=file,**{'from':a,'to':b},test=test))
for cue in ['type','phase','class']:
 add('R3-Roman-'+cue,'grammar.ts',f'|{cue}', '', 'round3-partials')
add('R3-Roman-forms','grammar.ts','lexicalForms(text)','[text]')
add('R3-Roman-case','grammar.ts',r'patients)\b/giu',r'patients)\b/gu')
add('R3-Roman-mg','grammar.ts','mg|kg','kg')
add('R3-Roman-units','grammar.ts',r'|\b([ivxlcdm]+)\s+(?:mg|kg|ml|mm|cm|units|participants|patients)\b','')
for script in ['Greek','Han','Arabic','Hiragana','Katakana','Hebrew','Devanagari']:
 add('R3-script-'+script,'normalise.ts',r',/\p{Script='+script+'}/u','')
for start,end in [('0000','0001'),('000e','0010')]:add('R3-C0-'+start,'normalise.ts',r'\u'+start,r'\u'+end,'round3-plan')
add('R3-filler','normalise.ts',r'requireThat(!/[\u115f',r'requireThat(true || !/[\u115f','round3-plan')
for filler in ['115f','1160','2800']:add('R3-filler-'+filler,'normalise.ts',r'\u'+filler,'','round3-plan')
add('R3-canonical-lookalikes','normalise.ts','requireThat(![...clean].some','requireThat(true || ![...clean].some','round3-plan')
add('R3-low-controls','normalise.ts',r'\u000b\u000c','','round3-plan')
add('R3-URL-scheme','grammar.ts',r'[a-z]+:\/\/|','')
add('R3-URL-domain','grammar.ts',r'|[a-z]+\.[a-z]{2,}\b','')
add('R3-URL-protocol','grammar.ts',r'(?:mailto|doi|javascript|data)\s*:|','')
add('R3-markup-bullet','grammar.ts',r"&&!/^(?:\s*[-+>]|\s*:::)/mu.test(text)",'')
add('R3-brackets','grammar.ts',r'requireThat(!/[\[\]]/u.test',r'requireThat(true || !/[\[\]]/u.test')
add('R3-unbalanced','grammar.ts','markers.length%2===0','true')
add('R3-sentence-split','grammar.ts',r"(i===text.length-1||/\s/u.test(text[i+1]!))",'true')
for sign in ['‰','‱']:add('R3-unit-'+sign,'grammar.ts',sign,'')
add('R3-look-safe','lock.ts','Number.isSafeInteger(seq)&&','')
add('R3-digest-required','report.ts','requireThat(Buffer.byteLength(required)<=options.byteBudget','requireThat(true || Buffer.byteLength(required)<=options.byteBudget')
add('R3-digest-optional','report.ts',r"Buffer.byteLength(markdown+line+'\n')<=options.byteBudget",'true')
add('R3-format-call-bounds','format.ts',' validateBundleBounds(b);','')
add('R3-format-call-one-sided','format.ts','validateOneSidedBundle(b);','')
add('R3-format-count-integral','format.ts','Number.isSafeInteger(value)&&','')
add('R3-format-count-nonnegative','format.ts','Number.isSafeInteger(value)&&value>=0','Number.isSafeInteger(value)')
add('R3-format-thresholds','format.ts','&&thresholds.every(finite)','')
add('R3-format-looks-integral','format.ts','&&Number.isSafeInteger(b.looks)','')
add('R3-plan-validation','context.ts','validatePlan(plan);','','round3-plan')
add('R3-plan-estimand','prose.ts',"requireThat(['odds ratio'","requireThat(true || ['odds ratio'",'round3-plan')
add('R3-plan-fragment','prose.ts',r'requireThat(/^[\p{L}',r'requireThat(true || /^[\p{L}','round3-plan')
add('R3-plan-assertion','prose.ts','requireThat(!hasAssertion(text)','requireThat(true || !hasAssertion(text)','round3-plan')
add('R3-narrative-procedure','prose.ts','requireThat(!procedural.test(key)','requireThat(true || !procedural.test(key)','round3-narrative')
add('R3-narrative-status','prose.ts',r'requireThat(!/\b(?:well-proven',r'requireThat(true || !/\b(?:well-proven','round3-narrative')
add('R3-narrative-assertion','prose.ts','requireThat(!hasAssertion(key)','requireThat(true || !hasAssertion(key)','round3-narrative')
add('R3-procedure-complete','render.ts',"requireThat(request.placeholders.length===1&&request.prose.trim()==='.'","requireThat(true || request.placeholders.length===1&&request.prose.trim()==='.'",'round3-narrative')
add('R3-blind-procedure','render.ts',r'requireThat(!request.placeholders.some(p=>/\.(?:validation|archiving)',r'requireThat(true || !request.placeholders.some(p=>/\.(?:validation|archiving)','round3-narrative')
add('R3-PartB-direction','limitations.ts',"requireThat(e.direction==='unknown'","requireThat(true || e.direction==='unknown'",'round3-narrative')
add('R3-template-lock','render.ts','validLock(ctx,bound.claims[0]!.id)','true','round3-plan')
add('R3-output-canonical','render.ts','normalise(displayFact(f))','displayFact(f)','round3-plan')
add('R3-numeric-string-input','../../omb-paper/src/derivations.ts','&&inputString(s.value,field)','','round2-numbers')
add('R3-quantity','english.ts','requireThat(!quantity.test(form)','requireThat(true || !quantity.test(form)','round3-partials')
add('R3-data-noun','render.ts',"requireThat(f.classification==='input'&&typeof f.raw==='number'","requireThat(true || f.classification==='input'&&typeof f.raw==='number'",'round3-narrative')
add('R3-entity-display','entities.ts','label:normalise(row.entry.label)','label:row.entry.label','round3-plan')
add('R3-plan-quantities','prose.ts','checkEnglish(text);','','round3-plan')
add('R3-inclusion-producer','prose.ts',"requireThat(!includedSubjects","requireThat(true || !includedSubjects",'round3-narrative')
add('R3-validation-availability','context.ts',"'validation not established'","'no validation data'",'round3-narrative')
add('R3-numeric-result-binding','prose.ts','requireThat(!statistic','requireThat(true || !statistic','round3-narrative')
add('R3-implicit-claim','wording.ts',"return pair||hasAssertion(s.prose)||entityPredicate(s.prose,c);", "return false;",'round2-templates')
add('R3-intro-exploratory','wording.ts',"requireThat(c.registered,'Introduction names exploratory entity')", "requireThat(true,'Introduction names exploratory entity')",'round3-narrative')
add('R3-blind-data-background','render.ts',"if(region==='introduction'||region==='background')requireThat(!(p.kind==='d'", "if(region==='introduction')requireThat(!(p.kind==='d'",'round2-guards')
add('R3-acronym-data','english.ts','MEDICAL_ACRONYMS.some(x=>lexicalKey(x)===lexicalKey(word))','false','round3-partials')
add('R3-source-own-study','wording.ts',r'requireThat(!/\b(?:our|we|this study',r'requireThat(true || !/\b(?:our|we|this study','round3-narrative')
add('R3-source-exact-canonical','wording.ts',"const quoteKey=(value:string)=>canonicalText(value).toLowerCase().replace(/ß/gu,'ss').replace(/ς/gu,'σ');", "const quoteKey=lexicalKey;",'round3-quote')
add('R3-entity-predicate','wording.ts','||entityPredicate(s.prose,c)','','round3-narrative')
# Retained legacy tests changed only where coordinator explicitly removed policy.
for r in rows:
 if r['id']=='R2-registry-visible':r['test']='text'
 if r['id'] in ['R24-title-digits','R2-partial-title-outcome','R2-numeric-raw-skeleton','R2-numeric-folded-skeleton','R3-filler-2800']:r['test']='round3-partials'
seen=set();unique=[]
for r in rows:
 k=(r['file'],r['from'],r['to'])
 if k not in seen:unique.append(r);seen.add(k)
(p/'scripts/round3-mutants.json').write_text(json.dumps(unique,indent=2)+'\n')
(p/'scripts/round3-retired-mutants.json').write_text(json.dumps(retired,indent=2)+'\n')
print(len(unique),'current edits;',len(retired),'replaced source sites recorded')
