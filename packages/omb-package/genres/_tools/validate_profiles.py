#!/usr/bin/env python3
"""Validate genre profiles (paper_genres/<slug>.json) against schema genre-profile/1.

Usage:
  python3 validate_profiles.py                 # all profiles in ../
  python3 validate_profiles.py slug [slug...]  # selected profiles
  python3 validate_profiles.py --check-dois    # also resolve every exemplar DOI at doi.org

Exit code 1 if any ERROR. WARN lines do not fail.
"""
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

LEVELS = {"required", "typical", "optional"}
SECTION_IDS = {
    "title", "abstract", "key_points", "plain_summary", "introduction", "methods", "results",
    "results_discussion", "discussion", "limitations", "conclusions", "data_availability",
    "code_availability", "ethics", "funding", "competing_interests", "contributions",
    "acknowledgements", "ai_disclosure", "registration", "references", "supplement", "other",
}
STATEMENT_PLACEMENTS = SECTION_IDS | {"back_matter", "title_page", "cover_letter", "figure_legend"}
ITEM_TYPES = {"figure", "table", "box"}
PLACEMENTS = {"main", "main-or-supplement", "supplement"}
KIND_VOCAB = set("""
study_design_schematic architecture_schematic prisma_flow data_flow forest_plot funnel_plot
rob_summary_figure network_geometry tsa_plot meta_regression_bubble surrogacy_scatter km_curve
mr_scatter mr_leave_one_out regional_association_plot volcano_plot manhattan_plot phewas_plot
embedding_umap marker_dotplot heatmap composition_bar trajectory_plot cnv_heatmap
cell_communication_plot drug_sensitivity_plot dependency_distribution biomarker_association_plot
dependency_drug_scatter network_plot validation_panel benchmark_comparison ablation_plot
case_study_figure human_eval_plot cost_runtime_plot error_taxonomy
characteristics_table sof_table rob_table results_table sensitivity_table instrument_table
coloc_table surrogacy_results_table benchmark_table ablation_table cost_table top_hits_table
dataset_table key_points_box glossary_box highlights_box algorithm_box
arm_level_scatter target_prioritisation_plot bulk_cohort_projection spatial_map
agent_prompt_figure safety_guardrail_example
""".split())
BASES = {"frequency", "guideline", "both"}
CONDITIONS = {"systematic_search", "ipd", "network_ma", "multi_instrument", "proteome_wide",
              "drug_selectivity_claim", "new_wet_lab_data"}
CHECKLIST_KINDS = {"reporting_guideline", "appraisal_tool", "methods_guidance", "venue_form", "venue_policy", "none"}
CONTAMINATION = re.compile(
    r"osteoarthrit|arthrit|arthropath|joint (disease|replacement|pain)|\bknee\b|\bhip (pain|fracture)|"
    r"\bgout\b|spondyl|cartilage|amyotrophic|\bALS\b|motor neuron|neurofilament|\bNfL\b|"
    r"pancrea", re.I)
TOP_KEYS = {
    "schema_version": str, "genre": str, "genre_name": str, "scope": str, "built_on": str,
    "word_count_convention": str, "exemplars": list, "sections": list,
    "section_order_variants": list, "main_text_words": dict, "abstract": dict,
    "display_items": list, "display_items_main_total": dict, "required_statements": list,
    "checklists": list, "supplement": list, "references": dict, "limitations": dict,
    "variation_notes": str, "lint_notes": list, "notes": list,
}

errors, warns = [], []


def err(slug, msg):
    errors.append(f"ERROR [{slug}] {msg}")


def warn(slug, msg):
    warns.append(f"WARN  [{slug}] {msg}")


def check_range(slug, where, r, allow_null=False):
    if r is None:
        if not allow_null:
            err(slug, f"{where}: range is null")
        return
    if not isinstance(r, dict):
        err(slug, f"{where}: range must be an object with min/typical/max")
        return
    for k in ("min", "typical", "max"):
        if k not in r:
            err(slug, f"{where}: missing '{k}'")
            return
        if not isinstance(r[k], (int, float)):
            err(slug, f"{where}.{k} must be a number")
            return
    if not (r["min"] <= r["typical"] <= r["max"]):
        err(slug, f"{where}: need min <= typical <= max, got {r['min']}/{r['typical']}/{r['max']}")


def check_detect(slug, where, pats):
    if pats is None:
        return
    if not isinstance(pats, list):
        err(slug, f"{where}.detect must be a list of regex strings")
        return
    for p in pats:
        try:
            re.compile(p, re.I)
        except re.error as e:
            err(slug, f"{where}.detect bad regex {p!r}: {e}")


def check_level(slug, where, lv, entry=None):
    if lv not in LEVELS:
        err(slug, f"{where}.level must be one of {sorted(LEVELS)}, got {lv!r}")
    if entry is not None:
        aw = entry.get("applies_when")
        if aw is not None and aw not in CONDITIONS:
            err(slug, f"{where}.applies_when {aw!r} not in {sorted(CONDITIONS)}")
        b = entry.get("basis")
        if b not in BASES:
            err(slug, f"{where}.basis must be one of {sorted(BASES)}, got {b!r}")
        elif lv != "required" and b != "frequency":
            err(slug, f"{where}: basis {b!r} only allowed on required entries")


def validate(path, check_dois=False):
    slug = os.path.basename(path)[:-5]
    try:
        p = json.load(open(path))
    except Exception as e:
        err(slug, f"not valid JSON: {e}")
        return
    for k, t in TOP_KEYS.items():
        if k not in p:
            err(slug, f"missing top-level key '{k}'")
        elif not isinstance(p[k], t):
            err(slug, f"'{k}' must be {t.__name__}")
    if p.get("schema_version") != "genre-profile/1":
        err(slug, "schema_version must be 'genre-profile/1'")
    if p.get("genre") != slug:
        err(slug, f"genre '{p.get('genre')}' must equal file slug")
    if not os.path.exists(os.path.join(ROOT, slug + ".md")):
        err(slug, "companion Markdown summary missing")

    ex = p.get("exemplars", [])
    if not (6 <= len(ex) <= 10):
        err(slug, f"need 6-10 exemplars, have {len(ex)}")
    ids = set()
    dois = set()
    for e in ex:
        eid = e.get("id", "?")
        if eid in ids:
            err(slug, f"duplicate exemplar id {eid}")
        ids.add(eid)
        for k in ("citation", "doi", "url", "licence", "journal", "year", "disease_area", "measured", "measurement_method"):
            if k not in e or e[k] in (None, ""):
                err(slug, f"exemplar {eid} missing '{k}'")
        y = e.get("year")
        if isinstance(y, int) and not (2022 <= y <= 2026):
            err(slug, f"exemplar {eid} year {y} outside 2022-2026")
        d = (e.get("doi") or "").lower()
        if d and not d.startswith("10."):
            err(slug, f"exemplar {eid} doi should be bare (10.xxxx/...), got {d}")
        if d in dois:
            err(slug, f"duplicate DOI {d}")
        dois.add(d)
        blob = " ".join(str(e.get(k, "")) for k in ("citation", "disease_area"))
        m = CONTAMINATION.search(blob)
        if m:
            err(slug, f"exemplar {eid} hits contamination term {m.group(0)!r}")
        lic = str(e.get("licence", ""))
        if not re.search(r"CC|Creative Commons|open access|public domain|arXiv|author manuscript", lic, re.I):
            warn(slug, f"exemplar {eid} licence {lic!r} does not look open")
        mf = e.get("measurement_file")
        if mf and not os.path.exists(os.path.join(ROOT, mf)):
            err(slug, f"exemplar {eid} measurement_file {mf} not found")
        meas = e.get("measured") or {}
        for k in ("main_text_words", "figures_main", "tables_main", "references"):
            if k not in meas:
                err(slug, f"exemplar {eid} measured.{k} missing")
        if check_dois and d:
            try:
                req = urllib.request.Request("https://doi.org/api/handles/" + d, headers={"User-Agent": "omerta-genre-profiler/1.0"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    j = json.load(r)
                if j.get("responseCode") != 1:
                    err(slug, f"exemplar {eid} DOI {d} does not resolve (code {j.get('responseCode')})")
            except Exception as x:
                err(slug, f"exemplar {eid} DOI {d} check failed: {x}")

    orders = []
    for s in p.get("sections", []):
        sid = s.get("id")
        if sid not in SECTION_IDS:
            err(slug, f"section id {sid!r} not in vocabulary")
        check_level(slug, f"section {sid}", s.get("level"), s)
        if "order" not in s:
            err(slug, f"section {sid} missing order")
        else:
            orders.append(s["order"])
        check_range(slug, f"section {sid}.words", s.get("words"), allow_null=True)
        for sub in s.get("subsections", []):
            check_level(slug, f"section {sid} > {sub.get('heading')}", sub.get("level"), sub)
            check_range(slug, f"section {sid} > {sub.get('heading')}.words", sub.get("words"), allow_null=True)
            check_detect(slug, f"section {sid} > {sub.get('heading')}", sub.get("aliases_regex"))
        for el in s.get("elements", []):
            check_level(slug, f"section {sid} element {el.get('id')}", el.get("level"), el)
            check_detect(slug, f"section {sid} element {el.get('id')}", el.get("detect"))
    for s in p.get("sections", []):
        if s.get("id") in ("key_points", "plain_summary") and s.get("venue_governed") is not True:
            err(slug, f"section {s.get('id')} must be flagged venue_governed")
    for d in p.get("display_items", []):
        if d.get("id") in ("key_points_box", "highlights_box") and d.get("venue_governed") is not True:
            err(slug, f"display item {d.get('id')} must be flagged venue_governed")
    if len(orders) != len(set(orders)):
        err(slug, "section orders not unique")
    for v in p.get("section_order_variants", []):
        for sid in v.get("order", []):
            if sid not in SECTION_IDS:
                err(slug, f"order variant {v.get('name')} has unknown id {sid}")
        for e in v.get("seen_in", []):
            if e not in ids:
                err(slug, f"order variant {v.get('name')} cites unknown exemplar {e}")

    check_range(slug, "main_text_words", p.get("main_text_words"))
    ab = p.get("abstract", {})
    if ab.get("format") not in {"structured", "unstructured", "either"}:
        err(slug, "abstract.format must be structured|unstructured|either")
    check_range(slug, "abstract.words", ab.get("words"))
    for el in ab.get("elements", []):
        check_level(slug, f"abstract element {el.get('id')}", el.get("level"), el)
        check_detect(slug, f"abstract element {el.get('id')}", el.get("detect"))
    for hs in ab.get("heading_sets", []):
        for e in hs.get("seen_in", []):
            if e not in ids:
                err(slug, f"abstract heading set {hs.get('family')} cites unknown exemplar {e}")

    di_ids = set()
    for d in p.get("display_items", []):
        did = d.get("id")
        if did in di_ids:
            err(slug, f"duplicate display item id {did}")
        di_ids.add(did)
        if d.get("type") not in ITEM_TYPES:
            err(slug, f"display item {did} type must be one of {sorted(ITEM_TYPES)}")
        if d.get("placement") not in PLACEMENTS:
            err(slug, f"display item {did} placement must be one of {sorted(PLACEMENTS)}")
        check_level(slug, f"display item {did}", d.get("level"), d)
        check_range(slug, f"display item {did}.count", d.get("count"))
        check_detect(slug, f"display item {did}", d.get("detect"))
        if not d.get("detect"):
            warn(slug, f"display item {did} has no detect patterns (lint cannot find it)")
        if not isinstance(d.get("priority"), int):
            err(slug, f"display item {did} needs integer 'priority'")
        if did not in KIND_VOCAB:
            warn(slug, f"display item id {did!r} is not in the shared vocabulary (allowed if new; say so in notes)")
    check_range(slug, "display_items_main_total", p.get("display_items_main_total"))

    for st in p.get("required_statements", []):
        check_level(slug, f"statement {st.get('id')}", st.get("level"), st)
        check_detect(slug, f"statement {st.get('id')}", st.get("detect"))
        for pl in st.get("placement", []):
            if pl not in STATEMENT_PLACEMENTS:
                err(slug, f"statement {st.get('id')} placement {pl!r} unknown")
    for c in p.get("checklists", []):
        check_level(slug, f"checklist {c.get('name')}", c.get("level"), c)
        if c.get("kind") not in CHECKLIST_KINDS:
            err(slug, f"checklist {c.get('name')} kind must be one of {sorted(CHECKLIST_KINDS)}")
    pr = [d.get("priority") for d in p.get("display_items", []) if isinstance(d.get("priority"), int)]
    if len(pr) != len(set(pr)):
        err(slug, "display item priorities not unique")
    sup_ids = set()
    for s in p.get("supplement", []):
        check_level(slug, f"supplement item {s.get('item')}", s.get("level"), s)
        if not s.get("id"):
            err(slug, f"supplement item {s.get('item')!r} needs 'id'")
        elif s["id"] in sup_ids:
            err(slug, f"duplicate supplement id {s['id']}")
        sup_ids.add(s.get("id"))
        if not s.get("detect"):
            err(slug, f"supplement item {s.get('id')} needs 'detect'")
        check_detect(slug, f"supplement {s.get('id')}", s.get("detect"))
    check_range(slug, "references", p.get("references"))
    lim = p.get("limitations", {})
    if "placement" not in lim or "conventions" not in lim:
        err(slug, "limitations needs placement and conventions")
    check_range(slug, "limitations.words", lim.get("words"), allow_null=True)
    si = lim.get("standard_items", [])
    if not si:
        err(slug, "limitations.standard_items is empty")
    lids = set()
    for it in si:
        if not isinstance(it, dict) or not it.get("id") or not it.get("text"):
            err(slug, f"limitations.standard_items entries must be objects with id and text, got {str(it)[:60]!r}")
            continue
        if it["id"] in lids:
            err(slug, f"duplicate limitation id {it['id']}")
        lids.add(it["id"])
        check_level(slug, f"limitation {it['id']}", it.get("level"), it)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check_dois = "--check-dois" in sys.argv
    if args:
        paths = [os.path.join(ROOT, a if a.endswith(".json") else a + ".json") for a in args]
    else:
        paths = sorted(os.path.join(ROOT, f) for f in os.listdir(ROOT) if f.endswith(".json"))
    for pth in paths:
        validate(pth, check_dois)
    for w in warns:
        print(w)
    for e in errors:
        print(e)
    print(f"{len(paths)} profile(s): {len(errors)} error(s), {len(warns)} warning(s)")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
