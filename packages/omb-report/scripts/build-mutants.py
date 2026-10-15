"""Explicit directed mutations, retaining still-applicable round-one boundaries."""
import json
from pathlib import Path
pkg=Path(__file__).resolve().parents[1]
old=json.loads((pkg/'scripts/review-mutants.json').read_text())
retired={'R17-null-phrases','R16-label-insertion','R23-procedure-owner'}
rows=[r for r in old if r['id'] not in retired and (pkg/'src'/r['file']).read_text().count(r['from'])==1]
for r in rows:
 if r['id'] in ['R01-atomic','R01-final-audit','R19-size','R19-crossed','R19-emphasis-length','R01-spaced-decoration']:r['test']='round2-isolation'
 if r['id']=='R11-unbound-summary':r['test']='round2-guards'
def add(id,file,a,b,test='round2-isolation'):
 rows.append(dict(id=id,file=file,**{'from':a,'to':b},test=test))
add('R2-numeric-raw-skeleton','normalise.ts',',confusableSkeleton(canonicalText(text))','')
add('R2-numeric-folded-skeleton','normalise.ts','[folded,lexicalKey(text),','[folded,', 'round2-isolation')
add('R2-casefold','normalise.ts',"canonicalText(text).toLowerCase().replace(/ß/gu,'ss').replace(/ς/gu,'σ')).toLowerCase()", "canonicalText(text)).toLowerCase()",'round2-normalise')
add('R2-white-space','normalise.ts',r'[\p{White_Space}]+',r'[\s]+','round2-normalise')
add('R2-Han-after-NFKC','normalise.ts','[text,clean]','[text]','round2-normalise')
add('R2-Han-refusal','normalise.ts',r'requireThat(!/[\p{Script=Han}',r'requireThat(true || !/[\p{Script=Han}','round2-normalise')
add('R2-ampersand','normalise.ts','requireThat(!/&/u.test(variant)','requireThat(true || !/&/u.test(variant)','round2-normalise')
add('R2-DEL','normalise.ts',r'\u007f-\u0084',r'\u0080-\u0084','round2-normalise')
add('R2-unknown-English','english.ts','requireThat(words.has(key)||','requireThat(true || words.has(key)||')
add('R2-normalized-digit','english.ts',"requireThat(!/[0-9]/u.test(form)","requireThat(true || !/[0-9]/u.test(form)")
add('R2-temporal-exception','english.ts','permittedProcedure&&nonQuantityProcedureWords.has','nonQuantityProcedureWords.has','round2-guards')
add('R2-English-acronym','english.ts','||acronymKeys.has(key)','', 'round2-numbers')
add('R2-Roman-position','grammar.ts',"requireThat(!roman.test(variant)","requireThat(true || !roman.test(variant)",'round2-guards')
add('R2-URL-normalized','grammar.ts',"requireThat(!/(?:[a-z]+:","requireThat(true || !/(?:[a-z]+:",'round2-guards')
add('R2-empty-emphasis','grammar.ts',"requireThat(!/(?<!\\*)", "requireThat(true || !/(?<!\\*)",'round2-guards')
add('R2-connective','wording.ts',"requireThat(CONNECTIVES.some(c=>", "requireThat(true || CONNECTIVES.some(c=>")
add('R2-one-claim','wording.ts',"requireThat(claims.length===1", "requireThat(true || claims.length===1",'round2-guards')
add('R2-one-placeholder','wording.ts',"s.placeholders.length===1&&", "")
add('R2-claim-placeholder','wording.ts',"&&s.placeholders[0]!.kind==='claim'", "",'round2-guards')
add('R2-procedure-regions','wording.ts',"if(!['methods','limitations','introduction','background'].includes(region))return false;", "",'round2-isolation')
add('R2-procedure-connective','templates.ts',"requireThat(CONNECTIVES.includes(connective)","requireThat(true || CONNECTIVES.includes(connective)",'round2-guards')
add('R2-software-label','templates.ts',' [m:${c.id}.label]','')
add('R2-software-bundle','templates.ts','` [m:${c.id}.result]`',"''")
add('R2-voided-no-bundle','templates.ts',"['voided','non-identifiable']","['non-identifiable']")
add('R2-unidentified-no-bundle','templates.ts',"['voided','non-identifiable']","['voided']")
phrases={'confirmed':'The pre-registered prediction held','replicated':'The prediction held again in independent data','tentative':'The finding is tentative; required checks remain incomplete','refuted':'The pre-registered prediction did not hold at the smallest effect of interest','insufficient-evidence':'The data could not decide the pre-registered prediction','non-identifiable':'The proposed effect is not identifiable from these data','voided':'The analysis was voided and is not counted as evidence','exploratory':'The observation is exploratory and was not tested on held-out data'}
for status,phrase in phrases.items():add('R2-template-'+status,'templates.ts',phrase,'The prediction was confirmed')
add('R2-literature-region','wording.ts',"requireThat(region==='introduction'||region==='background'", "requireThat(true || region==='introduction'||region==='background'",'round2-guards')
add('R2-literature-result','wording.ts',"requireThat(!s.placeholders.some(p=>!['c','l','e'].includes(p.kind))", "requireThat(true || !s.placeholders.some(p=>!['c','l','e'].includes(p.kind))",'round2-guards')
add('R2-literature-form','wording.ts',"requireThat(LITERATURE_TEMPLATES.some(t=>", "requireThat(true || LITERATURE_TEMPLATES.some(t=>",'round2-guards')
add('R2-literature-exact','wording.ts',"requireThat(ctx.quotes.filter(q=>quoteKeys.includes(q.key)).some", "requireThat(true || ctx.quotes.filter(q=>quoteKeys.includes(q.key)).some",'round2-guards')
add('R2-numeric-string','../../omb-paper/src/derivations.ts',"&&!/^[+-]?(?:[0-9][0-9.,\\s]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/u.test(s.value.normalize('NFKC').trim())", "",'round2-numbers')
add('R2-PartB-choice','limitations.ts',"requireThat(choice,'Part B requires", "requireThat(true,'Part B requires",'round2-limitations')
add('R2-PartB-overturn','limitations.ts',"e.couldOverturn&&['yes','no','unknown'].includes(e.couldOverturn)","true",'round2-limitations')
add('R2-PartB-no','limitations.ts',"requireThat(e.couldOverturn!=='no'", "requireThat(true || e.couldOverturn!=='no'",'round2-guards')
add('R2-PartB-NA','limitations.ts',"requireThat(e.notApplicable===undefined", "requireThat(true || e.notApplicable===undefined",'round2-guards')
add('R2-plain-scope','limitations.ts','${claimName(ctx,c.id)}','c1','round2-limitations')
add('R2-not-run-twin','limitations.ts',"requirement.outcome==='failed'", "true",'round2-limitations')
add('R2-measured-plain-name','limitations.ts','${claimName(ctx,region.id.slice(0,-suffix.length-1))}','${region.id.slice(0,-suffix.length-1)}','round2-guards')
add('R2-repeat-skeleton','limitations.ts','return lexicalKey(stripParentheticals(decoded.replace','return normalise(stripParentheticals(decoded.replace','round2-limitations')
add('R2-repeat-label','limitations.ts',".replace(/\\[[a-z]+:[^\\]]+\\]/gu,' ')","",'round2-limitations')
add('R2-repeat-punctuation','limitations.ts',".replace(/[^\\p{L}\\p{N}]+/gu,' ')","",'round2-limitations')
add('R2-nested-label','limitations.ts',"depth++;out+=' ';","depth=1;out+=' ';",'round2-limitations')
add('R2-registry-visible','entities.ts',"&&/^[\\p{L}\\p{N}][\\p{L}\\p{N} ._@+-]*$/u.test(pack.version)","",'round2-limitations')
for id,file,a,b in [
 ('requirements','context.ts','requirements.length>0&&',''),
 ('source-id','context.ts','source.id===d.sourceId&&',''),
 ('input-derivation','context.ts',"&&d.derivation===null",''),
 ('title-outcome','report.ts','exposure+outcome','exposure'),
 ('lock-integer','lock.ts','!Number.isSafeInteger(sequence)||',''),
 ('percent-negative','format.ts','value>=0&&value<=100','value<=100'),
 ('p-negative','format.ts','finite(value)&&value>=0&&value<=1&&finite(alpha)','finite(value)&&value<=1&&finite(alpha)'),
 ('alpha-zero','format.ts','alpha>0&&',''),
 ('alpha-one','format.ts','&&alpha<1',''),
 ('looks-zero','format.ts','&&b.looks>=1',''),
 ('family-integer','format.ts','Number.isSafeInteger(b.familySize)&&',''),
 ('MEI-lower','format.ts','b.nullValue-b.mei,',''),
 ('MEI-finite','format.ts','finite(b.mei)&&',''),
 ('two-sided-finite','format.ts','b.twoSidedCI.every(finite)&&',''),
 ('two-sided-order','format.ts','b.twoSidedCI[0]<=b.twoSidedCI[1]&&',''),
 ('justification-trim','format.ts','b.oneSidedJustification?.trim()','b.oneSidedJustification'),
 ('year-null','render.ts',"requireThat(quote.year!==null","requireThat(true || quote.year!==null"),
 ('literature-range','render.ts',"requireThat(finite(value),'missing literature number'","requireThat(true,'missing literature number'"),
 ]:add('R2-partial-'+id,file,a,b,'round2-partial')
add('R2-two-sided-lower-threshold','format.ts',"formatNumber(b.twoSidedCI[0],'ci',thresholds)","formatNumber(b.twoSidedCI[0],'ci')",'round2-partial')
add('R2-two-sided-upper-threshold','format.ts',"formatNumber(b.twoSidedCI[1],'ci',thresholds)","formatNumber(b.twoSidedCI[1],'ci')",'round2-partial')
add('R2-estimate-finite','format.ts','finite(b.estimate)&&','', 'round2-partial')
add('R2-null-finite','format.ts',"&&finite(b.nullValue),'non-finite",",'non-finite", 'round2-partial')
add('R2-background-derived','render.ts',"region==='introduction'||region==='background'","region==='introduction'",'round2-guards')
add('R2-intro-procedures','wording.ts',"const templates=region==='introduction'||region==='background'?", "const templates=region==='background'?",'round2-guards')
add('R2-background-procedures','wording.ts',"const templates=region==='introduction'||region==='background'?", "const templates=region==='introduction'?",'round2-guards')
# Core directed guards retained from the original runner.
for id,file,a,b,test in [
 ('producer-required','context.ts',"f.grade!=='unverified'&&f.producerGate!==null","f.grade!=='unverified'",'report'),
 ('context-seal','context.ts','requireThat(contexts.get(ctx)===','requireThat(true || contexts.get(ctx)===','round2-isolation'),
 ('spanless-order','numeric-matchers.ts','return tokens.every((token,i)=>','return true || tokens.every((token,i)=>','text'),
 ('sentence-skeleton','render.ts','requireThat(before.sha256===after.sha256','requireThat(true || before.sha256===after.sha256','wording'),
 ('protected-content','limitations.ts','requireThat(a&&a.text===e.text','requireThat(true || a&&a.text===e.text','wording'),
 ('at-most-once','limitations.ts','requireThat(count<=1','requireThat(true || count<=1','round2-limitations'),
 ('registry-hash','entities.ts','canonicalSha256(pack.entries)===pack.sha256','true','text'),
 ('p-bound','format.ts','value<0.001&&alpha>=0.001','value<0.001','text'),
 ('rounding-side','format.ts','if(thresholds.every(t=>side(Number(s),t)===side(value,t)))return s;','if(true)return s;','text'),
 ]:add(id,file,a,b,test)
seen=set();result=[]
for r in rows:
 k=(r['file'],r['from'],r['to'])
 if k in seen:continue
 seen.add(k)
 n=(pkg/'src'/r['file']).read_text().count(r['from'])
 if n!=1:raise Exception(f'{r["id"]}: {n} sites')
 result.append(r)
(pkg/'scripts/round2-mutants.json').write_text(json.dumps(result,indent=2)+'\n')
print(len(result),'directed mutations')
