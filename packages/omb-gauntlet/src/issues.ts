// Structured findings from lenient parsing and contract checks. Warnings never block; errors mark
// exactly the inputs that make a decision rule (or a contract) unevaluable. Messages are
// software-written and never echo unit IDs or data values.

export type Severity = "warning" | "error";

export interface Issue {
  readonly severity: Severity;
  /** Stable machine code, e.g. "alias-field", "default-applied", "unevaluable-direction". */
  readonly code: string;
  /** JSON-pointer-like location, e.g. "$.claims[0].alpha". */
  readonly path: string;
  readonly message: string;
}

export class IssueLog {
  readonly items: Issue[] = [];

  warn(code: string, path: string, message: string): void {
    this.items.push({ severity: "warning", code, path, message });
  }

  error(code: string, path: string, message: string): void {
    this.items.push({ severity: "error", code, path, message });
  }

  get errors(): Issue[] {
    return this.items.filter((issue) => issue.severity === "error");
  }

  get warnings(): Issue[] {
    return this.items.filter((issue) => issue.severity === "warning");
  }

  /** Number of errors recorded so far; used to scope errors to one claim. */
  get errorCount(): number {
    return this.errors.length;
  }
}
