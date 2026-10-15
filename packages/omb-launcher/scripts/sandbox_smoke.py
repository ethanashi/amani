"""Real unprivileged containment smoke. No sudo and no public network traffic.
The installed selftest separately tests TCP/DNS to 1.1.1.1 after owner approval.
"""
import json, os, pathlib, shutil, subprocess, sys, tempfile
PKG=pathlib.Path(__file__).resolve().parent.parent

def smoke(runtime,profile):
    runtime=runtime.resolve(strict=True)
    scratch=pathlib.Path(tempfile.mkdtemp(prefix='seatbelt-',dir=PKG/'.scratch'))
    try:
        stage=scratch/'stage'; stage.mkdir(); tmp=scratch/'tmp'; tmp.mkdir(); outside=scratch/'secret'; outside.write_text('must not be readable')
        (stage/'escape').symlink_to(outside)
        source='''import os,socket,errno,json,ctypes
import numpy,pandas,scipy
from scipy.linalg import solve
checks={}
def denied(fn):
 try: fn(); return False
 except OSError as e: return e.errno in (errno.EPERM,errno.EACCES)
checks['outside_read']=denied(lambda: open(OUTSIDE).read())
checks['symlink_read']=denied(lambda: open(ESCAPE).read())
checks['outside_write']=denied(lambda: open(OUTSIDE,'w'))
s=socket.socket(); s.settimeout(0.05)
checks['tcp']=denied(lambda: s.connect(('127.0.0.1',9))); s.close()
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
checks['dns_udp']=denied(lambda: s.sendto(b'probe',('127.0.0.1',53))); s.close()
libc=ctypes.CDLL(None,use_errno=True)
def ipc_denied(call):
 ctypes.set_errno(0); result=call()
 return result == -1 and ctypes.get_errno() in (errno.EPERM,errno.EACCES)
checks['sysv_ipc']=(ipc_denied(lambda:libc.shmget(0x4f4d4201,1,0o1000|0o600)) and
 ipc_denied(lambda:libc.msgget(0x4f4d4202,0o1000|0o600)) and
 ipc_denied(lambda:libc.semget(0x4f4d4203,1,0o1000|0o600)))
with open(os.environ['TMPDIR']+'/inside','w') as f: f.write('allowed')
checks['tmp_write']=True
checks['numpy']=float(numpy.dot([1,2],[3,4]))==11
checks['pandas']=bool(pandas.Series([1,2]).sum()==3)
checks['scipy']=bool(numpy.allclose(solve(numpy.eye(2),numpy.array([2.,3.])),[2,3]))
print(json.dumps(checks,sort_keys=True))
'''.replace('OUTSIDE',repr(str(outside))).replace('ESCAPE',repr(str(stage/'escape')))
        (stage/'entry.py').write_text(source)
        (stage/'entry.R').write_text('library(stats)\nlibrary(utils)\nfit <- lm(mpg ~ wt, data=mtcars)\nstopifnot(is.finite(unname(coef(fit)[[2]])), nrow(model.frame(fit)) == 32)\nwriteLines("R-stats-utils-lm-ok")\n')
        env={'PATH':'/usr/bin:/bin','HOME':'/var/empty','LANG':'C','TMPDIR':str(tmp),'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1','R_HOME':str(runtime/'lib/R'),'RHOME':str(runtime/'lib/R'),'R_SHARE_DIR':str(runtime/'lib/R/share'),'R_INCLUDE_DIR':str(runtime/'lib/R/include'),'R_DOC_DIR':str(runtime/'lib/R/doc'),'R_ENVIRON':'/dev/null','R_ENVIRON_USER':'/dev/null','R_PROFILE_USER':'/dev/null','R_LIBS_USER':'/nonexistent'}
        # The installed profile grants metadata (never file contents) on its
        # fixed root-owned /usr/local/libexec parents. A checkout runtime lives
        # below /Users, so add only its exact ancestors for this unprivileged
        # smoke; data access outside RUNTIME/STAGE/TMP remains denied.
        ancestors=[]; parent=runtime.parent
        while parent != parent.parent:
            ancestors.append(str(parent)); parent=parent.parent
        rendered=scratch/'run.sb'
        rendered.write_text(profile.read_text()+'\n(allow file-read-metadata '+' '.join('(literal "'+p+'")' for p in ancestors)+')\n')
        prefix=['/usr/bin/sandbox-exec','-f',str(rendered),'-D','STAGE='+str(stage),'-D','RUNTIME='+str(runtime),'-D','TMP='+str(tmp)]
        # First imports validate/sign Mach-O dylibs on macOS and can be slow on
        # a cold or busy developer machine; the check remains strictly bounded.
        py=subprocess.run(prefix+[str(runtime/'bin/python3.13'),'-I','-B',str(stage/'entry.py')],env=env,cwd=tmp,capture_output=True,text=True,timeout=60)
        if py.returncode: raise RuntimeError('Python sandbox: '+str(py.returncode)+' '+py.stderr)
        checks=json.loads(py.stdout)
        if len(checks)!=10 or any(v is not True for v in checks.values()): raise RuntimeError('Containment failed: '+py.stdout)
        r=subprocess.run(prefix+[str(runtime/'lib/R/bin/Rscript'),'--vanilla',str(stage/'entry.R')],env=env,cwd=tmp,capture_output=True,text=True,timeout=60)
        if r.returncode or r.stdout.strip()!='R-stats-utils-lm-ok': raise RuntimeError('R stats/utils sandbox: '+str(r.returncode)+' '+r.stdout+' '+r.stderr)
        result={'verified':True,'checks':checks,'Rscript':True,'RstatsUtilsLm':True}
        return result
    finally: shutil.rmtree(scratch)
if __name__=='__main__': print(json.dumps(smoke(pathlib.Path(sys.argv[1]),PKG/'system/run.sb'),sort_keys=True))
