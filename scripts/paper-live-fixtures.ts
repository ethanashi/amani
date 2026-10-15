import {canonicalSha256} from '../packages/bio-core/src/index.ts';
import {manuscriptFixture} from '../packages/omb-drafter/test/fixture.ts';
export const LIVE_CASES=['confirmed','tentative','refuted','insufficient','abstention'] as const;
export type LiveCase=typeof LIVE_CASES[number];
export const liveModels={drafter:{family:'codex' as const,model:'gpt-6-astra',effort:'high'},referee:{family:'claude' as const,model:'claude-opus-4-6',effort:'high'}};
export function liveFixture(name:LiveCase,actualDraftingOnly=false){return manuscriptFixture(undefined,true,p=>{
 (p.lock as any).time_ms=Date.parse('2026-01-01T00:00:00Z');(p.lockedPlan.priorKnowledge as any).frozenIndexHash=canonicalSha256(p.frozenLiteratureIndex);(p.timestamps[0] as any).planHash=canonicalSha256(p.lockedPlan);
 for(const plan of p.lockedPlan.claims as any[])plan.decisionRule={kind:'p-and-ci',alpha:0.0125};
 const ms=(p.runMetadata as any).models;Object.assign(ms[0],{id:liveModels.drafter.model,name:'Codex',provider:'OpenAI',version:liveModels.drafter.model});Object.assign(ms[1],{id:liveModels.referee.model,name:'Claude',provider:'Anthropic',version:liveModels.referee.model});
 if(actualDraftingOnly){const run=p.runMetadata as any;run.models=[{...ms[0],roles:['drafting'],stages:['writing'],usedAt:['2026-10-14'],recallProbe:'Not assessed in this tutorial'}];for(const [stage,cell]of Object.entries(run.aiUse.stages) as [string,any][])Object.assign(cell,{tier:stage==='writing'?'D':'N',humanRole:'none'});(p.ownerConfiguration as any).actions=(p.ownerConfiguration as any).actions.filter((a:any)=>a.action!=='endorsement-review');}
 const mixes:Record<LiveCase,string[]>={confirmed:['confirmed','confirmed','tentative','insufficient-evidence'],tentative:['tentative','confirmed','refuted','insufficient-evidence'],refuted:['refuted','insufficient-evidence','tentative','refuted'],insufficient:['insufficient-evidence','tentative','insufficient-evidence','confirmed'],abstention:['non-identifiable','tentative','refuted','insufficient-evidence']};
 p.plannedFound.found.forEach((found,i)=>{const status=mixes[name][i]!;found.status=status as any;found.classification=status as any;const a=found.assessment as any;a.status=status;a.label.status=status;a.label.requirements=a.label.requirements.map((r:any)=>({...r,passed:status==='confirmed'||r.gate==='G3',outcome:status==='confirmed'||r.gate==='G3'?'passed':'not-run'}));a.label.notPassed=a.label.requirements.filter((r:any)=>!r.passed);a.decision.reason=status==='non-identifiable'?'The exposure is aligned with a measured covariate.':'Synthetic tutorial certification';
 const cert=p.certifications[0]!;Object.assign((cert.certificate as any).certification.assessments[i],a);
 for(const fact of cert.metricGrades.filter(f=>f.claimId===found.claimId)){const suffix=fact.key.slice(found.claimId.length+1);if(suffix==='alpha')fact.value=0.0125;if(['confirmed','tentative'].includes(status)){if(suffix==='p_adjusted')fact.value=0.01;if(suffix==='ci.0'&&Number(fact.value)<=1)fact.value=1.02;}}
 if(status==='refuted')for(const fact of cert.metricGrades.filter(f=>f.claimId===found.claimId)){const suffix=fact.key.slice(found.claimId.length+1);if(suffix==='estimate')fact.value=1;if(suffix==='ci.0')fact.value=0.96;if(suffix==='ci.1')fact.value=1.04;if(suffix==='p_adjusted')fact.value=0.7;}
 if(status==='insufficient-evidence')for(const fact of cert.metricGrades.filter(f=>f.claimId===found.claimId)){const suffix=fact.key.slice(found.claimId.length+1);if(suffix==='ci.0')fact.value=0.7;if(suffix==='ci.1')fact.value=2.1;if(suffix==='p_adjusted')fact.value=0.4;}
 });
 (p.runMetadata as any).numberVerification.certificateHashes=[canonicalSha256(p.certifications[0]!.certificate)];
 });}
