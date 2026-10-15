#!/usr/bin/env python3
"""Print Markdown tables of the reference numbers (for task/SEALED-ANSWER.md).

  python reference/make_tables.py [reference/output]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "arms" / "lib"))
import seal  # noqa: E402  (read reference outputs whether plaintext or sealed)


def pct(x) -> str:
    return "n/a" if x is None else f"{100 * x:.1f}%"


def g(x) -> str:
    return "n/a" if x is None else f"{x:.3g}"


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent / "output")
    clean = json.loads(seal.read_text_sealed(out / "clean" / "summary.json"))
    arm = json.loads(seal.read_text_sealed(out / "arm" / "summary.json"))
    a, m = clean["analysis_set"], clean["meta_gene"]
    print(f"Analysis set (clean): {a['n_patients']} patients, {a['n_events']} deaths (OS); "
          f"DSS: {a['n_dss_patients']} patients, {a['n_dss_events']} breast-cancer deaths; "
          f"{a['genes_used']} of {a['genes_in_file']} genes (dropped {a['genes_dropped_missing']} with missing "
          f"values, {a['genes_dropped_constant']} constant); duplicate profiles: {a['duplicate_expression_profiles']}.")
    fa = arm["analysis_set"]
    print(f"Analysis set (arm-facing copy, flaw kept): {fa['n_patients']} patients, {fa['n_events']} deaths; "
          f"duplicate profiles: {fa['duplicate_expression_profiles']}.")
    print(f"Cox fitter warnings (clean): {clean.get('cox_fit_warnings')}")
    print()
    print(f"Proliferation meta-gene ({m['n_genes']} genes, seeded by the PAM50 11-gene proliferation score): "
          f"alone HR {g(m['hr_alone'])} per SD, p {g(m['p_alone'])}; 11-gene score alone HR "
          f"{g(m['prolif11_hr_alone'])}, p {g(m['prolif11_p_alone'])}; PCNA-seeded within-dataset meta-gene alone "
          f"HR {g(m['pcna_seeded_hr_alone'])}, p {g(m['pcna_seeded_p_alone'])} (overlap with primary: "
          f"{m['overlap_meta_vs_pcna_seeded']} genes). Top primary genes: {', '.join(m['top_genes'][:10])}. "
          f"Top PCNA-seeded genes: {', '.join(m['pcna_seeded_top_genes'][:10])}.")
    print()
    print("Share of random signatures with Cox p < 0.05 (clean data, 1,000 draws per size; OS unless noted)")
    print()
    print("| size | PC1 | PC1 adj. prolif. meta | PC1 adj. 11-gene | PC1 adj. PCNA-seeded | mean z | mean z adj. meta "
          "| permuted null | DSS PC1 | DSS adj. meta | OS adj. meta + age | flawed copy PC1 |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")
    fl = {r["size"]: r for r in arm["random_signatures"]}
    for r in clean["random_signatures"]:
        print(f"| {r['size']} | {pct(r['share_p05_pc1'])} | {pct(r['share_p05_pc1_adj_meta'])} | "
              f"{pct(r['share_p05_pc1_adj_prolif11'])} | {pct(r['share_p05_pc1_adj_pcna'])} | {pct(r['share_p05_meanz'])} | "
              f"{pct(r['share_p05_meanz_adj_meta'])} | {pct(r['share_p05_permuted'])} | {pct(r['share_p05_dss'])} | "
              f"{pct(r['share_p05_dss_adj_meta'])} | {pct(r['share_p05_pc1_adj_meta_age'])} | "
              f"{pct(fl.get(r['size'], {}).get('share_p05_pc1'))} |")
    print()
    print("Published signatures (clean data; PC1 score; 'random <= published' = share of random signatures of the "
          "same size with p at most the published one)")
    print()
    print("| signature | genes used | p (OS) | p adj. meta | p adj. 11-gene | random <= published | random <= published (adj.) | mean-z p | mean-z p adj. |")
    print("|---|---|---|---|---|---|---|---|---|")
    for name, s in clean["published_signatures"].items():
        print(f"| {name} | {s['n_genes_used']}/{s['n_genes_listed']} | {g(s['p_pc1'])} | {g(s['p_pc1_adj_meta'])} | "
              f"{g(s['p_pc1_adj_prolif11'])} | {pct(s['share_random_same_size_p_le_published'])} | "
              f"{pct(s['share_random_same_size_p_le_published_adj'])} | {g(s['p_meanz'])} | {g(s['p_meanz_adj_meta'])} |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
