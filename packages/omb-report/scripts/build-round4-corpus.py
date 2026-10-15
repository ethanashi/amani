"""Authored from biomedical manuscript conventions, independent of renderer templates.
The supplied review does NOT enumerate its 50/76 sets. Extract every quoted repro
verbatim; preserve the source digest and do not pretend missing rows were replayed.
"""
import json,re,hashlib,pathlib,sys
pkg=pathlib.Path(__file__).resolve().parents[1]
review=pathlib.Path(sys.argv[1]); raw=review.read_bytes(); data=json.loads(raw)
rows=[]
def add(region,lines,citation=False):
 for line in lines.strip().split('\n'):
  rows.append(dict(id=f'R4H{len(rows)+1:03}',region=region,text=line+(' [c:source].' if citation else ''),**({'citation':True} if citation else {})))
add('introduction','''Many candidate biomarkers have been proposed in recent years.
Most patients are diagnosed after substantial delay.
Clinical phenotyping remains central to the organization of neurological research.
Referral pathways vary between specialist services and community clinics.
The distinction between susceptibility and progression motivates careful endpoint selection.
Symptoms can evolve during the interval between referral and clinical assessment.
A molecular measurement need not capture the full clinical phenotype.
Patient priorities provide useful context for choosing research questions.
Diagnostic uncertainty complicates the interpretation of routinely collected information.
Environmental histories are often difficult to reconstruct retrospectively.
Mechanistic hypotheses can motivate complementary experimental approaches.
Clinical records reflect the circumstances in which patients seek care.
Recruitment practices may shape the populations represented in research.
A conceptual distinction separates etiological questions from prognostic questions.
Longitudinal observation offers a perspective on changes in functional ability.
Differences in access to specialist services warrant consideration.
The clinical context helps explain the motivation for biomarker research.
Practical questions about sample handling accompany biological questions.
A useful account of disease biology must accommodate clinical diversity.
The research question concerns the relationship between molecular biology and clinical presentation.''')
add('methods','''Missing covariate values were imputed with multiple imputation by chained equations.
Blood pressure was measured with an automated cuff after rest.
Samples were processed in a single batch.
All participants gave consent.
Each sample was run in duplicate.
Both groups were followed with the same schedule.
Multiple imputation was used for missing covariates.
Participants attended a clinical assessment at their local research site.
Venous blood was collected into tubes suitable for downstream processing.
Questionnaires were completed in a quiet room before the interview.
Laboratory staff followed the manufacturer's handling instructions.
Sample labels were checked against the accompanying requisition forms.
Tissue sections were examined using conventional light microscopy.
Clinical histories were obtained during a structured interview.
The questionnaire covered occupational history and current medication use.
Participants could request assistance when completing the study forms.
Data entry screens used descriptive labels for categorical responses.
The analysis script contains comments describing the transformation sequence.
Graphical diagnostics were examined alongside tabulated summaries.
The imputation model used chained equations with appropriate conditional distributions.
A sensitivity analysis considered alternative representations of missingness.
Categorical variables were represented using indicator terms.
Continuous variables were centered to aid interpretation of model coefficients.
Residual plots were inspected for unusual patterns.
The assay targeted α-synuclein in tissue sections.
The staining protocol describes TNF-α localization.
Müller cells were discussed in the histology protocol.
The second-generation assay uses an updated capture reagent.
The laboratory workflow separates preparation from instrumental analysis.
The protocol describes the handling of incomplete questionnaire responses.''')
add('discussion','''Clinical interpretation requires attention to the population and setting.
A plausible biological mechanism may involve altered cellular stress responses.
Future work could examine whether tissue specificity explains differences between clinical settings.
Mechanistic experiments could help distinguish competing explanations.
The clinical relevance of a biomarker depends on its intended use.
Translation into practice would require consideration of costs and patient preferences.
Differences in referral pathways may complicate comparisons across settings.
A distinction between prediction and explanation remains useful for interpretation.
Longitudinal designs may help clarify the temporal ordering of clinical changes.
Research priorities should reflect the needs of affected communities.
Functional experiments could provide complementary information about molecular pathways.
Potential mechanisms include altered metabolism and impaired cellular maintenance.
A mechanistic account would need to explain variation across tissues.
Interpretation should consider the potential for selection processes.
Clinical decisions require information beyond a molecular measurement.
Careful attention to phenotype definitions may aid future comparisons.
Harmonized terminology would facilitate communication across disciplines.
Future investigations could examine the role of environmental exposures.
Replication efforts should consider differences in recruitment and sample handling.
Patient involvement may help identify outcomes that matter in daily life.
The biological question remains suitable for complementary experimental approaches.
Several mechanisms could operate simultaneously in a heterogeneous clinical population.
Many practical barriers separate biomarker discovery from clinical implementation.
Most clinical decisions involve information from several sources.
A broader conceptual framework may help organize future mechanistic work.''')
add('limitations','''Unmeasured confounders could explain part of the association.
Unmeasured confounders could bias the association.
Participants were recruited from a single academic center, which limits generalizability.
Findings from observational data cannot establish causation.
Residual confounding may remain.
Retrospective histories are susceptible to recall error.
Referral populations may differ from patients seen in primary care.
Routine records may incompletely describe changes in medication use.
Measurement error could complicate interpretation of biological variation.
The available clinical descriptions may not capture subtle functional changes.
Generalizability may depend on patterns of access to specialist care.
Missing information may reflect clinical circumstances rather than random omission.
Self-reported histories are vulnerable to imperfect recall.
Differences in specimen handling could contribute to unexplained variability.
Clinical assessments may be sensitive to fatigue and intercurrent illness.
Selection processes could alter the composition of the recruited population.
A single assessment cannot fully characterize a changing clinical condition.
Some sources of uncertainty are difficult to quantify retrospectively.
Vague symptom descriptions may complicate phenotype harmonization.
Multiple imputation depends on assumptions about the missingness process.
Analytical choices may influence the interpretation of incomplete records.
The precision of clinical timing may be limited by documentation practices.
Hospital records may provide incomplete information about community care.
The same questionnaire may be interpreted differently across cultural settings.
A narrow recruitment setting may limit relevance to other populations.''')
add('plain-summary-context','''This study looked at a blood marker and its link to a nerve disease.
A blood sample can provide information about processes taking place in the body.
Researchers use clinical records to describe the people who take part.
A research question is different from advice about personal medical care.
People with the same diagnosis can have different experiences.
Doctors consider symptoms and clinical history alongside laboratory information.
Further work could help explain how disease develops.
The report includes explanations of scientific uncertainty.
Participation involved sharing information about health and daily activities.
Many factors can influence a person's health.
The research team considered how to explain technical terms clearly.
Several possible explanations may deserve further study.
A useful medical test must fit the setting in which it will be used.
The research concerns a biological question that matters to patients.
Most people encounter uncertainty when making decisions about health.''')
add('abstract-background','''Background: Clinical diversity complicates research into disease mechanisms.
Objective: To examine a question about molecular biology and clinical presentation.
Context: Patient experiences provide an important perspective on research priorities.
Rationale: Biological hypotheses can motivate complementary experimental work.
Background: Many candidate biomarkers require careful evaluation.''')
add('abstract-methods','''Methods: Participants attended a clinical assessment.
Methods: Clinical histories were obtained through structured interviews.
Methods: Blood samples were collected using standard laboratory materials.
Methods: Multiple imputation was used for missing questionnaire responses.
Methods: Graphical diagnostics accompanied the statistical analysis.''')
add('discussion','''Earlier work describes heterogeneity in clinical presentation
Published reports discuss differences between referral and community populations
Prior research describes challenges in harmonizing phenotype definitions
Other studies discuss uncertainty in reconstructing environmental histories
Previous work describes experimental models of neuronal stress''',True)
# All eleven main-set sentences actually disclosed in the review are included,
# including the three that conflict with the FINAL structural/number contract.
add('results','''Table 1 summarizes baseline characteristics of the cohort.
Participants who completed follow-up resembled those who did not in most baseline respects.''')
add('discussion','''Our observations are compatible with several mechanisms.''')
add('introduction','''Other studies have linked plasma markers to disease risk.''')
# Explicit expected refusals are evidence, still in the honest denominator.
for r in rows:
 if r['region']=='results':r['refusal']='number|result-bearing'
 if r['text'].startswith('Our observations'):r['refusal']='study result framing'
 if r['text'].startswith('Other studies have linked'):r['refusal']='literature statement'
(pkg/'test/corpus/honest.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False)+'\n')
attacks=[]; extracted=[]
for lens in data['results']:
 if lens['lens']=='honest':continue
 for d in lens['defects']:
  for text in re.findall(r"'([^'\n]*[.!?])'",d['repro']):
   if not text[0].isupper() and not text.startswith('['):continue
   if '...' in text or '[m:..]' in text or text=='[claim:c1].':continue
   extracted.append({'lens':lens['lens'],'title':d['title'],'text':text})
   # Verbatim sentence, default discussion; methods for the procedure lens.
   attacks.append(dict(id=f'R4A{len(attacks)+1:03}',text=text,region='methods' if lens['lens']=='procedure-plan' else 'discussion',status='tentative'))
# The prose lens specifies variants in these regions. Do not claim these are the
# omitted A01..Bxx rows; these are independently reproducible expansions.
for text in ['We found that the marker matters.','The marker causes the disease.','The prediction held.','The finding is reliable.','Our results are clear and encouraging.','The marker tracks the disease.','The hypothesis was borne out.','The result is solid.','Good news: the marker does what we hoped.']:
 for region in ['title','abstract','key-points','plain-summary','results','conclusion','introduction','background']:
  attacks.append(dict(id=f'R4A{len(attacks)+1:03}',text=text,region=region,status='tentative'))
for field,values in {'outcome':['no difference in mortality','unchanged mortality','mortality similar between groups','death rate halved','better survival','lower mortality','prolonged survival','doubling of mortality','tripling of risk','halving of mortality','cured mortality'],'exposure':['statin use lowering LDL','preregistered exposure'],'one_sided_justification':['direction fixed before the look','registered in advance','plan registered on OSF','archived on OSF'],'adjustment':[['covariates chosen before unblinding'],['no adjustment variables'],['better survival'],['exclusion of prior stroke']],'exclusions':[['pre-registered exclusion'],['patients excluded after unblinding']],'controls_source':['a registered biobank','the same hospital after unblinding']}.items():
 for value in values:attacks.append(dict(id=f'R4A{len(attacks)+1:03}',kind='plan',field=field,value=value,text=str(value),region='results',status='tentative'))
(pkg/'test/corpus/adversarial-round4.json').write_text(json.dumps(attacks,indent=2,ensure_ascii=False)+'\n')
(pkg/'test/corpus/round4-review-extract.json').write_text(json.dumps({'source':review.name,'sha256':hashlib.sha256(raw).hexdigest(),'reportedHonest':50,'reportedAttacks':76,'completeOriginalSetsAvailable':False,'explicitQuotedRepros':extracted},indent=2,ensure_ascii=False)+'\n')
print(len(rows),'fresh honest;',len(attacks),'round4 attacks;',len(extracted),'verbatim quoted repros (including repetitions)')
