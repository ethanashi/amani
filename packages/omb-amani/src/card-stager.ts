import {validateDictionaryTargets} from '../../omb-investigate/src/measurement-dictionary.ts';
import {renderPractice} from '../../omb-investigate/src/practice-provenance.ts';
import { opaqueKey, aliasPracticeKeys, reorderPractice, resolvePracticeKeys } from '../../omb-investigate/src/practice-exposure.ts';
import { writePhysical } from '../../omb-investigate/src/physical-format.ts';
import { genericPracticeDeclaration, viewTable } from '../../omb-investigate/src/tabular.ts';
import { practiceReferences, referenceDeclarations } from '../../omb-investigate/src/practice-references.ts';
import { blindCorrelation, checkCorrelation, correlationAxis } from './practice-correlation.ts';
import { consistentGwas } from './gwas-practice.ts';
import { assertPracticeBlinded, blindTable, readTable, writeTable, integerNamespace, permute, random, practiceDeclaration } from './practice.ts';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { TabularStager, parseTable, formatTable } from '../../omb-investigate/src/tabular.ts';
import { treeHash } from '../../omb-investigate/src/bundle.ts';
import type { StagerPort, StagedData } from '../../omb-investigate/src/ports.ts';
import { object } from './results.ts';
import type { Task } from './task.ts';

/** Public task IDs are already disclosed. JSON quoting in an alias cell adds no secret. */
export function publicIdentifier(value: string, text: string): boolean {
  const exact = (id: string) => {
    // Most served IDs are absent from the short task. Avoid compiling a
    // Unicode-boundary regex for every absent ID in a large matrix.
    if (!id || !text.includes(id)) return false;
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}_]|[\\p{L}\\p{N}_][.:-])${escaped}(?![\\p{L}\\p{N}_]|[.:-][\\p{L}\\p{N}_])`, 'u').test(text);
  };
  if (exact(value)) return true;
  try { const decoded: unknown = JSON.parse(value); return typeof decoded === 'string' && exact(decoded); } catch { return false; }
}
export { syntheticIdentifier } from '../../omb-investigate/src/synthesis-schema.ts';
import { syntheticIdentifier } from '../../omb-investigate/src/synthesis-schema.ts';

/** Adapt only public identity structure. No measurement is copied into the synthetic twin. */
export function cardStager(base: TabularStager, task: Task, onStaged?: (staged: StagedData) => void | Promise<void>): StagerPort {
  task = {...task, identity:[...task.identity]};
  const contract = task.publicContract;
  const registries = object(contract) && Array.isArray(contract.namespaces) ? contract.namespaces.flatMap(n => object(n) && object(n.registry) && typeof n.registry.path === 'string' ? [n.registry.path.replace(/^data\//, '')] : []) : [];
  for (const f of registries) if (path.isAbsolute(f) || f.split('/').includes('..')) throw new Error('invalid public registry path');
  async function generate(req:{staged:StagedData;seed:string;outcomes:readonly string[];exposures:readonly string[]},kind:string,attempt=0):Promise<{dir:string;hash:string;warnings:string[];provenance:string}> {
    const dir=mkdtempSync(path.join(path.dirname(req.staged.schemaViewDir),kind+'-'));
    try {
      const real=task.identity.map(d=>readTable(path.join(req.staged.realDataDir,d.file),d.file));
      if(real.some(t=>!t))throw new Error('Unparseable practice table');
      const sources=real.filter((t):t is NonNullable<typeof t>=>!!t);
      const declarations=Object.fromEntries(sources.map(t=>[t.file,{...practiceDeclaration(t.file,task),outcomes:req.outcomes,exposures:req.exposures}]));
      validateDictionaryTargets(sources,declarations);
      const refs=practiceReferences(sources,declarations),resolved=referenceDeclarations(resolvePracticeKeys(sources,declarations),refs);
      const provenance=base.practiceProvenance({...req.staged,synthesisSchema:task.identity,practiceDeclarations:resolved},sources,attempt?`${req.seed}:redraw:${attempt}`:req.seed,req.outcomes,req.exposures);
      provenance.input.registries=[];
      for(const file of registries.filter(f=>!task.identity.some(d=>d.file===f))){
        const registry=readTable(path.join(req.staged.realDataDir,file),file);
        if(!registry||registry.header.join('\t')!=='namespace\tencoding\toriginal\tcanonical\ttarget')throw new Error('unsupported served alias registry schema');
        registry.rows=registry.rows.map(r=>r.map((v,j)=>j<2?v:JSON.stringify(aliasValue(JSON.parse(v),req.seed,r[0]!,integerNamespace(task,r[0]!)))));
        reorderPractice(registry,req.seed);provenance.input.registries.push({file,rows:registry.rows});
      }
      writeFileSync(provenance.file,JSON.stringify(provenance.input));
      const output=renderPractice(provenance.input);
      for(const t of output){if(!task.identity.find(d=>d.file===t.file)?.matrix&&sources.some(s=>s.file===t.file))assertPracticeBlinded(sources.find(r=>r.file===t.file)!,t,task,resolved[t.file],{real:sources,practice:output,declarations:resolved});}
      writePhysical(dir,output);
      return {dir,hash:treeHash(dir),provenance:provenance.file,warnings:['Practice v3 regenerates non-design columns independently from inventories.']};
    }catch(error){rmSync(dir,{recursive:true,force:true});if(attempt<64&&error instanceof Error&&error.message.includes('unchanged non-key column'))return generate(req,kind,attempt+1);throw error;}
  }
  return {
    async stage(req) {
      const s = await base.stage(req,Object.fromEntries([...task.identity.map(d=>[d.file,practiceDeclaration(d.file,task)] as const),...registries.map(file=>[file,{keys:['original','canonical','target'],units:[]}] as const)]));
      const inventory = (await base.practiceTables(s.realDataDir)).tables;
      const views = inventory.map(viewTable);
      for (const t of inventory) if (!registries.includes(t.file) && !task.identity.some(d=>d.file===t.file) && (object(contract) && Array.isArray(contract.attachments) && contract.attachments.some(a=>object(a) && typeof a.path==='string' && a.path.replace(/^data\//,'')===t.file.split('::')[0]) || task.identity.some(d=>t.file.startsWith(d.file+'::')))) {
        const d=genericPracticeDeclaration(views,t,{outcomes:[]});
        // Distinct numeric values alone do not establish identity. Attachments
        // without a column contract must blind these as measurements.
        const identifiers=d.keys.filter(name=>viewTable(t).columns.find(c=>c.name===name)?.type==='string');
        task.identity.push({file:t.file,identifiers,matrix:false,fixedHeaders:t.header,
          columns:viewTable(t).columns.map(c=>({name:c.name,storage:c.type==='integer'?'integer':c.type==='number'?'number':'string',...(c.levels?{levels:Object.keys(c.levels)}:{})}))});
      }
      task.identity = task.identity.filter(d=>!inventory.some(t=>t.file.startsWith(d.file+'::')));
      // Registries encode join endpoints as JSON; resolve their namespace before
      // aliasing so even tables without an explicit namespace retain membership.
      for(const file of registries){
        const registry=readTable(path.join(s.realDataDir,file),file);
        if(!registry||registry.header.join('\t')!=='namespace\tencoding\toriginal\tcanonical\ttarget')throw new Error('unsupported served alias registry schema');
        const domains=new Map<string,Set<string>>();
        for(const r of registry.rows){const domain=domains.get(r[0]!)??new Set<string>();for(const v of r.slice(2)){const x:unknown=JSON.parse(v);for(const item of Array.isArray(x)?x:[x])if(typeof item==='string'||typeof item==='number')domain.add(String(item));}domains.set(r[0]!,domain);}
        task.identity=task.identity.map(d=>{
          const t=inventory.find(t=>t.file===d.file);if(!t)return d;
          const columns=(d.columns??[]).map(c=>{if(c.namespace||!d.identifiers.includes(c.name))return c;const j=t.header.indexOf(c.name),values=t.rows.map(r=>r[j]!).filter(Boolean),matches=[...domains].filter(([,domain])=>values.length&&values.every(v=>domain.has(v)));if(matches.length>1)throw new Error('Ambiguous registry namespace');return matches.length?{...c,namespace:matches[0]![0]}:c;});
          return {...d,columns};
        });
      }
      await onStaged?.(s);
      return { ...s, synthesisSchema: task.identity.length ? task.identity : s.synthesisSchema ?? [], canaries: s.canaries.filter(c => !publicIdentifier(c, task.taskText ?? readFileSync(path.join(task.dir, 'TASK.md'), 'utf8'))),
        // Contract roles drive both practice generation and the host self-check.
        practiceDeclarations: Object.fromEntries(task.identity.map(d => [d.file, practiceDeclaration(d.file, task)])) };
    },
    async verifyPractice(req) {
      // Include matrix axes when checking cross-file references; check correlation values below.
      if (!base.verifyPractice) throw new Error('practice self-check unavailable');
      const result = await base.verifyPractice({ ...req, files: task.identity.map(d => d.file) });
      for (const d of task.identity.filter(d => d.matrix)) {
        const real = readTable(path.join(req.staged.realDataDir, d.file), d.file);
        if (!real || !correlationAxis(real, d)) continue;
        let practice; try { practice = readTable(path.join(req.data.dir, d.file), d.file); } catch { practice = null; }
        const detail = practice ? checkCorrelation(real, practice, d) : 'correlation matrix missing';
        result.tables++;
        if (detail) result.violations.push({ file: d.file, check: 'correlation', detail });
      }
      return { ...result, ok: result.violations.length === 0 };
    },
    async scramble(req) { return generate(req,'scramble'); },
    async synthesize(req) { return generate({...req,outcomes:req.outcomes??[],exposures:req.exposures??[]},'synthetic'); },
  };
}

function aliasValue(v:unknown,seed:string,namespace='',integer?:boolean):unknown {
  if(typeof v==='string')return opaqueKey(seed,v,integer??/^\d+$/.test(v),namespace);
  if(typeof v==='number')return Number(opaqueKey(seed,String(v),true,namespace));
  if(Array.isArray(v))return v.map(x=>aliasValue(x,seed,namespace,integer));
  if(v===null)return null;
  throw new Error('Refusing unsupported practice registry identity');
}
