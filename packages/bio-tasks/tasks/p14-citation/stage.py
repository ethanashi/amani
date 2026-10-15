#!/usr/bin/env python3
"""Stage p14-citation: a draft manuscript paragraph with ten numbered references and the lab's
offline literature index (synthetic, internally consistent bibliographic records with abstracts).

    stage.py --out DIR [--truth-out FILE]

Deterministic from the card seed (numpy PCG64): same seed, same bytes. Writes
DIR/data/draft_introduction.md, DIR/data/literature_index.tsv, DIR/data/literature_records.jsonl,
DIR/TASK.md and DIR/manifest.json. Generator truth is written only when --truth-out is given, and
only inside the grading root (never into DIR). All records, authors, journals and DOIs are synthetic.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

import numpy as np  # noqa: E402

from biotasks import staging  # noqa: E402

JOURNALS = {
    "jngr": ("Journal of Neurogenetic Research", "10.30412"),
    "dnr": ("Developmental Neurobiology Reports", "10.29871"),
    "hmng": ("Human Molecular Neurogenetics", "10.31563"),
    "scn": ("Stem Cell Neuroscience", "10.32210"),
    "cs": ("Cortex and Synapse", "10.28794"),
    "cndg": ("Clinical Neurodevelopmental Genetics", "10.33017"),
    "tar": ("Translational Autism Research", "10.31746"),
}
SURNAMES = ["Novak", "Haddad", "Lindqvist", "Okafor", "Brennan", "Takahashi", "Moreau", "Kowalczyk", "Iyer",
            "Castellanos", "Fischer", "Adeyemi", "Halvorsen", "Rossi", "Nakamura", "Petrov", "Duarte", "Whitfield",
            "Esposito", "Sandberg", "Mbeki", "Larsen", "Choi", "Varga", "Oyelaran", "Bauer", "Quinn", "Salazar",
            "Kim", "Hoffmann", "Ribeiro", "Abernathy", "Tanaka", "Vasquez", "Lund", "Dimitriou", "Farouk", "Gallo"]
INITIALS = "ABCDEFGHJKLMNPRSTVW"

# The ten cited works, in reference order: (sentence in the draft, journal, year, title, abstract).
# SLOTS_ALT holds an alternative record for some slots: same title style, different findings.
SLOTS = [
    ("CHD8 encodes an ATP-dependent chromatin remodeller of the chromodomain helicase DNA-binding family "
     "that binds the promoters of several thousand actively transcribed genes",
     "hmng", 2015, "Genome-wide occupancy of the chromatin remodeller CHD8 at active promoters in human neural cells",
     "CHD8 is an ATP-dependent chromatin remodeller of the chromodomain helicase DNA-binding (CHD) family. We mapped "
     "CHD8 occupancy by chromatin immunoprecipitation and sequencing in human neural progenitor cells and in "
     "differentiated cortical neurons. CHD8 bound 4,812 promoters in progenitors and 3,950 in neurons. Bound promoters "
     "carried H3K4me3 and were actively transcribed, whereas binding at distal enhancers was rare. Occupancy was "
     "reproducible across three independent cell lines and two antibodies."),
    ("de novo loss-of-function variants in CHD8 are among the most frequently recurrent de novo variants in "
     "exome-sequencing studies of autism",
     "tar", 2016, "Recurrent de novo loss-of-function variants in 6,430 autism trios",
     "We sequenced the exomes of 6,430 parent-child trios in which the child has autism and 2,170 trios with an "
     "unaffected sibling. De novo loss-of-function variants were 2.1-fold more frequent in probands than in "
     "siblings. Fourteen genes carried three or more de novo loss-of-function variants in probands; CHD8, with nine, "
     "had the second highest count after SCN2A. Recurrent genes were enriched for chromatin regulators and synaptic "
     "proteins."),
    ("Carriers frequently present with macrocephaly, distinctive facial features and gastrointestinal problems",
     "cndg", 2017, "Clinical features of 41 individuals with CHD8 loss-of-function variants",
     "We assessed 41 individuals (aged 3-31 years) with heterozygous CHD8 loss-of-function variants recruited "
     "through genetics clinics in five countries. Macrocephaly (head circumference at least 2 SD above the mean) "
     "was present in 31 (76%), distinctive facial features (prominent forehead, wide-set eyes, pointed chin) in 29 "
     "(71%) and gastrointestinal problems, mainly chronic constipation, in 26 (63%). Autism was diagnosed in 35 "
     "(85%) and intellectual disability in 17 (41%). Sleep disturbance was reported by 22 families."),
    ("In mice, heterozygous loss of Chd8 increases brain volume",
     "dnr", 2018, "Megalencephaly in Chd8 haploinsufficient mice",
     "We generated mice carrying a frameshift allele of Chd8. Heterozygous mice were viable and fertile. In adult "
     "mice, magnetic resonance imaging showed a 4.8% larger total brain volume in Chd8+/- animals (n = 18) than in "
     "wild-type littermates (n = 17; 95% CI 2.9 to 6.7%), with the largest increases in the cortex and "
     "hippocampus. Body weight did not differ. Chd8+/- mice also showed mild deficits in novel object "
     "recognition."),
    ("In human neural progenitors, CHD8 directly binds and regulates other genes associated with autism",
     "jngr", 2015, "CHD8 targets are enriched for autism risk genes in human neural progenitors",
     "We combined CHD8 chromatin immunoprecipitation with RNA sequencing after CHD8 knockdown in human neural "
     "progenitor cells. Genes whose promoters were bound by CHD8 were 2.3-fold enriched for high-confidence "
     "autism risk genes. Knockdown of CHD8 changed the expression of 47 bound autism risk genes, most of which "
     "were downregulated, indicating that CHD8 directly regulates other autism-associated genes during "
     "neurodevelopment."),
    ("Knockdown of CHD8 in human iPSC-derived neural progenitors alters the expression of genes involved in "
     "neurodevelopment and Wnt signalling",
     "scn", 2016, "Transcriptional consequences of CHD8 knockdown in human iPSC-derived neural progenitors",
     "We reduced CHD8 expression by about 55% with shRNA in neural progenitor cells derived from induced "
     "pluripotent stem cells of three healthy donors. Knockdown changed the expression of 1,248 genes (false "
     "discovery rate below 0.05). Downregulated genes were enriched for neurodevelopmental processes, including "
     "axon guidance and neuronal differentiation, and for components of the canonical Wnt/beta-catenin pathway."),
    ("In cerebral organoids, CHD8 haploinsufficiency accelerates the development of inhibitory neurons",
     "cs", 2021, "Asynchronous development of inhibitory neurons in CHD8 haploinsufficient cortical organoids",
     "We generated isogenic CHD8+/- and control human cortical organoids from two iPSC lines and profiled them by "
     "single-cell RNA sequencing at one, three and six months. CHD8+/- organoids produced GABAergic interneurons "
     "earlier than controls: at three months interneurons made up 14% of cells in CHD8+/- organoids versus 6% in "
     "controls, a difference that had disappeared by six months. Excitatory neuron development was not "
     "detectably altered."),
    ("Chd8 haploinsufficiency reduces the density of PSD-95-positive excitatory synapses in the mouse cortex",
     "cs", 2019, "Reduced excitatory synapse density in the somatosensory cortex of Chd8 heterozygous mice",
     "We quantified synapses in layer 2/3 of the somatosensory cortex of Chd8+/- mice and wild-type littermates "
     "at postnatal days 14 and 35 (n = 8 per genotype and age). The density of colocalised PSD-95 and VGLUT1 "
     "puncta, marking excitatory synapses, was reduced by 18% in Chd8+/- mice at day 35 and by 11% at day 14. "
     "Inhibitory synapse density was unchanged. Miniature excitatory postsynaptic current frequency was reduced."),
    ("Reduced expression of DLG4, the gene encoding PSD-95, has been reported in post-mortem cortex from "
     "individuals with autism",
     "tar", 2019, "Synaptic gene expression in post-mortem prefrontal cortex in autism",
     "We performed RNA sequencing of post-mortem prefrontal cortex from 48 individuals with autism and 49 "
     "age-matched controls. A co-expression module of synaptic genes was downregulated in autism. Among its hub "
     "genes, DLG4, which encodes PSD-95, was reduced (log2 fold change -0.21, false discovery rate 0.01), as were "
     "SHANK2 and SYNGAP1. Results replicated in an independent set of 21 cases and 20 controls."),
    ("Inhibiting GSK3 restored synapse density in CHD8-deficient human neurons",
     "scn", 2022, "GSK3 inhibition rescues synaptic deficits in CHD8-deficient human cortical neurons",
     "Cortical neurons differentiated from CHD8 heterozygous and knockout iPSC lines had 22% and 30% fewer "
     "colocalised synapsin and PSD-95 puncta than isogenic controls. Because CHD8 loss reduced canonical Wnt "
     "signalling, we treated neurons with the GSK3 inhibitor CHIR99021 for seven days, which restored puncta density "
     "to control levels in both genotypes without changing neuronal survival."),
]
SLOTS_ALT = {
    4: ("dnr", 2018, "Brain size and cortical lamination in Chd8 heterozygous mice",
        "We generated mice carrying a frameshift allele of Chd8. In adult mice, magnetic resonance imaging showed no "
        "difference in total brain volume between Chd8+/- animals (n = 16) and wild-type littermates (n = 15; "
        "difference 0.6%, 95% CI -1.9 to 3.1%). Cortical thickness and the thickness of each cortical layer were "
        "also unchanged. Chd8+/- mice showed mild deficits in novel object recognition."),
    6: ("scn", 2016, "Transcriptional consequences of CHD8 knockdown in human iPSC-derived neural progenitors",
        "We reduced CHD8 expression by about 55% with shRNA in neural progenitor cells derived from induced "
        "pluripotent stem cells of three healthy donors. Knockdown changed the expression of 312 genes (false "
        "discovery rate below 0.05), which were enriched for cell-cycle regulation and RNA processing. We found no "
        "enrichment for neurodevelopmental gene sets or for Wnt pathway components."),
    8: ("cs", 2019, "Excitatory and inhibitory synapse density in the somatosensory cortex of Chd8 heterozygous mice",
        "We quantified synapses in layer 2/3 of the somatosensory cortex of Chd8+/- mice and wild-type littermates "
        "at postnatal days 14 and 35 (n = 8 per genotype and age). The density of colocalised PSD-95 and VGLUT1 "
        "puncta, marking excitatory synapses, did not differ between genotypes at either age. The density of "
        "gephyrin and VGAT puncta, marking inhibitory synapses, was increased by 12% at day 35."),
    9: ("tar", 2019, "Synaptic gene expression in post-mortem prefrontal cortex in autism",
        "We performed RNA sequencing of post-mortem prefrontal cortex from 48 individuals with autism and 49 "
        "age-matched controls. A co-expression module of synaptic genes was downregulated in autism, driven mainly "
        "by SHANK2 and SYNGAP1. DLG4, which encodes PSD-95, did not differ between groups (log2 fold change 0.03, "
        "false discovery rate 0.91). Results replicated in an independent set of 21 cases and 20 controls."),
}
F2_CANDIDATES = (2, 3, 5, 7, 10)

# Uncited records in the same library (topic neighbours).
OTHERS = [
    ("hmng", 2014, "CHD7 haploinsufficiency and the CHARGE syndrome phenotype",
     "We reviewed 112 individuals with CHD7 variants and CHARGE syndrome. Coloboma, choanal atresia and semicircular "
     "canal hypoplasia were the most consistent features. Developmental delay was present in 94% and was more severe with truncating variants."),
    ("jngr", 2017, "De novo CHD2 variants in developmental and epileptic encephalopathy",
     "Among 1,021 individuals with developmental and epileptic encephalopathy, 14 carried de novo CHD2 variants, "
     "most with photosensitive seizures beginning in childhood. Eleven of the 14 had intellectual disability and five met criteria for autism."),
    ("dnr", 2016, "Chd8 regulates intestinal motility through enteric neuron development in zebrafish",
     "Morpholino knockdown of chd8 in zebrafish reduced enteric neuron numbers and slowed intestinal transit, "
     "suggesting a developmental basis for gastrointestinal symptoms. Head size was increased in morphants, and both phenotypes were rescued by human CHD8 mRNA."),
    ("tar", 2018, "A review of chromatin remodelling genes in autism",
     "We review genetic, cellular and animal evidence linking chromatin remodellers, including CHD8, ARID1B and "
     "ADNP, to autism, and discuss convergence on neuronal gene expression programmes. We highlight open questions about dosage sensitivity and developmental timing."),
    ("scn", 2015, "A rapid protocol for cortical neurons from human induced pluripotent stem cells",
     "Dual SMAD inhibition followed by timed growth factor withdrawal produced cortical neurons within 42 days, with "
     "more than 80% MAP2-positive cells across six iPSC lines. Neurons fired action potentials by day 35 and formed spontaneously active networks on multielectrode arrays."),
    ("scn", 2018, "Line-to-line variability in iPSC-derived neuronal transcriptomes",
     "Across 28 iPSC lines from 14 donors, donor identity explained more transcriptomic variance than "
     "differentiation batch, underscoring the need for multiple donors per group. Genes with high donor-specific variance were enriched for known expression quantitative trait loci."),
    ("cs", 2017, "PSD-95 knockout mice show altered synaptic plasticity and social behaviour",
     "Mice lacking PSD-95 showed enhanced long-term potentiation, impaired spatial learning and reduced social "
     "interaction, consistent with roles for PSD-95 in synaptic maturation. Silent synapses persisted into adulthood in knockout cortex."),
    ("cs", 2020, "Developmental regulation of DLG4 transcription by neuronal activity",
     "Neuronal activity increased DLG4 transcription in cultured mouse cortical neurons through a CREB-dependent "
     "promoter element. Blocking action potentials with tetrodotoxin reduced DLG4 mRNA by 35% within 24 hours."),
    ("jngr", 2019, "SCN2A loss-of-function variants and autism: genotype-phenotype correlations",
     "Among 71 individuals with SCN2A variants, loss-of-function variants were associated with autism and "
     "later-onset seizures, whereas gain-of-function variants caused early infantile epilepsy. Sodium channel blockers worsened seizures in loss-of-function carriers."),
    ("hmng", 2020, "SYNGAP1 haploinsufficiency reduces dendritic spine maturation in human neurons",
     "SYNGAP1 heterozygous iPSC-derived neurons showed accelerated spine maturation and increased network activity. Effects were reproduced in two independent patient lines and reversed by gene correction."),
    ("cndg", 2015, "Head circumference trajectories in children with autism",
     "In 512 children with autism, head circumference was larger than population norms in the first two years, "
     "with substantial heterogeneity between individuals. Fewer than 10% met the criterion for macrocephaly at age four."),
    ("dnr", 2020, "Cortical organoids model human interneuron migration",
     "Fused dorsal and ventral forebrain organoids allowed live imaging of interneuron migration over four weeks. Migration speed depended on CXCR4 signalling."),
    ("tar", 2021, "Transcriptome-wide meta-analysis of post-mortem autism cortex",
     "A meta-analysis of five post-mortem cohorts found downregulation of neuronal and synaptic modules and "
     "upregulation of microglial genes in autism cortex. Effect sizes for individual genes were small and heterogeneous between cohorts."),
    ("scn", 2020, "Wnt signalling in human cortical neurogenesis",
     "Activation of canonical Wnt signalling expanded outer radial glia in human cortical organoids. Inhibiting Wnt secretion had the opposite effect."),
    ("hmng", 2018, "CHD8 isoforms and their distinct genomic targets",
     "The long and short CHD8 isoforms bound overlapping promoter sets but differed in their association with "
     "the cohesin complex. The short isoform predominated in the adult brain."),
    ("cs", 2016, "GSK3 inhibition normalises synaptic function in a Fragile X mouse model",
     "Chronic lithium or a selective GSK3 inhibitor normalised dendritic spine density and audiogenic seizures in "
     "Fmr1 knockout mice. Benefits disappeared within two weeks of stopping treatment."),
    ("jngr", 2021, "CHD8 haploinsufficiency alters chromatin accessibility in human neurons",
     "ATAC-seq of CHD8+/- iPSC-derived neurons revealed reduced accessibility at neuronal enhancers enriched for "
     "REST binding motifs. Accessibility changes at these sites correlated with reduced expression of neighbouring synaptic genes."),
    ("cndg", 2019, "Gastrointestinal symptoms in genetically defined autism",
     "Across 1,140 individuals with a genetic diagnosis and autism, constipation was most common in carriers of "
     "variants in chromatin regulators. Symptoms were often undertreated."),
    ("dnr", 2015, "Neural progenitor proliferation in Chd8 mutant mouse embryos",
     "Chd8+/- embryos showed increased proliferation of cortical progenitors at embryonic day 14.5 and a larger "
     "cortical plate at birth. Adult cortical thickness was not measured."),
    ("tar", 2015, "Statistical power in candidate gene studies of autism",
     "Simulations showed that most published candidate gene studies of autism had less than 20% power to detect "
     "realistic effect sizes. We recommend reporting minimum detectable effects alongside null results."),
    ("scn", 2021, "Synapse quantification in human iPSC-derived neurons: a methods comparison",
     "Automated and manual counting of synapsin and PSD-95 puncta agreed closely, but results depended strongly on "
     "culture density and imaging settings. We provide a reporting checklist for puncta quantification."),
    ("cs", 2022, "Inhibitory synapse development in Chd8 mutant mice",
     "Chd8 heterozygous mice showed a transient increase in parvalbumin interneuron synapses during the second "
     "postnatal week. The increase was no longer detectable at postnatal day 35."),
    ("hmng", 2016, "Loss of CHD8 impairs neural crest migration",
     "CHD8 knockdown in human neural crest cells reduced migration in vitro, pointing to a craniofacial "
     "contribution. Migration was rescued by re-expression of CHD8."),
    ("jngr", 2023, "Polygenic background modifies CHD8 variant penetrance",
     "Among 96 CHD8 variant carriers, higher autism polygenic scores were associated with more severe social "
     "communication difficulties. Polygenic scores did not predict head circumference."),
]


def authors(rng: np.random.Generator, k: int) -> list[str]:
    names = rng.choice(len(SURNAMES), k, replace=False)
    return [f"{SURNAMES[i]} {INITIALS[rng.integers(len(INITIALS))]}"
            + (INITIALS[rng.integers(len(INITIALS))] if rng.random() < 0.4 else "") for i in names]


def record(rng: np.random.Generator, journal: str, year: int, title: str, abstract: str, number: int) -> dict:
    name, prefix = JOURNALS[journal]
    volume = year - 2000 + {"jngr": 31, "dnr": 4, "hmng": 18, "scn": 9, "cs": 12, "cndg": 2, "tar": 6}[journal]
    first = int(rng.integers(1, 1800))
    return {"doi": f"{prefix}/{journal}.{year}.{number:04d}", "authors": authors(rng, int(rng.integers(3, 9))),
            "year": year, "title": title, "journal": name, "volume": str(volume),
            "pages": f"{first}-{first + int(rng.integers(6, 18))}", "abstract": abstract}


def generate(seed: int):
    rng = np.random.default_rng(seed)
    f1 = int(rng.choice(sorted(SLOTS_ALT)))
    f2 = int(rng.choice([s for s in F2_CANDIDATES if s != f1]))
    numbers = rng.choice(np.arange(100, 1000), len(SLOTS) + len(OTHERS), replace=False)
    cited = []
    for i, (_sentence, journal, year, title, abstract) in enumerate(SLOTS, start=1):
        if i == f1:
            journal, year, title, abstract = SLOTS_ALT[i]
        cited.append(record(rng, journal, year, title, abstract, int(numbers[i - 1])))
    others = [record(rng, j, y, t, a, int(numbers[len(SLOTS) + k])) for k, (j, y, t, a) in enumerate(OTHERS)]
    library = [r for i, r in enumerate(cited, start=1) if i != f2] + others
    order = rng.permutation(len(library))
    records = []
    for k, idx in enumerate(order, start=1):
        records.append({"record_id": f"LIT-{k:04d}", **library[idx]})
    by_doi = {r["doi"]: r["record_id"] for r in records}
    truth = {"task": "p14-citation", "seed": seed, "unsupportive_ref": f1, "absent_ref": f2,
             "refs": [{"ref": i, "doi": r["doi"], "record_id": by_doi.get(r["doi"], "")}
                      for i, r in enumerate(cited, start=1)]}
    return cited, records, truth


def draft(cited: list[dict]) -> str:
    sentences = [s for s, *_ in SLOTS]
    body = " ".join(f"{s[0].upper()}{s[1:]} [{i}]." for i, s in enumerate(sentences, start=1))
    refs = []
    for i, r in enumerate(cited, start=1):
        au = ", ".join(r["authors"][:6]) + (", et al." if len(r["authors"]) > 6 else "")
        refs.append(f"{i}. {au} ({r['year']}). {r['title']}. {r['journal']} {r['volume']}:{r['pages']}. "
                    f"doi:{r['doi']}")
    return ("# Introduction (draft, first paragraph)\n\n" + body + "\n\n## References\n\n" + "\n".join(refs) + "\n")


def main() -> int:
    a = staging.stage_args()
    card = json.loads((HERE / "card.json").read_text())
    data = staging.prepare_out(a.out)
    truth_out = staging.guard_truth(a.truth_out, a.out)
    cited, records, truth = generate(card["seed"])
    (data / "draft_introduction.md").write_text(draft(cited), encoding="utf-8", newline="\n")
    staging.write_tsv(data / "literature_index.tsv", ["record_id", "doi", "first_author", "year", "title", "journal"],
                      ([r["record_id"], r["doi"], r["authors"][0], str(r["year"]), r["title"], r["journal"]]
                       for r in records))
    with open(data / "literature_records.jsonl", "w", encoding="utf-8", newline="\n") as fh:
        for r in records:
            fh.write(json.dumps(r, ensure_ascii=False, sort_keys=False) + "\n")
    staging.write_truth(truth_out, truth)
    staging.finalize(a.out, HERE, card["id"], card["seed"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
