"""Write the public reveals from the owner's retired-case archive.

Run only after the blind papers: this file and the case curation are never
inputs to the manuscript model.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = Path(sys.argv[1]).resolve()
CASES = {
    3: dict(slug='infliximab-response', title='Infliximab response: expression signal and independent cohorts', study='A reproducible pretreatment mucosal-inflammatory-remodeling state is associated with induction-phase anti-tumor necrosis factor non-response in ulcerative colitis', authors='Hongwei Zheng, Xin Zhuang and Wenbiao Chen', year=2026, doi='10.3389/fgene.2026.1845510', field='Transcriptomics / ulcerative colitis', finding='Higher expression in non-responders; detected cohort overlap and loss of adjusted specificity',
        lead='Amani recovered the pretreatment expression signal, detected shared patients across nominal cohorts, and separated the signal from an independently validated predictor. The retired case passed **8/8 criteria**.',
        mapping=[('Inflammatory gut disease', 'Ulcerative colitis'),('Unnamed biologic', 'Infliximab, an anti-TNF treatment'),('Cohort A', 'GSE12251; mucosal-healing response'),('Cohort C', 'GSE16879; mucosal-healing response'),('Cohort D', 'GSE23597; clinical response'),('Dataset B', 'GPL570 probe annotation and MSigDB Hallmark gene sets'),('L24', 'HALLMARK_INFLAMMATORY_RESPONSE'),('PB… / G…', 'Affymetrix probe identifiers / gene symbols'),('S… / U…', 'Biopsy identifiers / patient identifiers')],
        disguise='The disease, drug, studies, accessions, platform and pathway collection were hidden. Probes, genes, samples and patients received consistent keyed tokens; gene sets received keyed category labels, including L24. Rows and matrix columns were permuted. Only annotated probes were retained, and intensities with more than three decimal places were rounded half-even to three decimals. Outcome definitions were paraphrased without their original timing. Duplicate expression profiles remained identical after rounding, so overlap could still be discovered. These changes remove gene-name and accession lookup routes while preserving the expression contrasts and the evidence needed to audit independence. A memorized published pooled effect cannot supply the coded overlapping cohorts, the independent-unit analysis or the masked pathway adjustment.',
        comparisons=[('Non-response expression signal', 'The program was higher in non-responders; published three-cohort pooled Hedges’ g = 1.36 (95% CI 0.83–1.89).', 'Higher in non-responders; pooled Hedges’ g = 1.05425 over two independent, endpoint-compatible folds.'),('Inflammation and interpretation', 'The paper describes substantial overlap with baseline inflammation and remodeling, while retaining adjusted associations in its original cohort analysis.', 'After L24 adjustment, no primary fold met the positive-and-significant outcome criterion. Amani detected overlap between A and D and returned “does-not-hold-up” for the stronger independence/prediction claim.')],
        scope='The grade measures the full retired-case audit, including detecting overlap. It does not mean that Amani endorsed the paper’s claim of three independent replications. The reported 27 overlapping record pairs follow the run’s patient/profile counting rule; they are not 27 distinct patients.',
        data='**Fetch the measurements; redistribute the Hallmark annotation under CC BY 4.0.** The expression matrices and GPL570 annotation come from public GEO records [GSE12251](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE12251), [GSE16879](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE16879), [GSE23597](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE23597) and [GPL570](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GPL570). No dataset-specific redistribution licence was established, so those files are downloaded from GEO. The [GEO disclaimer](https://www.ncbi.nlm.nih.gov/geo/info/disclaimer.html) distinguishes public access from submitters’ rights.\n\nThe bundled [disguised Hallmark membership](hallmark-disguised.tsv.gz) adapts MSigDB Human Hallmark v2024.1.Hs, © Broad Institute, MIT and Regents of the University of California, under [CC BY 4.0 and MSigDB terms](https://www.gsea-msigdb.org/gsea/msigdb_license_terms.jsp). Changes: keyed gene/set names and row permutation. Cite Liberzon et al., *The Molecular Signatures Database hallmark gene set collection* (2015), [10.1016/j.cels.2015.12.004](https://doi.org/10.1016/j.cels.2015.12.004).',
        command='python3 examples/replications/infliximab-response/fetch_data.py'),
    4: dict(slug='factor-xi', title='Factor XI: a stronger venous than arterial association', study='Leveraging genetic predictors of factor XI levels to anticipate results from clinical trials', authors='Iyas Daghlas and Dipender Gill', year=2023, doi='10.1111/ene.15820', field='Human genetics / thrombosis', finding='FXI outcome ordering: strongest protection for VTE, then cardioembolic stroke; bleeding arms inconclusive',
        lead='Amani recovered the ordering of the FXI associations across seven outcomes, with the largest protective estimate for venous thromboembolism. The retired case passed **18/18 criteria**.',
        mapping=[('Exposure E', 'Plasma factor XI (F11 / FXI)'),('Outcome B', 'Venous thromboembolism; GCST90451757'),('Outcome H', 'Cardioembolic stroke; GCST90104541'),('Outcome D', 'Any ischaemic stroke; GCST90104540'),('Outcome C', 'Large-artery stroke; GCST90104542'),('Outcome F', 'Small-vessel stroke; GCST90104543'),('Outcome G', 'Gastrointestinal haemorrhage; GCST90476109'),('Outcome A', 'Intracranial haemorrhage; GCST90479221'),('E exposure source', 'GCST90469165, open plasma F11 pQTL summary statistics'),('V18669175', 'rs2289252, selected lead instrument'),('n1 / n2 / n3 / n4', 'A / C / G / T alleles')],
        disguise='Gene, outcome, consortium, platform and accession names were removed. Dataset letters were assigned without an outcome-order hint. Variant identifiers, chromosome labels and row order were keyed; alleles were consistently recoded as n1–n4. Coordinates were remapped in order with keyed spacing, so original locus coordinates and distances could not identify F11. Before projection, beta and standard error were rounded half-even to four significant digits, allele frequency to two decimals, and p-values were dropped. Each source was re-sliced so row counts did not encode cohort sample sizes. These changes preserve harmonised association estimates and variant ordering while removing the recognizable locus and disease names. Published effect sizes are not the case’s answer: the open exposure source and mandated single-instrument estimator produce different magnitudes.',
        comparisons=[('Venous versus arterial ordering', 'Per SD lower FXI: VTE OR 0.54 (0.49–0.59), any ischaemic stroke OR 0.90 (0.87–0.93).', 'VTE OR 0.59735; any ischaemic stroke OR 0.86914. The ratio of absolute log odds effects was 3.67376, with lower interval bound 2.61136.'),('Stroke subtypes and bleeding', 'Cardioembolic stroke had the largest stroke-subtype association; the published analysis found no increased bleeding signal.', 'Cardioembolic stroke OR 0.74323, ranking after VTE and before any ischaemic stroke. Large-artery, small-vessel and both bleeding outcomes were classified as inconclusive.')],
        scope='This reproduces the direction and ordering of the published associations. It uses open pQTL data and a prespecified single-variant Wald ratio, rather than the publication’s exposure source and multi-variant analysis. The effect sizes and magnitude ratio therefore differ. Inconclusive bleeding estimates do not establish an absence of bleeding risk.',
        data='**Redistribute the disguised summary-statistic tables under CC0 1.0.** All eight inputs are regional slices of GWAS Catalog summary statistics. The case curation records CC0 for each source, and the [Catalog licence policy](https://www.ebi.ac.uk/gwas/docs/about/#licensing-information) states CC0 for summary statistics unless otherwise specified. Accessions are listed in the mapping table. [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) permits redistribution and transformation; these files apply the documented renaming, rounding and coordinate remapping.\n\nThe [data directory](data/) contains the exact served TSVs compressed with deterministic gzip headers. The [data contract](DATA-CONTRACT.json), [original manifest](manifest.json) and [data hashes](data-build.json) describe their contents. Decompress each `.tsv.gz` with `gzip -dk` to recover the served bytes.',
        command=None),
    1: dict(slug='gpnmb-parkinsons', title='GPNMB and Parkinson’s disease risk', study='Integrative clinical and genomic analyses reveal a causal role of GPNMB in the bone-brain axis of Parkinson’s disease', authors='Xingzhi Guo, Peiyao Wei, Wenzhi Shi, Rong Zhou and Rui Li', year=2026, doi='10.1038/s41531-026-01325-8', field='Human genetics / Parkinson’s disease', finding='Higher GPNMB associated with higher Parkinson’s risk in both cohorts, with a weaker replication estimate',
        lead='Amani reproduced the primary GPNMB–Parkinson’s association and its direction in two cohorts, including the weaker replication estimate. The retired case passed **14/16 criteria**.',
        mapping=[('Protein P7', 'GPNMB, glycoprotein non-metastatic melanoma protein B'),('Outcome A', 'Parkinson’s disease'),('Dataset C, protein GWAS', 'Open HELIC WGS pQTL data, Png et al. 2021; GCST90059975'),('Cohort C1 / dataset B', 'IPDGC Parkinson’s meta-analysis; GCST009325'),('Cohort C2 / dataset D', 'FinnGen R12, G6_PARKINSON'),('Dataset A', '1000 Genomes GRCh38 European reference genotypes; 503 individuals'),('V21461189', 'rs199347, prespecified reference instrument'),('V21461927', 'rs75801644, strongest protein-associated variant'),('ind001–ind503', 'Renamed European reference-panel individuals')],
        disguise='The gene, disease, cohorts, study identity and accessions were hidden. Variant and chromosome names received consistent keyed tokens; row order was permuted. Genomic positions were shifted by a shared constant, preserving distances and cross-table alignment while hiding the locus. Alleles, effect sizes, standard errors and p-values were retained; allele frequencies were rounded to four decimals. Cohort-specific file formats were converted to a common schema and source annotation/sample-count columns were removed. Reference individuals were renamed. This preserves the MR and LD calculations while preventing gene/disease-name lookup. The open exposure dataset differs from the publication’s exposure source, so reproducing a published odds ratio from memory would not reproduce the blinded numerical answer.',
        comparisons=[('Primary association', 'The published IVW estimate was OR 1.429 (95% CI 1.245–1.640) per SD higher GPNMB in the IPDGC cohort.', 'Reference-variant Wald log OR 0.52100 (0.34074–0.70126), equivalent to OR 1.684 (1.406–2.016). Direction: higher GPNMB, higher Parkinson’s risk.'),('Replication direction and strength', 'The FinnGen estimate was positive and weaker: OR 1.235 (1.092–1.397).', 'Log OR 0.37155 (0.16938–0.57372), equivalent to OR 1.450 (1.185–1.775); the replication was concordant and weaker.'),('Locus architecture', 'The study concerns genetic evidence at the GPNMB locus.', 'Amani identified multiple protein-association signals and found that the strongest protein variant itself was not associated with the outcome in either cohort.')],
        scope='The reproduced result is the primary association, its positive direction, interval exclusion of the null in both cohorts, and the weaker replication estimate. The blinded case uses the open HELIC exposure and a reference-variant Wald ratio; the paper uses a different exposure dataset and clumped IVW, so numerical equality is not claimed.',
        data='**Fetch-only for the combined input.** The two GWAS Catalog sources use the [Catalog’s CC0 policy](https://www.ebi.ac.uk/gwas/docs/about/#licensing-information). The other inputs are public [FinnGen R12 summary statistics](https://www.finngen.fi/en/access_results) and the [1000 Genomes reference panel](https://www.internationalgenome.org/data). A clear redistribution licence covering the combined staged input was not established, so no measurements or individual genotypes are bundled. The fetcher retrieves only the original public releases and genomic slices, then rebuilds the dosage table and disguise. It never uses the publication’s access-controlled exposure.\n\nFinnGen acknowledgement: we acknowledge the participants and investigators of the FinnGen study. Cite Kurki et al., *FinnGen provides genetic insights from a well-phenotyped isolated population* (2023), [10.1038/s41586-022-05473-8](https://doi.org/10.1038/s41586-022-05473-8).',
        command='packages/bio-baseline/.pixi/envs/default/bin/python examples/replications/gpnmb-parkinsons/fetch_data.py'),
    2: dict(slug='muscle-splicing', title='A muscle splicing signature across tissues and disorders', study='Transcriptome alterations in myotonic dystrophy skeletal muscle and heart', authors='Eric T. Wang, Daniel Treacy, Katy Eichinger, Adam Struck, Joseph Estabrook, Hailey Olafson, Thomas T. Wang, Kirti Bhatt, Tony Westbrook, Sam Sedehizadeh, Amanda Ward, John Day, David Brook, J. Andrew Berglund, Thomas Cooper, David Housman, Charles Thornton and Christopher Burge', year=2019, doi='10.1093/hmg/ddy432', field='RNA splicing / neuromuscular disease', finding='Cross-muscle splicing concordance, comparator overlap and appropriate limits on generalisation',
        lead='Amani reproduced the direction and attenuation of a splicing signature in a second muscle/site, quantified comparator overlap, and preserved the limits imposed by the sampled donors. The retired case passed **12/15 criteria**.',
        mapping=[('Cohort X', 'GSE86356 / DMseq human muscle and heart RNA-seq'),('G0', 'Unaffected controls'),('G1', 'Myotonic dystrophy type 1 (DM1; DMPK repeat expansion)'),('G2', 'Myotonic dystrophy type 2 (DM2; CNBP repeat expansion)'),('G3', 'Duchenne muscular dystrophy (DMD), comparator'),('M12 / M06', 'Tibialis anterior / quadriceps'),('T1 / T2', 'Skeletal / cardiac tissue'),('site1 / site3', 'Original anonymised collection centres A / B'),('E… / S… / DN…', 'Splicing-event coordinates / sample identifiers / anonymised donor identifiers')],
        disguise='Disease names, characteristic genes, muscle names, accessions, authors, platform and study identity were removed. Events, samples and donors received keyed identifiers; muscle, tissue and site labels were recoded, with row and sample-column permutations. The staged PSI matrix excludes comma-valued multi-isoform rows and retains events meeting the discovery coverage rule. PSI values remain the source fractions, already reported to two decimal places; no artificial scaling was applied. The task specifies deterministic median/difference rounding before thresholds. The resulting tables retain splicing contrasts and donor structure while preventing a named-event or disease-signature lookup from supplying the required masked identifiers and data-derived comparisons.',
        comparisons=[('Cross-muscle splicing direction', 'The study reports tissue-specific RNA-processing alterations and a skeletal-muscle splicing signature in myotonic dystrophy.', 'The second muscle/site replicated the direction: Spearman rho 0.67100 and magnitude ratio 0.33333; verdict “replicates”. These are the case-defined reanalysis quantities, not quoted publication point estimates.'),('Specificity and scope', 'The study includes DM1, a limited DM2 group and Duchenne comparator samples.', 'Comparator median f = 0.625; the signature was not disorder-specific under the task rule, while a specific core was identified. DM2 median f = 0.79775. Comparator and related-disorder conclusions were sample-only; discovery and replication were generalisable under the case’s scope rule.')],
        scope='Only reproduced findings are highlighted here. Clinical severity was correctly marked not-testable from the served tables, which omit the required phenotype; that answer is not evidence against the publication’s severity association. The published article does not report point estimates for every case-defined comparison.',
        data='**Fetch-only.** The public source is [GSE86356](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE86356), including its PSI supplement and series metadata. No dataset-specific redistribution licence was established. The [GEO disclaimer](https://www.ncbi.nlm.nih.gov/geo/info/disclaimer.html) allows public access while preserving any submitter rights, so the measurements are downloaded from the original source. The fetcher runs the retired case’s final staging code and replays the published identifier maps and permutations.',
        command='python3 examples/replications/muscle-splicing/fetch_data.py'),
    5: dict(slug='batch-adjustment', title='Batch adjustment: reproducing a statistical artifact', study='Methods that remove batch effects while retaining group differences may lead to exaggerated confidence in downstream analyses', authors='Vegard Nygaard, Einar Andreas Rødland and Eivind Hovig', year=2016, doi='10.1093/biostatistics/kxv027', field='Statistical genomics / batch effects', finding='Both published discovery counts: 2,011 after pre-adjustment; 11 with batch in the model',
        lead='Amani reproduced both published discovery counts in the batch-effect reanalysis: **2,011** from the prior pipeline versus **11** with batch included in the test model. The retired case passed **7/9 criteria**.',
        mapping=[('C10', 'GA.DP: Copaxone / glatiramer acetate treatment'),('C15', 'GA.Q: Glatimer / generic glatiramoid comparison'),('Other C-coded conditions', 'The remaining treatment and control groups in GSE40566'),('A-expression', 'GSE40566 mouse lymphocyte microarray expression; GPL6887'),('A-samples', 'Sample labels joined from GSE40566 and GSE61901'),('Empirical-Bayes location/scale adjustment', 'Parametric ComBat protecting all condition levels'),('batch_01–batch_18', 'Original array-chip identifiers'),('F… / S…', 'Illumina feature/probe identifiers / sample identifiers')],
        disguise='Drug, species, tissue, platform, study, author and accession names were hidden. Probe and sample identifiers were keyed, conditions were recoded C01–C16 and chips batch_01–batch_18. Probe rows and sample columns were permuted. The expression matrix retains the original unnormalised log2 values; no artificial scaling was applied. The task describes the original procedure without naming ComBat or giving the published discovery count. This preserves the unbalanced batch/condition design that causes the artifact while removing drug and study recognition cues. Correctly naming the ten highest-ranked disguised features also requires working with the coded data, rather than reciting the published counts.',
        comparisons=[('Prior pipeline', 'Nygaard et al. reproduced 2,011 differentially expressed features at 5% FDR after quantile normalisation, condition-protecting batch adjustment and limma.', '2,011 features, with the reproduced top-feature set meeting its grading criterion.'),('Sound batch handling', 'Including batch directly in the model reduced the result to 11 features.', '11 features with batch “in-model”; verdict “does-not-hold-up”, cause “batch-adjustment-step”.')],
        scope='This reproduces the published feature-count contrast and its batch-adjustment explanation. The biological setting is a mouse-cell experiment comparing formulations used in multiple sclerosis treatment; it is not a clinical efficacy comparison.',
        data='**Fetch-only.** Inputs come from public GEO [GSE40566](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE40566) and [GSE61901](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE61901). No dataset-specific redistribution licence was established, so no expression matrix is bundled. See the [GEO rights disclaimer](https://www.ncbi.nlm.nih.gov/geo/info/disclaimer.html). The fetcher downloads the unnormalised matrix and both sample-metadata records, runs the case’s label-joining staging code, and recreates the disguised inputs deterministically.',
        command='python3 examples/replications/batch-adjustment/fetch_data.py'),
}


def write_case(i, c):
    out = ROOT / 'examples/replications' / c['slug']
    run = BASE / 'runs' / {2:'tierb-c2-r2',4:'tierb-c4-r2'}.get(i, f'tierb-c{i}')
    task = (run / 'served/TASK.md').read_text().split('\n## Files')[0].rstrip()
    grade = json.loads((run / 'grade.json').read_text())
    mapping = '\n'.join('| ' + a + ' | ' + b + ' |' for a, b in c['mapping'])
    comparisons = '\n'.join('| ' + ' | '.join(row) + ' |' for row in c['comparisons'])
    fetch = ''
    if c['command']:
        fetch = '\n\nFrom the repository root:\n\n```sh\nnice -n 10 ' + c['command'] + '\n```\n\n[Fetcher](fetch_data.py) · [staging code](stage_data.py) · [projection recipe](projection.json.gz) · [data contract](DATA-CONTRACT.json). The recipe records curation name maps and row/column permutations, with measurements read from the original downloads. Every recreated served-file checksum is verified. Pass a destination directory as the first argument to write the data elsewhere.'
    text = f'''# {c['title']}

{c['lead']}

[Blind paper PDF](paper.pdf) · [page-one PNG](paper-page-1.png) · [paper source](paper.md) · [evaluated report](report.json) · [grade](grade.json) · [all retired Tier B cases](../README.md)

![First page of Amani's blind paper](paper-page-1.png)

## The reveal

**{c['study']}.** {c['authors']} ({c['year']}). [DOI: {c['doi']}](https://doi.org/{c['doi']}). The paper linked above was drafted with the disguised names; this reveal was written separately afterwards.

| What Amani saw | Real identity |
|---|---|
{mapping}

## How it was disguised

{c['disguise']}

## Amani's blind result beside the published finding

| Finding | Published finding | Amani's blind result |
|---|---|---|
{comparisons}

{c['scope']}

**Grade: {grade['passed']}/{grade['total']} criteria.** This is the sealed one-shot grade from the final blind run, retained unchanged after retirement. Benchmark criteria and the software kernel's scientific claim labels are distinct: the reading paper preserves the native labels and pending manuscript-review status. It is not an endorsed submission package.

## Data and licence

{c['data']}{fetch}

## The question Amani received

The following is verbatim from the served task, including the disguised data description and analysis instructions. [The complete served task](TASK.md) also includes the file inventory and report-field specification.

<details>
<summary>Read the served question and disguised data description</summary>

````text
{task}
````

</details>

## Records and reproduction

[Paper inputs](paper-input.json) preserve the blinded task, frozen executed code, selected evaluated facts and native scientific claim statuses. [Draft provenance](drafter-provenance.json) records the live Codex call and usage. [Build checks](build.json) record journal/phase-chain, frozen-code, output-snapshot, deliverable and served-manifest checks, PDF hash and zero overfull warnings. The reveal and grading answer were not supplied to the paper drafter.

The original investigation was not rerun or regraded for this showcase. Data staging and document rendering were replayed separately. The paper uses Amani's journal preprint layout; cross-family manuscript review and owner endorsement remain pending.
'''
    (out / 'README.md').write_text(text)


selected = [int(sys.argv[2])] if len(sys.argv) > 2 else [3, 4, 1, 2, 5]
for i in selected:
    write_case(i, CASES[i])

if len(sys.argv) == 2:
    rows = []
    front_rows = []
    labels = {3:'Infliximab response',4:'Factor XI',1:'GPNMB and Parkinson’s',2:'Muscle splicing',5:'Batch adjustment'}
    for i in [3,4,1,2,5]:
        c = CASES[i]
        run = BASE / 'runs' / {2:'tierb-c2-r2',4:'tierb-c4-r2'}.get(i, f'tierb-c{i}')
        g = json.loads((run / 'grade.json').read_text())
        rows.append(f"| [C{i}: {labels[i]}]({c['slug']}/README.md) | [{c['study']}](https://doi.org/{c['doi']}) — {c['authors'].split(',')[0]}{' et al.' if ',' in c['authors'] else ''}, {c['year']} | {c['field']} | {c['finding']} | **{g['passed']}/{g['total']} criteria** | [PDF]({c['slug']}/paper.pdf) · [page 1]({c['slug']}/paper-page-1.png) |")
        front_rows.append(f"| [C{i}: {labels[i]}](examples/replications/{c['slug']}/README.md) | {c['finding']} | **{g['passed']}/{g['total']}** | [PDF](examples/replications/{c['slug']}/paper.pdf) |")
    text = '''# Blind replications

Amani received a research question and public data with the study identity hidden. Disease, gene and variable names were replaced with consistent codes; row and column orders were permuted. Case-specific rounding and coordinate transforms removed numeric fingerprints while preserving the statistical structure needed for the analysis.

Across these **retired Tier B cases**, Amani met **59 of 66 grading criteria on sealed one-shot cases**. The papers keep the disguised names Amani saw. Each reveal connects its blind result to the real study and documents the source data, licence decision and exact task.

| Case | Real study | Field | What Amani reproduced | Grade | Blind paper |
|---|---|---|---|---|---|
''' + '\n'.join(rows) + '''

The suite includes positive associations, replication audits and a published statistical-artifact reanalysis. A full case grade means every case criterion passed; it does not endorse every conclusion in the source publication. For cases with partial grades, the reveals highlight only reproduced findings.

## Read the papers and reproduce the inputs

Every case provides a PDF, first-page PNG, manuscript source, evaluated report and unchanged grade. Papers were drafted retrospectively through Amani’s Codex drafting runtime using only blinded task, frozen executed code and selected run facts. The original investigation and grade were retained. The reveal and grading answer were not supplied to the manuscript model.

The archived certification summaries retain their native scientific claim labels. Those labels are separate from the benchmark criteria. These are reading preprints, with cross-family manuscript review and owner endorsement pending; no submission or endorsement certificate was fabricated.

Factor XI’s disguised summary-statistic inputs are bundled under CC0. The other measurement inputs are fetched from their original public sources and reconstructed with the retired staging code, explicit name maps and deterministic permutations. The Hallmark annotation included with C3 is attributed under CC BY 4.0. Each data route verifies the exact original served-file hashes; no controlled-access data are included.

See [validation and build instructions](VALIDATION.md) and return to [Amani](../../README.md).
'''
    (ROOT / 'examples/replications/README.md').write_text(text)
    front = '''## Blind replications

Amani was given research questions and public data with the study identity hidden: disease, gene and variable names were replaced, rows and columns permuted, and values or coordinates transformed where needed to preserve the relevant statistical structure while removing recognizable fingerprints. It worked blind.

These **retired Tier B cases** scored **59 of 66 grading criteria on sealed one-shot cases**. The blind papers keep the coded names; the reveals show the real studies, disguise methods and reproduced findings.

| Case / real study | What Amani reproduced | Grade | Blind paper |
|---|---|---|---|
''' + '\n'.join(front_rows) + '''

Explore the [full showcase, study reveals and data](examples/replications/README.md). The cases include association replication, audits of stronger publication claims and a reproduced batch-effect artifact.

'''
    main = ROOT / 'README.md'
    content = main.read_text()
    marker = 'Amani turns a research question and public biomedical data into an auditable investigation.'
    if '## Blind replications\n' in content:
        start = content.index('## Blind replications\n')
        end = content.index(marker, start)
        content = content[:start] + content[end:]
    at = content.index(marker)
    content = content[:at] + front + content[at:]
    content = content.replace('[Architecture](#how-it-works) · [Evidence]', '[Blind replications](#blind-replications) · [Architecture](#how-it-works) · [Evidence]')
    content = content.replace('| Sealed held-out Tier B evaluation |', '| Retired Tier B evaluation |')
    main.write_text(content)
