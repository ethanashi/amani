/** Round-three producer survivors plus replacement round-four boundaries. */
export const round4Mutants = [
 [
  "design-wording",
  "checklist-evidence.ts",
  "This was an observational cohort study.",
  "This was a randomized controlled trial of a cohort."
 ],
 [
  "interpretation-wording",
  "checklist-evidence.ts",
  "The findings warrant caution: an observational association does not establish causality.",
  "The findings establish causality beyond reasonable doubt in every population."
 ],
 [
  "generalisability-wording",
  "checklist-evidence.ts",
  "External validity is restricted to the source population; extension to other settings remains uncertain.",
  "The findings generalise to all populations worldwide."
 ],
 [
  "sample-size-wording",
  "checklist-evidence.ts",
  "The available secondary dataset determined the sample size; no prospective power calculation was used.",
  "A prospective power calculation with ninety percent power determined the sample size."
 ],
 [
  "setting-dates",
  "checklist-evidence.ts",
  " from ${s.startDate} to ${s.endDate}.",
  "."
 ],
 [
  "objective-order",
  "checklist-evidence.ts",
  "${c.plan.exposure} in relation to ${c.plan.outcome}",
  "${c.plan.outcome} in relation to ${c.plan.exposure}"
 ],
 [
  "setting-calendar",
  "checklist-evidence.ts",
  "&&new Date(value).toISOString().slice(0,10)===value",
  ""
 ],
 [
  "structure-widened",
  "prose.ts",
  " (?:the|a) structure(?=[.!?]?$)",
  ""
 ],
 [
  "methods-all-regions",
  "methods.ts",
  "const review=assessMethodsNarrative(ctx,prose);",
  "const review=assessMethodsNarrative(ctx,_region==='methods'?prose:'');"
 ],
 [
  "ai-normalization",
  "ai-prose.ts",
  "const key=aiComparisonKey(prose),",
  "const key=prose.toLowerCase(),"
 ],
 [
  "ai-spaced",
  "ai-prose.ts",
  ".join('[\\\\s\\\\p{P}]*');",
  ".join('');"
 ],
 [
  "ai-provenance",
  "ai-prose.ts",
  "names.push(m.name)",
  "(void 0)"
 ],
 [
  "results-mapping",
  "checklist-evidence.ts",
  "'18':'key-results'",
  "'18':'objectives'"
 ],
 [
  "title-mapping",
  "checklist-evidence.ts",
  "'1a':'design-title'",
  "'1a':'design'"
 ],
 [
  "setting-verified",
  "checklists.ts",
  "verified: evidence.verified",
  "verified: true"
 ],
 [
  "setting-owner",
  "checklists.ts",
  "needsOwner: !evidence.verified",
  "needsOwner: false"
 ],
 [
  "paper-sentence-equality",
  "checklists.ts",
  "sentence.text===excerpt",
  "sentence.text.includes(excerpt)"
 ],
 [
  "setting-paper-binding",
  "checklist-evidence.ts",
  "doc.paperHash===ctx.input.sha256&&",
  ""
 ]
] as const;
