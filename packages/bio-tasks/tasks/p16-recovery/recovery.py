"""Trusted progress-triggered recovery; containment and audit inputs stay host-owned."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time


HERE=Path(__file__).resolve().parent
DELIVERABLES=('results.json','REPORT.md','run_all.sh')


def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def completed_deliverables(work):
    """Answer-free: did the worker finish? Regular, non-empty REPORT.md and run_all.sh, plus a
    results.json that passes the task's public schema. No key or rubric value is consulted."""
    try:
        work=Path(work)
        for name in DELIVERABLES:
            p=work/name
            if p.is_symlink() or not p.is_file() or p.stat().st_size==0: return False
        for lib in (HERE.parents[1]/'lib',HERE.parent/'p1-esr1'):
            if str(lib) not in sys.path: sys.path.append(str(lib))
        from check_support import schema_valid
        return schema_valid('p16-recovery',work)
    except (OSError,ValueError,TypeError): return False


def excluded_candidate(attempt, r=None):
    """The one not-exercised predicate shared by the controller's receipt, check.py and every p16
    grading entry point. True only for a receipt bound to this attempt that records a zero-exit
    completion before the progress trigger, and whose collected workdir independently holds the
    complete deliverables. Anything else is an ordinary attempt that counts in the denominator."""
    try:
        attempt=Path(attempt)
        if r is None:
            p=attempt/'recovery.json'
            if p.is_symlink() or not p.is_file(): return False
            r=json.loads(p.read_text())
        return (isinstance(r,dict) and r.get('outcome')=='not-exercised' and r.get('interrupted') is False
                and r.get('resumed') is False and r.get('first_exit')==0 and r.get('completed') is True
                and not r.get('fixture') and bound_receipt(attempt,r)
                and completed_deliverables(attempt/'workdir'))
    except (OSError,ValueError,TypeError,AttributeError): return False


def valid_receipt(r):
    try:
        return (r['schema']=='bio-tasks/recovery@2' and r['mode'] in ('codex-resume','claude-resume','host-resume')
                and type(r['cap_ms']) is int and r['cap_ms']>0
                and r['trigger']=='observed-progress' and r['interrupted'] is True
                and 0<=r['interrupt_at_ms']<r['cap_ms']
                and r['first_signal']==signal.SIGKILL and r['resumed'] is True
                and r['resume_exit']==0 and r['records_ok'] is True
                and 0<r['remaining_ms']<=r['cap_ms']-r['interrupt_at_ms']+.001
                and r['interrupt_at_ms']<=r['finished_at_ms']<=r['cap_ms'] and r['timed_out'] is False
                and r['outcome']=='exercised')
    except (KeyError,TypeError): return False


def fixture_receipt():
    return {'schema':'bio-tasks/recovery@2','mode':'codex-resume','cap_ms':20,'interrupt_at_ms':2,
            'trigger':'observed-progress','outcome':'exercised','fixture':True,
            'interrupted':True,'first_signal':9,'resumed':True,'resume_exit':0,'records_ok':True,
            'remaining_ms':18,'finished_at_ms':15,'timed_out':False}


def bound_receipt(attempt, r, allow_fixture=False):
    try:
        if r.get('fixture'):
            from biotasks.paths import grading_root
            return (allow_fixture and Path(attempt).resolve().is_relative_to(grading_root())
                    and any(p.name.startswith('biotasks-cal.') for p in Path(attempt).parents))
        meta=json.loads((attempt/'meta.json').read_text())
        return (r['attempt']==meta['attempt'] and r['model']==meta['model']
                and r['cap_ms']==meta['wall_cap_ms']
                and r['mode']==('host-resume' if meta['arm']=='omerta' else meta['arm']+'-resume')
                and r['transcript_sha256']==digest(attempt/'transcript.jsonl')
                and meta['recovery_sha256']==digest(attempt/'recovery.json'))
    except (OSError,KeyError,TypeError,ValueError): return False


def finalize(attempt):
    """Run after collection, before cleanup. Refuse any audit-log replacement."""
    p=attempt/'recovery.json'; r=json.loads(p.read_text())
    meta_path=attempt/'meta.json'; meta=json.loads(meta_path.read_text())
    if meta['arm']=='omerta':
        # Adapter reconstructs the worker transcript from verified host artifacts.
        journal=json.loads((attempt/'omerta/journal.json').read_text())
        if not (meta.get('host_evidence_complete') is True and meta.get('worker_transcript_complete') is True
                and (r['outcome']=='not-exercised' or journal_records_ok(journal))): raise ValueError('host recovery evidence incomplete')
        if digest(attempt/'host-stdout.jsonl')!=r['transcript_sha256']: raise ValueError('host stdout changed')
        r['transcript_sha256']=digest(attempt/'transcript.jsonl')
        p.write_text(json.dumps(r,sort_keys=True)+'\n')
    elif digest(attempt/'transcript.jsonl')!=r['transcript_sha256']: raise ValueError('transcript changed')
    meta['recovery_sha256']=digest(p)
    meta['recovery_outcome']=r['outcome']
    meta_path.write_text(json.dumps(meta,sort_keys=True,indent=2)+'\n')


def unique_records(path):
    def pairs(entries):
        d={}
        for k,v in entries:
            if k in d: raise ValueError('duplicate JSON key')
            d[k]=v
        return d
    try:
        r=json.loads(Path(path).read_text(),object_pairs_hook=pairs)
        claims=r['claims']; ids=[c['id'] for c in claims]
        return bool(ids) and all(isinstance(i,str) and i for i in ids) and len(set(ids))==len(ids)
    except (OSError,ValueError,KeyError,TypeError): return False


def drive(cap_ms,mode,backend,now):
    start=now(); deadline=start+cap_ms/1000
    r={'schema':'bio-tasks/recovery@2','mode':mode,'cap_ms':cap_ms,'trigger':'observed-progress',
       'outcome':'unverified','interrupted':False,'resumed':False,'resume_exit':None,'records_ok':False,'timed_out':False}
    try:
        backend.start(False)
        observed=backend.wait_progress(deadline)
        if not observed:
            r['first_exit']=backend.wait(now())
            early_exit(r,backend,now()<deadline,'before progress trigger')
            if r['outcome']!='not-exercised': r['timed_out']=now()>=deadline
            return r
        r['interrupt_at_ms']=(now()-start)*1000
        killed=backend.kill()
        if killed!=signal.SIGKILL:
            r['first_exit']=getattr(backend,'last_exit',None)
            early_exit(r,backend,now()<deadline,'at progress boundary')
            return r
        r['first_signal']=killed; r['interrupted']=True
        remaining=(deadline-now())*1000; r['remaining_ms']=remaining
        if remaining<=0:
            r['timed_out']=True; return r
        backend.start(True); r['resumed']=True
        r['resume_exit']=backend.wait(deadline)
        if r['resume_exit'] is None:
            r['timed_out']=True; return r
        backend.kill()  # join capture and authenticate logs before records are credited
        r['records_ok']=backend.records_ok(); r['outcome']='exercised'
        return r
    finally:
        backend.kill()
        r['finished_at_ms']=(now()-start)*1000


def early_exit(r,backend,in_time,where):
    """Only a zero-exit run that finished every deliverable is not-exercised (excluded, rerun).
    An early exit without them is an ordinary failed attempt."""
    if r['first_exit']==0 and in_time:
        r['completed']=bool(backend.completed())
        if r['completed']: r.update(outcome='not-exercised',reason=f'completed {where}; exclude and rerun')
        else: r['reason']=f'exited {where} without complete deliverables; ordinary failed attempt'
    else: r['reason']='no progress before exit or cap' if where.startswith('before') else 'process failed at progress boundary'


class ProcessBackend:
    def __init__(self,arm,command,prefix,work,logs,now,protected=()):
        self.arm,self.command,self.prefix,self.work,self.logs,self.now=arm,list(command),list(prefix),work,logs,now
        self.child=None; self.identity=None; self.threads=[]; self.progress=threading.Event()
        self.protected={Path(p):digest(p) for p in protected}
        self.captured={}; self.errors=[]
        self.command_hash=hashlib.sha256(json.dumps([self.command,self.prefix]).encode()).hexdigest()

    def verify(self):
        if self.command_hash!=hashlib.sha256(json.dumps([self.command,self.prefix]).encode()).hexdigest():
            raise ValueError('launch command changed')
        for p,h in {**self.protected,**self.captured}.items():
            if p.is_symlink() or digest(p)!=h: raise ValueError('protected recovery input changed')
        if self.errors: raise ValueError('capture failed')

    def resume_command(self):
        self.verify()
        if self.arm=='omerta': return self.command
        session=None
        for line in (self.logs/'phase1.jsonl').read_text().splitlines():
            try: event=json.loads(line)
            except ValueError: continue
            if self.arm=='codex' and event.get('type')=='thread.started': session=event.get('thread_id')
            if self.arm=='claude' and event.get('type')=='system' and event.get('subtype')=='init': session=event.get('session_id')
        if not isinstance(session,str) or not session or any(c not in '0123456789abcdef-' for c in session.lower()):
            raise ValueError('native resume session unavailable')
        if self.arm=='claude': return [*self.command,'--resume',session]
        cmd=self.command.copy(); cmd.insert(2,'resume')
        for flag in ('-C','--color'):
            if flag in cmd:
                i=cmd.index(flag); del cmd[i:i+2]
        cmd[-1:]=[session,'Continue the interrupted task. Preserve completed work and finish all deliverables.']
        return cmd

    def capture(self,stream,path,events):
        h=hashlib.sha256()
        try:
            with path.open('xb') as out:
                for line in iter(stream.readline,b''):
                    out.write(line); out.flush(); h.update(line)
                    if events:
                        try:
                            e=json.loads(line)
                            tool=(e.get('type') in ('item.started','item.completed') and e.get('item',{}).get('type') in ('command_execution','file_change','mcp_tool_call'))
                            tool=tool or any(c.get('type')=='tool_use' for c in e.get('message',{}).get('content',[]) if isinstance(c,dict))
                            if tool: self.progress.set()
                        except (ValueError,AttributeError,TypeError): pass
            path.chmod(0o400); self.captured[path]=h.hexdigest()
        except Exception: self.errors.append('capture failed')
        finally: stream.close()

    def start(self,resume):
        self.verify()
        cmd=self.resume_command() if resume else self.command
        phase=2 if resume else 1
        # Pipes, not worker-writable files or denied file descriptors. Only the host writes logs.
        self.child=subprocess.Popen([*self.prefix,*cmd],cwd=self.work,stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        self.identity={'pid':self.child.pid,'pgid':self.child.pid,'sid':self.child.pid}
        for stream,suffix,events in ((self.child.stdout,'jsonl',True),(self.child.stderr,'stderr',False)):
            t=threading.Thread(target=self.capture,args=(stream,self.logs/f'phase{phase}.{suffix}',events),daemon=True)
            t.start(); self.threads.append(t)

    def wait_progress(self,deadline):
        while self.now()<deadline:
            if self.progress.is_set(): return True
            if any(p.is_file() for p in (self.work/'outputs').glob('**/*')): return True
            if self.arm=='omerta':
                # HostWorker writes audited tool events outside every model write root.
                authority=self.work.parent/'investigation/authority'
                if any(p.is_file() and p.stat().st_size>0 for p in authority.glob('tools-*.jsonl')): return True
            if self.child.poll() is not None: return False
            self.progress.wait(min(.005,max(0,deadline-self.now())))
        return False

    def wait(self,deadline):
        try: return self.child.wait(timeout=max(0,deadline-self.now()))
        except subprocess.TimeoutExpired: return None

    def kill(self):
        killed=None
        if self.child is not None:
            sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'bio-baseline/arms/lib'))
            from operation import reap_session
            reap_session(self.identity)
            self.child.wait(); self.last_exit=self.child.returncode
            killed=-self.child.returncode if self.child.returncode<0 else None; self.child=None
        for t in self.threads: t.join(timeout=.2)
        if any(t.is_alive() for t in self.threads): self.errors.append('capture incomplete')
        self.threads=[]
        self.verify()
        return killed

    def records_ok(self): return self.arm=='omerta' or unique_records(self.work/'results.json')

    def completed(self): return completed_deliverables(self.work)


def main():
    if sys.argv[1:2]==['finalize']:
        finalize(Path(sys.argv[2])); return 0
    ap=argparse.ArgumentParser()
    ap.add_argument('--arm',choices=['codex','claude','omerta'],required=True)
    ap.add_argument('--cap-ms',type=int,required=True); ap.add_argument('--work',type=Path,required=True)
    ap.add_argument('--logs',type=Path,required=True); ap.add_argument('--receipt',type=Path,required=True)
    ap.add_argument('--meta',type=Path,required=True); ap.add_argument('--protected',action='append',default=[])
    ap.add_argument('--sandbox'); ap.add_argument('command',nargs=argparse.REMAINDER)
    a=ap.parse_args(); cmd=a.command[1:] if a.command[:1]==['--'] else a.command
    if a.sandbox and a.sandbox not in a.protected: a.protected.append(a.sandbox)
    if '--settings' in cmd:
        settings=cmd[cmd.index('--settings')+1]
        if settings not in a.protected: a.protected.append(settings)
    if a.cap_ms<=0 or not cmd: return 2
    if a.logs.resolve().is_relative_to(a.work.parent.resolve()): raise ValueError('logs inside worker root')
    for p in a.protected:
        if Path(p).resolve().is_relative_to(a.work.parent.resolve()): raise ValueError('config inside worker root')
    a.logs.mkdir(parents=True,exist_ok=False)
    meta=json.loads(a.meta.read_text())
    prefix=['/usr/bin/sandbox-exec','-f',a.sandbox] if a.sandbox else []
    backend=ProcessBackend(a.arm,cmd,prefix,a.work,a.logs,time.monotonic,a.protected)
    def cancel(*_):
        backend.kill(); raise SystemExit(130)
    for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP): signal.signal(sig,cancel)
    try: receipt=drive(a.cap_ms,a.arm+'-resume' if a.arm!='omerta' else 'host-resume',backend,time.monotonic)
    except Exception:
        receipt={'schema':'bio-tasks/recovery@2','reason':'recovery integrity or resume unavailable','outcome':'unverified',
                 'interrupted':False,'resumed':False,'cap_ms':a.cap_ms,'mode':a.arm+'-resume'}
    h=hashlib.sha256()
    # verify() already authenticated the captured bytes before they become audit input.
    try:
        backend.verify()
        for phase in (1,2):
            p=a.logs/f'phase{phase}.jsonl'
            if p.exists():
                raw=p.read_bytes(); h.update(raw); sys.stdout.buffer.write(raw)
        sys.stdout.buffer.flush()
    except Exception:
        receipt['outcome']='unverified'; receipt['records_ok']=False
    receipt.update(attempt=meta['attempt'],model=meta['model'],transcript_sha256=h.hexdigest(),
                   protected_sha256={str(p):h for p,h in backend.protected.items()})
    a.receipt.write_text(json.dumps(receipt,sort_keys=True)+'\n')
    return 0 if valid_receipt(receipt) else 8 if receipt['outcome']=='not-exercised' else 7


def journal_records_ok(journal):
    """Supplement the host adapter's verified hash chains with duplicate/terminal checks."""
    try:
        if set(journal)!={'pipeline','host','ledger'} or any(not journal[k] for k in journal): return False
        for stream in journal.values():
            ids=[e['eventId'] for e in stream]
            if len(ids)!=len(set(ids)): return False
            sequences=[e['sequence'] for e in stream]
            if sequences!=sorted(set(sequences)): return False
        types=[e['type'] for e in journal['pipeline']]
        if not any(t.endswith('.interrupted') for t in types): return False
        completed=[t for t in types if t.startswith('step.') and t.endswith('.completed')]
        if len(completed)!=len(set(completed)): return False
        records=[]
        for e in journal['ledger']:
            payload=e['payload']
            for field in ('record','amendment'):
                r=payload.get(field)
                if isinstance(r,dict): records.append(r)
        ids=[r['id'] for r in records]
        if not ids or len(ids)!=len(set(ids)): return False
        by_id={r['id']:r for r in records}
        active=dict(by_id)
        for r in records:
            payload=r.get('payload',{})
            parent=payload.get('data',{}).get('supersedes')
            if parent: active.pop(parent,None)
            for link in payload.get('parents',[]):
                if link.get('relation')=='supersedes': active.pop(link['id'],None)
        interpretations={}
        for r in active.values():
            p=r.get('payload',{}); d=p.get('data',{})
            if p.get('kind')=='interpretation':
                # Compare the scientific target, not the incidental observation/check parents.
                target=tuple(sorted(link['id'] for link in p.get('parents',[])
                                    if by_id.get(link['id'],{}).get('payload',{}).get('kind')=='experiment'))
                if not target or target in interpretations: return False
                if d.get('status') not in ('tentative','confirmed','refuted','insufficient'): return False
                interpretations[target]=d['status']
        return True
    except (KeyError,TypeError,ValueError): return False


if __name__=="__main__": sys.exit(main())
