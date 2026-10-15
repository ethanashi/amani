import type { ProcedureAssumption, ProcedureDiagnostic } from '../../omb-procedures/src/types.ts';

/** Trusted procedure outputs only. Never call this on a worker-supplied envelope. */
export function certifyProcedureOutputs(
  metadata: { assumptions: readonly ProcedureAssumption[] },
  result: { diagnostics?: readonly ProcedureDiagnostic[] },
  outputs: Readonly<Record<string, unknown>>,
  requested: readonly string[],
) {
  const diagnostics = [...(result.diagnostics ?? [])];
  for (const assumption of metadata.assumptions) {
    if (!diagnostics.some(d => d.id === assumption.id)) diagnostics.push({ id:assumption.id, assumption:assumption.assumption, blocks:[...assumption.blocks],
      status: 'not-evaluable', valid_alternatives: [], detail: 'declared diagnostic missing' });
  }
  if (new Set(diagnostics.map(d => d.id)).size !== diagnostics.length) throw new Error('duplicate procedure diagnostic');
  const active = diagnostics.filter(d => d.status === 'fail' || d.status !== 'pass' &&
    metadata.assumptions.some(a => a.id === d.id && a.mandatory !== false));
  const blocks = [...new Set(active.flatMap(d => [...d.blocks,
    ...(metadata.assumptions.find(a => a.id === d.id)?.blocks ?? [])]))];
  // An ancestor object includes its descendants: it cannot smuggle a blocked field through.
  const overlaps = (a: string, b: string) => a === b || a.startsWith(b + '.') || b.startsWith(a + '.');
  const blocked = (field: string) => blocks.some(b => overlaps(field, b));
  const computed = (field: string) => Object.hasOwn(outputs, field) && outputs[field] !== undefined && outputs[field] !== null;
  const official: Record<string, unknown> = {};
  const refused: string[] = [];
  for (const field of requested) {
    if (!blocked(field) && computed(field)) { official[field] = outputs[field]; continue; }
    const alternatives = active.filter(d => [...d.blocks, ...(metadata.assumptions.find(a => a.id === d.id)?.blocks ?? [])].some(b => overlaps(field, b)))
      .flatMap(d => {
        const rule=metadata.assumptions.find(a=>a.id===d.id);
        return d.status==='fail' ? (rule?.default_rule.on_fail ?? []).filter(a=>rule!.valid_alternatives.includes(a) && d.valid_alternatives.includes(a)) : [];
      }).filter(a => !blocked(a) && computed(a));
    if (!alternatives.length) refused.push(field);
    for (const alternative of alternatives) official[alternative] = outputs[alternative];
  }
  return { status: refused.length ? 'refused' as const : 'certified' as const, official, blocked: blocks, refused, diagnostics };
}
