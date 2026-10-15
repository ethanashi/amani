import type { TabularDeclaration, ValidityEvidence } from "./validity.ts";

/** Decision input is bounded; complete row/group evidence remains separately available. */
export function findingsSummary(evidence: ValidityEvidence, declarations: TabularDeclaration[]): string {
  const summary = {
    fullFindings: "validity-findings.json", fullFindingsRequiredForDecision: false,
    allowed: evidence.allowed,
    datasets: evidence.datasets.map(d => {
      const declaration = declarations.find(p => p.file === d.file);
      const exact = d.findings.find(f => f.name === "content-duplicates")?.evidence as {
        checked?: boolean; groups?: { ids: string[] }[]; information?: { insufficient: unknown[] }
      } | undefined;
      const distribution: Record<string, number> = {};
      for (const g of exact?.groups ?? []) distribution[g.ids.length] = (distribution[g.ids.length] ?? 0) + 1;
      return { file: d.file, allowed: d.allowed, rowCount: d.rowCount, effectiveN: d.effectiveN,
        checked: exact?.checked === true, exactFullContentGroups: exact?.groups?.length ?? null,
        groupSizeDistribution: distribution, sparseRowsRetained: exact?.information?.insufficient.length ?? null,
        axis: declaration?.sampleAxis ?? null, missingValues: declaration?.missingValues ?? { policy: "refuse" },
        handling: declaration?.handling ?? null,
        // Both group count and ids per group are bounded; identifiers may be long.
        exampleGroups: (exact?.groups ?? []).slice(0, 10).map(g => g.ids.slice(0, 4).map(id => id.slice(0, 80))),
        decision: d.decision.slice(0, 600),
        crossTable: d.findings.find(f => f.name === "cross-table donor confirmation")?.evidence ?? null,
        failedChecks: d.findings.filter(f => !f.passed).map(f => f.name),
      };
    }),
  };
  const bytes = JSON.stringify(summary);
  if (Buffer.byteLength(bytes) >= 10_000) throw new Error("validity decision summary exceeds 10 KB; cannot silently omit datasets");
  return bytes;
}
