/** Plan-declared numeric bounds on frozen metrics.json values, evaluated only by software.
 * Bounds are an additional acceptance check: they can add failures, never waive one. */
export type MetricBound =
  | { metric: string; op: "between"; values: [number, number] }
  | { metric: string; op: "eq" | "le" | "ge"; value: number };
export interface MetricBoundResult { metric: string; op: MetricBound["op"]; expected: number | [number, number]; actual: number | null; passed: boolean }

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function metricBounds(value: unknown): MetricBound[] {
  if (!Array.isArray(value) || !value.length || value.length > 64) throw new Error("metricBounds must be a nonempty list of at most 64 bounds");
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("metric bound must be an object");
    const b = item as Record<string, unknown>, keys = Object.keys(b).sort().join();
    if (typeof b.metric !== "string" || !b.metric.trim() || b.metric.length > 256) throw new Error("metric bound requires metric: a metrics.json key");
    if (b.op === "between") {
      const [low, high] = Array.isArray(b.values) && b.values.length === 2 ? b.values as unknown[] : [];
      if (keys !== "metric,op,values" || !finite(low) || !finite(high) || low > high) {
        throw new Error("between bound requires exactly {metric, op, values: [low, high]} with finite low <= high");
      }
      return { metric: b.metric, op: "between", values: [low, high] };
    }
    if (b.op === "eq" || b.op === "le" || b.op === "ge") {
      if (keys !== "metric,op,value" || !finite(b.value)) throw new Error(`${b.op} bound requires exactly {metric, op, value} with a finite value`);
      return { metric: b.metric, op: b.op, value: b.value };
    }
    throw new Error("metric bound op must be between, eq, le or ge");
  });
}

/** eq uses the plan's declared numeric tolerance; between/le/ge are inclusive and exact. */
export function evaluateMetricBounds(bounds: MetricBound[], numbers: Record<string, number>, tolerance: { abs: number; rel: number }): { passed: boolean; results: MetricBoundResult[] } {
  const results = bounds.map((b): MetricBoundResult => {
    const actual = Object.hasOwn(numbers, b.metric) && finite(numbers[b.metric]) ? numbers[b.metric]! : null;
    let passed = false;
    if (actual !== null) {
      if (b.op === "between") passed = actual >= b.values[0] && actual <= b.values[1];
      else if (b.op === "le") passed = actual <= b.value;
      else if (b.op === "ge") passed = actual >= b.value;
      else passed = Math.abs(actual - b.value) <= Math.max(tolerance.abs, tolerance.rel * Math.abs(b.value));
    }
    return { metric: b.metric, op: b.op, expected: b.op === "between" ? b.values : b.value, actual, passed };
  });
  return { passed: results.length > 0 && results.every(r => r.passed), results };
}
