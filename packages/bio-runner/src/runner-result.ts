// Adapted from Amani L/packages/harness/src/runner-result.ts and runner-result.schema.json (4fb5d05a). The report
// gains `artifacts` and `claims`; parsing stays exact-keys and fail-closed. See PROVENANCE.md.

export type RunnerStatus = "completed" | "blocked" | "inconclusive";

/** Free-text description of an output. Never used to choose a file to read or hash. */
export interface ReportArtifact {
  path: string;
  description: string;
}

/** Something the worker asserts. `value` is a number it claims; software stores it as claimed, never as observed. */
export interface ReportClaim {
  id: string;
  statement: string;
  value: number | null;
  /** Paths from the report's own `artifacts` list that support this claim. */
  artifacts: string[];
}

export interface RunnerReport {
  status: RunnerStatus;
  summary: string;
  artifacts: ReportArtifact[];
  claims: ReportClaim[];
}

export const REPORT_LIMITS = {
  summaryChars: 16_384,
  artifacts: 256,
  pathChars: 1024,
  descriptionChars: 2000,
  claims: 256,
  statementChars: 4000,
  claimArtifacts: 64,
} as const;

const CLAIM_ID = "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$";
const STATUSES: readonly RunnerStatus[] = ["completed", "blocked", "inconclusive"];

/** Passed to `claude --json-schema`. The parser below is the authority; the schema only steers the model. */
export const RUNNER_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "artifacts", "claims"],
  properties: {
    status: { type: "string", enum: [...STATUSES] },
    summary: { type: "string", minLength: 1, maxLength: REPORT_LIMITS.summaryChars },
    artifacts: {
      type: "array",
      maxItems: REPORT_LIMITS.artifacts,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "description"],
        properties: {
          path: { type: "string", minLength: 1, maxLength: REPORT_LIMITS.pathChars },
          description: { type: "string", minLength: 1, maxLength: REPORT_LIMITS.descriptionChars },
        },
      },
    },
    claims: {
      type: "array",
      maxItems: REPORT_LIMITS.claims,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "statement", "value", "artifacts"],
        properties: {
          id: { type: "string", pattern: CLAIM_ID },
          statement: { type: "string", minLength: 1, maxLength: REPORT_LIMITS.statementChars },
          value: { type: ["number", "null"] },
          artifacts: { type: "array", maxItems: REPORT_LIMITS.claimArtifacts, items: { type: "string" } },
        },
      },
    },
  },
} as const;

export const REPORT_MISSING_SUMMARY = "Runner did not provide the required structured completion report.";
export const REPORT_MALFORMED_SUMMARY = "Runner completion report is malformed or outside the contract.";

/** Fail closed: anything but an exact, valid report becomes `inconclusive` with no artifacts and no claims. */
export function parseRunnerReport(text: string | undefined): RunnerReport {
  let value: unknown;
  try { value = JSON.parse(text ?? ""); } catch { /* fail closed */ }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { status: "inconclusive", summary: REPORT_MISSING_SUMMARY, artifacts: [], claims: [] };
  }
  if (runnerReportViolation(value) !== null) {
    return { status: "inconclusive", summary: REPORT_MALFORMED_SUMMARY, artifacts: [], claims: [] };
  }
  const report = value as RunnerReport;
  return {
    status: report.status,
    summary: report.summary,
    artifacts: report.artifacts.map((artifact) => ({ path: artifact.path, description: artifact.description })),
    claims: report.claims.map((claim) => ({ id: claim.id.toLowerCase(), statement: claim.statement, value: claim.value, artifacts: [...claim.artifacts] })),
  };
}

/** The first rule a candidate report breaks, or null when it is exactly within the contract. */
export function runnerReportViolation(value: unknown): string | null {
  if (!isPlainObject(value)) return "report is not an object";
  if (!exactKeys(value, ["artifacts", "claims", "status", "summary"])) return "report keys must be exactly status, summary, artifacts, claims";
  if (typeof value.status !== "string" || !STATUSES.includes(value.status as RunnerStatus)) return "status outside the contract";
  if (!boundedText(value.summary, REPORT_LIMITS.summaryChars)) return "summary must be non-blank text within bounds";
  if (!Array.isArray(value.artifacts) || value.artifacts.length > REPORT_LIMITS.artifacts) return "artifacts must be a bounded array";
  for (const artifact of value.artifacts) {
    if (!isPlainObject(artifact) || !exactKeys(artifact, ["description", "path"])) return "artifact keys must be exactly path, description";
    if (!boundedText(artifact.path, REPORT_LIMITS.pathChars)) return `artifact path must be bounded text: ${String(artifact.path).slice(0, 80)}`;
    if (!boundedText(artifact.description, REPORT_LIMITS.descriptionChars)) return "artifact description must be non-blank text within bounds";
  }
  if (!Array.isArray(value.claims) || value.claims.length > REPORT_LIMITS.claims) return "claims must be a bounded array";
  const ids = new Set<string>();
  const claimId = new RegExp(CLAIM_ID);
  for (const claim of value.claims) {
    if (!isPlainObject(claim) || !exactKeys(claim, ["artifacts", "id", "statement", "value"])) return "claim keys must be exactly id, statement, value, artifacts";
    if (typeof claim.id !== "string" || !claimId.test(claim.id)) return "claim id outside the contract";
    if (ids.has(claim.id.toLowerCase())) return `duplicate claim id: ${claim.id}`;
    ids.add(claim.id.toLowerCase());
    if (!boundedText(claim.statement, REPORT_LIMITS.statementChars)) return "claim statement must be non-blank text within bounds";
    if (claim.value !== null && (typeof claim.value !== "number" || !Number.isFinite(claim.value))) return "claim value must be a finite number or null";
    if (!Array.isArray(claim.artifacts) || claim.artifacts.length > REPORT_LIMITS.claimArtifacts) return "claim artifacts must be a bounded array";
    for (const reference of claim.artifacts) {
      if (!boundedText(reference, REPORT_LIMITS.pathChars)) return "claim artifact reference must be bounded text";
    }
  }
  return null;
}

/** Relative POSIX path inside the working directory: no absolute, empty, `.` or `..` segment, backslash or control. */
export function safeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > REPORT_LIMITS.pathChars) return false;
  if (value.startsWith("/") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(",") === keys.join(",");
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}
