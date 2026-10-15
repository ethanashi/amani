import { canonicalJson } from "../../bio-core/src/index.ts";
import { parseCsv } from "./csv.ts";
import { renderTable, type RenderedTable } from "./tables.ts";
import type { TableSpec } from "./spec.ts";
/**
 * Re-verification (section 8): an SVG is accepted only if it is byte-identical to the figure
 * regenerated from the same spec and certified records, and it passes the lint and the
 * closed-world check. Regeneration is what proves that geometry, not only text, traces to input.
 */
import { checkFigureRoundTrip, type RoundTripResult } from "./roundtrip.ts";
import type { ClosedWorldIssue } from "./closed-world.ts";
import { checkFigure, type LintIssue } from "./lint.ts";
import { FigureRefusal } from "./refusal.ts";
import { renderFigure } from "./render.ts";
import type { FigureSpec } from "./spec.ts";
import type { FactStore } from "./store.ts";

export interface FigureVerification {
  readonly ok: boolean;
  /** The submitted SVG equals the regenerated one byte for byte. */
  readonly identical: boolean;
  readonly roundTrip?: RoundTripResult;
  readonly lint: readonly LintIssue[];
  readonly closedWorld: readonly ClosedWorldIssue[];
  /** Set when the spec or records themselves are refused. */
  readonly refusal: string | null;
}

export function verifyFigure(svg: string, spec: FigureSpec, store: FactStore): FigureVerification {
  let regenerated;
  try {
    regenerated = renderFigure(spec, store);
  } catch (error) {
    if (error instanceof FigureRefusal) return { ok: false, identical: false, lint: [], closedWorld: [], refusal: error.message };
    throw error;
  }
  const identical = svg === regenerated.svg;
  const roundTrip = checkFigureRoundTrip(svg, regenerated.sourceCsv, regenerated);
  const check = checkFigure(svg, regenerated.bindings);
  return { ok: identical && roundTrip.ok && !check.lint.length && !check.closedWorld.length, identical, roundTrip, lint: check.lint, closedWorld: check.closedWorld, refusal: null };
}

/** Tables are accepted only against trusted regeneration, never submitted hashes. */
export function verifyTable(submitted: unknown, spec: TableSpec, store: FactStore): {ok:boolean;issues:string[]} {
  try { return checkTableRoundTrip(submitted, renderTable(spec,store)); }
  catch(error) { return {ok:false,issues:[error instanceof Error?error.message:"table verification unavailable"]}; }
}
export function checkTableRoundTrip(submitted: unknown, expected: RenderedTable): {ok:boolean;issues:string[]} {
  const issues:string[]=[];
  if(!submitted || typeof submitted!=="object") return {ok:false,issues:["table submission missing or malformed"]};
  try {
  const value=submitted as Record<string,unknown>;
  for(const field of ['markdown','csv','dictionary'] as const) if(value[field]!==expected[field]) issues.push(`${field} hash mismatch`);
  try { if(canonicalJson(value.provenance)!==canonicalJson(expected.provenance)) issues.push('table provenance mismatch'); }
  catch { issues.push('table provenance missing or malformed'); }
  try { if(canonicalJson(parseCsv(String(value.csv)))!==canonicalJson(parseCsv(expected.csv))) issues.push('CSV cell mismatch'); }
  catch { issues.push('unreadable table CSV'); }
  } catch { issues.push("table submission unreadable"); }
  return {ok:issues.length===0,issues};
}
