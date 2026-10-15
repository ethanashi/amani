import { devPath } from '../../omb-investigate/src/triage-stage1.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { ruleFor, RULES, RULEBOOK_VERSION, NO_WORKAROUND, type RuleTier } from '../../omb-investigate/src/rules.ts';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A refusal is evidence about a guard, never a scientific verdict. */
export interface RefusalRecord {
  decision: "denied" | "guard-error";
  ruleId: string;
  rule: string;
  trigger: string;
  repairable: boolean;
  id: string;
  allowed: string[];
  tier: RuleTier;
  appealable: boolean;
  rulebookVersion: string;
  instruction: string;
  location: { path: string | null; line: number | null };
  bundleFiles: string[];
  passingBundle: string[];
  phase: 'pre-look' | 'post-look';
}
export function refusalRecord(ruleId: string, trigger: string, phase: RefusalRecord['phase'] = 'pre-look', decision: RefusalRecord['decision'] = 'denied'): RefusalRecord {
  if (!Object.hasOwn(RULES,ruleId)) ruleId='unknown';
  const definition=ruleFor(ruleId), rule=definition.rule;
  // After a look, even a filename or exception message may encode data: project to trusted categories.
  const safe = phase === 'post-look' ? '[redacted; error category only]' : trigger
    .replace(/(?<![\w.])\/(?:[^\s"'<>:]+\/)*[^\s"'<>:]*/g, '[host-path]')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(-4096);
  const file=/^([A-Za-z0-9._/-]+)(?::(\d+))?(?::|\s|$)/.exec(safe);
  const location=phase==='post-look'?{path:null,line:null}:{path:file?.[1]??null,line:file?.[2]?Number(file[2]):null};
  const record={decision,ruleId,rule,trigger:safe,repairable:definition.tier!=='hard-stop',allowed:[...definition.allowed],phase,tier:definition.tier,appealable:definition.tier!=='hard-stop'&&decision==='denied',rulebookVersion:RULEBOOK_VERSION,instruction:NO_WORKAROUND,location,bundleFiles:[] as string[],passingBundle:['plan.json (host locked)','run_all.sh','run_primary.sh','code/ (runtime source only)']};
  return {id:canonicalSha256(record),...record};
}
export class CodePolicyError extends Error {
  readonly refusal: RefusalRecord;
  constructor(file:string, rule:string, line?:number) { super(`${file}: ${rule}${line?` at line ${line}`:""} (code policy)`); this.name='CodePolicyError'; this.refusal=refusalRecord('code-policy',`${file}${line?`:${line}`:''}: ${rule}`); }
}
export class GuardError extends Error {
  readonly refusal:RefusalRecord;
  constructor(message:string){super(message);this.name='GuardError';this.refusal=refusalRecord('infra',message,'pre-look','guard-error');}
}
// Absolute repository-pinned pixi interpreter; never the worker PATH or Xcode shim.
const runtimeLocation=new URL('../../bio-baseline/runtime-location.json',import.meta.url);
// Host-authored packaging metadata relocates the same locked environment; never a model setting.
export const POLICY_PYTHON=existsSync(runtimeLocation)?path.join(JSON.parse(readFileSync(runtimeLocation,'utf8')).analysisRuntime,'bin/python'):fileURLToPath(new URL('../../bio-baseline/.pixi/envs/default/bin/python',import.meta.url));

// Parse Python without executing it. The interpreter is host selected, never from
// worker PATH. Import aliases and assignments cannot hide a forbidden capability.
const PYTHON_POLICY = String.raw`
import ast, json, sys
try:
    tree=ast.parse(sys.stdin.read())
    aliases={}
    parents={child:parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
    helpers={'getattr','setattr','delattr','builtins.getattr','builtins.setattr','builtins.delattr'}
    forbidden={'exec','eval','compile','__import__','globals','locals','vars','__builtins__'}
    frame_attributes={'f_builtins','f_globals','f_locals'}
    modules={'subprocess','importlib','runpy','multiprocessing','ctypes','posix'}
    def name(n):
        if isinstance(n,ast.Name): return aliases.get(n.id,n.id)
        if isinstance(n,ast.Attribute): return name(n.value)+'.'+n.attr
        if isinstance(n,ast.Call) and name(n.func) in {'getattr','builtins.getattr'} and len(n.args)>=2 and isinstance(n.args[1],ast.Constant) and isinstance(n.args[1].value,str): return name(n.args[0])+'.'+n.args[1].value
        return ''
    def builtin_capability(f):
        return f.startswith('builtins.') and f.split('.')[1] in forbidden
    def denied(f):
        return f in forbidden or builtin_capability(f) or f.split('.')[0] in modules or ('.' in f and f.rsplit('.',1)[1] in frame_attributes) or f in {'sys.modules','sys._getframe','operator.attrgetter','operator.methodcaller','inspect.getmembers','inspect.getattr_static'} or f.startswith(('os.system','os.popen','os.spawn','os.exec','os.fork','posix.'))
    def refuse(n,f):
        hint='; use os.cpu_count and n_jobs=1 instead' if 'multiprocessing' in f else '; importlib.metadata re-exports execution capabilities; use host-pinned package versions' if 'importlib.metadata' in f else ''
        raise ValueError('refused call '+f+hint)
    for n in ast.walk(tree):
        if isinstance(n,ast.Import):
            for a in n.names: aliases[a.asname or a.name.split('.')[0]]=a.name if a.asname else a.name.split('.')[0]
        if isinstance(n,ast.ImportFrom):
            for a in n.names: aliases[a.asname or a.name]=(n.module or '')+'.'+a.name
    for _ in range(8):
        for n in ast.walk(tree):
            if isinstance(n,ast.Assign):
                for t in n.targets:
                    if isinstance(t,ast.Name) and name(n.value): aliases[t.id]=name(n.value)
    for n in ast.walk(tree):
        if isinstance(n,ast.Import):
            for a in n.names:
                if denied(a.name): refuse(n,a.name)
        if isinstance(n,ast.ImportFrom) and denied(n.module or ''): refuse(n,n.module or '')
        if isinstance(n,ast.ImportFrom):
            for a in n.names:
                if a.name.startswith('__') or (a.name=='*' and (n.module or '').split('.')[0] in modules|{'os','sys','builtins','operator','inspect','functools','types','pty','timeit','pickle','marshal','code','codeop'}): refuse(n,(n.module or '')+'.'+a.name)
                if denied((n.module or '')+'.'+a.name): refuse(n,(n.module or '')+'.'+a.name)
        if isinstance(n,(ast.Name,ast.Attribute)) and name(n) in helpers:
            parent=parents.get(n)
            if not isinstance(parent,ast.Call) or parent.func is not n: refuse(n,'indirect reflective helper '+name(n))
        if isinstance(n,ast.Name) and (n.id in forbidden or builtin_capability(name(n))): refuse(n,name(n))
        if isinstance(n,ast.Attribute):
            parent=parents.get(n)
            harmless=isinstance(n.ctx,ast.Load) and (n.attr in {'__name__','__file__'} or n.attr=='__class__' and isinstance(parent,ast.Attribute) and parent.attr=='__name__' and isinstance(parent.ctx,ast.Load))
            if (n.attr.startswith('__') and not harmless) or denied(name(n)): refuse(n,name(n))
        if isinstance(n,ast.Call):
            if isinstance(n.func,(ast.Call,ast.Subscript,ast.Lambda)): refuse(n,'computed execution capability')
            f=name(n.func)
            if denied(f): refuse(n,f)
            if f in {'getattr','setattr','delattr','builtins.getattr','builtins.setattr','builtins.delattr'}:
                if len(n.args)<2 or not isinstance(n.args[1],ast.Constant) or not isinstance(n.args[1].value,str) or n.args[1].value.startswith('__'): refuse(n,f)
                if f in {'getattr','builtins.getattr'} and denied(name(n)): refuse(n,name(n))
    print(json.dumps({'ok':True}))
except SyntaxError as e:
    print(json.dumps({'rule':'invalid Python syntax at line '+str(e.lineno),'line':e.lineno}))
except ValueError as e:
    print(json.dumps({'rule':str(e),'line':getattr(n,'lineno',None)}))
except Exception as e:
    print(json.dumps({'rule':'Python analyzer failed: '+type(e).__name__,'guardError':True}))
`;
/** Mask comments/literals without changing offsets or line numbers. */
export function lexicalCode(source:string):string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,t=>t.replace(/[^\n]/g,' '));
}
export function assertSourcePolicy(file:string,source:string,python=POLICY_PYTHON):void {
  const ext=path.extname(file).toLowerCase();
  if(ext==='.py'){
    let diagnostic='Python AST parser unavailable';
    for(let attempt=0;attempt<3;attempt++){
      const r=spawnSync(python,['-I','-B','-c',PYTHON_POLICY],{input:source,encoding:'utf8',timeout:30_000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin'}});
      if(r.error||r.status!==0)continue;
      let result:{ok?:boolean;rule?:string;line?:number;guardError?:boolean};try{result=JSON.parse(r.stdout);}catch{diagnostic='Python AST parser returned invalid diagnostics';continue;}
      if(result.guardError){const error=new CodePolicyError(file,result.rule??diagnostic);Object.assign(error,{refusal:refusalRecord('infra',diagnostic,'pre-look','guard-error')});throw error;}
      if(result.rule)throw new CodePolicyError(file,result.rule,result.line);
      if(result.ok===true)return;
    }
    throw new GuardError(diagnostic);
  }
  if(/\.(?:json|yaml|yml|toml|cfg|csv|tsv)$/.test(ext))return;
  // JS regex/template grammar cannot be safely erased by the lightweight masker.
  // Refuse capability tokens even in literals rather than hide executable source.
  if(/\.(?:[cm]?js|[cm]?ts)$/.test(ext)) {
    const token=/\b(?:child_process|vm|getBuiltinModule|createRequire|eval|Function)\b|\bimport\s*\(/.exec(source);
    if(token)throw new CodePolicyError(file,`refused call ${token[0].trim()}`,source.slice(0,token.index).split('\n').length);
  }
  const clean=lexicalCode(source);
  const pattern=/\.(?:[cm]?js|[cm]?ts)$/.test(ext)?/\b(?:eval|Function)\s*\(|\bimport\s*\(|\brequire\s*\(\s*[^'"\s)]/:/\b(?:eval|exec|system|system2|source)\s*\(/;
  const found=pattern.exec(clean);
  if(found)throw new CodePolicyError(file,`refused call ${found[0].trim()}`,clean.slice(0,found.index).split('\n').length);
  // Capability-bearing import strings are checked only in an import/require construct.
  const imports=source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,t=>t.replace(/[^\n]/g,' '));
  const module=/(?:from\s*|require\s*\(\s*|import\s*)['"](?:node:)?(?:child_process|vm)['"]/.exec(imports);
  if(module)throw new CodePolicyError(file,'refused subprocess/vm import',imports.slice(0,module.index).split('\n').length);
}

/** Host-supplied inventory; after a look, arbitrary filenames and line numbers are discarded. */
export function withBundleContext(r:RefusalRecord,files:readonly string[]):RefusalRecord {
  if(r.phase==='post-look')return refusalRecord(r.ruleId,'','post-look',r.decision);
  const bundleFiles=[...files].filter(f=>/^[A-Za-z0-9._/-]+$/.test(f)&&!f.startsWith('/')&&!f.split('/').includes('..')).sort();
  const passingBundle=devPath(r.location.path??'')?bundleFiles.filter(f=>f!==r.location.path):bundleFiles;
  const {id:_id,...rest}=r;const value={...rest,bundleFiles,passingBundle:passingBundle.length?passingBundle:r.passingBundle};
  return {id:canonicalSha256(value),...value};
}
