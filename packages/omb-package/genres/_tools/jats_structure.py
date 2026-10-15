#!/usr/bin/env python3
"""Structural measurement of an open-access paper from its JATS XML.

Fetches Europe PMC fullTextXML (or reads a local .xml) and reports STRUCTURE ONLY:
section order and headings, prose word counts per section, abstract format and
length, display-item counts, reference count, statements present, licence.
It never saves exemplar prose. Caption heads are printed only with --show-captions
(to stdout, for classifying figure types by hand) and are never written to --out.

Word-count convention (used by every genre profile and by the structural lint):
  * words = regex tokens [A-Za-z0-9][A-Za-z0-9'.,%/-]* in <p> and <list-item> text;
  * excluded: figure and table wraps (captions and table footnotes included), boxed
    text (boxes are display items), display formulas, numeric citation xrefs
    (ref-type="bibr"), section titles, footnotes; nested lists are counted once;
  * main text = introduction + methods + results + discussion (+ limitations and
    conclusions when they are separate top-level sections). Abstract, key points,
    declarations, acknowledgements, references and supplement are excluded.

Usage:
  python3 jats_structure.py PMC10540836 [--out file.json] [--show-captions]
  python3 jats_structure.py path/to/article.xml
"""
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

XLINK = "{http://www.w3.org/1999/xlink}"
WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'.,%/\-]*")

CANON = [
    # (canonical id, regex on lower-cased heading)
    ("introduction", r"^(\d+\.?\s*)?(introduction|background|introduction and background|rationale)\b"),
    ("methods", r"^(\d+\.?\s*)?((materials? and )?methods?|methodology|patients and methods|study design|online methods|star\W*methods|experimental procedures|methods and materials)\b"),
    ("results", r"^(\d+\.?\s*)?(results?|findings)\b"),
    ("results_discussion", r"^(\d+\.?\s*)?results and discussion\b"),
    ("discussion", r"^(\d+\.?\s*)?(discussion|comment|interpretation)\b"),
    ("limitations", r"^(\d+\.?\s*)?(limitations?|strengths and limitations|study limitations)\b"),
    ("conclusions", r"^(\d+\.?\s*)?(conclusions?|concluding remarks|summary and conclusions?)\b"),
    ("data_availability", r"(data|code|software|materials?)( and (code|data|materials?|software))? (availability|sharing|access)|availability of (data|code)|data statement|resource availability"),
    ("acknowledgements", r"^acknowledg"),
    ("funding", r"^(funding|financial support|role of the funder|grant)"),
    ("contributions", r"author(s'|s’|’s|'s)? contributions?|contributors|credit author"),
    ("competing_interests", r"(competing|conflicts?|declaration) of interests?|competing interests|disclosures?|conflict"),
    ("ethics", r"ethic|consent|institutional review"),
    ("declarations", r"^declarations?$"),
    ("references", r"^references?$|^bibliography"),
    ("supplementary", r"supplement|associated data|additional (files|information)|appendix"),
    ("transparency", r"transparency|patient and public|dissemination|provenance|what is already known|what this study adds|summary box"),
    ("key_points", r"key points|research in context|highlights|in brief|significance"),
]

STATEMENT_PATTERNS = {
    "prospero": r"PROSPERO|CRD42\d+",
    "osf_registration": r"osf\.io/",
    "inplasy": r"INPLASY",
    "prisma": r"\bPRISMA\b",
    "prisma_harms": r"PRISMA[- ]?harms",
    "grade": r"\bGRADE\b",
    "rob2": r"RoB ?2|risk[- ]of[- ]bias (tool|2)|Cochrane risk",
    "strobe_mr": r"STROBE[- ]MR",
    "strobe": r"\bSTROBE\b",
    "tripod": r"TRIPOD",
    "consort": r"CONSORT",
    "mdar": r"\bMDAR\b",
    "arrive": r"\bARRIVE\b",
    "coloc": r"\bcoloc(alis|aliz)ation\b",
    "steiger": r"Steiger",
    "egger": r"Egger",
    "funnel": r"funnel plot",
    "i2": r"\bI ?2\b|I²",
    "zenodo": r"zenodo",
    "github": r"github\.com",
    "figshare": r"figshare",
    "geo": r"\bGSE\d{3,}",
    "cellxgene": r"cellxgene|CZ ?CELLxGENE",
    "depmap": r"DepMap",
    "ethics_waiver": r"(ethic\w* (approval|review)).{0,80}(not required|not needed|waived|exempt)|publicly available.{0,60}(no|not) (ethic|IRB)",
    "patient_public_involvement": r"patient and public involvement|patients? (were|was) not involved",
    "reporting_summary": r"Reporting Summary",
    "ai_disclosure": r"(generative|large language model|ChatGPT|GPT-4|LLM).{0,80}(used|assist|writing|edit)",
}

FIG_KINDS = [
    ("prisma_flow", r"PRISMA|flow ?(diagram|chart)|study selection|selection process|screening"),
    ("forest", r"forest"),
    ("funnel", r"funnel"),
    ("network_geometry", r"network (plot|geometry|diagram)|network of"),
    ("rob_summary", r"risk of bias|risk-of-bias|traffic"),
    ("surrogacy_scatter", r"surrogate|surrogacy|trial-level|prediction (band|interval)"),
    ("mr_scatter", r"scatter"),
    ("leave_one_out", r"leave[- ]one[- ]out"),
    ("regional_locuszoom", r"regional|locuszoom|locus zoom|locus plot|stacked"),
    ("phewas", r"phe-?was|phenome"),
    ("study_design_schematic", r"study design|overview of|schematic|workflow|pipeline|framework|architecture|outline"),
    ("umap_tsne", r"\bumap\b|t-?sne|embedding"),
    ("heatmap", r"heat ?map"),
    ("dotplot", r"dot ?plot|bubble"),
    ("volcano", r"volcano"),
    ("waterfall_rank", r"waterfall|rank(ed|ing)"),
    ("kaplan_meier", r"kaplan|survival curve"),
    ("bar_benchmark", r"benchmark|accuracy|success rate|score|performance|ablation"),
    ("violin_box", r"violin|box ?plot"),
]


def fetch(src):
    if src.lower().endswith(".xml"):
        return open(src, "rb").read()
    pmcid = src if src.upper().startswith("PMC") else "PMC" + src
    url = f"https://www.ebi.ac.uk/europepmc/webservices/rest/{pmcid}/fullTextXML"
    req = urllib.request.Request(url, headers={"User-Agent": "omerta-genre-profiler/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def text_of(el, drop_bibr=True, keep_tails=True):
    """Prose text of an element, excluding floats, formulas and numeric citations."""
    parts = []

    def walk(e):
        tag = e.tag if isinstance(e.tag, str) else ""
        if tag in ("fig", "table-wrap", "disp-formula", "fig-group", "table-wrap-group",
                   "title", "label", "fn", "fn-group", "supplementary-material", "graphic",
                   "media", "boxed-text"):
            # boxed-text is reported separately; its words are not main text
            if e.tail:
                parts.append(e.tail)
            return
        if tag == "xref" and drop_bibr and e.get("ref-type") == "bibr":
            if e.tail:
                parts.append(e.tail)
            return
        if e.text:
            parts.append(e.text)
        for c in e:
            walk(c)
        if e.tail:
            parts.append(e.tail)

    walk(el)
    s = " ".join(parts)
    # strip leftover bracketed citation residue like "[, ]" or "(-)"
    s = re.sub(r"[\[\(]\s*[,;–\-\s]*[\]\)]", " ", s)
    return s


def words(s):
    return len(WORD.findall(s))


# Subtrees whose words are never prose (captions, table footnotes, boxes, notes).
SKIP_SUBTREES = {"fig", "fig-group", "table-wrap", "table-wrap-group", "boxed-text",
                 "supplementary-material", "fn-group", "fn", "caption", "title", "label",
                 "disp-formula", "ref-list", "media", "graphic", "alternatives"}
# Block-level children that can sit inside a <p> (JATS allows lists and quotes in p).
P_BLOCK_CHILDREN = {"p", "list", "disp-quote", "def-list", "statement", "verse-group"}


def sec_words(el):
    """Prose words under el: each <p> counted once (nested lists counted once),
    nothing inside SKIP_SUBTREES. Subsections are included."""
    n = 0
    for c in el:
        tag = c.tag if isinstance(c.tag, str) else ""
        if tag in SKIP_SUBTREES:
            continue
        if tag == "p":
            n += p_words(c)
        else:
            n += sec_words(c)
    return n


def p_words(p):
    q = ET.Element("p")
    q.text = p.text
    n = 0
    for g in p:
        if g.tag in P_BLOCK_CHILDREN:
            holder = ET.Element("x")
            holder.append(g)
            n += sec_words(holder)
            if g.tail:
                t = ET.Element("span")
                t.tail = g.tail
                q.append(t)
        else:
            q.append(g)
    return n + words(text_of(q, keep_tails=False))


def p_shallow(p):
    """Copy of a <p> without nested block children (used for abstracts)."""
    q = ET.Element("p")
    q.text = p.text
    for c in p:
        if c.tag in P_BLOCK_CHILDREN:
            continue
        q.append(c)
    return q


def classify(title):
    t = (title or "").strip().lower()
    t = re.sub(r"\s+", " ", t)
    if not t:
        return "untitled"
    for cid, rx in CANON:
        if re.search(rx, t):
            return cid
    return "other"


def walk_secs(sec, depth=1, maxdepth=3):
    title = (sec.findtext("title") or "").strip()
    node = {"heading": re.sub(r"\s+", " ", title), "canonical": classify(title), "words": sec_words(sec)}
    kids = [walk_secs(s, depth + 1, maxdepth) for s in sec.findall("sec")] if depth < maxdepth else []
    if kids:
        node["sub"] = kids
    return node


def abstract_info(ab):
    secs = ab.findall("sec")
    w = sum(words(text_of(p_shallow(p))) for p in ab.iter("p"))
    return {
        "type": ab.get("abstract-type") or "main",
        "structured": any((s.findtext("title") or "").strip() for s in secs),
        "headings": [h for h in (re.sub(r"\s+", " ", (s.findtext("title") or "").strip()) for s in secs) if h],
        "words": w,
    }


def caption_head(el, n=12):
    cap = el.find("caption")
    if cap is None:
        return ""
    s = " ".join("".join(cap.itertext()).split())
    return " ".join(s.split()[:n])


def fig_kind(head):
    h = head.lower()
    kinds = [k for k, rx in FIG_KINDS if re.search(rx, h)]
    return kinds[:3] or ["unclassified"]


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(2)
    src = args[0]
    out = args[args.index("--out") + 1] if "--out" in args else None
    show = "--show-captions" in args
    raw = fetch(src)
    root = ET.fromstring(raw)
    meta = root.find("front/article-meta")
    jmeta = root.find("front/journal-meta")

    def mid(kind):
        for a in meta.findall("article-id"):
            if a.get("pub-id-type") == kind:
                return a.text
        return None

    year = None
    for pd in meta.findall("pub-date"):
        y = pd.findtext("year")
        if y:
            year = int(y)
            break
    lic = meta.find("permissions/license")
    licence = None
    if lic is not None:
        licence = lic.get(XLINK + "href") or lic.get("license-type")
        if not licence:
            lp = " ".join("".join(lic.itertext()).split())
            m = re.search(r"(CC[ -]BY[^\s,.;)]*(\s\d\.\d)?|Creative Commons [A-Za-z\- ]+\d\.\d)", lp)
            licence = m.group(0) if m else lp[:80]
    heading = [s.text for s in meta.iter("subject")]

    body = root.find("body")
    back = root.find("back")
    secs = []
    lead_words = 0
    if body is not None:
        for c in body:
            if c.tag == "p":
                lead_words += p_words(c)
        for s in body.findall("sec"):
            secs.append(walk_secs(s))
    if lead_words:
        secs.insert(0, {"heading": "(untitled lead paragraphs)", "canonical": "introduction", "words": lead_words})
    back_secs = []
    if back is not None:
        for s in back.findall("sec"):
            back_secs.append(walk_secs(s, maxdepth=1))
        for a in back.findall("ack"):
            back_secs.append({"heading": a.findtext("title") or "Acknowledgements", "canonical": "acknowledgements", "words": sec_words(a)})
        for fg in back.iter("fn-group"):
            for fn in fg.findall("fn"):
                t = fn.get("fn-type") or (fn.findtext("title") or fn.findtext("label") or "fn")
                back_secs.append({"heading": f"fn:{t}", "canonical": classify(t) if classify(t) != "other" else "fn", "words": 0})
        for nt in back.findall("notes"):
            back_secs.append({"heading": nt.findtext("title") or "notes", "canonical": classify(nt.findtext("title") or ""), "words": 0})
    for nt in root.findall("front/notes"):
        for s in nt.iter("sec"):
            back_secs.append({"heading": s.findtext("title") or "front-notes", "canonical": classify(s.findtext("title") or ""), "words": 0})

    MAIN = {"introduction", "methods", "results", "results_discussion", "discussion", "limitations", "conclusions"}
    BACKMATTER = {"data_availability", "acknowledgements", "funding", "contributions", "competing_interests",
                  "ethics", "declarations", "references", "supplementary", "transparency"}
    # Untitled or unrecognised top-level sections count as main text only while they
    # sit before the first back-matter section and before Discussion/Conclusions
    # (Nature-style descriptive Results headings); after that they are flattened
    # footnotes or declarations.
    totals = {}
    in_back = False
    seen_disc = False
    for s in secs:
        c = s["canonical"]
        if c in BACKMATTER:
            in_back = True
        if c in ("untitled", "other") and seen_disc:
            in_back = True
        if c in ("discussion", "conclusions", "results_discussion"):
            seen_disc = True
        if c in ("untitled", "other"):
            s["counted_as"] = "main:other" if not in_back else "backmatter:other"
            key = "other_main" if not in_back else "other_back"
        else:
            key = c
        totals[key] = totals.get(key, 0) + s["words"]
    main_words = sum(v for k, v in totals.items() if k in MAIN or k == "other_main")
    main_words_ex_methods = main_words - totals.get("methods", 0)

    # limitations: is it a top-level section, a subsection, or neither?
    lim_place = "absent-as-heading"
    lim_words = 0
    for s in secs:
        if s["canonical"] == "limitations":
            lim_place, lim_words = "top-level section", s["words"]
        for ss in s.get("sub", []):
            if ss["canonical"] == "limitations" or "limitation" in ss["heading"].lower():
                lim_place, lim_words = f"subsection of {s['heading']}", ss["words"]

    # floats anywhere outside supplementary-material
    figs, tabs = [], []
    supp_figs = 0
    for f in root.iter("fig"):
        lab = " ".join((f.findtext("label") or "").split())  # also normalises NBSP
        if re.search(r"^(supplementa|extended data|appendix|e?Figure S|Fig\.? ?S\d|Figure S\d|S\d)", lab, re.I):
            supp_figs += 1
            continue
        head = caption_head(f)
        figs.append({"label": lab, "kind_guess": fig_kind(head), **({"caption_head": head} if show else {})})
    for t in root.iter("table-wrap"):
        lab = " ".join((t.findtext("label") or "").split())
        if re.search(r"^(supplementa|appendix|e?Table S|Table S\d|S\d)", lab, re.I):
            continue
        head = caption_head(t)
        tabs.append({"label": lab, **({"caption_head": head} if show else {})})
    boxes = len(list(root.iter("boxed-text")))
    supp = []
    seen_supp = set()
    for sm in root.iter("supplementary-material"):
        lab = " ".join((sm.findtext("label") or "").split())
        # Europe PMC repeats each supplementary node in an "Associated Data" section:
        # de-duplicate by href (or label + caption head when there is no href).
        media = sm.find("media")
        key = (media.get(XLINK + "href") if media is not None else None) or sm.get(XLINK + "href") or (lab, caption_head(sm, 15))
        if key in seen_supp:
            continue
        seen_supp.add(key)
        supp.append({"label": lab, **({"caption_head": caption_head(sm, 15)} if show else {})})

    nref = len(list(root.iter("ref")))
    abstracts = [abstract_info(a) for a in meta.findall("abstract")] + [abstract_info(a) for a in meta.findall("trans-abstract")][:0]

    full = " ".join(root.itertext())
    flags = {k: bool(re.search(rx, full, re.I if k not in ("grade", "prisma", "strobe", "mdar", "arrive") else 0)) for k, rx in STATEMENT_PATTERNS.items()}

    title = " ".join("".join(meta.find("title-group/article-title").itertext()).split())
    # Contamination audit (Amani's own topics must not appear in exemplars):
    # terms are searched in title + abstracts + keywords; only the matched terms are kept.
    CONTAM = re.compile(r"osteoarthrit\w*|arthrit\w*|arthropath\w*|joint (disease|replacement|pain)|\bknee\b|"
                        r"\bgout\b|spondyl\w*|cartilage|amyotrophic|\bALS\b|motor neuron\w*|neurofilament\w*|"
                        r"\bNfL\b|pancrea\w*", re.I)
    front_txt = title + " " + " ".join(" ".join(a.itertext()) for a in meta.findall("abstract")) + " " + \
        " ".join(" ".join(k.itertext()) for k in meta.iter("kwd"))
    contam_front = sorted({m.group(0).lower() for m in CONTAM.finditer(front_txt)})
    contam_body = sorted({m.group(0).lower() for m in CONTAM.finditer(" ".join(body.itertext()) if body is not None else "")})
    res = {
        "pmcid": mid("pmc") or mid("pmcid"),
        "doi": mid("doi"),
        "pmid": mid("pmid"),
        "journal": (jmeta.findtext("journal-title-group/journal-title") or jmeta.findtext("journal-title")) if jmeta is not None else None,
        "year": year,
        "article_type": root.get("article-type"),
        "subject_heading": heading[:3],
        "title_words": words(title),
        "licence": licence,
        "abstracts": abstracts,
        "sections": secs,
        "back_sections": back_secs,
        "section_word_totals": totals,
        "main_text_words": main_words,
        "main_text_words_excluding_methods": main_words_ex_methods,
        "limitations": {"placement": lim_place, "words": lim_words},
        "figures_main": len(figs),
        "figures": figs,
        "figures_supplementary_inline": supp_figs,
        "tables_main": len(tabs),
        "tables": tabs,
        "boxes": boxes,
        "supplementary_files": len(supp),
        "supplementary": supp,
        "references": nref,
        "flags": flags,
        "contamination_title_abstract": contam_front,
        "contamination_body_terms": contam_body,
    }
    if show:
        res["_title"] = title
    js = json.dumps(res, indent=1, ensure_ascii=False)
    if out:
        safe = dict(res)
        safe.pop("_title", None)
        for k in ("figures", "tables", "supplementary"):
            safe[k] = [{kk: vv for kk, vv in d.items() if kk != "caption_head"} for d in safe[k]]
        with open(out, "w") as fh:
            json.dump(safe, fh, indent=1, ensure_ascii=False)
    print(js)


if __name__ == "__main__":
    main()
