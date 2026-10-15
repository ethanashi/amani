/** A small, fail-closed subset of JSON Schema for a task's results.json. Unknown keywords
 * are refused rather than ignored, so a schema can never silently check less than it says. */
export type JsonType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
export interface ResultsSchema {
  type?: JsonType | JsonType[];
  properties?: Record<string, ResultsSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: ResultsSchema;
  minItems?: number;
}

const types: readonly JsonType[] = ["object", "array", "string", "number", "integer", "boolean", "null"];
const structural = new Set(["type", "properties", "required", "additionalProperties", "items", "minItems"]);
const annotations = new Set(["$schema", "$id", "$comment", "title", "description", "examples", "default"]);
const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

function node(value: unknown, depth: number): ResultsSchema {
  if (depth > 32 || !plain(value)) throw new Error("results schema nodes must be objects (depth <= 32)");
  for (const key of Object.keys(value)) if (!structural.has(key) && !annotations.has(key)) throw new Error(`unsupported results schema keyword: ${key}`);
  const schema: ResultsSchema = {};
  if (value.type !== undefined) {
    const list = Array.isArray(value.type) ? value.type : [value.type];
    if (!list.length || new Set(list).size !== list.length || list.some(t => !types.includes(t as JsonType))) throw new Error("invalid results schema type");
    schema.type = Array.isArray(value.type) ? [...value.type] as JsonType[] : value.type as JsonType;
  }
  if (value.properties !== undefined) {
    if (!plain(value.properties)) throw new Error("results schema properties must be an object");
    schema.properties = Object.fromEntries(Object.entries(value.properties).map(([key, child]) => [key, node(child, depth + 1)]));
  }
  if (value.required !== undefined) {
    if (!Array.isArray(value.required) || value.required.some(k => typeof k !== "string" || !k) || new Set(value.required).size !== value.required.length) throw new Error("results schema required must list unique key names");
    schema.required = [...value.required as string[]];
  }
  if (value.additionalProperties !== undefined) {
    if (typeof value.additionalProperties !== "boolean") throw new Error("results schema additionalProperties must be boolean");
    schema.additionalProperties = value.additionalProperties;
  }
  if (value.items !== undefined) schema.items = node(value.items, depth + 1);
  if (value.minItems !== undefined) {
    if (!Number.isSafeInteger(value.minItems) || (value.minItems as number) < 0) throw new Error("results schema minItems must be a nonnegative integer");
    schema.minItems = value.minItems as number;
  }
  return schema;
}

/** Validates and normalizes; the root must describe a JSON object with declared keys. */
export function parseResultsSchema(value: unknown): ResultsSchema {
  const schema = node(value, 0);
  if (schema.type !== "object" || !schema.properties) throw new Error("results schema root must be type object with properties");
  return schema;
}

function kind(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "number" && Number.isInteger(value) ? "integer" : typeof value;
}
function matches(type: JsonType, value: unknown): boolean {
  switch (type) {
    case "object": return plain(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
  }
}

/** Required keys with the right JSON types; top-level keys only from the schema plus `extra`. */
export function resultsSchemaViolations(schema: ResultsSchema, value: unknown, limit = 50): string[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("results schema violation limit must be positive");
  const out: string[] = [];
  const visit = (s: ResultsSchema, v: unknown, at: string, root: boolean): void => {
    if (out.length >= limit) return;
    if (s.type !== undefined) {
      const allowed = Array.isArray(s.type) ? s.type : [s.type];
      if (!allowed.some(t => matches(t, v))) { out.push(`${at}: expected ${allowed.join("|")}, got ${kind(v)}`); return; }
    }
    if (plain(v)) {
      for (const key of s.required ?? []) if (!Object.hasOwn(v, key)) out.push(`${at}: missing required key ${JSON.stringify(key)}`);
      for (const [key, child] of Object.entries(v)) {
        const declared = s.properties && Object.hasOwn(s.properties, key) ? s.properties[key] : undefined;
        if (declared) visit(declared, child, `${at}.${key}`, false);
        else if (root ? key !== "extra" : s.additionalProperties === false) out.push(`${at}: unexpected key ${JSON.stringify(key)}${root ? " (additional results belong under extra)" : ""}`);
      }
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) out.push(`${at}: expected at least ${s.minItems} items, got ${v.length}`);
      if (s.items) v.forEach((item, i) => visit(s.items!, item, `${at}[${i}]`, false));
    }
  };
  visit(schema, value, "$", true);
  return out.slice(0, limit);
}
