/** Every refusal names a code so tests and callers can tell causes apart. Fail closed. */
export type RefusalCode =
  | "invalid-records"
  | "missing-record"
  | "unverified-quarantined"
  | "published-not-allowed"
  | "foreign-claim"
  | "kind-mismatch"
  | "inconsistent-data"
  | "inconsistent-display"
  | "unformattable"
  | "invalid-spec"
  | "template-lint"
  | "label-too-long"
  | "figure-lint"
  | "internal-template";

export class FigureRefusal extends Error {
  readonly code: RefusalCode;
  readonly issues: readonly string[];
  constructor(code: RefusalCode, message: string, issues: readonly string[] = []) {
    super(`${code}: ${message}${issues.length ? ` (${issues.join("; ")})` : ""}`);
    this.name = "FigureRefusal";
    this.code = code;
    this.issues = issues;
  }
}

export function refuse(code: RefusalCode, message: string, issues: readonly string[] = []): never {
  throw new FigureRefusal(code, message, issues);
}
