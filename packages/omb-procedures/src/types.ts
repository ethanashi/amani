import type { Direction } from './special.ts';
export type { Direction } from './special.ts';

/** Shared assumption contract; metadata is registry-owned, statuses are procedure-owned. */
export interface ProcedureAssumption {
  id: string;
  assumption: string;
  mandatory: boolean;
  blocks: string[];
  diagnostic: string;
  valid_alternatives: string[];
  default_rule: { on_fail: string[]; on_not_evaluable: "not-estimable" };
}
export interface ProcedureDiagnostic {
  mandatory?: boolean;
  id: string;
  assumption: string;
  status: 'pass' | 'fail' | 'not-evaluable';
  blocks: string[];
  valid_alternatives: string[];
  detail: string;
}
export interface ProcedureEnvelope {
  procedure: string;
  status: 'ok' | 'refused';
  diagnostics?: ProcedureDiagnostic[];
}
/** Frequentist registered procedure result. Posterior procedures use ProcedureEnvelope. */
export interface ProcedureResult extends ProcedureEnvelope {
  procedure: string;
  status: 'ok' | 'refused';
  /** Why the claim was refused (legacy validity checks remain refusal-only). */
  refusal?: string;
  /** Estimate of the estimand in the data's original units. */
  estimate: number;
  /** Null value tested, original units. */
  nullValue: number;
  direction: Direction;
  alpha: number;
  /** Decision p-value: the maximum of the component p-values. */
  p: number;
  /** Interval from inverting the same decision rule at level 1 - alpha (one-sided for directional tests). */
  ci: [number, number];
  /** Component statistics (t, df, se, p of each branch, resampling counts). */
  components: Record<string, number | string>;
  /** Observable design quantities for the envelope check. */
  envelope: Record<string, number>;
}

export interface TestSpec { direction: Direction; alpha: number }

export function refused(procedure: string, reason: string, direction: Direction, alpha: number, nullValue: number, envelope: Record<string, number> = {}, estimate = NaN): ProcedureResult {
  const code = /separat/i.test(reason) ? 'separation' : /zero.*variance|zero.*SE|degenerate/i.test(reason) ? 'zero-variance' : /events/i.test(reason) ? 'too-few-events' : /rank deficient|collinear|singular/i.test(reason) ? 'singular-design' : /fewer|degrees of freedom|too few|insufficient/i.test(reason) ? 'insufficient-sample' : null;
  return { procedure, status: 'refused', refusal: reason, estimate, nullValue, direction, alpha, p: 1, ci: [-Infinity, Infinity], components: {}, envelope,
    ...(code ? {diagnostics:[{id:`numerical-validity:${code}`,assumption:'estimable numerical design',mandatory:true,status:'fail' as const,blocks:['estimate','p','ci'],valid_alternatives:[],detail:`non-estimable: ${code}: ${reason}`}]} : {}) };
}

/** t at least as extreme as the observed in the given direction, with a 1e-9 relative tie band
 * so floating-point near-ties count as ties (conservative). */
export function atLeastAsExtreme(stat: number, observed: number, direction: Direction): boolean {
  if (direction === 'two-sided') return geTol(Math.abs(stat), Math.abs(observed));
  if (direction === 'greater') return geTol(stat, observed);
  return geTol(-stat, -observed);
}
export function geTol(x: number, ref: number): boolean {
  if (!Number.isFinite(ref)) return x >= ref;
  return x >= ref - 1e-9 * Math.max(1, Math.abs(ref));
}

/** Largest count b with (1 + b) / (1 + B) <= alpha. */
export function mcThreshold(alpha: number, B: number): number {
  return Math.floor(alpha * (1 + B) + 1e-9) - 1;
}
