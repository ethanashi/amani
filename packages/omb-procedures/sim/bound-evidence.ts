/** Return a fail-closed verdict for one requested objective/bound pair. */
export interface BoundPick { corner: string; objective: 'two' | 'one'; K: number; ids: string[] }
export interface BoundEvidence { text: string; pass: boolean; cp: number; id: string }

export function boundEvidenceVerdict(
  picks: readonly BoundPick[],
  corner: string,
  objective: 'two' | 'one',
  K: number,
  required: boolean,
  resolve: (id: string) => { cp: number } | null,
  limit: number,
): BoundEvidence | null {
  if (!required) return null;
  const pick = picks.find(p => p.corner === corner && p.objective === objective && p.K === K);
  if (!pick) return { text: 'pending (missing pick)', pass: false, cp: NaN, id: '' };
  if (pick.ids.length === 0) return { text: 'pending (no candidates)', pass: false, cp: NaN, id: '' };

  let worst: { cp: number; id: string } | null = null;
  let pending = false;
  for (const id of pick.ids) {
    const result = resolve(id);
    if (!result) { pending = true; continue; }
    if (!worst || result.cp > worst.cp) worst = { cp: result.cp, id };
  }
  if (!worst) return { text: 'pending (missing confirmations)', pass: false, cp: NaN, id: '' };
  const passes = worst.cp <= limit && !pending;
  return { text: `${(100 * worst.cp).toFixed(2)}%${passes ? '' : ' FAIL'}${pending ? ' (partial)' : ''}`, pass: passes, cp: worst.cp, id: worst.id };
}
