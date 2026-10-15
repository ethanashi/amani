"""p16 grading: the one implementation behind grade-task.sh, `python -m biotasks grade` and
`python -m biotasks.recovery_grade`.

A not-exercised attempt (successful completion before the progress-triggered interruption) is
excluded and must be rerun with a new attempt ID; it gets null task/science scores, never a recovery
or science failure. Exclusion requires the shared `recovery.excluded_candidate` predicate (bound
receipt recording a zero-exit completion, complete schema-valid deliverables in the collected
workdir) plus grader-side completion evidence: this task's staged inputs, untouched data, no
contamination, and a sandboxed re-run of run_all.sh (bio-baseline grade.py, reused) that exits 0 and
reproduces the claimed results. Every other attempt is graded normally and counts in the
denominator. The p16 check.py refuses to produce verdicts for an exclusion candidate, so no path can
turn one into a recovery/science verdict. No key is read for the exclusion decision.
"""
import argparse
import json
import shutil
import sys
from pathlib import Path
from . import calibrate, grading, sealing, staging
from .card import load_card
from .paths import TASKS
sys.path.insert(0,str(TASKS/'p16-recovery'))
sys.path.insert(0,str(TASKS/'p1-esr1'))
from recovery import excluded_candidate  # noqa: E402
import grade  # noqa: E402  (bio-baseline grade.py, made importable by grading)

TASK='p16-recovery'


def completion_evidence(attempt,stage,card,cap_sec):
    """Grader-side proof that a not-exercised attempt really completed (no key involved)."""
    meta=grade.load_json(attempt/'meta.json') or {}
    work=attempt/'workdir'
    problems=list(grading.inputs_match(attempt,stage))
    if meta.get('task_id') not in (None,card['id']) or meta.get('task_manifest_sha256') not in (None,card['datasetManifestHash']):
        problems.append('meta names a different task or manifest')
    if meta.get('data_modified') not in (False,'false'):
        problems.append('data modified or unknown')
    tr=grade.scan_transcript(attempt/'transcript.jsonl',blank=meta.get('worktmp'))
    flag=str(meta.get('contaminated') or '')
    if (tr['web'] or tr['outside_workdir'] or flag.startswith('CONTAMINATED') or not tr['available']
            or flag in ('','audit-error','no-transcript')):
        problems.append('contamination not ruled out')
    rerun_dir=attempt/'grade'/'rerun'
    if rerun_dir.exists(): shutil.rmtree(rerun_dir)
    rr=grade.rerun(attempt,stage/'data',cap_sec,rerun_dir) if not problems else {'ran':False,'reason':'not attempted'}
    if not grade.successful_rerun(rr):
        problems.append('re-run failed, timed out, or cleanup unavailable')
    else:
        claimed=grade.load_json(work/'results.json'); again=grade.load_json(rerun_dir/'results.json')
        bad,compared=grade.compare_numbers(claimed,again) if claimed is not None and again is not None else (['missing'],0)
        if bad or compared==0 or grading.claims_view(claimed)!=grading.claims_view(again):
            problems.append('re-run did not reproduce the claimed results')
    return {'ok':not problems,'problems':problems,
            'rerun':{k:rr.get(k) for k in ('ran','exit_code','timed_out','tmp_deleted','wall_ms')}}


def exclusion(attempt,evidence):
    """The exclusion summary, or None when the attempt must be graded as an ordinary attempt."""
    if not (excluded_candidate(attempt) and isinstance(evidence,dict) and evidence.get('ok') is True):
        return None
    return {'task':TASK,'attempt':attempt.name,'credited':False,'task_passed':None,
            'science_passed':None,'recovery_outcome':'not-exercised','excluded':True,
            'rerun_required':True,'reason':'completed before progress-triggered interruption',
            'completion':{'deliverables':True,'reproduced':True,'rerun':evidence['rerun']}}


def grade_p16(attempts,cap_sec=3600):
    td=TASKS/TASK; card=load_card(td)
    problems=calibrate.check_record(td,card)
    if problems: raise SystemExit(f'refusing to grade {TASK}: '+'; '.join(problems))
    attempts=[Path(a).resolve() for a in attempts]
    evidence={}
    candidates=[a for a in attempts if excluded_candidate(a)]
    if candidates:
        with sealing.scratch('biotasks-grade.') as tmp:
            stage=tmp/'stage'
            if staging.run_stage(td,stage)!=card['datasetManifestHash'] or staging.verify(stage,card['datasetManifestHash']):
                raise SystemExit(f'refusing to grade {TASK}: fresh staging does not match the card')
            for a in candidates: evidence[a]=completion_evidence(a,stage,card,cap_sec)
    rc=0
    for attempt in attempts:
        result=exclusion(attempt,evidence.get(attempt))
        if result:
            out=attempt/'grade'; out.mkdir(exist_ok=True)
            for stale in ('task-grade.json.enc','task-grade.json.enc.sha256'): (out/stale).unlink(missing_ok=True)
            (out/'task-summary.json').write_text(json.dumps(result,sort_keys=True,indent=2)+'\n')
            print(f'{attempt.name}: not-exercised; excluded; rerun required')
            continue
        s=grading.grade_attempts(td,[attempt],cap_sec)[0]
        items=' '.join(f"{i['id']}={i['verdict']}" for i in s['check'].get('items',[])) or 'check-error'
        print(f"{s['attempt']}: credited={s['credited']} task_passed={s['task_passed']} score={s['check'].get('score')} {items}")
        if not s['credited']: print(f"  not credited: {'; '.join(s['not_credited_reasons'])}")
        if s['rerun'].get('ran') and not s['rerun'].get('tmp_deleted'): rc=3
    return rc


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('task',choices=[TASK])
    ap.add_argument('attempts',nargs='+',type=Path); ap.add_argument('--rerun-cap-sec',type=int,default=3600)
    a=ap.parse_args()
    return grade_p16(a.attempts,a.rerun_cap_sec)


if __name__=='__main__': sys.exit(main())
