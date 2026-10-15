import { ruleFor, NO_WORKAROUND } from "./rules.ts";
import { refusalRecord, type RefusalRecord } from "../../omb-certify/src/source-policy.ts";
// Prompt texts for each turn. Prompts carry no data inline: only host-chosen paths of what the turn
// may read (mounted read-only) and the file contract. The first line names the turn for audit.
// Every lead prompt is self-contained, because a refused session is rerouted to a fresh session
// on another family, which has none of the earlier context.

import type { ErrorCategory } from "./types.ts";

const OUTPUT_CONTRACT = [
  "Output contract for run_all.sh (software runs it; you never run it on the real data):",
  "- it starts with `sh ./prepare.sh` (software-owned; copies the input tables into ./data/), then runs your code;",
  "- it reads input tables only from ./data/ (same file names as in the mounted tables);",
  "- it writes outputs/primary.json with one block per claim id: {\"claims\": {\"<claim id>\": {\"estimate\": number, \"se\": number, \"ci\": [lower, upper], \"p\": number, \"n_units\": integer}}};",
  "- Registered designs have software-owned decision intervals. A classical Student/Welch interval is a different quantity from a registered bootstrap/permutation interval: never present one as the other. Put any method-specific diagnostic interval in a separately named outputs/diagnostics.json field with its method; omit the ci field entirely from primary.json and claim entries in results.json when you have not computed the registered interval (an explicit null is malformed). Software computes and reports its decision interval independently; an omitted field never supplies interval evidence.",
  "- For an additive OLS or Welch analysis, identify the p-value calculation with pMethod: student or welch in each primary block. Report the actual computed estimate, standard error, p-value and independent-unit count; all claimed numbers remain subject to trusted recomputation. Do not invent missing quantities.",
  "- no network, no files outside the run directory, deterministic (fixed seeds).",
].join("\n");

export interface PlanPromptInput {
  nativeConfirmation?: boolean;
  id: string; question: string; plainStatement: string; taskFile: string | null; schemaViewDir: string; devDir: string | null;
  /** Public facts of the host-pinned data contract (units and tables), when one is pinned. */
  contract?: { floor: string | null; units: readonly string[]; tables: readonly string[] } | null;
  /** Registered procedure designs and their estimands (K2b registry). */
  designs?: Readonly<Record<string, readonly string[]>>;
}

export function planPrompt(i: PlanPromptInput): string {
  return [
    "OMB-PHASE: plan",
    `Investigation ${i.id}. You are the lead analyst. This turn writes the analysis plan only.`,
    `Question: ${i.question}`,
    `Plain statement: ${i.plainStatement}`,
    i.taskFile ? `Task description (read-only): ${i.taskFile}` : "",
    `Schema view (read-only): ${i.schemaViewDir} — table shapes, headers, column types, missingness and marginal counts.`,
    i.devDir
      ? `Route H: the dev partition (real outcomes, dev units only) is mounted read-only at ${i.devDir}; the held-out partition is sealed and is analysed once, by software, after the lock.`
      : "The data itself is NOT available in this turn. Do not try to read it; reads outside the mounted paths are denied and logged.",
    'Include top-level ideation: {candidates: [{id, question, angle, rationale, citationKeys: [], datasetAccessions: [], impact: 0..5, testability: 0..5}], priorKnowledge: {knownResults, dataPreviouslySeen, hypothesesPreviouslyTested, source: "lead"}}. Generate at least six candidates from the frozen brief and available public data, with at least four distinct angles: biological-mechanism, alternative-mechanism, confounding-artifact, data-integrity, clinical-translational, contrarian-null. Ratings are subjective and all candidate ideas remain exploratory. Declare unknown prior knowledge explicitly.',
    "Write plan.json in your working directory:",
    "{",
    "  \"plain_statement\": \"one plain-language sentence a non-specialist can follow\",",
    "  \"paper_set\": [\"<claim ids a paper must report>\"],",
    "  \"claims\": [{ \"id\", \"kind\": \"effect-exists|effect-size|null|reproduction|data-integrity|out-of-sample\", \"estimand\", \"exposure\", \"outcome\",",
    "               \"unit\", \"adjustment\": [...], \"strata\": [...], \"test\", \"direction\": \"two-sided|greater|less\", \"alpha\" (<= 0.05), \"mei\", \"family\", \"table\" }]",
    "}",
    "Every confirmatory statistical claim needs estimand, exposure, outcome, test and mei (the minimum effect of interest). Do not choose a machine epsilon merely to bypass a positive-MEI check; justify a scientifically meaningful positive threshold.",
    "exposure, outcome, adjustment and strata are exact column names from the selected table, including case. Never append descriptions, units or level explanations to column names; put those in estimand or plain_statement.",
    i.designs
      ? `Each confirmatory statistical claim also locks \"design\": the registered procedure family that software certifies it with (your test name never selects it). Registered designs and their estimands: ${Object.entries(i.designs).map(([d, e]) => `${d} (${e.join(", ")})`).join("; ")}. A design and estimand outside this list can be Tentative at most.`
      : "",
    i.contract
      ? `Data contract (host-pinned): set each claim's \"unit\" to \"unit_id\" (the software-generated independent unit${i.contract.floor ? `, the contract floor ${i.contract.floor}` : ""}) or one of the contract levels ${i.contract.units.join(", ")}; never a description. Use a contract table for \"table\": ${i.contract.tables.join(", ") || "(none listed)"}.`
      : "",
    i.nativeConfirmation ? 'Native authority confirmation is enabled. Deterministic data-integrity facts are recomputed by trusted software. For out-of-sample claims, lock performance.features (exact feature columns), performance.simpleRuleColumn, the table, outcome, and performance settings. Only tokenized features reach apply code; missing training/pipeline evidence cannot be claimed as passed.' : "",
    "Use only the listed claim fields. Put methodological descriptions and MEI justifications in top-level sharedKnobs or plain_statement; extra claim keys become executable analysis knobs and unsupported knobs cannot be evaluated.",
    'Registry-owned diagnostic decision rules are attached automatically at lock. No assumption_decisions entry is required. You may narrow a registry-allowed alternative, never weaken a rule. Assumption-related prose is advisory: on failure the registry valid alternative supplies the official answer, and mandatory not-evaluable diagnostics block it.',
    "Software locks plan.json by hash before any real data is analysed. Only plan.json counts.",
  ].filter(Boolean).join("\n");
}

export function planRepairPrompt(i: PlanPromptInput, issues: string): string {
  return [
    planPrompt(i).replace("OMB-PHASE: plan", "OMB-PHASE: plan-repair"),
    "",
    "The software plan check refused plan.json for these reasons (no data was consulted):",
    issues,
    "Fix plan.json in place.",
  ].join("\n");
}

export interface CodePromptInput { nativeConfirmation?: boolean; realOnlyFiles?:readonly string[]; id: string; question: string; taskFile: string | null; schemaViewDir: string; dataDir: string; route: "P" | "H" }

export const RUNTIME_CONTRACT = "Runtime: data is at ./data; write final outputs to ./outputs (maximum 50000000 bytes per file). Keep temporary arrays, caches, and intermediate binary matrices in ./tmp, outside ./outputs; the kernel's locked plan is at ./plan.json (read-only). Python is python on PATH (pinned pixi environment); R is Rscript. env.sh sets nothing (in particular, no $PYTHON). There is no network. Frozen analysis code may not start processes or use eval/exec/dynamic import; shell launchers may invoke python or Rscript directly. Source extensions .sh .bash .awk .py .r .js .mjs .cjs .ts .mts and code/ configs .json .yaml .yml .toml .cfg .csv .tsv (up to 256 KB each) are frozen. Tests, docs, and caches are dropped; never source or depend on them. PYTHONDONTWRITEBYTECODE=1 is set. Runtime limit: 900 s; console output is truncated to its first and last 64 KB. No multiprocessing or background jobs; n_jobs=1. Outputs must be regular files. Nonfinite JSON values (NaN/Infinity) become null; an unexplained missing primary estimate requires repair. Scientific non-estimability is an output, not a crash: when the locked procedure detects separation, zero variance, too few events, n <= fitted parameters, singular design or a missing endpoint, emit primary.json with status=non-estimable, estimate=null, se=null, p=null and reason_code (separation, zero-variance, too-few-events, insufficient-sample, singular-design, nonfinite-result or missing-endpoint), plus diagnostic detail. Fill task-results.json abstention fields from that diagnostic and exit successfully. Never invent a diagnostic to excuse arbitrary code errors, substitute a proxy endpoint, or manufacture a primary estimate. RAW and frozen code are read-only.";

export function codePrompt(i: CodePromptInput): string {
  return [
    "OMB-PHASE: code",
    `Investigation ${i.id}. Question: ${i.question}`,
    i.taskFile ? `Task description (read-only): ${i.taskFile}` : "",
    "The plan is LOCKED: plan.json in your working directory. Do not edit it; edits are discarded and the locked plan is used.",
    "Write code/, run_all.sh and run_primary.sh implementing the locked plan exactly.",
    i.realOnlyFiles?.length?`Real-only files unavailable in development/synthetic runs: ${i.realOnlyFiles.join(", ")}. Do not assume these files exist during a dry run.`:"",
    OUTPUT_CONTRACT,
    RUNTIME_CONTRACT,
    ...ruleFor("code-policy").allowed.map((line,index)=>`${index+1}. ${line}`),
    NO_WORKAROUND,
    'Before declaring code done, state rulesConsidered in turn-output.json. You may include appeal: {issueType: dev-file-flagged|harness-missing-input|contract-mismatch|timeout-too-short|plan-cannot-satisfy-rule|other, evidence: [refusal ids or exact run-relative paths], claim: at most 300 characters} to request an independent standby review of a refusal.',
    `Schema view (read-only): ${i.schemaViewDir}.`,
    i.route === "P"
      ? `For development, the tables are mounted read-only at ${i.dataDir} with the outcome(s) PERMUTED: the real effect is not visible. Copy them into ./data/ to test your code.`
      : `For development, the dev partition is mounted read-only at ${i.dataDir}. Copy it into ./data/ to test your code.`,
    i.nativeConfirmation ? 'Native confirmation: for a locked out-of-sample performance.features rule, also write code/apply.py and code/training.json. apply.py reads the TSV path in OMB_FEATURES (token plus locked feature columns), the trained artifact at OMB_TRAINING, and writes only token\\tprediction rows with the header token\\tprediction to OMB_OUTPUT. Preserve every token exactly once. No outcomes, original identifiers, raw tables, network or authority paths are available. Data-integrity claims are computed by software; worker primary.json is not evidence for them.' : "",
    "Software runs your frozen code once on the confirming data; that run is the look. Anything you compute here (outputs/, results.json) is discarded.",
  ].filter(Boolean).join("\n");
}

export function dryRunRepairPrompt(i: CodePromptInput, category: ErrorCategory, errorText: string, discarded: readonly string[] = [], refusal: RefusalRecord = refusalRecord(category, errorText)): string {
  return [
    codePrompt(i).replace("OMB-PHASE: code", "OMB-PHASE: dry-run-repair"),
    "",
    `Software ran your code on a SYNTHETIC dataset with the same schema (no real values) and it failed: ${category}.`,
    JSON.stringify(refusal),
    "Diagnostics from that synthetic run:",
    errorText,
    `Excluded from the bundle: ${discarded.length ? discarded.join(", ") : "none"}.`,
    "Fix the code in place.",
  ].join("\n");
}

/** After a look a model sees only the trusted error category (amendment 14): no stderr, no outputs. */
export function lookRepairPrompt(i: CodePromptInput, category: ErrorCategory, refusal: RefusalRecord = refusalRecord(category, "", "post-look")): string {
  return [
    codePrompt(i).replace("OMB-PHASE: code", "OMB-PHASE: look-repair"),
    "",
    `The frozen code failed on the confirming data. Error category: ${category}.`,
    JSON.stringify(refusalRecord(refusal.ruleId, "", "post-look")),
    "No other information about that run is available. Fix the code in place; the repaired code is checked on synthetic data and run once more, as look 2, which can never be Confirmed.",
  ].join("\n");
}

export interface ReplicatePromptInput { realOnlyFiles?:readonly string[]; id: string; question: string; lockedPlanDir: string; schemaViewDir: string; dataDir: string; route: "P" | "H" }

export function replicatePrompt(i: ReplicatePromptInput): string {
  return [
    "OMB-PHASE: replicate",
    `Investigation ${i.id}. You check implementation agreement from a different model family. Same-plan agreement does not corroborate methods validity.`,
    `Question: ${i.question}`,
    `The locked analysis plan is at ${i.lockedPlanDir}/plan.json (read-only). Implement it independently from the plan alone; you will never see another analyst's code, numbers or report.`,
    "Copy plan.json into your working directory unchanged, then write code/, run_all.sh and run_primary.sh.",
    i.realOnlyFiles?.length?`Real-only files unavailable in development/synthetic runs: ${i.realOnlyFiles.join(", ")}. Do not assume these files exist during a dry run.`:"",
    OUTPUT_CONTRACT,
    RUNTIME_CONTRACT,
    ...ruleFor("code-policy").allowed.map((line,index)=>`${index+1}. ${line}`),
    NO_WORKAROUND,
    'Before declaring code done, state rulesConsidered in turn-output.json. You may include appeal: {issueType: dev-file-flagged|harness-missing-input|contract-mismatch|timeout-too-short|plan-cannot-satisfy-rule|other, evidence: [refusal ids or exact run-relative paths], claim: at most 300 characters} to request an independent standby review of a refusal.',
    `Schema view (read-only): ${i.schemaViewDir}.`,
    i.route === "P"
      ? `Development tables with the outcome(s) PERMUTED are mounted read-only at ${i.dataDir}; copy them into ./data/ to test.`
      : `The dev partition is mounted read-only at ${i.dataDir}; copy it into ./data/ to test.`,
  ].join("\n");
}

export function interpretPrompt(i: { id: string; question: string; certifiedDir: string }): string {
  return [
    "OMB-PHASE: interpret",
    `Investigation ${i.id}. Question: ${i.question}`,
    `The certified results are at ${i.certifiedDir} (read-only): report.md, claims.json (software labels), metrics.json (software numbers) and errors.json (trusted error categories only).`,
    "TRUSTED HOST CONTEXT: integrity.json contains software-verified integrity observations and explicitly marked advisory findings. These facts must be addressed, including duplicate groups, table overlap, sparse or unmatched records, and the units actually used. Missing checks never mean clean data.",
    "Reference every duplicate group as [i:<id>] using its id from integrity.json; software inserts its token IDs. Summarize the other finding categories and units of analysis. Use integrity.* keys in metrics.json for counts. Distinguish matrix-backed matches from metadata-only matches using the separate counts. Exact content matches do not by themselves establish biological identity. These findings cannot raise any label.",
    "Write interpretation.md in your working directory: what the certified results mean and do not mean, in plain language.",
    "Refer to numbers ONLY as [m:<metric key>] references using keys from metrics.json; typed numbers are stripped.",
    "Labels are final and set by software; never restate a claim more strongly than its label.",
  ].join("\n");
}

export function bossPrompt(i: { programId: string; cycle: number; digestDir: string; maxProposals: number; manifests: string[] }): string {
  return [
    "OMB-PHASE: boss",
    `Research program ${i.programId}, cycle ${i.cycle}. You propose hypotheses; software decides what runs and what any result may be called.`,
    `World digest (read-only, at most 8 KB): ${i.digestDir}/digest.json — earlier hypotheses, their labels, the registry counts and the approved datasets with their schema views.`,
    `Approved dataset manifests: ${i.manifests.join(", ")}.`,
    `Write proposals.json in your working directory: {"proposals": [ at most ${i.maxProposals} items ]}. Each item:`,
    "{ \"id\", \"rung\": \"prediction|association|genetic-directional|causal|target|dossier\", \"kind\": \"effect-exists|effect-size|null|reproduction|out-of-sample\",",
    "  \"scope\": \"S1|S2|S3\", \"manifest\": \"<approved manifest>\", \"question\", \"plain_statement\",",
    "  \"rule\": {\"exposure\", \"outcome\", \"unit\", \"adjustment\": [...], \"strata\": [...], \"test\", \"direction\"} }",
    "Every proposal is registered and counts toward the multiplicity family of its dataset (\"kth hypothesis on this manifest\"), whether or not it runs. Duplicates of earlier hypotheses are dropped.",
  ].join("\n");
}

export function noveltyPrompt(i: { proposalId: string; question: string; snapshotDir: string }): string {
  return [
    "OMB-PHASE: novelty",
    `Proposal ${i.proposalId}: ${i.question}`,
    `A read-only literature and ClinicalTrials.gov snapshot is at ${i.snapshotDir}.`,
    "Write novelty.json: {\"annotations\": [{\"source\", \"ref\", \"relation\": \"same-association|related|contradicting|none\", \"note\"}]}.",
    "You annotate only. You cannot label, confirm or rank anything; any label you write is discarded.",
  ].join("\n");
}
