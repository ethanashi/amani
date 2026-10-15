import { tiercPlanSpecs } from '../../omb-certify/src/tierc-plan.ts';
import { TIERC_REGISTRATIONS } from '../../omb-certify/src/tierc.ts';
import { colocPlanSpecs } from '../../omb-certify/src/coloc-plan.ts';
import { COLOC_ASSUMPTIONS } from '../../omb-procedures/src/coloc.ts';
import { assumptionIssues, assumptionAdvisories, registryDecisionRules, type MethodAssumption } from './assumptions.ts';
import { ideationIssues, type Ideation } from '../../omb-literature/src/ideas.ts';
import {jsonErrorPosition} from './json-position.ts';
// Software plan check before the lock (no outcome data is used). The lead's plan.json is parsed
// leniently by omb-gauntlet (the single plan parser); V7 adds what an investigation needs to lock:
// every confirmatory statistical claim names its estimand, exposure, outcome, test and minimum
// effect of interest; the plan carries a plain_statement and a paper_set (paper_writer_design §13,
// decision item 11). Issues go back to the lead as a blind repair turn: codes and paths only,
// never data.

import { IssueLog, isStatistical, parseLenientJson, parsePlan, planLockHash, type Plan } from "../../omb-gauntlet/src/index.ts";

export interface PlanIssue { code: string; path: string; message: string; evidence?: string; allowed?: string[] }

export interface PlanCheck {
  ideation?: Ideation;
  /** accepted: lockable as is. repair: a repair turn may fix it. */
  status: "accepted" | "repair";
  plan: Plan | null;
  planHash: string | null;
  plainStatement: string | null;
  paperSet: string[];
  /** Claim ids of the evaluable plan that are confirmatory (not exploratory). */
  confirmatory: string[];
  issues: PlanIssue[];
  warnings: string[];
  registryDecisions?: ReturnType<typeof registryDecisionRules>;
  advisories?: PlanIssue[];
}

const PLAIN = ["plainstatement", "plain_statement", "plainlanguagestatement", "plain"];
const PAPER = ["paperset", "paper_set", "papers", "paperclaims"];
const compact = (k: string): string => k.normalize("NFKC").toLowerCase().replace(/[\s_.\-]+/g, "");

function pick(record: Record<string, unknown>, names: readonly string[]): unknown {
  const want = new Set(names.map(compact));
  for (const [k, v] of Object.entries(record)) if (want.has(compact(k))) return v;
  return undefined;
}

/** Host contract rules for the plan check (public facts of the pinned contract; no values). */
export interface ContractRules { floor: string | null; units: readonly string[]; tables: readonly string[]; tableColumns?: Record<string, readonly string[]>;tableUnits?:Record<string,string> }

/** Contract rules from a pin's design, or null when there is no usable contract. */
export function contractRules(design: unknown): ContractRules | null {
  const d = design && typeof design === "object" && !Array.isArray(design) ? design as { floor?: unknown; unitLevels?: unknown; tables?: unknown; tableColumns?: Record<string, unknown>;tableUnits?:Record<string,string> } : null;
  const units = Array.isArray(d?.unitLevels) ? d!.unitLevels.filter((x): x is string => typeof x === "string") : [];
  const tables = Array.isArray(d?.tables) ? d!.tables.filter((x): x is string => typeof x === "string") : [];
  const tableColumns = Object.fromEntries(Object.entries(d?.tableColumns ?? {}).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((c) => typeof c === "string")));
  return units.length ? { floor: typeof d!.floor === "string" ? d!.floor : null, units, tables, tableColumns,tableUnits:d!.tableUnits??{} } : null;
}

export function checkPlan(text: string | null, contract: ContractRules | null = null, assumptions: readonly MethodAssumption[] = [], requireIdeation = true): PlanCheck {
  const issues: PlanIssue[] = [];
  const warnings: string[] = [];
  const empty = (code: string, message: string): PlanCheck => ({
    status: "repair", plan: null, planHash: null, plainStatement: null, paperSet: [], confirmatory: [], issues: [{ code, path: "$", message }], warnings,
  });
  if (text === null) return empty("missing-file", "plan.json was not written");
  const log = new IssueLog();
  const raw = parseLenientJson(text, log);
  if (!raw.ok || raw.value === null || typeof raw.value !== "object" || Array.isArray(raw.value)) {let detail="plan.json is not a JSON object";try{JSON.parse(text);}catch(e){detail+=`: ${String(e)} (position ${jsonErrorPosition(text)})`;}return empty("invalid-file",detail);}
  const record = raw.value as Record<string, unknown>;
  try { if(colocPlanSpecs(record.sharedKnobs).length)assumptions=[...assumptions,...COLOC_ASSUMPTIONS]; }
  catch(e){issues.push({code:'diagnostic-parameter-invalid',path:'$.sharedKnobs.coloc_procedures',message:String(e)});}
  try { assumptions=[...assumptions,...tiercPlanSpecs(record.sharedKnobs).flatMap(s=>TIERC_REGISTRATIONS[s.kind].assumptions)]; }
  catch(e){issues.push({code:'diagnostic-parameter-invalid',path:'$.sharedKnobs.tierc_procedures',message:String(e)});}
  issues.push(...assumptionIssues(record, assumptions));
  if (requireIdeation) for (const code of ideationIssues(record.ideation)) issues.push({ code, path: "$.ideation", message: "Six candidates, four angles and the prior-knowledge box are required before locking" });

  const parsed = parsePlan(text);
  for (const i of parsed.issues) {
    if (i.severity === "error") issues.push({ code: i.code, path: i.path, message: i.message, allowed: planAlternatives(i.code, i.path) });
    else warnings.push(`${i.code} ${i.path}: ${i.message}`);
  }
  const plan = parsed.plan;
  if (!plan) return { ...empty("no-evaluable-claim", "no claim with an evaluable decision rule"), issues: issues.length ? issues : [{ code: "no-evaluable-claim", path: "$", message: "no claim with an evaluable decision rule" }] };

  const confirmatory = plan.claims.filter((c) => !c.exploratory).map((c) => c.id);
  if (confirmatory.length === 0) issues.push({ code: "no-confirmatory-claim", path: "$.claims", message: "every claim is exploratory; at least one claim must be confirmatory" });
  for (const c of plan.claims) {
    if (c.exploratory || !isStatistical(c.kind)) continue;
    const at = `$.claims[${c.id}]`;
    const mode = c.knobs.permutationMode;
    if (mode !== undefined && (typeof mode !== 'string' || !['auto','exact','monte-carlo'].includes(mode))) issues.push({ code: 'invalid-field', path: `${at}.permutationMode`, message: 'permutationMode must be auto, exact or monte-carlo' });

    // Match claimData's executable knob vocabulary. Unknown narrative keys are kept
    // by the lenient parser, but cannot be interpreted by the deterministic kernel.
    const supported = new Set(["table", "monteCarlo", "permutationMode", "material", "interval", "performance", "producer", "design", "procedureDesign", "weights", "sequenceColumn", "periodColumn", "controlLevel", "treatedLevel"]);
    for (const key of Object.keys(c.knobs)) if (!supported.has(key)) {
      issues.push({ code: "unsupported-analysis-knob", path: `${at}.${key}`, message: `the kernel does not implement ${key}; keep descriptive context in top-level sharedKnobs or plain_statement, and use only executable claim fields` });
    }
    for (const [field, value] of [["estimand", c.estimand], ["exposure", c.exposure], ["outcome", c.outcome], ["test", c.test]] as const) {
      if (value === null) issues.push({ code: "missing-field", path: `${at}.${field}`, message: `${field} is required for a confirmatory ${c.kind} claim` });
    }
    if (c.mei === null) issues.push({ code: "mei-ignored", path: `${at}.mei`, message: "the mei value was missing or ignored because it must be a finite, nonzero numeric minimum effect of interest for a confirmatory statistical claim" });
  }
  // Under a pinned contract the kernel resolves claim units in the contract hierarchy and reads
  // only contract tables: a free-text unit or an outside table could never be certified.
  if (contract) for (const c of plan.claims) {
    if (c.exploratory || !(isStatistical(c.kind) || c.kind === "reproduction")) continue;
    const at = `$.claims[${c.id}]`;
    if (c.unit !== "unit_id" && !contract.units.includes(c.unit ?? "")) {
      issues.push({ code: "unit-not-in-contract", path: `${at}.unit`, message: `unit must be "unit_id" (the software-generated independent unit, the contract floor${contract.floor ? ` ${contract.floor}` : ""}) or one of the contract levels: ${contract.units.join(", ")}` });
    }
    const table = c.knobs.table;
    if (contract.tables.length && (typeof table !== "string" || !contract.tables.includes(table))) {
      issues.push({ code: "table-not-in-contract", path: `${at}.table`, message: `table must be one of the contract's row tables: ${contract.tables.join(", ")}` });
    }
    const columns = typeof table === "string" ? contract.tableColumns?.[table] : undefined;
    if (columns) {
      for (const [field, names] of [["exposure", [c.exposure]], ["outcome", [c.outcome]], ["adjustment", c.adjustment], ["strata", c.strata]] as const) {
        for (const name of names) if (name !== null && !columns.includes(name)) {
          const unit=c.unit==='unit_id'?contract.floor:c.unit;
          const joined=field==='outcome'?contract.tables.filter(t=>contract.tableUnits?.[t]===unit&&contract.tableColumns?.[t]?.includes(name)):[];
          if(joined.length){warnings.push(`outcome ${name} is available from joinable contract row table ${joined.join(', ')} on ${unit}`);continue;}
          issues.push({ code: "column-not-in-contract", path: `${at}.${field}`, message: `${field} must use an exact column from ${table}${field==='outcome'?' or a contract row table joinable on the claim unit':''}: ${columns.join(", ")}; available row tables: ${contract.tables.join(', ')}; put descriptions in estimand or plain_statement` });
        }
      }
    }
  }

  const plainRaw = pick(record, PLAIN);
  const plainStatement = typeof plainRaw === "string" && plainRaw.trim() ? plainRaw.normalize("NFKC").trim().replace(/\s+/g, " ") : null;
  if (plainStatement === null) issues.push({ code: "missing-field", path: "$.plain_statement", message: "plain_statement (one plain-language sentence) is required" });

  const paperRaw = pick(record, PAPER);
  let paperSet: string[] = [];
  if (paperRaw === undefined) {
    paperSet = [...confirmatory].sort();
    warnings.push("paper_set absent: defaulted to every confirmatory claim");
  } else if (Array.isArray(paperRaw) && paperRaw.every((x) => typeof x === "string" && x.trim())) {
    paperSet = [...new Set(paperRaw.map((x) => (x as string).normalize("NFKC").trim().toLowerCase()))].sort();
    const unknown = paperSet.filter((id) => !plan.claims.some((c) => c.id === id));
    if (unknown.length) issues.push({ code: "unknown-claim", path: "$.paper_set", message: `paper_set names claims not in the plan: ${unknown.join(", ")}` });
    if (paperSet.length === 0) issues.push({ code: "empty-paper-set", path: "$.paper_set", message: "paper_set must name at least one claim" });
  } else {
    issues.push({ code: "invalid-field", path: "$.paper_set", message: "paper_set must be a list of claim ids" });
  }

  return {
    status: issues.length === 0 && parsed.status === "accepted" ? "accepted" : "repair",
    plan, planHash: planLockHash(plan), plainStatement, paperSet, confirmatory, issues, warnings,
    ...(ideationIssues(record.ideation).length === 0 ? { ideation: structuredClone(record.ideation) as Ideation } : {}),
    registryDecisions: registryDecisionRules(record, assumptions), advisories: assumptionAdvisories(record),
  };
}

/** The trusted plan context the lock carries (the L4 payload): software-resolved, never re-read from a worker. */
export interface LockedContext { plainStatement: string; paperSet: readonly string[]; registryDecisions?: ReturnType<typeof registryDecisionRules> }

const normalPlain = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.normalize("NFKC").trim().replace(/\s+/g, " ") : null);
const normalPaper = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? [...new Set((v as string[]).map((x) => x.normalize("NFKC").trim().toLowerCase()).filter(Boolean))].sort() : null;

function planRecord(text: string): Record<string, unknown> | null {
  const parsed = parseLenientJson(text, new IssueLog());
  return parsed.ok && parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value) ? parsed.value as Record<string, unknown> : null;
}

/**
 * The plan the kernel locks and executes: plan.json with the worker's plain_statement / paper_set
 * spellings replaced by the trusted locked context. certifyDirectory hard-stops a locked plan
 * without both (K2b: locked-plan-context-incomplete), and the gauntlet lock hash covers them, so
 * the plain statement and the paper set are part of the locked rule. Returns JSON text.
 */
export function kernelPlanText(text: string, context: LockedContext): string | null {
  const record = planRecord(text);
  if (record === null) return null;
  const drop = new Set([...PLAIN, ...PAPER, "ideation"].map(compact));
  const kept = Object.fromEntries(Object.entries(record).filter(([k]) => !drop.has(compact(k))));
  if (context.registryDecisions?.length) kept.sharedKnobs = {...(kept.sharedKnobs && typeof kept.sharedKnobs==='object' ? kept.sharedKnobs : {}), registry_decisions:context.registryDecisions};
  return JSON.stringify({ plain_statement: context.plainStatement, paper_set: [...context.paperSet], ...kept }, null, 2) + "\n";
}

/** The locked context of a locked kernel plan, or null when it carries none. */
export function lockedContextOf(lockedText: string): LockedContext | null {
  const plan = parsePlan(lockedText).plan;
  const paper = normalPaper(plan?.paperSet);
  return plan?.plainStatement && paper ? { plainStatement: plan.plainStatement, paperSet: paper } : null;
}

/**
 * Locked-plan equivalence for freeze. The worker's own plain_statement / paper_set count when it
 * wrote them (a rewrite after the lock is an edit); a field it never wrote was filled by software
 * at the lock and is not an edit. The locked plan is frozen either way.
 */
export function samePlan(workerText: string | null, lockedText: string): boolean {
  const locked = lockedContextOf(lockedText);
  const record = workerText === null ? null : planRecord(workerText);
  if (workerText === null || record === null || locked === null) return false;
  const a = kernelPlanText(workerText, { plainStatement: normalPlain(pick(record, PLAIN)) ?? locked.plainStatement, paperSet: normalPaper(pick(record, PAPER)) ?? locked.paperSet });
  if (a === null) return false;
  const pa = parsePlan(a).plan, pb = parsePlan(lockedText).plan;
  return pa !== null && pb !== null && planLockHash(pa) === planLockHash(pb);
}

/** The blind repair message: issue codes, paths and software messages only (no data, no values). */
export function repairMessage(issues: readonly PlanIssue[]): string {
  return issues.map((i) => `- ${i.code} at ${i.path}: ${i.message}\n  Allowed: ${(i.allowed ?? planAlternatives(i.code, i.path)).join(" ")}`).join("\n");
}

/** Trusted alternatives depend on the failed rule, never on outcome values. */
export function planAlternatives(code: string, field: string): string[] {
  if (code === "unevaluable-reproduction") return ["Without a published numeric target, use kind 'effect-size' (alias 'estimate') to estimate the outcome from data, or 'effect-exists' to test an association/difference with the exposure. Declare outcome, exposure, estimand, test and meaningful nonzero mei. Never invent a published target."];
  if (code === "unknown-kind") return ["Use canonical kind 'effect-size' for estimation, 'effect-exists' for association/difference, 'out-of-sample' for prediction, 'data-integrity' only for integrity findings, or 'null' for prespecified equivalence. 'reproduction' requires a supplied published numeric target."];
  if (code === "mei-ignored") return ["Provide a finite nonzero numeric mei justified as the smallest scientifically meaningful effect, before seeing outcomes. Do not use machine epsilon or relabel the claim as integrity."];
  if (code === "missing-field" && field.includes(".claims[")) return ["For effect-exists, effect-size, null or out-of-sample, supply exposure and outcome as source column names, an estimand, test, and meaningful nonzero mei; describe any required join separately. Never replace a scientific claim with data-integrity to bypass a required field."];
  return ["Revise the named plan field according to the software message before locking; use the declared schema and registered claim kinds, without outcome data."];
}
