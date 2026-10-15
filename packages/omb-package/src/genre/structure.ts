import { ruleClass,RULE_CLASS_POLICY_HASH } from './classes.ts';
import { canonicalJson,canonicalSha256 } from '../common.ts';
import { loadProfile } from './profiles.ts';
import { sections,displays,MAIN,EXTENSIONS,allNodes,attributes,fullText,normalizeHeading,proseText,countWords,protectedWords } from './ast.ts';
import type { SectionView } from './ast.ts';
import type { LintInput,Report,Finding,Severity,Entry,Range,LoadedProfile,Waiver,Profile } from './types.ts';
export const PROMOTIONS=['surrogacy-prediction-band@1','colocalised-regional-plot@1'];
export function waiverHash(w:Waiver):string {const {owner_action_receipt:_receipt,...body}=w;return canonicalSha256(body);}
export function ownerWaiverValid(w:Waiver,input:Pick<LintInput,'ownerActions'|'ownerActor'|'asOf'>):boolean {
 return /^[a-f0-9]{64}$/.test(w.profile_sha256)&&w.reason.trim().length>0&&/^\d{4}-\d{2}-\d{2}$/.test(w.date)&&w.date<=input.asOf&&input.ownerActions.some(a=>a.receipt===w.owner_action_receipt&&a.actor===input.ownerActor&&a.action==='structure-waiver'&&a.waiver_hash===waiverHash(w)&&a.at.slice(0,10)>=w.date&&a.at.slice(0,10)<=input.asOf);
}
export function blocksPackaging(report:Report):boolean {return report.summary.fail>0||report.summary.fail_w_unwaived>0;}
export function assertStructure(report:Report):void {if(blocksPackaging(report))throw Error('Genre structure lint failed: '+report.findings.filter(f=>f.severity==='FAIL'||f.severity==='FAIL-W'&&!f.waiver).map(f=>`${f.rule} ${f.target}`).join('; '));}
export function reportBytes(report:Report):string {return canonicalJson(report)+'\n';}
export function reportMarkdown(r:Report):string {
 const lines=[`# Genre structure: ${r.profile?.genre??'unprofiled'}`,`Comparable words: ${r.comparable_words}; Amani extension words: ${r.omerta_extension_words}.`];
 for(const severity of ['FAIL','FAIL-W','WARN'] as const){const findings=r.findings.filter(f=>f.severity===severity);if(findings.length)lines.push(`## ${severity}`,...findings.map(f=>`- ${f.rule} ${f.target}: ${f.observed}${f.waiver?` (owner waiver: ${f.waiver.reason})`:''}. ${f.hint}`));}
 const manual=r.findings.filter(f=>f.rule==='G1');if(manual.length)lines.push('## Manual checks',...manual.map(f=>`- ${f.hint}`));
 return lines.join('\n\n')+'\n';
}
/** The production entry point has no switches to disable package checks. */
export function lintStructure(input:LintInput):Report {return evaluate(input,false);}
/** Exemplar-only harness: published papers have no Amani checklist files, manifest
 * or Part B record. This function is never imported by packaging. */
export function lintExemplar(input:LintInput):Report {return evaluate(input,true);}
function evaluate(input:LintInput,exemplar:boolean):Report {
 const report:Report={ruleClassPolicyHash:RULE_CLASS_POLICY_HASH,profile:null,secondary_profiles:[],venue:input.venue.id,comparable_words:0,omerta_extension_words:0,summary:{fail:0,fail_w_unwaived:0,fail_w_waived:0,warn:0,info:0},findings:[],promotions:PROMOTIONS};
 let active:LoadedProfile|null=null;
 const add=(rule:string,severity:Severity,target:string,expected:string,observed:string,location:string|null=null,hint='',entry?:Entry)=>{if(entry?.level==='typical'&&(severity==='FAIL'||severity==='FAIL-W'))severity='WARN';report.findings.push({ruleClass:ruleClass(rule,target,entry),rule,severity,target,expected,observed,location,hint,waiver:null,profile_sha256:active?.sha256??null,...(entry?{basis:entry.basis}:{})});};
 const finish=()=>{
  for(const f of report.findings)if(f.severity==='FAIL-W')f.waiver=input.waivers.find(w=>w.rule===f.rule&&w.target===f.target&&w.profile_sha256===f.profile_sha256&&ownerWaiverValid(w,input)&&fullText(input.supplementAst?.blocks??[]).includes(w.reason.replace(/\s+/g,' ').trim()))??null;
  for(const w of input.waivers)if(!report.findings.some(f=>f.waiver===w))add('WAIVER','INFO',w.target,'waiver of a matching FAIL-W backed by an owner action','unused or invalid waiver; FAIL cannot be waived',null,w.reason);
  report.findings.sort((a,b)=>[a.rule,a.target,a.profile_sha256??'',a.observed].join('\0').localeCompare([b.rule,b.target,b.profile_sha256??'',b.observed].join('\0'),'en'));
  for(const f of report.findings){if(f.severity==='FAIL')report.summary.fail++;else if(f.severity==='FAIL-W')report.summary[f.waiver?'fail_w_waived':'fail_w_unwaived']++;else report.summary[f.severity==='WARN'?'warn':'info']++;}
  return report;
 };
 const declaredProfiles=[...new Set([input.declaration.genre,...input.declaration.secondary_genres??[]].filter((x):x is string=>!!x))].sort();
 if(input.expectedProfileHashes&&canonicalJson(Object.keys(input.expectedProfileHashes).sort())!==canonicalJson(declaredProfiles))add('P2','FAIL','profile.set','same genre set as prior certificate',declaredProfiles.join(', '));
 const get=(slug:string):LoadedProfile|null=>{try{return loadProfile(slug);}catch(e){add('P1','FAIL','profile','valid pinned genre-profile/1',String(e));return null;}};
 if(!input.declaration.genre){add('P4','WARN','profile','locked primary genre','structural lint not applied: no genre in the locked paper_set');return finish();}
 active=get(input.declaration.genre);
 if(!active){if(!report.findings.length)add('P4','WARN','profile','known genre','structural lint not applied: no profile for '+input.declaration.genre);return finish();}
 const p=active.profile;report.profile={genre:p.genre,schema_version:p.schema_version,sha256:active.sha256};
 const verifyPin=(loaded:LoadedProfile)=>{if(input.expectedProfileHashes&&input.expectedProfileHashes[loaded.profile.genre]!==loaded.sha256)add('P2','FAIL','profile.sha256','certificate profile hash',loaded.sha256);};verifyPin(active);
 const staleAfter=new Date(p.built_on+'T00:00:00Z');staleAfter.setUTCFullYear(staleAfter.getUTCFullYear()+2);
 if(new Date(input.asOf).getTime()>staleAfter.getTime())add('P3','WARN','profile.built_on','profile no older than 24 months',p.built_on);
 const variants:Record<string,string[]>= {'sr-ma-adverse-events-rct':['synthesis','literature-synthesis','harms'],'trial-level-surrogate-evaluation':['synthesis','literature-synthesis','surrogacy'],'cis-mr-colocalisation-drug-target':['causal-genetic'],'crispr-dependency-target-selectivity':['discovery','functional-genomics'],'single-cell-atlas-drug-sensitivity':['discovery','single-cell'],'ai-research-agent-methods':['system-paper','ai-research-agent-methods']};
 const declared=[...input.declaration.claim_kinds,input.declaration.study_variant??''];
 if(!declared.some(k=>variants[p.genre]?.includes(k))||input.declaration.claim_kinds.includes('causal-genetic')&&p.genre!=='cis-mr-colocalisation-drug-target')add('P5','FAIL-W','genre','genre compatible with locked claim kinds and study variant',declared.join(', '));
 const applicable=(e:Entry,target:string)=>{
  if(e.venue_governed){add('V1','INFO',target,'venue summary-layer rules','venue-governed item delegated to venue lint');return false;}
  if(e.applies_when){const flag=input.declaration.design_flags?.[e.applies_when];if(flag===false){add('X1','INFO',target,`${e.applies_when}=true`,'design flag false; skipped',null,'',e);return false;}if(flag===undefined)add('X2','WARN',target,`declared flag ${e.applies_when}`,'flag missing; requirement checked fail-closed',null,'',e);}
  return true;
 };
 const level=(e:Entry,hard:Severity='FAIL-W'):Severity=>e.level==='required'?hard:'WARN';
 const band=(rule:string,target:string,value:number,r:Range|null,factor:[number,number],entry?:Entry,onlyWarn=false)=>{if(!r||value>=r.min&&value<=r.max)return;const hard=value<factor[0]*r.min||value>factor[1]*r.max;const severity=input.venue.shortFormat&&['W1','W2','A4','D4','D5'].includes(rule)?'INFO':hard&&!onlyWarn?'FAIL-W':'WARN';add(rule,severity,target,`${r.min}–${r.max} (hard ${factor[0]*r.min}–${factor[1]*r.max})`,String(value),null,'',entry);};
 const views=sections(input.ast,p),suppViews=input.supplementAst?sections(input.supplementAst,p):[];
 if(input.manifest.length&&!views.some(s=>s.id==='supplement'))views.push({id:'supplement',ids:['supplement'],heading:'Supplement',level:1,location:'supplement/manifest.json',blocks:[],subsections:[],fallback:false,words:0,prose:suppViews.map(s=>s.prose).join('\n')});
 const getSection=(id:string):SectionView|undefined=>views.find(s=>s.ids.includes(id))??views.filter(s=>!['title','abstract','plain_summary','key_points'].includes(s.id)).flatMap(s=>s.subsections.filter(sub=>sub.id===id).map(sub=>({...s,id,ids:[id],heading:sub.heading,level:2,location:s.location+'/'+sub.heading,blocks:sub.blocks,words:countWords(sub.blocks),prose:proseText(sub.blocks),subsections:[]}))).at(0);
 const merged=views.find(s=>s.id==='results_discussion'),mergedAllowed=p.section_order_variants.some(v=>v.order.includes('results_discussion'));
 const headedLimitations=getSection('limitations');
 const discussion=getSection('discussion')??merged;
 const unheaded=discussion?.blocks.filter(n=>['Para','Plain'].includes(n.t)&&/\blimitation|\bcaveat|\bweakness|\blimited by\b|\bdrawback/i.test(proseText([n])));
 const limitations=headedLimitations??(unheaded?.length?{...discussion!,id:'limitations',ids:['limitations'],heading:'Unheaded limitations passage',level:2,blocks:unheaded,prose:proseText(unheaded),words:countWords(unheaded),subsections:[]}:undefined);
 report.limitationsContent={headed:!!headedLimitations,present:!!limitations};
 for(const s of views){if(s.fallback)add('S7','INFO',`sections[${s.id}]`,'section-id attribute','heading fallback',s.location);if(s.id==='unknown'||!p.sections.some(x=>x.id===s.id)&&!EXTENSIONS.has(s.id)&&![...MAIN,'declarations','back_matter','plain_summary','key_points','title','abstract','supplement','data_availability','code_availability','references','ai_disclosure'].includes(s.id))add('S4','WARN',`sections[${s.heading}]`,'known section',s.heading,s.location);}
 for(const rule of p.sections){const target=`sections[${rule.id}]`;if(!applicable(rule,target))continue;
  const s=getSection(rule.id)??(mergedAllowed&&['results','discussion'].includes(rule.id)?merged:undefined)??(rule.id==='discussion'&&p.section_order_variants.some(v=>v.order.includes('limitations')&&!v.order.includes('discussion')&&!v.order.includes('results_discussion'))?limitations:undefined);
  if(!s){if(rule.id!=='limitations'&&rule.level!=='optional'&&!(input.venue.shortFormat&&!input.venue.keptSections?.includes(rule.id)))add(rule.level==='required'?'S1':'S2',level(rule,'FAIL'),target,rule.heading,'section missing',null,'',rule);continue;}
  if(!['title','abstract','plain_summary','key_points'].includes(rule.id))band('W1',target+'.words',s.words,rule.words,[.5,1.5],rule);
  for(const sub of rule.subsections){const t=target+`.subsections[${sub.heading}]`;if(!applicable(sub,t)||sub.level==='optional')continue;if(/limitation|caveat/i.test(sub.heading))continue;
   const found=s.subsections.some(h=>[sub.heading,...sub.aliases].some(a=>normalizeHeading(a)===normalizeHeading(h.heading))||sub.aliases_regex.some(rx=>new RegExp(rx,'i').test(h.heading)));
   if(!found)add('S5',level(sub),t,sub.heading,'subsection heading missing',s.location,'',sub);
  }
  for(const el of rule.elements){const t=target+`.elements[${el.id}]`;if(!applicable(el,t)||el.level==='optional')continue;
   const text=/limitations_(?:content|paragraph)/.test(el.id)?s.prose+' '+(limitations?.prose??''):s.prose;
   const found=el.id==='title_length'?s.words>=6&&s.words<=15:el.id==='declarative_subheadings'?s.subsections.length>0:el.detect.some(rx=>new RegExp(rx,'i').test(text));
   if(!found)add('S6',level(el),t,el.description,'element wording not detected',s.location,'',el);
  }
 }
 const ordered=views.filter(s=>s.level===1&&MAIN.has(s.id)).map(s=>s.id).filter((id,i,all)=>i===0||id!==all[i-1]);
 let orderOK:boolean;
 if(input.venue.sectionOrder)orderOK=canonicalJson(ordered)===canonicalJson(input.venue.sectionOrder.filter(s=>MAIN.has(s)));
 else orderOK=p.section_order_variants.some(v=>{const candidate=v.order.filter(s=>MAIN.has(s));return ordered.filter(s=>!['limitations','conclusions'].includes(s)).every(s=>candidate.includes(s))&&canonicalJson(ordered.filter(s=>candidate.includes(s)))===canonicalJson(candidate.filter(s=>ordered.includes(s)));});
 for(const [i,id] of ordered.entries()){if(id==='conclusions'&&!['discussion','results_discussion','limitations'].includes(ordered[i-1]??''))orderOK=false;if(id==='limitations'&&ordered[i-1]!== (ordered.includes('discussion')?'discussion':ordered.includes('results_discussion')?'results_discussion':'results'))orderOK=false;}
 for(const [i,s] of views.entries())if(EXTENSIONS.has(s.id)){const before=views.slice(0,i).map(x=>x.id),after=views.slice(i+1).map(x=>x.id);if(!before.includes('results')||!after.includes('discussion'))orderOK=false;}
 if(!orderOK)add('S3','FAIL','section_order_variants','allowed main-section order and extension placement',ordered.join(' → '));
 report.comparable_words=views.filter(s=>s.level===1&&p.main_text_words.counted.includes(s.id)&&!EXTENSIONS.has(s.id)).reduce((n,s)=>n+s.words,0);
 report.omerta_extension_words=views.filter(s=>s.level===1&&EXTENSIONS.has(s.id)).reduce((n,s)=>n+s.words,0)+views.filter(s=>s.level===1).reduce((n,s)=>n+protectedWords(s.blocks),0);
 band('W2','main_text_words',report.comparable_words,p.main_text_words,[.67,1.33]);
 if(report.omerta_extension_words>.25*(report.comparable_words+report.omerta_extension_words))add('W3','WARN','omerta_extension_words','≤25% of full main text',String(report.omerta_extension_words),null,'Move verification detail to the supplement.');
 const abstract=getSection('abstract');
 if(abstract){const structured=abstract.subsections.length>0,format=structured?'structured':'unstructured';
  const conventionFormats=new Set(p.exemplars.map(e=>e.measured.abstract_format));
  if(p.abstract.format!=='either'&&format!==p.abstract.format&&!conventionFormats.has(format))add('A1',input.venue.abstractFormat?'INFO':'FAIL','abstract.format',p.abstract.format,format,null,input.venue.abstractFormat?'Venue abstract format takes precedence.':'');
  const headings=abstract.subsections.map(h=>h.heading.toLowerCase()),family=p.abstract.heading_sets.find(h=>h.family===input.venue.abstractHeadingFamily),set=family??p.abstract.heading_sets[0];
  if(set&&canonicalJson(headings)!==canonicalJson(set.headings.map(h=>h.toLowerCase())))add('A2',family?'FAIL-W':'WARN','abstract.heading_sets',set.headings.join(' / '),headings.join(' / '));
  for(const el of p.abstract.elements)if(applicable(el,`abstract.elements[${el.id}]`)&&el.level!=='optional'&&!el.detect.some(rx=>new RegExp(rx,'i').test(abstract.prose)))add('A3',level(el),`abstract.elements[${el.id}]`,el.description,'not detected','abstract','',el);
  band('A4','abstract.words',abstract.words,p.abstract.words,[.67,1.33]);
 }
 const mainDisplays=displays(input.ast.blocks,p),supplementDisplays=input.manifest.filter(e=>e.kind).map(e=>({id:e.path,kind:e.kind!,kinds:e.kind!.split(/[ ,]+/),caption:e.caption??e.title}));
 for(const d of mainDisplays){if(!d.typed)add('D7','WARN',`displays[${d.id}]`,'kind attribute','caption-regex typing used',d.id);if(d.kinds.some(k=>!p.display_items.some(r=>r.id===k)))add('D8','INFO',`displays[${d.id}]`,'profile display kind',d.kinds.join(', '),d.id);}
 const activeDisplays=p.display_items.filter(d=>applicable(d,`display_items[${d.id}]`));
 for(const d of activeDisplays){const target=`display_items[${d.id}]`,main=mainDisplays.filter(x=>x.kinds.includes(d.id)&&x.type===d.type),sup=supplementDisplays.filter(x=>x.kinds.includes(d.id)),count=main.length+sup.length;
  if(!count){if(d.level!=='optional')add(d.level==='required'?'D1':'D3',level(d,'FAIL'),target,`${d.level}, ${d.placement}`,'absent from main text and supplement manifest',null,d.notes??'',d);continue;}
  if(d.level==='required'&&d.placement==='main'&&!main.length){const higher=activeDisplays.filter(x=>x.level==='required'&&x.placement==='main'&&x.priority<d.priority).length;add('D2',input.venue.shortFormat?'INFO':input.venue.displayCap<=higher?'WARN':'FAIL-W',target,'required item in main','only in supplement',null,'',d);}
  band('D4',target+'.count',count,d.count,[.5,1.5],d);
  if(d.level==='required'&&d.placement==='main'&&!main.length&&sup.length){const lower=activeDisplays.filter(x=>x.priority>d.priority&&mainDisplays.some(m=>m.kinds.includes(x.id)));if(lower.length)add('D6','FAIL-W',target,'higher-priority required item retained in main','lower priority item in main: '+lower.map(x=>x.id).join(', '),null,'',d);}
 }
 band('D5','display_items_main_total',mainDisplays.length,p.display_items_main_total,[.5,1.5],undefined,true);
 const statementViews=[...views,...views.flatMap(s=>s.subsections.filter(sub=>sub.id).map(sub=>({...s,id:sub.id!,ids:[sub.id!],blocks:sub.blocks,prose:proseText(sub.blocks)}))),...suppViews.map(s=>({...s,ids:[...s.ids,'supplement']}))];
 const isAllowed=(s:SectionView,placements:string[])=>s.ids.some(id=>placements.includes(id))||placements.includes('title_page')&&s.id==='title'||placements.includes('back_matter')&&!MAIN.has(s.id)&&!EXTENSIONS.has(s.id)&&!['title','abstract','plain_summary','key_points','unknown'].includes(s.id);
 for(const st of p.required_statements){const target=`required_statements[${st.id}]`;if(!applicable(st,target)||st.level==='optional')continue;
  const sectionFor:Record<string,string>={author_contributions:'contributions',competing_interests:'competing_interests',funding:'funding',data_availability:'data_availability',ethics:'ethics'};
  const found=statementViews.filter(s=>(s.ids.includes(sectionFor[st.id]??'__none__')&&s.prose.trim().length>0)||allNodes(s.blocks).some(n=>attributes(n).kv['statement-id']===st.id&&fullText(n).trim())||st.detect.some(rx=>new RegExp(rx,'i').test(s.prose)));
  if(st.placement.includes('figure_legend')&&[...mainDisplays,...supplementDisplays].some(d=>st.detect.some(rx=>new RegExp(rx,'i').test(d.caption))))continue;
  if(!found.some(s=>isAllowed(s,st.placement))){if(found.length)add('T2','WARN',target,st.placement.join(', '),'only outside allowed placements',found[0]!.location,'',st);add(st.level==='required'?'T1':'T3',level(st,'FAIL'),target,st.label,'statement missing from allowed placements',null,'',st);}
 }
 const checkChecklists=(profile:Profile,secondary=false)=>{for(const c of profile.checklists){const target=`checklists[${c.name}]`;if(secondary&&c.level!=='required')continue;if(!applicable(c,target))continue;if(c.kind!=='reporting_guideline'){add('C4','INFO',target,c.kind,'checked through elements, displays, statements, or venue rules',null,c.citation,c);continue;}if(exemplar)continue;
  const mapping=input.checklistMapping[c.name];if(!mapping){add('C3','FAIL',target,'checklist file mapping','no lint configuration mapping',null,'',c);continue;}
  const file=input.checklists[mapping],complete=file?.items.length&&file.items.every(i=>i.id&&i.text&&(['software','llm'].includes(i.status)?i.anchor&&i.excerpt:i.status==='not-applicable'?i.reason?.trim():i.status==='not-available-in-source-data'));
  if(!complete&&c.level!=='optional')add(c.level==='required'?'C1':'C2',level(c,'FAIL'),target,'completed reporting guideline file',file?'empty checklist slot':'file missing',mapping,'',c);
 }};checkChecklists(p);
 if(!exemplar)for(const s of p.supplement){const target=`supplement[${s.id}]`;if(!applicable(s,target)||s.level==='optional')continue;if(!input.manifest.some(m=>m.genre_item===s.id||s.detect.some(rx=>new RegExp(rx,'i').test(m.title))))add('U1',level(s,'FAIL'),target,s.item,'manifest item missing',null,'',s);}
 const refs=input.ast.meta.references?.c?.length??allNodes(input.ast.blocks).filter(n=>attributes(n).classes.includes('csl-entry')).length;
 band('R1','references',refs,p.references,[.5,1.5]);
 if(!headedLimitations)add('L1','FAIL','limitations','Limitations section or subsection','missing');
 else if(limitations) {if(!input.venue.limitationsPlacement){const usual=p.limitations.placement.toLowerCase();if(limitations.level===1&&(/never a top-level|inside discussion|usually unheaded/.test(usual)))add('L2','WARN','limitations.placement',p.limitations.placement,'top-level section');}
  band('L4','limitations.words',limitations.words,p.limitations.words,[.5,1.5],undefined,true);
 }
 if(!exemplar&&limitations)for(const l of p.limitations.standard_items){if(!applicable(l,`limitations.standard_items[${l.id}]`)||l.level==='optional')continue;const slot=input.limitations.find(s=>s.id===l.id),norm=(x:string)=>x.replace(/\s+/g,' ').trim();const valid=slot&&(slot.status==='addressed'?!!slot.text.trim()&&norm(limitations?.prose??'').includes(norm(slot.text)):slot.status.startsWith('not-applicable:')&&slot.status.slice(15).trim().length>0&&norm(fullText(input.supplementAst?.blocks??[])).includes(norm(slot.status.slice(15))));if(!valid)add('L3',level(l,'FAIL'),`limitations.standard_items[${l.id}]`,'addressed rendered Part B text or printed not-applicable reason','slot missing, empty or not rendered',null,l.text,l);}
 // Explicit owner-requested promotions of profile lint notes; original pins stay intact.
 if(!exemplar&&p.genre==='trial-level-surrogate-evaluation'&&[...mainDisplays,...supplementDisplays].some(d=>d.kinds.includes('surrogacy_scatter'))&&![...mainDisplays,...supplementDisplays].filter(d=>d.kinds.includes('surrogacy_scatter')).every(d=>/95\s*%.*prediction (band|interval)|prediction (band|interval).*95\s*%/i.test(d.caption)))add('S6','FAIL-W','display_items[surrogacy_scatter].prediction_band','95% prediction band (ReSEEM item 22)','prediction band not documented in scatter caption',null,'Promoted from surrogacy lint note 1.',{level:'required',basis:'guideline'});
 if(!exemplar&&p.genre==='cis-mr-colocalisation-drug-target'&&!mainDisplays.some(d=>d.kinds.includes('regional_association_plot'))&&!supplementDisplays.some(d=>d.kinds.includes('regional_association_plot')))add('D1','FAIL','display_items[regional_association_plot]','regional plot for colocalised loci','absent from main text and supplement manifest',null,'Promoted from MR lint note 3 for this MR-plus-colocalisation genre.',{level:'required',basis:'guideline'});
 for(const [i,note] of p.lint_notes.entries())if(!(p.genre==='trial-level-surrogate-evaluation'&&i===0||p.genre==='cis-mr-colocalisation-drug-target'&&i===2))add('G1','INFO',`lint_notes[${i}]`,'manual review','not promoted to a software rule',null,note);
 const primary=active;
 for(const slug of [...new Set(input.declaration.secondary_genres??[])].sort()){if(slug===p.genre)continue;active=get(slug);if(!active){add('P4','WARN','secondary_genres['+slug+']','known secondary genre','secondary structural lint not applied');continue;}verifyPin(active);report.secondary_profiles.push({genre:slug,sha256:active.sha256});checkChecklists(active.profile,true);for(const d of active.profile.display_items)if(d.level==='required'&&applicable(d,`display_items[${d.id}]`)&&!mainDisplays.some(x=>x.kinds.includes(d.id))&&!supplementDisplays.some(x=>x.kinds.includes(d.id)))add('D1','WARN',`display_items[${d.id}]`,'secondary required display','missing',null,'Secondary genres add display warnings only.',d);}
 active=primary;
 // Avoid duplicate element failures for the same missing statement or Limitations.
 const duplicates:Record<string,string>={registration_id:'registration',strobe_mr_statement:'strobe_mr',preregistration_statement:'preregistration',code_location:'code_availability'};
 report.findings=report.findings.filter(f=>!(f.rule==='S6'&&Object.entries(duplicates).some(([el,st])=>f.target.endsWith(`elements[${el}]`)&&report.findings.some(g=>g.rule==='T1'&&g.target===`required_statements[${st}]`)))&&!(f.rule==='S6'&&/limitations_(?:content|paragraph)/.test(f.target)&&!limitations));
 report.findings=report.findings.filter(f=>!(f.rule==='A3'&&f.target==='abstract.elements[registration_in_abstract]'&&report.findings.some(g=>g.rule==='T1'&&g.target==='required_statements[registration]')));
 return finish();
}
