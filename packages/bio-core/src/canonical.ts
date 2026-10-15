import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON cannot encode non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => {
        const entry = record[key];
        if (entry === undefined) throw new Error("canonical JSON cannot encode undefined");
        return `${JSON.stringify(key)}:${canonicalJson(entry)}`;
      });
    return `{${entries.join(",")}}`;
  }
  throw new Error(`canonical JSON cannot encode ${typeof value}`);
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Compatibility names retained while the crash-qualified donor kernel is extracted. */
export const canonicalSha256 = sha256Canonical;

export function canonicalClone<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}
