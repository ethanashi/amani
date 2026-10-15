/** Paired effect/uncertainty summaries have semantic domains, not observed extrema.
 * Generate a weak null independent of real effects, uncertainties and significance.
 * Names alone never grant a structural exemption; an effect/SE pair is required. */
export function summaryDomain(header: readonly string[], name: string, bounds?: Readonly<Record<string, { min?: number; max?: number } | undefined>>): { min: number; max: number } | undefined {
  const effect = /^(beta|effect|estimate)(.*)$/i;
  const uncertainty = /^(se|stderr|standard_error)(.*)$/i;
  const paired = header.filter(h => effect.test(h)).filter(h => {
    const suffix = h.match(effect)![2]!.toLowerCase();
    return header.some(s => s.match(uncertainty)?.[2]?.toLowerCase() === suffix);
  });
  if (!paired.length) return undefined;
  const seName = (h: string) => header.find(s => s.match(uncertainty)?.[2]?.toLowerCase() === h.match(effect)![2]!.toLowerCase())!;
  const seDomain = (h: string) => {
    const b = bounds?.[h];
    const max = b?.max ?? Math.max(0.25, (b?.min ?? 0) * 2);
    const min = b?.min !== undefined && b.min > 0 ? b.min : Math.min(0.05, max / 5);
    return { min, max };
  };
  if (paired.includes(name)) { const limit = seDomain(seName(name)).min / 2; return { min: -limit, max: limit }; }
  if (uncertainty.test(name) && paired.some(h => seName(h) === name)) return seDomain(name);
  if (/^(p|pvalue|p_value)(_[a-z0-9]+)?$/i.test(name)) return { min: 0.5, max: 1 };
  return undefined;
}
