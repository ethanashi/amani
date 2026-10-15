"""Synthetic biomedical prose written independently of renderer templates.
No source module is read. Each line is a manually authored sentence, not a
Cartesian template expansion. Citations are synthetic frozen fixture evidence.
"""
import json
from pathlib import Path
sections = {
'introduction': '''Motor neuron degeneration can involve disturbances in protein homeostasis [c:source].
Clinical heterogeneity complicates comparisons between referral populations [c:source].
Neuroinflammation has been discussed as a potential contributor to disease progression [c:source].
Our objective was to examine a prespecified research question using an auditable workflow.
Astrocyte responses may influence the local environment of vulnerable neurons [c:source].
The biological rationale is described alongside the assumptions of the study design.
Symptom onset can precede referral to a specialist clinic [c:source].
We distinguish the motivating question from the evidence needed to answer it.
The clinical phenotype includes variation in bulbar and limb involvement [c:source].
ALS remains an important topic for translational research [c:source].
Published descriptions emphasize heterogeneity in clinical presentation [c:source].
The literature describes challenges in translating molecular observations into clinical practice [c:source].''',
'background': '''Prior work describes impaired axonal transport in experimental models of motor neuron disease [c:source].
Clinical descriptions emphasize progressive weakness and functional impairment [c:source].
Published reports describe variation in respiratory involvement during the clinical course [c:source].
The source article discusses altered RNA processing in affected tissues [c:source].
Earlier research describes challenges in distinguishing neuronal changes from glial responses [c:source].
Cerebrospinal fluid has been used to investigate candidate biomarkers of neuronal injury [c:source].
Postmortem tissue studies provide a different view of disease biology from circulating biomarkers [c:source].
We distinguish observations in the literature from predictions to be evaluated.
Specialist clinic populations may differ from community populations in referral pathways [c:source].
A mechanistic hypothesis requires careful definition before empirical evaluation.''',
'methods': '''Blood samples were collected after an overnight fast.
Participants provided written informed consent.
This was an observational study.
The study was approved by the ethics committee.
Samples were staged.
Files were inspected.
Histological sections were prepared using routine staining procedures.
Laboratory staff handled the specimens according to the written processing protocol.
The analytical workflow was implemented in R.
We describe the recruitment setting before presenting the analytical approach.
Clinical histories were reviewed by trained research staff.
Specimens were transferred to labelled storage containers after processing.
Participants completed questionnaires during the study visit.
Tissue sections were examined using brightfield microscopy.
Research staff used a standardized case report form during clinical visits.
The protocol describes the rationale for the analytical choices.
First, files were staged.
We discuss a one-sided test in the methodological rationale.
The cause of death was considered during protocol development.
Matched designs require careful attention to the recruitment setting.
ALS was the focus of the recruitment materials.
The documentation describes how to interpret missing entries.
Data processing was organized into auditable stages.
The clinical questionnaire included information about symptom onset and functional status.''',
'results': '''The presentation follows the order of the research questions.
The accompanying figure presents the distributions alongside the clinical annotations.
Detailed provenance is available alongside the software outputs.
The table separates descriptive information from inferential summaries.
Readers should consider the uncertainty intervals when interpreting the report.
The narrative follows the structure of the analysis plan.
The source documentation accompanies the displayed outputs.
The following section describes the interpretation of the analysis.''',
'discussion': '''Further work is needed to understand the mechanism.
This result should be interpreted with caution.
The biological interpretation remains a question for future research.
A prospective study could clarify the temporal ordering of the relevant processes.
Future experiments might distinguish competing mechanistic hypotheses.
An alternative hypothesis concerns the role of tissue composition.
A mechanistic explanation would require evidence from experimental systems.
Longitudinal sampling could clarify how circulating biomarkers vary during the clinical course.
Experimental work on glial responses could clarify the proposed biological mechanism.
Differences in recruitment practices may complicate transportability.
Additional sampling could help characterize variation across clinical settings.
The interpretation should account for the assumptions of the study design.
Caution is warranted when translating research observations into clinical decisions.
Future work should examine whether the proposed mechanism is biologically plausible.
Published work discusses challenges in evaluating transportability [c:source].
An earlier report describes heterogeneity in symptom presentation [c:source].
The cited review describes competing hypotheses about protein aggregation and cellular stress [c:source].
The source article discusses misclassification in routinely collected diagnostic records [c:source].
A proposed explanation is that tissue composition may influence the biological pathway.
We regard the mechanistic account as a hypothesis for future investigation.''',
'limitations': '''Residual confounding cannot be excluded.
The sample size was small.
Sampling may vary across cohorts.
The interpretation depends on assumptions about the data collection process.
Selection processes may limit the relevance of the findings to other settings.
Recall error could affect the interpretation of questionnaire responses.
Clinical practice may differ across recruitment settings.
Referral pathways may differ between tertiary clinics and community neurology services.
Missing information could complicate assessment of the study population.
The recruitment setting may limit transportability to community populations.
Differences in specimen handling might contribute to analytical variability.
Future studies should assess the relevance of these assumptions.
A broader sampling frame would help assess representativeness.
The interpretation requires caution because observational designs depend on assumptions.
Uncertainty about the data collection process warrants careful consideration.
The research question may require a different design to resolve remaining uncertainty.
Incomplete medication histories may complicate interpretation of circulating biomarker profiles.
Potential sources of bias should be considered alongside the reported evidence.''',
'plain-summary': '''We wanted to understand a question about disease biology.
The report explains what the evidence can tell us about the research question.
Further research could help clarify the biological mechanism.
Readers should consider the limits of the study design.
The methods section explains how the research was organized.
A future study could examine the question in a different setting.
This work concerns a research question rather than advice about individual care.
The report includes explanations of uncertainty and study limitations.
The research team considered the question in the context of clinical epidemiology.
The background section explains why the question matters.''',
'abstract': '''Background: Clinical heterogeneity complicates the study of disease mechanisms.
Methods: We analysed data from a cohort study.
Conclusions: Further research is warranted.
Interpretation: Caution is warranted when considering clinical implications.
Objective: To examine a research question using an auditable analytical workflow.
Context: The biological mechanism remains a topic for future research.
Design: The analytical approach follows the structure of the research question.
Relevance: The work addresses a question in clinical epidemiology.''',
'key-points': '''The research question concerns disease biology.
The analytical approach is described in the methods section.
Study limitations warrant careful consideration.
Future work could clarify the biological interpretation.''',
'title': '''An auditable investigation of a question in clinical epidemiology.
A framework for interpreting observational biomedical research.
Disease biology in the context of clinical epidemiology.
An examination of uncertainty in biomedical research.''',
'caption': '''The diagram illustrates the organization of the analytical workflow.
The shaded area denotes the part of the workflow concerned with data preparation.
The arrows indicate the sequence of processing stages.
The accompanying legend explains the terminology used in the diagram.''',
'alt': '''A flow diagram describes the organization of the analysis.
A schematic illustrates the sequence of data processing stages.
A table presents the structure of the research questions.
A diagram places the analytical steps in their methodological context.'''
}
rows=[]
for region,block in sections.items():
 for text in block.splitlines(): rows.append(dict(id=f'H{len(rows)+1:03}',region=region,text=text,**({'citation':True} if '[c:source]' in text else {})))
# Deliberately retained honest but unsupported assertions. They require software
# input or numeric placeholders, and count against acceptance, not disappear.
for text,reason in [('We enrolled adults aged 18 to 65 years.','typed number'),('Confidence intervals are 95% intervals.','typed unit'),('The analysis was adjusted for age and sex.','fact-bearing procedure'),('Participants were excluded if their data were incomplete.','fact-bearing procedure')]:
 rows.append(dict(id=f'H{len(rows)+1:03}',region='methods',text=text,refusal=reason))
Path('packages/omb-report/test/corpus/honest.json').write_text(json.dumps(rows,indent=2)+'\n')
print(len(rows),'independently authored sentences')
