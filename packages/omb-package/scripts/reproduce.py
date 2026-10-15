#!/usr/bin/env python3
"""Standalone bundle verifier/reproducer. Python stdlib; pinned runtime, no private framework."""
import hashlib, json, os, pathlib, shutil, subprocess, sys, tempfile

def digest(data):return hashlib.sha256(data).hexdigest()
def canonical(obj):return json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def safe(root,name):
    p=pathlib.PurePosixPath(name)
    if not name or p.is_absolute() or '..' in p.parts or '.' in p.parts or '\\' in name:raise ValueError('unsafe bundle path')
    target=root.joinpath(*p.parts)
    if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(root.resolve()):raise ValueError('unsafe or absent bundle file: '+name)
    return target

def verify_bundle(root):
    payload=safe(root,'certificate.payload.json').read_bytes()
    key=safe(root,'certificate-public.pem');sig=safe(root,'certificate.sig')
    openssl=pathlib.Path(sys.executable).parent/'openssl'
    if not openssl.exists():raise ValueError('pinned environment openssl missing')
    subprocess.run([str(openssl),'pkeyutl','-verify','-pubin','-inkey',str(key),'-rawin','-in',str(root/'certificate.payload.json'),'-sigfile',str(sig)],check=True,capture_output=True,timeout=10)
    cert=json.loads(payload);manifest=json.loads(safe(root,'bundle-manifest.json').read_bytes())
    if digest(canonical(manifest))!=cert['bundleHash']:raise ValueError('bundle manifest hash differs from certificate')
    for name,want in manifest['files'].items():
        if digest(safe(root,name).read_bytes())!=want:raise ValueError('bundle file hash mismatch: '+name)
    plan=json.loads(safe(root,'reproduction.json').read_bytes())
    if sys.version_info[:3]!=tuple(plan['pythonVersion']):raise ValueError('use the pinned Python runtime via ./reproduce')
    if digest(safe(root,'environment/pixi.lock').read_bytes())!=plan['environmentLock']:raise ValueError('analysis environment lock mismatch')
    return plan,cert

def seatbelt(runtime,work):
    # Read only public system libraries, the pinned runtime and the isolated input copy.
    roots=[str(runtime),str(work),'/usr/lib','/System/Library','/System/Volumes/Preboot/Cryptexes/OS','/Library/Apple/System/Library','/private/var/db/dyld','/usr/share/zoneinfo','/private/var/db/timezone','/dev/null','/dev/random','/dev/urandom']
    q=lambda s:json.dumps(str(s))
    rules=['(version 1)','(deny default)','(allow process-exec)','(allow process-fork)','(allow signal (target self))','(allow sysctl-read)','(allow mach-lookup)']
    for r in roots:rules.append('(allow file-read* (subpath '+q(r)+'))')
    ancestors=set()
    for r in (runtime,work):ancestors.update(str(p) for p in r.parents)
    for r in ancestors:rules.append('(allow file-read-metadata (literal '+q(r)+'))')
    rules+=['(allow file-read-data (literal "/"))','(allow file-write* (subpath '+q(work)+') (literal "/dev/null"))']
    for name in ('code','data'):rules.append('(deny file-write* (subpath '+q(work/name)+'))')
    return '\n'.join(rules)

def reproduce(root,plan):
    runtime=pathlib.Path(sys.executable).resolve().parent.parent
    scratch=root/'.reproduction';scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='fresh-',dir=scratch) as tmp:
        work=pathlib.Path(tmp).resolve()
        # No expected outputs, original framework or certificate are visible to analysis code.
        for name in ('code','data'):
            src=root/name
            if src.exists():shutil.copytree(src,work/name)
        entry=pathlib.PurePosixPath(plan['entrypoint'])
        if not str(entry).startswith('code/') or '..' in entry.parts:raise ValueError('unsafe analysis entrypoint')
        env={'PATH':str(runtime/'bin')+':/usr/bin:/bin','HOME':str(work),'TMPDIR':str(work),'LANG':'C.UTF-8','TZ':'UTC','PYTHONHASHSEED':'0','OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'}
        if sys.platform=='darwin':
            cmd=['/usr/bin/sandbox-exec','-p',seatbelt(runtime,work),str(pathlib.Path(sys.executable).resolve()),'-I','-B',str(work/entry)]
            backend='seatbelt'
        elif sys.platform=='linux' and shutil.which('bwrap'):
            cmd=[shutil.which('bwrap'),'--die-with-parent','--unshare-all','--proc','/proc','--dev','/dev','--ro-bind',str(runtime),str(runtime),'--bind',str(work),'/work']
            for p in ('/usr','/bin','/lib','/lib64','/etc/ld.so.cache'):
                if pathlib.Path(p).exists():cmd+=['--ro-bind',p,p]
            for name in ('code','data'):
                if (work/name).exists():cmd+=['--ro-bind',str(work/name),'/work/'+name]
            cmd+=['--chdir','/work','--',str(pathlib.Path(sys.executable).resolve()),'-I','-B','/work/'+str(entry)]
            backend='bwrap'
        else:raise ValueError('no supported sandbox; reproduction refused')
        result=subprocess.run(cmd,cwd=work,env=env,capture_output=True,timeout=60)
        if result.returncode:raise ValueError('sandbox analysis failed: '+result.stderr.decode(errors='replace')[-2000:])
        output=work/'numbers.json'
        if output.is_symlink() or not output.is_file() or output.stat().st_size>5_000_000:raise ValueError('missing / invalid numbers.json')
        numbers=json.loads(output.read_bytes())
        expected=plan['expected']
        if set(numbers)!=set(expected) or any(type(numbers[k]) not in (int,float) or numbers[k]!=expected[k] for k in expected):raise ValueError('reproduced numbers differ (missing / extra / changed values)')
        for pointer in plan['data']:
            if digest((work/pointer['path']).read_bytes())!=pointer['sha256']:raise ValueError('analysis changed input data')
        receipt={'schema':'omb/reproduction@1','sandbox':backend,'network':'denied','expectedOutputsVisibleToAnalysis':False,'numbers':numbers,'numbersSha256':digest(canonical(numbers)),'pythonVersion':list(sys.version_info[:3])}
        (scratch/'receipt.json').write_bytes(canonical(receipt)+b'\n')
        return receipt

if __name__=='__main__':
    root=pathlib.Path(__file__).resolve().parent
    plan,cert=verify_bundle(root)
    if '--verify-only' in sys.argv:print('Bundle signature and hashes verified.')
    else:print(json.dumps(reproduce(root,plan),sort_keys=True))
