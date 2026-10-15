/** A small, closed JSON Schema vocabulary; types and wire schemas share one definition. */
export type JsonSchema = {
  readonly type?: string; readonly const?: string | boolean; readonly enum?: readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>; readonly required?: readonly string[];
  readonly additionalProperties?: false; readonly items?: JsonSchema; readonly minItems?: number;
  readonly uniqueItems?: boolean; readonly minLength?: number; readonly maxLength?: number;
  readonly pattern?: string; readonly minimum?: number; readonly maximum?: number;
  readonly anyOf?: readonly JsonSchema[];
};
export interface Shape<T> { readonly json: JsonSchema; readonly _type?: T }
export type Infer<S> = S extends Shape<infer T> ? T : never;
type Fields = Record<string, Shape<unknown>>;
type ObjectType<R extends Fields, O extends Fields> = { -readonly [K in keyof R]: Infer<R[K]> } & { -readonly [K in keyof O]?: Infer<O[K]> };
export const str = (pattern?: string): Shape<string> => ({ json: { type: 'string', minLength: 1, ...(pattern ? { pattern } : {}) } });
export const token: Shape<string> = { json: { type: 'string' } };
export const integer = (minimum = 0): Shape<number> => ({ json: { type: 'integer', minimum, maximum: Number.MAX_SAFE_INTEGER } });
export const bool: Shape<boolean> = { json: { type: 'boolean' } };
export const literal = <const T extends string | boolean>(value: T): Shape<T> => ({ json: { const: value } });
export const enumeration = <const T extends readonly string[]>(...values: T): Shape<T[number]> => ({ json: { type: 'string', enum: values } });
export const array = <T>(item: Shape<T>, minItems = 0, uniqueItems = false): Shape<T[]> => ({ json: { type: 'array', items: item.json, minItems, uniqueItems } });
export const union = <const S extends readonly Shape<unknown>[]>(...shapes: S): Shape<Infer<S[number]>> => ({ json: { anyOf: shapes.map(s => s.json) } });
export const nullable = <T>(shape: Shape<T>): Shape<T | null> => ({ json: { anyOf: [shape.json, { type: 'null' }] } });
export function object<const R extends Fields, const O extends Fields = Record<never, never>>(required: R, optional?: O): Shape<ObjectType<R, O>> {
  return { json: { type: 'object', properties: Object.fromEntries(Object.entries({ ...required, ...optional }).map(([k, v]) => [k, v.json])), required: Object.keys(required), additionalProperties: false } };
}

const patterns = new Map<string, RegExp>();
/** One bounded accumulator avoids an array allocation for every valid schema leaf. */
export function shapeErrors(schema: JsonSchema, value: unknown, path = ''): string[] {
  const errors: string[] = [];
  const visit = (schema: JsonSchema, value: unknown, path: string): void => {
    if (errors.length >= 100) return;
    const fail = (reason: string) => { if (errors.length < 100) errors.push(`${path || '/'}: ${reason}`); };
    if (schema.anyOf) { if (!schema.anyOf.some(s => shapeErrors(s,value,path).length === 0)) fail('does not match an allowed variant'); return; }
    if ('const' in schema && value !== schema.const) { fail('wrong constant'); return; }
    if (schema.enum && !schema.enum.includes(value as string)) { fail('unknown enum value'); return; }
    if (schema.type === 'null') { if (value !== null) fail('expected null'); return; }
    if (schema.type === 'string') {
      if (typeof value !== 'string') { fail('expected string'); return; }
      if (schema.minLength !== undefined && value.length < schema.minLength) { fail('empty string'); return; }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) { fail('string length limit'); return; }
      if (schema.pattern) {
        let pattern=patterns.get(schema.pattern);
        if (!pattern) { pattern=new RegExp(schema.pattern,'u'); if(patterns.size<256)patterns.set(schema.pattern,pattern); }
        if (!pattern.test(value)) fail('invalid string grammar');
      }
      return;
    }
    if (schema.type === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < schema.minimum! || value > schema.maximum!)) { fail('expected bounded safe integer'); return; }
    if (schema.type === 'boolean' && typeof value !== 'boolean') { fail('expected boolean'); return; }
    if (schema.type === 'array') {
      if (!Array.isArray(value)) { fail('expected array'); return; }
      if (value.length < schema.minItems!) { fail('too few items'); return; }
      if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) { fail('duplicate items'); return; }
      for (let i=0; i<value.length && errors.length<100; i++) visit(schema.items!,value[i],`${path}/${i}`);
      return;
    }
    if (schema.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { fail('expected object'); return; }
      const obj=value as Record<string,unknown>;
      for (const k of schema.required ?? []) if(!Object.hasOwn(obj,k) && errors.length<100) errors.push(`${path}/${k}: required`);
      for (const k of Object.keys(obj)) {
        if(errors.length>=100)break;
        const sub=schema.properties && Object.hasOwn(schema.properties,k) ? schema.properties[k] : undefined;
        if(sub)visit(sub,obj[k],`${path}/${k}`);else errors.push(`${path}/${k}: unknown field`);
      }
    }
  };
  visit(schema,value,path); return errors;
}
