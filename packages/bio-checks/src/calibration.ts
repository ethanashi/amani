import { isRecord, snapshot } from "./evidence.ts";

export interface CalibrationInput {
  empty: string | null | undefined;
  reference: string | null | undefined;
  permuted: readonly string[] | null | undefined;
}
export type CalibrationStatus = "valid" | "refused-vacuous" | "refused-reference-fails" | "refused-inconclusive";
export interface CalibrationResult {
  status: CalibrationStatus;
  reasons: string[];
}

export type CalibrationRunner = () => boolean | Promise<boolean>;
export interface RunnerCalibrationInput {
  runEmpty: CalibrationRunner;
  runReference: CalibrationRunner;
  runPermuted: CalibrationRunner;
}
export interface RunnerCalibrationResult {
  status: Exclude<CalibrationStatus, "valid"> | "calibrated";
  empty: boolean | "error";
  reference: boolean | "error";
  permuted: boolean | "error";
  reason: string;
}

// Compatibility adapters only: all scientific decisions live in evaluate below.
export function checkCalibration(input: CalibrationInput): CalibrationResult;
export function checkCalibration(input: RunnerCalibrationInput): Promise<RunnerCalibrationResult>;
export function checkCalibration(input: CalibrationInput | RunnerCalibrationInput): CalibrationResult | Promise<RunnerCalibrationResult> {
  try {
    if (input && ["runEmpty", "runReference", "runPermuted"].some(key => Object.hasOwn(input, key))) return runCalibration(input);
  } catch { return evaluate(undefined); }
  return evaluate(input);
}
export { checkCalibration as calibrateTask };

async function runCalibration(input: unknown): Promise<RunnerCalibrationResult> {
  let runners: unknown[] = [];
  try {
    if (!isRecord(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error("invalid runner input");
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (["empty", "reference", "permuted"].some(key => Object.hasOwn(descriptors, key))) throw new Error("mixed calibration APIs");
    if (Object.getOwnPropertySymbols(input).length || Object.values(descriptors).some(d => !("value" in d) || !d.enumerable)) throw new Error("invalid runner descriptors");
    runners = ["runEmpty", "runReference", "runPermuted"].map(key => descriptors[key]?.value);
  } catch { /* malformed input produces three unavailable controls */ }
  const outcomes: Array<boolean | "error"> = [];
  for (let i = 0; i < 3; i++) {
    try {
      const runner = runners[i];
      const value: unknown = typeof runner === "function" ? await runner() : undefined;
      outcomes.push(typeof value === "boolean" ? value : "error");
    } catch { outcomes.push("error"); }
  }
  const [empty, reference, permuted] = outcomes as [boolean | "error", boolean | "error", boolean | "error"];
  const status = (value: boolean | "error") => value === "error" ? "error" : value ? "passed" : "failed";
  const result = evaluate({ empty: status(empty), reference: status(reference), permuted: [status(permuted)] });
  return { empty, reference, permuted, status: result.status === "valid" ? "calibrated" : result.status,
    reason: result.reasons.join("; ") || "empty fails, reference passes, permuted fails" };
}

/** Evaluate executed calibration outcomes; unavailable/skipped/error is never a negative control failure. */
function evaluate(input: unknown): CalibrationResult {
  const refuse = (status: CalibrationStatus, reason: string): CalibrationResult => ({ status, reasons: [reason] });
  let data: unknown;
  try { data = snapshot(input); } catch { return refuse("refused-inconclusive", "malformed calibration evidence"); }
  if (!isRecord(data)) return refuse("refused-inconclusive", "missing calibration evidence");
  if (!["passed", "failed"].includes(data.empty as string) || !["passed", "failed"].includes(data.reference as string) ||
      !Array.isArray(data.permuted) || data.permuted.length === 0 || data.permuted.some(status => status !== "passed" && status !== "failed")) {
    return refuse("refused-inconclusive", "every calibration control must execute conclusively");
  }
  if (data.empty === "passed") return refuse("refused-vacuous", "empty analysis passed");
  if (data.reference === "failed") return refuse("refused-reference-fails", "reference analysis failed");
  if (!data.permuted.every((status) => status === "failed")) {
    return refuse("refused-inconclusive", "every label permutation must execute and fail");
  }
  return { status: "valid", reasons: [] };
}
