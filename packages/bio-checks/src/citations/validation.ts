export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeDoi(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const doi = value.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").toLowerCase();
  return /^10\.\d{4,9}\/[^\s\u0000-\u001f\u007f]+$/u.test(doi) ? doi : null;
}

export function normalizePmid(value: unknown): string | null {
  return typeof value === "string" && /^[1-9]\d*$/.test(value.trim()) ? value.trim() : null;
}
