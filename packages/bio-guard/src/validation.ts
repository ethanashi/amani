export interface GuardResult {
  ok: boolean;
  reasons: string[];
}

export function result(reasons: string[]): GuardResult {
  return { ok: reasons.length === 0, reasons };
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value);
}

export function isoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
