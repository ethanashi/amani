import { iadMeasurement } from './iad-measurements.ts';
/** Offline author drafts from task-author policies. Never import this module in an analyst. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { buildContract, evidencePointers, contentHash, type ContractStructure, type PublicLayer, type PrivateLayer, type Column, type Table } from '../../omb-contract/src/index.ts';
import { parseContractTable, sha256 } from '../../omb-certify/src/contract-verifier.ts';
const base=path.dirname(new URL(import.meta.url).pathname),scratch=readFileSync(path.join(base,'.staging-location'),'utf8');
const namespaces=(id:string,kind:'unit'|'feature'='unit',level:string|null=id)=>({id,entity_kind:kind,level:kind==='feature'?null:level,preserve_originals:true as const,collision_policy:'merge-with-limitation' as const,rules:[]});
const policies:Record<string,Record<string,{key:string[];unit:string;sample?:boolean;matrix?:boolean}>>={
 'iad1-brady-audit':{'predictions.csv':{key:['subject','cycle'],unit:'subject'},'psa_history.csv':{key:['subject','day','psa','testosterone','cycle','on_treatment'],unit:'subject'},'training_roc.csv':{key:['held_out_subject','cycle','threshold'],unit:'held_out_subject'}},
 'iad2-brady-twin':{'predictions.csv':{key:['subject','cycle'],unit:'subject'},'psa_history.csv':{key:['subject','day','psa','testosterone','cycle','on_treatment'],unit:'subject'}},
 'iad3-browning-count':{'psa_series.csv':{key:['subject','day','psa','testosterone','cycle','on_treatment'],unit:'subject'}},
 'p10-pseudorep':{'samples.tsv':{key:['sample_id'],unit:'line_id',sample:true},'counts.tsv':{key:['gene'],unit:'sample_id',matrix:true}},
 'p10b-pseudorep-hidden':{'samples.tsv':{key:['sample_id'],unit:'sample_id',sample:true},'counts.tsv':{key:['gene'],unit:'sample_id',matrix:true}},
 'p13-endpoint':{'participants.tsv':{key:['participant_id'],unit:'participant_id'},'outcomes.tsv':{key:['participant_id'],unit:'participant_id'}},
 'p14-citation':{'literature_index.tsv':{key:['record_id'],unit:'record_id'}},
 'p4-bixbench':{'Swarm_1.csv':{key:['DishNumber'],unit:'DishNumber'}},
 'p6-subgroups':{'participants.tsv':{key:['participant_id'],unit:'participant_id'}},
 'p7-nosignal':{'samples.tsv':{key:['sample_id'],unit:'sample_id'},'genotypes.tsv':{key:['sample_id'],unit:'sample_id'}},
 'p8-underpowered':{'donors.tsv':{key:['donor_id'],unit:'donor_id'},'wells.tsv':{key:['plate','well'],unit:'donor_id'}},
 'p9-leakage':{'donors.tsv':{key:['donor_id'],unit:'donor_id'},'cells.tsv':{key:['cell_id'],unit:'donor_id',sample:true},'expression.tsv':{key:['cell_id'],unit:'cell_id',sample:true}},
 'w0-venet':{'clinical_patient.tsv':{key:['PATIENT_ID'],unit:'PATIENT_ID'},'clinical_sample.tsv':{key:['SAMPLE_ID'],unit:'PATIENT_ID',sample:true},'expression_mrna.tsv':{key:['Hugo_Symbol','Entrez_Gene_Id'],unit:'SAMPLE_ID',matrix:true}},
};
const summary:unknown[]=[];
for(const task of JSON.parse(readFileSync(path.join(base,'.stage-summary.json'),'utf8')) as {task:string;status:string}[]){
 if(task.status!=='staged')continue;
 if(process.env.ONLY_TASK&&task.task!==process.env.ONLY_TASK)continue;
 const id=task.task,raw=path.join(scratch,id,'data'),dest=path.join(process.env.AUTHOR_CONTRACT_OUTPUT??base,id);mkdirSync(dest,{recursive:true});
 const staged=new Map(readdirSync(raw).map(name=>[name,readFileSync(path.join(raw,name))]));
 const s:ContractStructure={dataset_id:id,dataset_type:'subject-level',source_files:[...staged].map(([name,bytes])=>({path:name,sha256:sha256(bytes)})),namespaces:[namespaces('sample'),namespaces('patient'),namespaces('cluster'),namespaces('population')],
 graph:{nodes:[{id:'population',kind:'target-population',level:'population',namespace:'population',original_id:id}],edges:[]},
 unit_hierarchy:[{id:'sample',coarser_level:'patient',minimum_independent:false},{id:'patient',coarser_level:'cluster',minimum_independent:true},{id:'cluster',coarser_level:'population',minimum_independent:false},{id:'population',coarser_level:null,minimum_independent:false}],
 tables:[],aliases:[],alias_registries:[],collision_merges:[],joins:[],batch:[],time:[],dependence:[{id:'design',kind:'unknown',unit_level:'patient',cluster_nodes:[],description:'Author unit floor; no claim of random assignment or independent censoring.'}],assignments:[],replicate_groups:[],partitions:[],forbidden_uses:[],survival:[],row_exclusions:[],transformations:[],summary_statistics:null,
 limitations:['Author draft; owner review and authority-store approval required. No held-out partition is asserted.']};
 const aux=new Map<string,Buffer>(),nodeIds=new Map<string,string>();
 const node=(ns:'sample'|'patient',token:string)=>{const key=JSON.stringify([ns,token]);if(nodeIds.has(key))return nodeIds.get(key)!;const nid=ns+'_'+sha256(token).slice(0,24);nodeIds.set(key,nid);s.graph.nodes.push({id:nid,kind:ns==='sample'?'specimen/sample':'donor/subject',level:ns,namespace:ns,original_id:token});s.aliases.push({namespace:ns,encoding:'token',original:token,canonical:token,node:nid},{namespace:ns,encoding:'canonical-json-array',original:JSON.stringify([token]),canonical:JSON.stringify([token]),node:nid});if(ns==='patient')s.graph.edges.push({from:nid,to:'population',relation:'member-of-population'});return nid;};
 const file=(name:string,bytes:Buffer)=>{aux.set(name,bytes);const f={path:'contract-assets/'+name,sha256:sha256(bytes)};s.source_files.push(f);return f;};
 const registry=(ns:string,values:string[])=>{if(s.namespaces.some(n=>n.id===ns))return;s.namespaces.push(namespaces(ns,'feature'));
 const distinct=[...new Set(values)].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));const text='namespace\tencoding\toriginal\tcanonical\ttarget\n'+distinct.map(v=>[ns,'token',JSON.stringify(v),JSON.stringify(v),JSON.stringify(v||'empty-token')].join('\t')).join('\n')+'\n';
 s.alias_registries.push({namespace:ns,file:file(ns+'.tsv',Buffer.from(text)),format:'omb-alias-registry-tsv/v1',entry_count:distinct.length,coverage:'verify-against-data'});};
 const policy=policies[id]??{'observations.tsv':{key:['sample_id'],unit:'sample_id'}};
 // Material graph is built from metadata first, before any expression/companion table.
 for(const [name,p] of Object.entries(policy).filter(([n])=>!['expression.tsv','counts.tsv','expression_mrna.tsv'].includes(n))){
 const t=parseContractTable(name,staged.get(name)!);for(const row of t.rows){const u=row[t.header.indexOf(p.unit)]!;node('patient',u);if(p.sample&&!['p9-leakage','w0-venet'].includes(id)){const sample=row[t.header.indexOf(p.key[0]!)]!,sn=node('sample',sample),pn=node('patient',u);if(!s.graph.edges.some(e=>e.from===sn&&e.to===pn))s.graph.edges.push({from:sn,to:pn,relation:'sample-of'});}}
 }
 if(id==='p9-leakage'){
   const t=parseContractTable('cells.tsv',staged.get('cells.tsv')!);for(const row of t.rows){const token=row[t.header.indexOf('cell_id')]!,donor=row[t.header.indexOf('donor_id')]!,target=nodeIds.get(JSON.stringify(['patient',donor]))!;s.aliases.push({namespace:'patient',encoding:'token',original:token,canonical:token,node:target},{namespace:'patient',encoding:'canonical-json-array',original:JSON.stringify([token]),canonical:JSON.stringify([token]),node:target});}
 }
 for(const [name,p] of Object.entries(policy)){
 const t=parseContractTable(name,staged.get(name)!),tid='table_'+s.tables.length;
 const unitNS=p.matrix?(['p10b-pseudorep-hidden','w0-venet'].includes(id)?'patient':'sample'):name==='expression.tsv'&&id!=='p9-leakage'?'sample':'patient';
 const columns:Column[]=t.header.map((name,i)=>{
   const vals=t.rows.map(r=>r[i]!),nonmissing=vals.filter(v=>!['','NA','NaN','nan','NAN'].includes(v));
   const numeric=nonmissing.length>0&&nonmissing.every(v=>/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?(0|[1-9][0-9]*))?$/.test(v));
   const isKey=p.key.includes(name);let namespace:string|null=null;
   if(name===p.unit&&!p.matrix)namespace=unitNS;
   else if(isKey&&p.sample)namespace=['p9-leakage','w0-venet'].includes(id)?'patient':'sample';
   else if(isKey){namespace=tid+'_'+i;registry(namespace,vals);}
   const structural_kind:Column['structural_kind']=namespace?(name===p.unit?'unit':'identifier'):/^(batch|library_batch|site|cohort)$/i.test(name)?'batch':numeric?'measurement':'annotation';
   // Resolution is lexical precision, not an inferred statistical model.
   const decimals=numeric?Math.max(...nonmissing.map(v=>(v.split(/[eE]/)[0]!.split('.')[1]??'').length-Number(v.split(/[eE]/)[1]??0))):0;
   return {name,storage:numeric&&!namespace?'decimal':'string',structural_kind,namespace,decimal_resolution:numeric&&!namespace?'1e-'+Math.max(0,decimals):null,
     measurement:numeric&&!namespace?{type:'continuous',unit:'source-native',bounds:null,categories:[]}:null,missingness_codes:['','NA','NaN','nan','NAN'].filter(token=>vals.includes(token))};
 });
 if(id.startsWith('iad')&&/^psa_(history|series)\.csv$/.test(name))for(let i=0;i<columns.length;i++)columns[i]=iadMeasurement(columns[i]!,t.rows.map(r=>r[i]!));
 let derivation:Table['unit_derivation'];
 if(p.matrix){const headers=t.header.filter(h=>!p.key.includes(h)),map=Object.fromEntries(headers.map(h=>[JSON.stringify([h]),h]));derivation={kind:'sidecar',map:file(tid+'-units.json',Buffer.from(JSON.stringify(map)+'\n')),key_encoding:'canonical-json-array',namespace:unitNS,level:unitNS};}
 else derivation={kind:'column-tuple',columns:[p.unit],encoding:'canonical-json-array',namespace:unitNS,level:unitNS};
 const def:Table={id:tid,file:{path:name,sha256:sha256(staged.get(name)!)},row_key:p.key,columns,unit_derivation:derivation,orientation:{layout:p.matrix?'matrix':'records',unit_axis:p.matrix?'columns':'rows',row_entity:p.matrix?'features':p.sample?'samples':'units',header_namespace:p.matrix?unitNS:null},alias_coverage:{rows:'all',matrix_headers:'all',unresolved:'refuse',ambiguous_axis:'refuse'}};s.tables.push(def);
 if(id.startsWith('iad')&&/^psa_(history|series)\.csv$/.test(name))s.time.push({column:{table:tid,column:'day'},index_event:'first-recorded-visit',relation:'post-index',unit:'days'});
 for(const col of columns)if(col.structural_kind==='batch')s.batch.push({table:tid,column:col.name});
 }
 for(const ns of ['patient','sample']){
   const aliases=s.aliases.filter(a=>a.namespace===ns);if(aliases.length<100)continue;
   aliases.sort((a,b)=>Buffer.compare(Buffer.from(a.encoding),Buffer.from(b.encoding))||Buffer.compare(Buffer.from(a.original),Buffer.from(b.original)));
   const text='namespace\tencoding\toriginal\tcanonical\ttarget\n'+aliases.map(a=>[ns,a.encoding,JSON.stringify(a.original),JSON.stringify(a.canonical),JSON.stringify(a.node)].join('\t')).join('\n')+'\n';
   s.alias_registries.push({namespace:ns,file:file(ns+'-aliases.tsv',Buffer.from(text)),format:'omb-alias-registry-tsv/v1',entry_count:aliases.length,coverage:'verify-against-data'});s.aliases=s.aliases.filter(a=>a.namespace!==ns);
 }
 const unitLevel=id==='p4-bixbench'?'dish':id==='p14-citation'?'record':id.startsWith('p10')?'line':['p8-underpowered','p9-leakage'].includes(id)?'donor':'patient';
 if(unitLevel!=='patient'){
   for(const n of s.graph.nodes)if(n.level==='patient'){n.level=unitLevel;if(unitLevel==='dish')n.kind='randomization-unit';}
   for(const ns of s.namespaces)if(ns.level==='patient')ns.level=unitLevel;
   for(const l of s.unit_hierarchy){if(l.id==='patient')l.id=unitLevel;if(l.coarser_level==='patient')l.coarser_level=unitLevel;}
   for(const t of s.tables)if(t.unit_derivation.level==='patient')t.unit_derivation.level=unitLevel;
   s.dependence[0]!.unit_level=unitLevel;
 }
 const source_bundle_hash=contentHash(s.source_files),producers=[{id:'author',kind:'task-author' as const,name:'Pilot task author draft',version:'K1b-1',model_family:null,source_bundle_hash,outcome_blind:true},{id:'stager',kind:'stager' as const,name:'Pinned pilot staging program',version:'K1b-1',model_family:null,source_bundle_hash,outcome_blind:true}];
 const evidence=(structure:ContractStructure)=>evidencePointers(structure).map(pointer=>({pointer,status:'author' as const,producer_ids:pointer.startsWith('/structure/source_files/')?['author','stager']:['author'],citations:[],note:null}));
 const pub:PublicLayer={schema_version:'omb-data-contract/v3.1',structure:s,producers,evidence:evidence(s)};
 // Assumed public groupings are never promoted by author agreement alone.
 if(id==='p10b-pseudorep-hidden')for(const e of pub.evidence)if(/\/(graph|unit_derivation|dependence)\//.test(e.pointer)){e.status='assumed' as never;e.note='Unit linkage unavailable in analyst metadata.' as never;}
 const publicContract=buildContract(pub);
 const ps=structuredClone(s),truth=JSON.parse(readFileSync(path.join(scratch,id+'.truth.json'),'utf8'));
 if(id==='p10b-pseudorep-hidden'){
   const groups=new Map<string,string[]>();for(const record of truth.samples){const list=groups.get(record.line_id)??[];list.push(nodeIds.get(JSON.stringify(['sample',record.sample_id]))!);groups.set(record.line_id,list);}
   for(const [name,members] of groups){const cid='hidden_'+sha256(name).slice(0,24),first=ps.graph.edges.find(e=>e.from===members[0]&&e.relation==='sample-of')!.to;for(const member of members)if(!ps.graph.edges.some(e=>e.from===member&&e.to===first))ps.graph.edges.push({from:member,to:first,relation:'sample-of'});ps.replicate_groups.push({id:cid,kind:'biological',members,grouping_node:first,handling:'model-dependence',rationale:'Private author lineage.'});}

 }
 if(id==='w0-venet')for(const pair of truth.pairs){
   const source=nodeIds.get(JSON.stringify(['patient',pair.source_id])),copy=nodeIds.get(JSON.stringify(['patient',pair.new_id]));if(!source||!copy)throw new Error('private author mapping incomplete');
   const members=[pair.source_id,pair.new_id].map(token=>{const nid='material_'+sha256(token).slice(0,24);if(!ps.graph.nodes.some(n=>n.id===nid)){ps.graph.nodes.push({id:nid,kind:'specimen/sample',level:'sample',namespace:'sample',original_id:token});ps.graph.edges.push({from:nid,to:nodeIds.get(JSON.stringify(['patient',token]))!,relation:'sample-of'});}return nid;});
   if(!ps.graph.edges.some(e=>e.from===members[1]&&e.to===source))ps.graph.edges.push({from:members[1]!,to:source,relation:'sample-of'});
   ps.replicate_groups.push({id:'duplicate_'+sha256(pair.new_id).slice(0,24),kind:'technical',members,grouping_node:source,handling:'collapse',rationale:'Private author material identity.'});
 }
 const defects=[{id:'author-truth',description:JSON.stringify(truth),affected_nodes:ps.graph.nodes.filter(n=>n.level===unitLevel).map(n=>n.id)}];
 const privateLayer:PrivateLayer={schema_version:'omb-data-contract-private/v3.1',public_hash:publicContract.public.hash,structure:ps,producers:structuredClone(producers),evidence:[...evidence(ps),...evidencePointers(defects,'/planted_defects').map(pointer=>({pointer,status:'author' as const,producer_ids:['author'],citations:[],note:null}))],planted_defects:defects};
 const full=buildContract(pub,privateLayer);
 writeFileSync(path.join(dest,'public.json'),JSON.stringify(full.public)+'\n');
 mkdirSync(path.join(dest,'assets'),{recursive:true});for(const [name,bytes] of aux)writeFileSync(path.join(dest,'assets',name),bytes);
 writeFileSync(path.join(scratch,id+'.private-contract.json'),JSON.stringify(full.sealed_private)+'\n',{mode:0o600});
 summary.push({task:id,publicHash:full.public.hash,tables:s.tables.length,sourceFiles:s.source_files.length,status:'author-draft'});
 console.log(id+': author draft validated');
}
if(!process.env.ONLY_TASK)writeFileSync(path.join(base,'index.json'),JSON.stringify(summary,null,2)+'\n');
