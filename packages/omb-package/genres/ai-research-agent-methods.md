# Genre profile: AI research-agent methods / system paper

Slug `ai-research-agent-methods`, built 2026-10-13. JSON: `ai-research-agent-methods.json`. Measurements: `_measurements/ai-research-agent-methods/E1-E9.json`.

**Scope.** Original papers that introduce an LLM-based research agent or multi-agent system for science, describe how it is built, and validate it. Validation means benchmarks against baselines, component ablations, case studies or discoveries (wet-lab confirmed in 4/9), human or LLM-judge evaluation, cost, and safety. Amani's own system paper (PW11) belongs to this genre. Out of scope: benchmark-only papers, reviews, clinical or diagnostic agents, and tools without an agentic loop.

## Exemplars (9, all peer-reviewed, all in PMC JATS)

| ID | Journal | Year | DOI | Licence | Main words (excl. Methods) | Figs/Tables | Refs |
|---|---|---|---|---|---|---|---|
| E1 Coscientist | Nature | 2023 | 10.1038/s41586-023-06792-0 | CC BY 4.0 | 4004 (4004; no main-text Methods) | 6/0 | 52 |
| E2 ChemCrow | Nat Mach Intell | 2024 | 10.1038/s42256-024-00832-8 | CC BY 4.0 | 5272 (3110) | 5/0 | 103 |
| E3 SciAgents | Adv Mater | 2025 | 10.1002/adma.202413523 | CC BY-NC 4.0 | 8755 (6676) | 12/5 | 47 |
| E4 GeneAgent | Nat Methods | 2025 | 10.1038/s41592-025-02748-6 | CC BY 4.0 | 6047 (3126) | 3/3 + glossary box | 59 |
| E5 CRISPR-GPT | Nat Biomed Eng | 2026 | 10.1038/s41551-025-01463-z | CC BY 4.0 | 6931 (3995) | 6/0 | 78 |
| E6 The AI Scientist | Nature | 2026 | 10.1038/s41586-026-10265-5 | CC BY 4.0 | 5158 (2446) | 3/1 | 64 |
| E7 Robin | Nature | 2026 | 10.1038/s41586-026-10652-y | CC BY-NC-ND 4.0 | 7792 (4094) | 4/1 | 62 |
| E8 BioMaster | Patterns (Cell Press) | 2026 | 10.1016/j.patter.2026.101611 | CC BY 4.0 | 7181 (4997) | 7/2 | 58 |
| E9 Agentomics | Bioinformatics (ISMB) | 2026 | 10.1093/bioinformatics/btag250 | CC BY 4.0 | 4951 (2761) | 3/2 + algorithm box | 33 |

Excluded on contamination grounds (Amani's topics in the body): Co-Scientist (Nature 2026; ALS used as the running worked example), AutoBA (pancreatic-islet example data), Biomni (joint-development case study), and Kosmos (pancreatic-islet discovery). Virtual Lab and data-to-paper were left out because they are not open access.

## Canonical order and word ranges (min / typical / max)

Methods-last is the dominant order (7/9).
1. Title: names the system class (9/9); the system name is in the title in 5/9. 6-15 words.
2. Abstract: 100 / 200 / 250 words, one unstructured paragraph (8/9).
3. Introduction: 400 / 600 / 1100. Nature-style papers use an untitled lead.
4. Results: 1150 / 2650 / 4300. Subsections: architecture overview (6/9), benchmark vs baselines (8/9), case study (8/9), per-module demos (3/9), robustness/failure (3/9), human evaluation (2/9), cost (3/9).
5. Discussion, or a closing Conclusion or Limitations section: 150 / 600 / 1300. It covers the contribution summary, limitations (8/9), safety/dual-use (6/9) and outlook.
6. Methods: 2100 / 2450 / 3700. Subsections: implementation (8/8), tools (5/9), evaluation design (6/9), LLM settings (4/9), human-evaluation protocol (3/9), wet-lab methods (2/9), safety (2/9), ethics (2/9).
7. Back matter: data availability, code availability, acknowledgements, contributions, funding, competing interests, optional AI-writing disclosure, references, supplement.

Main text (I+M+R+D+L+C): 4000 / 6050 / 8750 words. Excluding Methods: 2450 / 4000 / 6700. Nature's guide (read 2026-10-13) gives about 2,500 words with 4 display items, or 4,300 words with 5-6, and Methods typically up to 3,000 words.

Order variants:
- Methods last: I-R-D-M (E4, E5, E7, E8).
- Merged Results and discussion, then Conclusion, then Methods (E2, E3).
- Limitations section in place of a Discussion (E6).
- No main-text Methods (E1).
- Numbered IMRaD plus Conclusions (E9).

## Abstract
- Unstructured in 8/9. Bioinformatics uses Motivation / Results / Availability and implementation (E9).
- Required content: the system named and defined (9/9) and its components (9/9).
- Typical content: evaluation scope with counts (6/9) and a concrete demonstration (7/9).
- Optional content: a named comparator (4/9), wet-lab validation (4/9), the backbone LLM (3/9).
- Extra summaries depend on the venue: Nature web summary (6/9); Cell Press highlights, bigger-picture text and eTOC blurb, or Wiley graphical-abstract text (2/9).

## Display items (priority order; 4 / 6 / 17 main items per paper)
- **Required:** `architecture_schematic`, which is Figure 1 in 9/9. `benchmark_comparison` against baselines with error bars, in 8/9 (main text in 7/9).
- **Typical:** `case_study_figure` (7/9) and `validation_panel` (5/9).
- **Optional:** `benchmark_table` (4/9), `ablation_plot` (3/9, often Extended Data), `error_taxonomy` (3/9), `human_eval_plot` (2/9 main), `cost_table` (2/9), `dataset_table` (2/9), `results_table` (2/9), and three new ids: `safety_guardrail_example`, `agent_prompt_figure`, `algorithm_box` (2/9 each).
- Extended Data figures appear in 4/9 (Nature family).

## Required statements
- Data availability (9/9).
- Code availability with an explicit release status (9/9):
  - open in 6/9;
  - an open subset in 1/9;
  - full code withheld for safety in 2/9 (E1, E5).
- Competing interests (9/9; commercial ties in 5/9).
- Funding (9/9).
- Author contributions (8/9).
- LLM backbones named (9/9). Only 3/9 give a dated snapshot ID, 3/9 a training cutoff, and 0/9 an access date.
- Agent transcripts or outputs released (8/9).
- Typical: a safety/dual-use statement (6/9).
- Optional: Reporting Summary (4/9, Nature Portfolio), ethics and consent for human raters (2/9, although 6/9 used human raters), AI-writing disclosure (2/9).

## Checklists
No EQUATOR guideline covers this genre, and 0/9 exemplars cite any checklist. Candidates (all verified):
- TRIPOD-LLM (Nat Med 2025, 10.1038/s41591-024-03425-5)
- REFORMS (Sci Adv 2024, 10.1126/sciadv.adk3452)
- DOME (Nat Methods 2021, 10.1038/s41592-021-01205-4)
- NeurIPS Paper Checklist
- Agentic Benchmark Checklist (arXiv:2507.02825)
- Nature Portfolio Reporting Summary and code/software policy, filed by 4/9

## Supplement
- Supplementary methods/notes (8/9).
- Agent transcripts, generated outputs or demo videos (5/9 in the supplement; 8/9 counting repositories).
- Benchmark task definitions and per-task results (5/9).
- Evaluation rubrics and LLM-judge vs human concordance (4/9).
- Prompts (3/9 in the supplement; withheld in E1 and E5).
- Reporting Summary (4/9), Extended Data (4/9), source data (3/9), extended limitations or failure modes (2/9), peer-review file (2/9).

## References
33 / 59 / 103.

## Limitations conventions
- **Placement:** usually unheaded paragraphs near the end of the Discussion or Conclusion (6/9). One paper has a headed Discussion subsection (E4), one has a top-level Limitations section (E6), and one has none (E1).
- **Length:** 0 / 200 / 650 words.
- **Framing:** written as gaps in the "current implementation" plus future work, often next to a safety paragraph. Fuller analysis sometimes goes to the SI.
- **Standard items:**
  - typical: errors and hallucinations remain, narrow scope, evaluation validity, misuse risk;
  - optional: backbone dependence, human oversight still needed, validation only early-stage, compute dependence.

## Variation
House style drives most of the layout.
- **Nature family:** untitled lead, declarative Results headings, online Methods last, Extended Data.
- **Wiley:** merged Results and discussion, a long Conclusion, Experimental Section last, many figures and no baselines.
- **Cell Press:** highlights plus a Resource availability block.
- **OUP Bioinformatics:** numbered IMRaD and a structured abstract that carries the code URL.

Design also matters. Wet-lab discovery systems (E1, E2, E5, E7) add experimental methods and validation panels. Computational systems (E4, E6, E8, E9) lean on benchmark tables, repeated runs, ablations and cost.

## The 3 most important structural requirements
1. **Figure 1 is the system architecture schematic (9/9).** Results or Methods walk through it: agents, tools, control loop and human touchpoints.
2. **Two evidence pillars:**
   - quantitative evaluation against named baselines, with run-to-run variance (n plus s.d., s.e.m. or CI) (8/9);
   - at least one end-to-end case study or discovery (9/9), externally or experimentally validated where possible.
3. **Transparency block:**
   - LLM backbones named in Methods (Amani should add exact version, access date and cutoff);
   - code availability with an explicit release status;
   - released transcripts or outputs;
   - competing interests;
   - limitations content (8/9) and a safety/dual-use paragraph (6/9).

---
Normalisation pass (coordinator, 2026-10-13): every levelled entry in `ai-research-agent-methods.json` now carries `basis` (frequency, both, or guideline; guideline means required by the reporting guideline although fewer than 80% of exemplars comply). Subsection headings are levelled by how often the heading itself appears, and guideline content is enforced by section elements. Checklists carry a `kind`, Key Points and highlights items are flagged `venue_governed`, and design-dependent items carry `applies_when`. See README.md.
