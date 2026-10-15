/** Snapshot inert evidence without invoking getters, coercions or inherited properties.
 * Shared references are allowed; cycles and executable/custom objects are not evidence.
 * Holes become explicit undefined so array iteration cannot silently skip missing entries.
 */
export function snapshot(value: unknown, active = new Set<object>()): unknown {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") throw new Error("evidence must be plain data");
  if (active.has(value)) throw new Error("cyclic evidence");
  const array = Array.isArray(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) {
    throw new Error("evidence has a custom prototype");
  }
  active.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length) throw new Error("symbol evidence key");
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!("value" in descriptor) || (!descriptor.enumerable && !(array && key === "length"))) {
        throw new Error("evidence must have enumerable data properties");
      }
      if (array && key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= (descriptors.length?.value as number))) {
        throw new Error("non-index array property");
      }
    }
    if (array) {
      const length = descriptors.length?.value as number;
      return Array.from({ length }, (_, i) => snapshot(descriptors[String(i)]?.value, active));
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(descriptors)) result[key] = snapshot(descriptor.value, active);
    return result;
  } finally {
    active.delete(value);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
