import {publicationRegistry,type ArticleEdition} from './article.ts';
import {CHECKLIST_NAMES,type ChecklistName} from '../checklists.ts';
import {deriveMatterInput} from '../matter.ts';
import {sentencePositionValue} from '../sentence-style.ts';
/** Host assembler for the reading preprint. No model controls section order,
 * declarations, evidence labels, numerical templates or provenance placement. */
import {record,requireThat} from '../common.ts';
import {assertContext,type ReportContext} from '../context.ts';
import type {EntityRegistry} from '../entities.ts';
import type {MethodsDocument} from '../methods.ts';
import {assertMethods} from '../methods.ts';
import {assertMatter,type MatterDocument} from '../matter.ts';
import type {TermRegistry} from '../glossary.ts';
import type {PlainSummary,IdeaInBrief,GlossaryBox} from '../boxes.ts';
import type {LimitationEntry} from '../limitations.ts';
import {outcomeText} from '../labels.ts';
import {CLAIM_TEMPLATES} from '../templates.ts';
import {claimCountSentence} from '../reader-templates.ts';
import {claimCountBlockPlan,limitationsBlockPlan,resultsBlockPlans,type ManuscriptPlan,type SectionPlan,type BlockPlan} from './manuscript.ts';
import type {RenderedFigure,RenderedTable} from '../../../omb-figures/src/index.ts';
export interface PreprintInput {
 article?:ArticleEdition;
 ctx:ReportContext;registry:EntityRegistry;methods:MethodsDocument;matter:MatterDocument;terms:TermRegistry;
 summary:PlainSummary;idea:IdeaInBrief;glossary:GlossaryBox;nonce:string;
 prose:{introduction:string;methods:string;summary:string;results:string;discussion:string;partB:readonly LimitationEntry[]};
 figures?:readonly RenderedFigure[];tables?:readonly RenderedTable[];
 preview:'synthetic-fixture'|'synthetic-live';
}
export function createPreprintPlan(input:PreprintInput):ManuscriptPlan {
 const {ctx,methods,matter,terms,prose}=input,registry=publicationRegistry(input.registry);assertContext(ctx);assertMethods(ctx,methods);assertMatter(ctx,matter);
 const primary=ctx.claims.find(c=>c.id===ctx.input.plannedFound.primaryClaimId);requireThat(primary,'preprint requires its locked primary claim');
 const design=record(ctx.input.lockedPlan.reporting).design;
 const designs:Record<string,string>={cohort:'an observational cohort analysis','case-control':'a case-control analysis','cross-sectional':'a cross-sectional analysis'};
 const software=(id:string,text:string):BlockPlan=>({kind:'software',id,paragraphs:[{parts:[text]}]});
 const matterBlock=(heading:string):BlockPlan=>({kind:'producer',id:'matter',producer:'matter',document:matter,heading});
 const edition=input.article??{version:'1',date:new Date(Number(record(ctx.input.lock).time_ms)).toISOString().slice(0,10)};
 const defaults:Record<string,ChecklistName>={'effect-exists':'STROBE','causal-genetic':'STROBE-MR','out-of-sample':'TRIPOD+AI','diagnostic-accuracy':'TRIPOD+AI','literature-synthesis':'PRISMA'};
 const checklistNames=[...new Set(ctx.claims.flatMap(c=>{const name=c.plan.originalChecklist??(design==='randomized-trial'?'CONSORT':defaults[c.kind]);if(name===undefined)return [];requireThat(typeof name==='string'&&(CHECKLIST_NAMES as readonly string[]).includes(name),'unknown reporting guideline');return [name as ChecklistName];}))];
 const sections:SectionPlan[]=[
  {id:'preview-status',heading:'Synthetic tutorial · unendorsed preprint',blocks:[software('status',input.preview==='synthetic-live'?'Drafted by a live language model from synthetic records. Cross-family review and human checks remain pending; this is not patient research or a publication approval.':'Synthetic records and fixture prose. Reporting and human checks remain pending; this is not patient research or a publication approval.')]},
  {id:'authors',heading:'Authors',blocks:[{kind:'article-authors',id:'authors',document:matter}]},
  {id:'article-information',heading:'Article information',blocks:[{kind:'article-info',id:'information',document:matter,edition}]},
  {id:'abstract',heading:'Abstract',blocks:[
   software('background',`Background. This tutorial concerns ${primary.plan.exposure} and ${primary.plan.outcome}. It illustrates the interpretation of a planned association when required verification is incomplete.`),
   software('design',`Methods. The locked design was ${designs[String(design)]??'an analysis of archived data'}. The analysis and its required checks were specified before examining the confirming data.`),
   {kind:'draft',id:'primary-result',region:'abstract-results',source:prose.summary,lead:'Results'},
   {kind:'software',id:'conclusion',paragraphs:[{parts:['Conclusions. ',{opaque:CLAIM_TEMPLATES[primary.status]},'. The synthetic example does not support clinical use.']}]},
  ]},
  {id:'keywords',heading:'Keywords',blocks:[software('keywords','Synthetic data; observational research; reproducibility; uncertainty')]},
  {id:'plain-summary',heading:'Plain-language summary',blocks:[{kind:'producer',id:'summary',producer:'plain-summary',document:input.summary}]},
  {id:'introduction',heading:'Introduction',blocks:[{kind:'draft',id:'context',region:'introduction',source:prose.introduction},{kind:'software',id:'aims',paragraphs:[{parts:[`The primary question concerns ${primary.plan.exposure} and ${primary.plan.outcome}. The secondary questions follow the locked plan. This tutorial does not establish a clinical or biological finding.`],provides:['block:aims']}]}]},
  {id:'idea-in-brief',heading:'The idea in brief',blocks:[{kind:'producer',id:'idea',producer:'idea-in-brief',document:input.idea}]},
  {id:'methods',heading:'Methods',blocks:[
   {kind:'subheading',id:'population-heading',text:'Data source and study population'},
   {kind:'software',id:'source-description',paragraphs:[{parts:[{opaque:'Data were obtained from '+deriveMatterInput(ctx).data.map(d=>`${d.source} (${d.accession})`).join('; ')+'.'}]}]},
   {kind:'methods-shared',id:'population',topic:'population'},
   {kind:'draft',id:'methods',region:'methods',source:prose.methods},
   {kind:'subheading',id:'exposure-heading',text:'Exposure'},software('exposures','The registered exposure contrasts were '+[...new Set(methods.specification.rows.map(r=>r[0]))].join(', ')+'.'),
   {kind:'subheading',id:'outcome-heading',text:'Outcome'},software('outcomes','The registered outcomes were '+[...new Set(methods.specification.rows.map(r=>sentencePositionValue(r[1]!,'middle')))].join('; ')+'.'),
   {kind:'subheading',id:'covariates-heading',text:'Covariates'},software('adjustments','The locked covariate specification was '+[...new Set(methods.specification.rows.map(r=>r[4]!.toLowerCase()==='none'?'unadjusted':r[4]))].join('; ')+'.'),
   {kind:'software',id:'specification-callout',paragraphs:[{parts:[{key:'tab:claim-specifications'},' gives the claim-specific exposures, outcomes, measures, horizons and adjustments.']}]},{kind:'methods-specification',id:'claim-specifications'},
   {kind:'subheading',id:'statistical-heading',text:'Statistical analysis'},
   {kind:'methods-shared',id:'shared-procedures',topic:'analysis'},
   ...ctx.claims.some(c=>c.kind!=='data-integrity'&&c.bundle)?[software('decision-rule','Support requires a p-value at or below the effective alpha and a confidence interval wholly on the registered side of the null. Refutation instead requires the whole interval to lie within the pre-registered equivalence bounds; a large p-value alone is not sufficient.')]:[],
   {kind:'software',id:'search',paragraphs:[{parts:['The literature index was frozen with the plan. The cited literature provides background; the numerical findings in this tutorial are synthetic.'],provides:['block:search']}]},
   ...checklistNames.length?[{kind:'subheading',id:'reporting-heading',text:'Reporting guideline'} as BlockPlan,software('reporting-guideline','Reporting is organized according to '+checklistNames.join(' and ')+'. The item-level checklist is in the Supplement; final evidence-anchor review remains pending.')]:[],
  ]},
  {id:'results',heading:'Results',blocks:[{kind:'software',id:'claim-count',paragraphs:[{parts:[{opaque:claimCountSentence(ctx)}],provides:['block:claim-count']}]},{kind:'software',id:'findings-callout',paragraphs:[{parts:[{key:'tab:claim-summary'},' brings together the certified findings and their evidence status.']}]},{kind:'claim-table',id:'claim-summary'},{kind:'draft',id:'findings',region:'results',source:prose.results},...(input.figures??[]).flatMap((figure):BlockPlan[]=>[{kind:'software',id:'callout-'+figure.id,paragraphs:[{parts:[{key:'fig:'+figure.id},' illustrates the synthetic data and the analysis.']}]},{kind:'figure',id:'figure-'+figure.id,figure}]),...(input.tables??[]).flatMap((table):BlockPlan[]=>[{kind:'software',id:'callout-'+table.id,paragraphs:[{parts:[{key:'tab:'+table.id},' presents the synthetic findings in plan order.']}]},{kind:'table',id:'table-'+table.id,table,caption:'Summary of the synthetic findings.'}])]},
  {id:'discussion',heading:'Discussion',blocks:[{kind:'draft',id:'discussion',region:'discussion',source:prose.discussion}]},
  {id:'limitations',heading:'Limitations',blocks:[limitationsBlockPlan(ctx)]},
  {id:'limitations-part-b',heading:'Study-specific limitations',blocks:[{kind:'limitations-part-b',id:'part-b',entries:prose.partB}]},
  {id:'conclusions',heading:'Conclusions',blocks:[{kind:'software',id:'conclusion',paragraphs:[{parts:[{opaque:CLAIM_TEMPLATES[primary.status]},'. Interpretation is limited to the registered setting. This tutorial is not clinical evidence.']}]}]},
  {id:'declarations',heading:'Declarations',blocks:[software('status','This synthetic tutorial remains unendorsed. The artifact signature verifies its contents, not its scientific conclusions or approval for publication.')]},
  {id:'data-availability',heading:'Data and code availability',blocks:[matterBlock('Data availability'),{kind:'data-source-overview',id:'full-data-records'}]},
  {id:'code-availability',heading:'Code availability',blocks:[matterBlock('Code availability')]},
  {id:'registration',heading:'Pre-registration',blocks:[{kind:'software',id:'registration',paragraphs:[{parts:['The plan was locked on ',{key:'r:lock_date'},'. Plan hash prefix: ',{key:'r:plan_hash_short'},'. The full value is in the technical records.']}]}]},
 ];
 const declarations=[['AI-use disclosure','ai-use-disclosure'],['Funding','funding'],['Competing interests','competing-interests'],['Author contributions (CRediT)','author-contributions'],['Ethics statement','ethics'],['Acknowledgments','acknowledgments'],['Research scope','research-scope']] as const;
 for(const [heading,id] of declarations)if(matter.regions.some(r=>r.heading===heading))sections.push({id,heading,blocks:[matterBlock(heading)]});
 sections.push({id:'references',heading:'References',blocks:[{kind:'literature-references',id:'literature'},...matter.regions.some(r=>r.heading==='Software references')?[matterBlock('Software references')]:[]]});
 sections.push({id:'supplement',heading:'Supplement',blocks:[software('scope','The following records preserve the definitions, provenance and outstanding checks for this tutorial.')]});
 for(const name of checklistNames)sections.push({id:'reporting-checklist-'+name.toLowerCase().replaceAll('+','-plus-'),heading:name+' reporting checklist',blocks:[{kind:'reporting-checklist',id:'checklist',name}]});
 sections.push({id:'glossary',heading:'Glossary and label crosswalk',blocks:[{kind:'producer',id:'glossary',producer:'glossary-box',document:input.glossary}]});
 sections.push({id:'key-points',heading:'Key points',blocks:[{kind:'draft',id:'key-points',region:'key-points',source:'[claim:'+primary.id+'].'}]});
 sections.push({id:'technical-records',heading:'Technical records',blocks:[{kind:'software',id:'full-plan-hash',paragraphs:[{parts:['Full plan hash: ',{key:'r:plan_hash'},'.']}]},...resultsBlockPlans(ctx),{kind:'draft',id:'records',region:'methods',source:[...methods.slots.keys()].filter(k=>/(?:data-sources|data-fetching-checksums|software-versions|hardware|runtime)$/u.test(k)).map(k=>'['+k+'].').join('\n')},...matter.regions.some(r=>r.heading==='AI use in Methods')?[{kind:'producer',id:'ai-methods-prose',producer:'matter',document:matter,heading:'AI use in Methods',proseOnly:true} as BlockPlan,...[1,2,3,4].map((tableColumn):BlockPlan=>({kind:'producer',id:'ai-use-'+String.fromCharCode(96+tableColumn),producer:'matter',document:matter,heading:'AI use in Methods',tableColumn}))]:[]]});
 const workflowIds=new Set((input.figures??[]).filter(f=>['data-flow','consort'].includes(f.kind)).map(f=>f.id));
 const resultSection=sections.find(s=>s.id==='results')!,methodsSection=sections.find(s=>s.id==='methods')!;
 const workflowBlocks=resultSection.blocks.filter(b=>b.kind==='figure'&&workflowIds.has(b.figure.id)||b.kind==='software'&&[...workflowIds].some(id=>b.id==='callout-'+id));
 sections[sections.indexOf(resultSection)]={...resultSection,blocks:resultSection.blocks.filter(b=>!workflowBlocks.includes(b))};
 sections[sections.indexOf(methodsSection)]={...methodsSection,blocks:[...workflowBlocks,...methodsSection.blocks]};
 const partBIndex=sections.findIndex(s=>s.id==='limitations-part-b');const [partBSection]=sections.splice(partBIndex,1);sections.push(partBSection!);
 for(let i=0;i<sections.length;i++)sections[i]={...sections[i]!,blocks:sections[i]!.blocks.filter(b=>b.kind!=='draft'||b.source.trim().length>0)};
 return {ctx,registry,nonce:input.nonce,plainLanguage:terms,presentation:'preprint',renderOptions:{methods,terms},sections};
}
