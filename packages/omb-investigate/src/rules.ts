/** Host-owned policy data. Runtime reviewers cannot change this table or its modes. */
export const RULEBOOK_VERSION='triage-2026-10-12-v2';
export const NO_WORKAROUND='Comply with this rule as stated; do not reach the same outcome by a workaround, indirect execution or a different code path; if you believe the rule is wrong, file an appeal.';
export type RuleTier='hard-stop'|'gate'|'soft';
export type VerdictId='rule-correct'|'false-alarm'|'system-bug';
export type RemedyId='drop-dev-files'|'retry-infra'|'extend-timeout-once'|'route-other-family';
export const DEV_SIGNATURES=['**/tests','**/tests/**','**/test_*.py','**/*_test.py','**/*.test.*','**/__pycache__','**/__pycache__/**','**/.pytest_cache','**/.pytest_cache/**','**/*.pyc','**/README*','**/*.md','**/*.txt','**/.DS_Store'] as const;
export interface RuleDefinition {
 tier:RuleTier; mode:'enforce'|'warn'|'audit'; rule:string; allowed:readonly string[];
 allowedVerdicts:readonly VerdictId[]; allowedRemedies:readonly RemedyId[]; knownFalseAlarmSignatures:readonly string[];
 onGuardError:'park'; owner:string; lastChanged:string;
}
const ALLOWED=['Read ./data using pandas.read_csv or equivalent local readers.','Write final files only in ./outputs; temporary files in ./tmp.','Read the host-locked ./plan.json without edits.','Use python or Rscript directly in shell launchers.','Installed Python libraries: numpy, pandas, scipy, statsmodels, lifelines.','Installed R libraries: survival, data.table.','Frozen source: .sh .bash .awk .py .r .js .mjs .cjs .ts .mts; no subprocess, eval or dynamic import; no network.'] as const;
const soft=(rule:string,remedies:readonly RemedyId[]=[],signatures:readonly string[]=[]):RuleDefinition=>({tier:'soft',mode:'enforce',rule,allowed:ALLOWED,allowedVerdicts:['rule-correct','false-alarm','system-bug'],allowedRemedies:remedies,knownFalseAlarmSignatures:signatures,onGuardError:'park',owner:'omb-investigate',lastChanged:'2026-10-12'});
const gate=(rule:string):RuleDefinition=>({...soft(rule),tier:'gate',allowedVerdicts:['rule-correct','system-bug']});
const hard=(rule:string):RuleDefinition=>({...gate(rule),tier:'hard-stop',allowedVerdicts:[]});
export const RULES:Readonly<Record<string,RuleDefinition>>=Object.freeze({
 'assumption-signal':{...soft('Worker assumption signals require an independent advisory review.',['route-other-family']),mode:'audit'},
 'methods-validity':{...soft('Independent methods-validity objections require advisory triage.',['route-other-family']),mode:'audit'},
 'canary-exposed':hard('Sealed canaries must never appear in successful worker output.'),
 'non-model-egress':hard('Only the model API may receive network traffic.'),
 'trusted-path-changed':hard('Trusted code and data must remain unchanged.'),
 'benchmark-key-access':hard('Benchmark workers must not access graders, keys or another arm’s results.'),
 'plan-lock':gate('The registered plan must remain locked before any real-data look.'),
 'look-ledger':gate('Every real-data execution must be charged to the durable look ledger.'),
 freeze:gate('The validated source bundle must be frozen before real-data execution.'),
 sealing:gate('Sealed data must remain inaccessible to workers.'),
 referee:gate('Only the deterministic referee may assign scientific labels.'),
 G3:gate('G3 must evaluate the locked procedure without relaxation.'),
 'write-outside-outputs':soft('Write only to ./outputs or $TMPDIR.',['route-other-family']),
 'code-policy':soft('Frozen code must contain only bounded source files without process spawning or dynamic execution.',['drop-dev-files','route-other-family'],DEV_SIGNATURES),
 staging:gate('Staged inputs must satisfy the pinned data contract.'),
 infra:soft('Execution requires an available trusted runtime and adapter.',['retry-infra','route-other-family']),
 timeout:soft('Analysis execution must finish within the host deadline.',['extend-timeout-once','route-other-family']),
 execution:soft('The analysis must execute successfully and produce valid required outputs.',['route-other-family']),
 'exit-nonzero':soft('The analysis must execute successfully and produce valid required outputs.',['route-other-family']),
 'memory-limit':soft('The analysis must remain within the host memory limit.',['route-other-family']),
 signal:soft('Analysis execution must complete without interruption.',['retry-infra']),
 'missing-output':soft('The analysis must produce every required output.',['route-other-family']),
 'invalid-output':soft('Analysis outputs must satisfy the output schema and byte limits.',['route-other-family']),
 interrupted:soft('Interrupted analysis execution is not a successful result.',['retry-infra']),
});
for(const r of Object.values(RULES)){Object.freeze(r.allowedVerdicts);Object.freeze(r.allowedRemedies);Object.freeze(r.knownFalseAlarmSignatures);Object.freeze(r.allowed);Object.freeze(r);}
export function ruleFor(id:string):RuleDefinition {return (Object.hasOwn(RULES,id)?RULES[id]:undefined)??gate('An unknown guard cannot be overridden.');}
