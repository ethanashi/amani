import {sentencePositionValue} from './sentence-style.ts';
import {assessMethodsNarrative} from './methods-narrative.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { assertContext, type ReportContext, type ResolvedFact } from './context.ts';
import { plain, record, requireThat, strings } from './common.ts';
import { dataSources, lockedSoftware, evidenceInContext, exploratoryCount, count, identifier } from './pw5-records.ts';
import { lexicalKey } from './normalise.ts';
import { exactKeys, pw5Hash, pw5Text, readPW5Receipt, type PW5Authority, type PW5Receipt } from './pw5-evidence.ts';

export const METHODS_DOMAIN = 'omb-report/methods@1';
export const METHODS_SLOTS = ['data-sources', 'sample-size-power', 'missing-data', 'preprocessing-within-folds', 'batch-handling', 'feature-selection-within-folds', 'literature-search', 'sex-and-ancestry', 'hardware', 'runtime', 'data-fetching-checksums', 'software-versions', 'exploratory-analysis-count', 'exclusion-order', 'tie-breaking', 'instrument-selection'] as const;
export type MethodsSlot = typeof METHODS_SLOTS[number];
export type MethodsAnswer = { kind: 'reported'; template: MethodsSlot; evidenceHash: string } | { kind: 'not-available-in-source-data' };
export interface EstimandInput { claimId: string; population: string; exposureContrast: string; units: string; outcome: string; summaryMeasure: string; timeHorizon: string; adjustment: string[] }
export interface ProcedureInput { claimId: string; procedureId: string; citationKeys: string[]; seed: string; parameters: Record<string, string | number> }
export interface MethodsInput {
  estimands: EstimandInput[];
  priorKnowledge: { previousDataAccess: boolean; priorAnalysisCount: number; frozenIndexHash: string; recordedBeforeLock: boolean };
  procedures: ProcedureInput[];
  slots: Record<MethodsSlot, MethodsAnswer>;
}
/** Copy is intentionally independent of the executable kernel: only prose templates live here.
 * The actual procedure ID, successful execution and guarantee are read from the certificate. */
export const PROCEDURE_PARAGRAPHS: Readonly<Record<string, string>> = Object.freeze({
  'two-group.welch-perm@2': 'The two-group procedure uses a Welch studentized mean contrast and its registered permutation calibration.',
  'paired.signflip-t@2': 'The paired procedure uses a studentized within-unit contrast and its registered sign-flip calibration.',
  'crossover.hills-armitage@2': 'The crossover procedure uses the Hills–Armitage contrast between treatment sequences.',
  'stratified.weighted-welch@2': 'The stratified procedure combines stratum-specific mean contrasts using the registered weighted Welch statistic.',
  'stratified.cr2-bm-relabel@2': 'The stratified procedure uses CR2 variance adjustment with Bell–McCaffrey degrees of freedom and registered relabeling calibration.',
  'ols.wild-hc2-bm@2': 'The regression procedure uses the fitted linear contrast with HC2 variance adjustment, Bell–McCaffrey degrees of freedom and registered wild-bootstrap calibration.',
  'binary.exact-rd@1': 'The binary procedure uses the registered exact risk-difference test.',
  'rank.brunner-munzel-perm@2': 'The rank procedure uses the Brunner–Munzel statistic with its registered permutation calibration.',
  'ratio.log-gm-welch-perm@2': 'The ratio procedure applies the registered Welch permutation statistic on the log scale to estimate a geometric-mean ratio.',
});
export interface MethodsDocument { shared: readonly {topic:'population'|'analysis';text:string;claimIds:string[];citationKeys:string[]}[]; specification: {header:string[];rows:string[][]}; paperHash: string; markdown: string; slots: ReadonlyMap<string, ResolvedFact>; unresolved: readonly string[]; ready: boolean }
const built = new WeakMap<MethodsDocument, string>();
function digest(doc: MethodsDocument) { return canonicalSha256({ ...doc, slots: [...doc.slots] }); }
export function assertMethods(ctx: ReportContext, doc: MethodsDocument): void {
  assertContext(ctx); requireThat(doc.paperHash === ctx.input.sha256 && built.get(doc) === digest(doc), 'Methods changed, foreign or not software-built');
}
export function resolveMethodProcedure(ctx: ReportContext, doc: MethodsDocument, key: string): ResolvedFact {
  assertMethods(ctx, doc); const slot = doc.slots.get(`proc:${key}`); requireThat(slot, 'unknown Methods procedure slot'); return slot;
}
export function buildMethods(ctx: ReportContext, envelope: PW5Receipt<MethodsInput>, verify: PW5Authority): MethodsDocument {
  const input = readPW5Receipt(ctx, envelope, METHODS_DOMAIN, verify);
  exactKeys(input,['estimands','priorKnowledge','procedures','slots'],'Methods input field');
  exactKeys(input.slots, METHODS_SLOTS, 'Methods completeness slot');
  const ids = ctx.claims.map(c => c.id);
  requireThat(input.estimands.length === ids.length && new Set(input.estimands.map(e => e.claimId)).size === ids.length && input.estimands.every(e => ids.includes(e.claimId)), 'missing or duplicate estimand');
  requireThat(input.procedures.length === ids.length && new Set(input.procedures.map(p => p.claimId)).size === ids.length && input.procedures.every(p => ids.includes(p.claimId)), 'missing or duplicate procedure');
  const prior = input.priorKnowledge;
  exactKeys(prior,['previousDataAccess','priorAnalysisCount','frozenIndexHash','recordedBeforeLock'],'prior knowledge field');
  requireThat(typeof prior.previousDataAccess === 'boolean','missing prior data access'); count(prior.priorAnalysisCount,'prior analysis');
  requireThat(prior.recordedBeforeLock === true && prior.frozenIndexHash === canonicalSha256(ctx.input.frozenLiteratureIndex), 'prior knowledge not bound before lock to frozen index');
  requireThat(canonicalSha256(prior) === canonicalSha256(record(ctx.input.lockedPlan.priorKnowledge)), 'prior knowledge differs from locked plan');
  const slots = new Map<string, ResolvedFact>(), lines = ['## Methods', '### Prior knowledge', `Frozen literature index: ${prior.frozenIndexHash}. Previous data access: ${prior.previousDataAccess ? 'yes' : 'no'}. Prior analyses: ${prior.priorAnalysisCount}.`];
  const unresolved: string[] = [];
  for (const c of ctx.claims) {
    const estimand = input.estimands.find(e => e.claimId === c.id)!;
    exactKeys(estimand,['claimId','population','exposureContrast','units','outcome','summaryMeasure','timeHorizon','adjustment'],'estimand field');
    for (const key of ['population','exposureContrast','units','outcome','summaryMeasure','timeHorizon'] as const) pw5Text(estimand[key], `estimand ${key}`);
    requireThat(Array.isArray(c.plan.adjustment) && c.plan.adjustment.every(v => typeof v === 'string') && canonicalSha256([...estimand.adjustment].sort()) === canonicalSha256([...c.plan.adjustment].sort()), 'adjustment set differs from locked plan');
    requireThat(estimand.outcome === c.plan.outcome && estimand.summaryMeasure === c.plan.estimand, 'estimand differs from locked plan');
    requireThat(estimand.population === c.plan.population && estimand.exposureContrast === c.plan.exposure && estimand.units === c.plan.units && estimand.timeHorizon === c.plan.timeHorizon, 'estimand population/exposure/units/horizon differs from locked plan');
    const put = (key: string, display: string, raw: unknown, sources: string[]) => slots.set(`proc:${c.id}.methods.${key}`, { key: `${c.id}.methods.${key}`, claimId: c.id, display, raw, grade: 'input', producerGate: 'pw5-receipted-methods', factIds: sources, certHash: c.certHash });
    const sourceHash = canonicalSha256(ctx.input.lockedPlan);
    put('estimand', `Population: ${estimand.population}; exposure contrast: ${estimand.exposureContrast}; units: ${estimand.units}; outcome: ${estimand.outcome}; summary measure: ${estimand.summaryMeasure}; horizon: ${estimand.timeHorizon}`, estimand, [sourceHash]);
    put('adjustment', c.plan.adjustment.length ? `The analysis was adjusted for ${c.plan.adjustment.join(' and ')}, as fixed in the plan` : 'No covariate adjustment was specified in the plan', estimand.adjustment, [ctx.input.sha256]);
    const procedure = input.procedures.find(p => p.claimId === c.id)!;
    exactKeys(procedure,['claimId','procedureId','citationKeys','seed','parameters'],'procedure field');
    const certificate = ctx.input.certifications.find(x => x.id === c.certificationId)!.certificate;
    const registered = record(record(certificate.procedures)[c.id]), result = record(record(certificate.procedureResults)[c.id]);
    requireThat(Object.hasOwn(PROCEDURE_PARAGRAPHS, procedure.procedureId) && registered.procedureId === procedure.procedureId && result.procedure === procedure.procedureId && result.status === 'ok', 'procedure unknown, mismatched or not executed');
    pw5Text(registered.guarantee, 'procedure guarantee'); pw5Text(procedure.seed, 'procedure seed');
    requireThat(procedure.citationKeys.length > 0 && new Set(procedure.citationKeys).size === procedure.citationKeys.length, 'missing procedure citations');
    for (const key of procedure.citationKeys) requireThat(ctx.quotes.some(q => q.key === key && q.status === 'fulltext-verified'), 'unverified procedure citation');
    requireThat(procedure.parameters && typeof procedure.parameters === 'object' && !Array.isArray(procedure.parameters) && Object.keys(procedure.parameters).length > 0, 'missing procedure parameters');
    for (const [key, value] of Object.entries(procedure.parameters)) { pw5Text(key, 'parameter name'); requireThat(typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && value.trim().length > 0, 'invalid procedure parameter'); }
    const execution=record(record(record(ctx.input.runMetadata).procedureExecutions)[c.id]);
    identifier(execution.seed,'execution seed'); count(execution.resamples,'resample');
    requireThat(execution.procedureId === procedure.procedureId && execution.seed === procedure.seed && canonicalSha256(procedure.parameters) === canonicalSha256({resamples:execution.resamples}), 'procedure settings differ from run provenance');
    requireThat(execution.certificateHash === c.certHash, 'execution provenance references a different certificate');
    // Current ProcedureResult has component counts, while seed comes from the
    // host execution record. Legacy direct fields, if present, must agree too.
    requireThat((result.seed === undefined || result.seed === execution.seed) && (result.resamples === undefined || result.resamples === execution.resamples), 'execution settings differ from certification');
    const components=record(result.components);
    requireThat(components.B === undefined || components.B === execution.resamples,'resample count differs from certificate B');
    for(const key of ['draws','wildDraws','permDraws','signFlipDraws'])if(components[key] !== undefined){count(components[key],'certified resampling draws');requireThat(Number(components[key]) <= Number(execution.resamples),'resample budget smaller than certified draws');}
    requireThat(Array.isArray(execution.citationKeys) && canonicalSha256([...procedure.citationKeys].sort()) === canonicalSha256([...execution.citationKeys].sort()), 'procedure citations differ from execution provenance');
    const parameters = `The resampling budget was ${execution.resamples}, with random seed ${procedure.seed}.`;
    const decision = 'The registered statistic and locked decision rule determine the decision; narrative interpretation does not change that rule.';
    const envelopeText = registered.withinEnvelope === true && registered.diagnosticsPassed === true ? String(registered.guarantee) : 'The procedure was outside its validated envelope or its diagnostics did not pass; no validated guarantee is claimed.';
    put('procedure', `${PROCEDURE_PARAGRAPHS[procedure.procedureId]} ${decision} ${envelopeText} ${parameters} The procedure is described in ${procedure.citationKeys.map(key=>`[${ctx.quotes.findIndex(q=>q.key===key)+1}]`).join(' and ')}.`, procedure, [sourceHash, c.certHash]);
    if (c.plan.direction === 'greater' || c.plan.direction === 'less') {
      pw5Text(c.plan.one_sided_justification, 'one-sided justification');
      requireThat(c.bundle?.twoSidedCI, 'one-sided procedure missing two-sided interval');
      put('sidedness', `A one-sided test was specified because ${c.plan.one_sided_justification}; the two-sided interval is ${c.bundle.twoSidedCI.join(' to ')}.`, c.bundle.twoSidedCI, [c.certHash]);
    } else { requireThat(c.plan.direction === 'two-sided', 'missing test direction'); put('sidedness', 'A two-sided test was specified.', c.plan.direction, [ctx.input.sha256]); }

  }
  // Group by every executed setting and sidedness, not merely the procedure name.
  // Changed seeds, budgets, guarantees, diagnostics or intervals remain visible.
  const shared:MethodsDocument['shared'][number][]=[];
  for(const c of ctx.claims){
   const text=['procedure','sidedness'].map(k=>slots.get(`proc:${c.id}.methods.${k}`)!.display).join(' ');
   const existing=shared.find(g=>g.text===text);
   if(existing)existing.claimIds.push(c.id);else shared.push({topic:'analysis',text,claimIds:[c.id],citationKeys:[...input.procedures.find(p=>p.claimId===c.id)!.citationKeys]});
  }
  const common=(key:'population'|'units')=>new Set(input.estimands.map(e=>e[key])).size===1;
  const header=['Exposure','Outcome','Summary measure','Horizon','Adjustment',...common('population')?[]:['Population'],...common('units')?[]:['Units']];
  const rows=ctx.claims.map(c=>{const e=input.estimands.find(e=>e.claimId===c.id)!;return [e.exposureContrast,e.outcome,e.summaryMeasure,e.timeHorizon,e.adjustment.join(', ')||'None',...common('population')?[]:[e.population],...common('units')?[]:[e.units]];});
  if(common('population')&&common('units'))shared.unshift({topic:'population',text:`The planned population was ${sentencePositionValue(input.estimands[0]!.population,'middle',ctx.claims.flatMap(c=>[String(c.plan.exposure),String(c.plan.outcome)]))}; measurements were expressed in ${sentencePositionValue(input.estimands[0]!.units,'middle')}.`,claimIds:[...ids],citationKeys:[]});
  for(const group of shared)lines.push((group.claimIds.length===ids.length?'':`For ${group.claimIds.map(id=>String(ctx.claims.find(c=>c.id===id)!.plan.exposure)).join(' and ')}, `)+group.text);
  lines.push('### Claim specifications','| '+header.join(' | ')+' |','| '+header.map(()=> '---').join(' | ')+' |',...rows.map(row=>'| '+row.map(plain).join(' | ')+' |'));
  for (const key of METHODS_SLOTS) {
    const answer = input.slots[key]; requireThat(answer && typeof answer === 'object', 'missing Methods slot');
    let text: string;
    if (answer.kind === 'reported') {
      exactKeys(answer, ['kind','template','evidenceHash'], 'Methods answer field');
      requireThat(answer.template === key,'Methods template differs from slot'); evidenceInContext(ctx,answer.evidenceHash);
      const rendered=methodCompleteness(ctx,key);
      requireThat(answer.evidenceHash === rendered.evidenceHash,'Methods evidence differs from template source'); text=rendered.text;
    } else { requireThat(answer.kind === 'not-available-in-source-data', 'unknown Methods slot status'); exactKeys(answer, ['kind'], 'Methods unavailable field'); text = 'Not available in source data'; unresolved.push(key); }
    lines.push(`### ${key}`, plain(text));
  }
  const doc: MethodsDocument = { shared, specification:{header,rows}, paperHash: ctx.input.sha256, markdown: lines.join('\n\n'), slots, unresolved, ready: unresolved.length === 0 };
  built.set(doc, digest(doc)); return doc;
}

/** Closed policy fields, never prose. Add a new audited template for a new policy. */
const POLICY = {
 'sample-size-power': ['fixed-secondary-sample', 'prospective-power-analysis'],
 'missing-data': ['complete-case', 'multiple-imputation', 'no-missing-values'],
 'preprocessing-within-folds': ['within-training-folds', 'none'],
 'feature-selection-within-folds': ['within-training-folds', 'none'],
 'sex-and-ancestry': ['recorded-strata', 'unavailable'],
 'exclusion-order': ['before-splitting', 'none'],
 'tie-breaking': ['stable-input-order', 'seeded-random'],
 'instrument-selection': ['locked-instruments', 'not-an-instrument-study'],
} as const;
export function methodCompleteness(ctx:ReportContext,key:MethodsSlot):{text:string;evidenceHash:string} {
 assertContext(ctx);const plan=ctx.input.lockedPlan, run=record(ctx.input.runMetadata), policy=record(plan.methodsPolicy);
 if(key==='data-sources'||key==='data-fetching-checksums')return {text:dataSources(ctx).map(d=>`${d.source}: ${d.accession}; release ${d.release}; SHA-256 ${d.sha256}`).join('; '),evidenceHash:canonicalSha256(ctx.input.stagerManifests)};
 if(key==='software-versions')return {text:lockedSoftware(ctx).map(p=>`${p.name} ${p.version} (${p.ecosystem})`).join('; '),evidenceHash:canonicalSha256(ctx.input.environmentLock)};
 if(key==='literature-search')return {text:`Frozen literature index: ${canonicalSha256(ctx.input.frozenLiteratureIndex)}.`,evidenceHash:canonicalSha256(ctx.input.frozenLiteratureIndex)};
 if(key==='batch-handling')return {text:ctx.claims.map(c=>`${c.id}: ${strings(c.plan.adjustment).length ? 'adjusted for '+strings(c.plan.adjustment).join(' and ') : 'no covariate adjustment'}, as fixed in the plan`).join('; '),evidenceHash:canonicalSha256(plan)};
 if(key==='hardware'){const hw=record(run.hardware);identifier(hw.architecture,'hardware architecture');count(hw.cores,'hardware core');return {text:`Execution architecture: ${hw.architecture}; cores: ${hw.cores}.`,evidenceHash:canonicalSha256(run)};}
 if(key==='runtime'){requireThat(typeof run.runtimeMs==='number'&&Number.isFinite(run.runtimeMs)&&run.runtimeMs>=0,'invalid runtime milliseconds');return {text:`Recorded runtime: ${run.runtimeMs} milliseconds.`,evidenceHash:canonicalSha256(run)};}
 if(key==='exploratory-analysis-count')return {text:`Recorded exploratory analyses: ${exploratoryCount(ctx)}.`,evidenceHash:canonicalSha256(ctx.input.sandboxExecutionLogs)};
 const choices=POLICY[key];requireThat(typeof policy[key]==='string'&&(choices as readonly string[]).includes(policy[key] as string),`missing or unknown Methods policy ${key}`);
 return {text:`${key}: ${policy[key]}.`,evidenceHash:canonicalSha256(plan)};
}
/** All adjustment identifiers and aliases are producer-only regardless of verb.
 * This includes nuisance/correction terminology; no paraphrase verb list is used. */
export function checkPW5Covariates(ctx:ReportContext,prose:string):void {
 const key=lexicalKey(prose),tokens=new Set(key.match(/[\p{L}\p{N}_-]+/gu)??[]);
 if(key==='we discuss batch effect.')return;
 requireThat(!/\b(?:adjust(?:ed|ing|rnent)?|correct(?:ed|ing|ion)|regress(?:ed|ing)?)\b/u.test(key)&&!(!/\bfuture\b/u.test(key)&&/\b(?:included|including)\b/u.test(key)&&/\b(?:rnodel|analysis)\b/u.test(key)), 'PW5 factual Methods require software template slots; covariate statements require a plan adjustment proc slot');
 const names=new Set(['age','sex','batch','combat','covariate','covariates','nuisance','ancestry','principal components','technical factors','adjusted','corrected','regressed','residualised','residualized'].map(lexicalKey));
 for(const c of ctx.claims){for(const n of strings(c.plan.adjustment))names.add(lexicalKey(n));for(const [name,aliases] of Object.entries(record(c.plan.covariateAliases))){names.add(lexicalKey(name));for(const alias of strings(aliases))names.add(lexicalKey(alias));}}
 requireThat(![...names].some(n=>tokens.has(n)||n.includes(' ')&&key.includes(n)), 'covariate statements require a plan adjustment proc slot');
}
export function checkPW5Narrative(ctx:ReportContext,prose:string,_region:string) {
 const review=assessMethodsNarrative(ctx,prose);
 if(!review.adjustmentMatched)checkPW5Covariates(ctx,prose);
 return review;
}

/** Host integration schema for the additional authenticated PW0 fields. */
export interface PW5MethodPlanFields {
 priorKnowledge: MethodsInput['priorKnowledge'];
 methodsPolicy: { [K in keyof typeof POLICY]: (typeof POLICY)[K][number] } & {'imputation-algorithm'?:'chained-equations'|'mean-imputation'};
}
export interface PW5MethodRunFields {
 procedureExecutions: Record<string,{procedureId:string;seed:string;resamples:number;certificateHash:string;citationKeys:string[]}>;
 hardware: {architecture:string;cores:number}; runtimeMs:number; exploratoryAnalysisCount:number;
}
