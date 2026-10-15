import type { CertifyResult } from './ports.ts';
import type { ClaimRecord, Json } from './types.ts';
import type { MethodAssumption } from './assumptions.ts';

/** Exact shared producer contract. Only CertifyPort returns trusted diagnostics. */
export interface ProcedureDiagnostic {
  mandatory?: boolean;
  id: string;
  assumption: string;
  status: 'pass' | 'fail' | 'not-evaluable';
  blocks: string[];
  valid_alternatives: string[];
  detail: string;
}
export interface DiagnosticIntegrity {
  blocked: { id: string; status: ProcedureDiagnostic['status']; blocks: string[]; detail: string }[];
  officialAnswers: Record<string, Json>;
  withheldClaims: string[];
  line: string;
}
const overlaps = (a: string, b: string) => a === b || a.startsWith(b + '.') || b.startsWith(a + '.');
export function blockingDiagnostics(diagnostics: readonly ProcedureDiagnostic[], assumptions: readonly MethodAssumption[] = []): ProcedureDiagnostic[] {
  return diagnostics.filter(d => d.blocks.length > 0 && (d.status === 'fail' || d.status !== 'pass' && d.mandatory!==false && !assumptions.some(a => (a.id === d.id || d.id.endsWith(':'+a.id)) && a.mandatory === false)));
}
function valueAt(outputs: Record<string, Json>, key: string): Json | undefined {
  if (Object.hasOwn(outputs, key)) return outputs[key];
  let v: Json | undefined = outputs;
  for (const part of key.split('.')) v = v && typeof v === 'object' && Object.hasOwn(v, part) ? (v as Record<string, Json>)[part] : undefined;
  return v;
}
/** Publication guard. Unbound prose/claims cannot demonstrate independence from invalid fields. */
export function enforceDiagnostics(result: CertifyResult, assumptions: readonly MethodAssumption[] = []): CertifyResult {
  const diagnostics = result.diagnostics ?? [];
  const failed = blockingDiagnostics(diagnostics, assumptions);
  const blocks = failed.flatMap(d => d.blocks);
  const invalid = (key: string, visiting = new Set<string>()): boolean => {
    if (blocks.some(b => overlaps(key, b))) return true;
    if (visiting.has(key)) return true;
    return (result.fieldSources?.[key] ?? []).some(source => source !== key && invalid(source, new Set([...visiting, key])));
  };
  const answers: Record<string, Json> = {};
  for (const d of failed) for (const key of d.valid_alternatives) {
    const value = valueAt({...result.metrics, ...result.outputs ?? {}}, key);
    if (value !== undefined && value !== null && !invalid(key)) answers[key] = value;
  }
  const withheld: string[] = [];
  const claims: ClaimRecord[] = result.claims.map(c => {
    const sources = result.claimSources?.[c.claimId];
    const blocked = blocks.length > 0 && (invalid(c.claimId) || !!c.kind && invalid(c.kind) || !sources?.length || sources.some(s => invalid(s)));
    if (!blocked || c.voided) return c;
    withheld.push(c.claimId);
    return {...c, status:'insufficient-evidence', taskStatus:'insufficient-evidence', reasons:failed.map(d=>`${d.id}: ${d.detail}`), limitations:[...new Set([...c.limitations, 'An invalid primary cannot be published with a caveat.'])]};
  });
  const metrics = Object.fromEntries(Object.entries(result.metrics).filter(([key]) => !invalid(key) && (!blocks.length || result.fieldSources?.[key]?.length || Object.hasOwn(answers, key))));
  function clean(value: Json, key: string): Json | undefined {
    if (blocks.some(b => key === b || key.startsWith(b + '.')) || (result.fieldSources?.[key] && invalid(key))) return undefined;
    if (Array.isArray(value)) return value.map((v,i) => clean(v, key ? `${key}.${i}` : String(i)) ?? null);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).flatMap(([k,v]) => { const next=clean(v,key ? `${key}.${k}` : k); return next === undefined ? [] : [[k,next]]; }));
    return value;
  }
  const line = failed.length ? `Diagnostic integrity: ${failed.map(d => `${d.id} (${d.status}) blocked ${d.blocks.join(', ')}`).join('; ')}. Official answers: ${Object.keys(answers).join(', ') || 'inconclusive (no computed valid alternative)'}.` : 'Diagnostic integrity: no outputs blocked by supplied trusted diagnostics.';
  const diagnosticIntegrity: DiagnosticIntegrity = {blocked:failed.map(d=>({id:d.id,status:d.status,blocks:[...d.blocks],detail:d.detail})),officialAnswers:answers,withheldClaims:withheld,line};
  return {...result, claims, metrics, ...(result.outputs ? {outputs:clean(result.outputs,'') as Record<string,Json>} : {}), diagnosticIntegrity,
    report:failed.length ? `${line}\n${JSON.stringify(answers, null, 2)}\n${claims.map(c=>`${c.claimId}: ${c.status}`).join('\n')}` : result.report};
}
