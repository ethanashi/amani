"""Cooperative Python audit guard; loaded only for native CI tests, never the leak scanner."""
import os
from pathlib import Path
import sys
home=Path.home()
denied=[home/p for p in ('omerta-bio-heldout','.omerta-bio/oneshot/tierb','.omerta-bio/oneshot/tierb2','.omerta-bio/keys','.omerta-bio/bin','.local/share/claude')]

def check(value):
    if not isinstance(value,(str,bytes,os.PathLike)): return
    value=os.path.abspath(os.fsdecode(value))
    if any(value==str(p) or value.startswith(str(p)+os.sep) for p in denied):
        raise PermissionError('CI protected-path read refused')

def audit(event,args):
    if event in ('open','os.listdir','os.scandir') and args: check(args[0])
    if event=='subprocess.Popen':
        executable,argv=args[:2]
        check(executable)
        base=os.path.basename(os.fsdecode(executable))
        import tempfile
        command=os.fsdecode(executable)
        fixture=os.path.isabs(command) and (command.startswith(os.path.realpath(tempfile.gettempdir())+os.sep) or command.startswith(os.getcwd()+os.sep))
        if base in ('sudo','pkill','killall') or (base in ('claude','codex') and not fixture): raise PermissionError('CI provider/pattern-kill command refused')
        if isinstance(argv,(list,tuple)):
            for arg in argv:
                if isinstance(arg,str) and arg.startswith(str(home)): check(arg)

sys.addaudithook(audit)

# Tests sometimes replace PYTHONPATH while launching their task scripts. Preserve
# the guard for ordinary children; sandboxed workers use their own filesystem policy.
_guard_dir=os.path.dirname(__file__)
def inherited_guard(event,args):
    if event!='subprocess.Popen': return
    executable,argv,cwd,env=args
    base=os.path.basename(os.fsdecode(executable))
    if base=='sandbox-exec': return
    target=os.environ if env is None else env
    prior=target.get('PYTHONPATH','')
    if _guard_dir not in prior.split(os.pathsep): target['PYTHONPATH']=_guard_dir+(os.pathsep+prior if prior else '')

sys.addaudithook(inherited_guard)

# Popen constructs its native env array before emitting its audit event, so inject
# the guard before that conversion as well as auditing the requested command.
import subprocess
_Popen=subprocess.Popen
class GuardedPopen(_Popen):
    def __init__(self, args, *rest, **kwargs):
        executable=kwargs.get('executable') or (args[0] if isinstance(args,(list,tuple)) else args)
        if os.path.basename(os.fsdecode(executable))=='sandbox-exec':
            env=dict(os.environ if kwargs.get('env') is None else kwargs['env'])
            env.pop('NODE_OPTIONS',None); env.pop('PYTHONPATH',None)
            kwargs['env']=env
        else:
            env=dict(os.environ if kwargs.get('env') is None else kwargs['env'])
            prior=env.get('PYTHONPATH','')
            if _guard_dir not in prior.split(os.pathsep):env['PYTHONPATH']=_guard_dir+(os.pathsep+prior if prior else '')
            kwargs['env']=env
        if os.path.basename(os.fsdecode(executable)).startswith('python') and isinstance(args,(list,tuple)) and any(x in args for x in ('-I','-E','-S')):
            args=list(args)
            prefix="import runpy,sys;runpy.run_path("+repr(os.path.join(_guard_dir,'sitecustomize.py'))+");"
            if '-c' in args:
                i=args.index('-c')+1;args[i]=prefix+args[i]
            elif '-m' not in args:
                i=next((i for i,a in enumerate(args[1:],1) if not a.startswith('-')),None)
                if i is not None:
                    script=args[i]
                    args=args[:i]+['-c',prefix+"sys.argv=sys.argv[1:];runpy.run_path(sys.argv[0],run_name='__main__')",script]+args[i+1:]
            else:
                raise PermissionError('CI isolated Python module requires explicit guarded entry point')
        super().__init__(args,*rest,**kwargs)
subprocess.Popen=GuardedPopen
