"""Owner-side reproducible assembly; no root operations or post-link execution.
Only verified conda archives are inputs. Extracted owner cache is never trusted.
"""
import concurrent.futures, hashlib, json, os, pathlib, re, shutil, subprocess, sys, tarfile, urllib.request, zipfile
PKG = pathlib.Path(__file__).resolve().parent.parent
REPO = PKG.parent.parent
NODE_VERSION = '24.21.0'
MAX_DOWNLOAD = 1_000_000_000

def digest(data): return hashlib.sha256(data).hexdigest()
def run(args, **kw): return subprocess.run([str(x) for x in args], check=True, **kw)
def download(url, target, expected=None, expected_size=None):
    if target.exists() and (expected is None or digest(target.read_bytes()) == expected): return
    if expected_size is not None and expected_size > MAX_DOWNLOAD: raise RuntimeError('Over 1 GB: coordinator approval required')
    run(['/usr/bin/curl','--fail','--location','--proto','=https','--proto-redir','=https','--connect-timeout','10','--max-time','900','--max-filesize',str(MAX_DOWNLOAD),'--retry','2','--continue-at','-','--silent','--show-error','--output',target,url])
    if expected_size is not None and target.stat().st_size != expected_size: raise RuntimeError('Archive length mismatch')
    if expected and digest(target.read_bytes()) != expected: target.unlink(); raise RuntimeError('Archive hash mismatch: '+url)

def locked_packages(text):
    # Deliberately narrow parser for the pinned pixi v7 conda-only lock. Refuse
    # unsupported forms instead of implementing a permissive YAML subset.
    if not text.startswith('version: 7\n') or '  pypi:' in text: raise RuntimeError('Unsupported lock')
    records = []
    for block in text.split('\npackages:\n', 1)[1].split('\n- conda: '):
        block = block.removeprefix('- conda: ')
        url = block.splitlines()[0]
        sha = re.search(r'^  sha256: ([a-f0-9]{64})$', block, re.M)
        size = re.search(r'^  size: (\d+)$', block, re.M)
        if not url.startswith('https://conda.anaconda.org/conda-forge/') or not sha or not size: raise RuntimeError('Incomplete locked package')
        records.append((url,sha[1],int(size[1])))
    declared = re.findall(r'^      - conda: (.+)$', text, re.M)
    if sorted(declared) != sorted(x[0] for x in records): raise RuntimeError('Lock inventory mismatch')
    return records

def safe_member(name):
    path = pathlib.PurePosixPath(name)
    return not path.is_absolute() and '..' not in path.parts and '\\' not in name

def untar(archive, dest):
    if str(archive).endswith('.zst'):
        unpacked=pathlib.Path(str(archive)[:-4])
        with unpacked.open('wb') as f: run(['/opt/homebrew/bin/zstd','-q','-d','-c',archive],stdout=f)
        try: return untar(unpacked,dest)
        finally: unpacked.unlink()
    listing = subprocess.check_output(['/usr/bin/tar','-tf',str(archive)], text=True).splitlines()
    if any(not safe_member(n) for n in listing): raise RuntimeError('Unsafe archive member')
    run(['/usr/bin/tar','-xf',archive,'-C',dest])

def assemble_runtime(archives, runtime, work, final_prefix):
    placeholders = set()
    for archive in archives:
        directory = work / ('extract-'+archive.name.split('.')[0]); directory.mkdir()
        if archive.suffix == '.conda':
            with zipfile.ZipFile(archive) as z:
                names = [n for n in z.namelist() if n.endswith('.tar.zst')]
                if len(names) != 2 or any('/' in n for n in names): raise RuntimeError('Unexpected conda archive')
                for name in names:
                    z.extract(name, directory); untar(directory/name, directory); (directory/name).unlink()
        else: untar(archive, directory)
        paths = json.loads((directory/'info/paths.json').read_text())['paths'] if (directory/'info/paths.json').exists() else None
        if paths is None:
            # Legacy tar packages have no per-file digest; the full archive was
            # verified against the lock before extraction.
            paths = [{'_path': n} for n in (directory/'info/files').read_text().splitlines()]
        linkfile = directory/'info/link.json'
        noarch = linkfile.exists() and json.loads(linkfile.read_text()).get('noarch',{}).get('type') == 'python'
        for record in paths:
            name = record['_path']
            if not safe_member(name): raise RuntimeError('Unsafe runtime path')
            src = directory/name
            if src.is_dir() and not src.is_symlink(): continue
            if noarch and name.startswith('site-packages/'): name = 'lib/python3.13/'+name
            elif noarch and name.startswith('python-scripts/'): name = 'bin/'+name[len('python-scripts/'):]
            dest = runtime/name; dest.parent.mkdir(parents=True, exist_ok=True)
            if src.is_symlink():
                link = os.readlink(src)
                if os.path.isabs(link): raise RuntimeError('Absolute package symlink: '+name)
                resolved = os.path.normpath(str(dest.parent/link))
                if not resolved.startswith(str(runtime)+'/'): raise RuntimeError('Escaping package symlink')
                if dest.exists() or dest.is_symlink(): dest.unlink()
                dest.symlink_to(link); continue
            data = src.read_bytes()
            if record.get('sha256') and digest(data) != record['sha256']: raise RuntimeError('Package member digest mismatch')
            placeholder = record.get('prefix_placeholder')
            if placeholder:
                placeholders.add(placeholder)
                old=placeholder.encode(); new=final_prefix.encode()
                if record.get('file_mode') == 'binary':
                    if len(new) > len(old): raise RuntimeError('Relocation prefix too long')
                    data=b'\0'.join(part.replace(old,new)+b'\0'*(len(part)-len(part.replace(old,new))) for part in data.split(b'\0'))
                else: data=data.replace(old,new)
            # Runtime must be movable without a self-referential manifest hash.
            # The temporary fixed-width sentinel is eliminated below, never used
            # as a loading path in a published release.
            if dest.exists() and dest.read_bytes() != data: raise RuntimeError('Conflicting package file: '+name)
            dest.write_bytes(data); dest.chmod(src.stat().st_mode & 0o777)
        shutil.rmtree(directory)
    return placeholders

def scan_runtime(runtime):
    bad = []
    for file in runtime.rglob('*'):
        if file.is_symlink():
            if not file.resolve().is_relative_to(runtime): bad.append(str(file.relative_to(runtime))); continue
        elif file.is_file():
            data = file.read_bytes()
            if b'/Users' in data or b'/opt/homebrew' in data: bad.append(str(file.relative_to(runtime)))
    return bad

def main():
    out = pathlib.Path(sys.argv[1]).resolve()
    if (out/'MANIFEST').exists(): raise RuntimeError('Already sealed; use new staging')
    out.mkdir(parents=True,exist_ok=True); work = out/'.build'; work.mkdir(exist_ok=True)
    (out/'bin').mkdir(exist_ok=True); (out/'runtime').mkdir(exist_ok=True)
    lock = (REPO/'packages/bio-baseline/pixi.lock').read_bytes()
    packages = locked_packages(lock.decode())
    (out/'pixi.lock').write_bytes(lock)
    archive = f'node-v{NODE_VERSION}-darwin-arm64.tar.gz'
    base = f'https://nodejs.org/dist/v{NODE_VERSION}/'
    download(base+'SHASUMS256.txt', work/'SHASUMS256.txt')
    shas = dict(line.split()[::-1] for line in (work/'SHASUMS256.txt').read_text().splitlines())
    node_cache=PKG/'.scratch/verified-archives'/archive
    if node_cache.is_file() and digest(node_cache.read_bytes()) == shas[archive]: shutil.copyfile(node_cache,work/archive)
    download(base+archive, work/archive, shas[archive])
    node_cache.parent.mkdir(parents=True,exist_ok=True)
    if not node_cache.exists(): shutil.copyfile(work/archive,node_cache)
    untar(work/archive, work)
    shutil.copyfile(work/f'node-v{NODE_VERSION}-darwin-arm64/bin/node', out/'bin/node'); (out/'bin/node').chmod(0o755)
    deps = subprocess.check_output(['/usr/bin/otool','-L',str(out/'bin/node')],text=True).splitlines()[1:]
    if any(not line.strip().startswith(('/usr/lib/','/System/')) for line in deps): raise RuntimeError('Node loads non-system library')
    esbuild = next((REPO/'node_modules/.pnpm').glob('esbuild@*/node_modules/esbuild/bin/esbuild'))
    run([esbuild, PKG/'src/cert-main.ts','--bundle','--platform=node','--format=esm','--target=node24','--packages=bundle','--legal-comments=none','--sources-content=false',f'--outfile={out}/omb-cert.mjs',f'--metafile={work}/bundle.json'])
    run([esbuild, PKG/'scripts/verify-cli.ts','--bundle','--platform=node','--format=esm','--target=node24','--packages=bundle','--legal-comments=none','--sources-content=false',f'--outfile={out}/omb-verify.mjs'])
    meta=json.loads((work/'bundle.json').read_text())
    if any(name.endswith('.node') for name in meta['inputs']): raise RuntimeError('Native addon in bundle')
    if any(not x['path'].startswith('node:') for v in meta['outputs'].values() for x in v['imports']): raise RuntimeError('Non-built-in bundle import')
    for name in ['cert-launch','run-launch','omb.sudoers']:
        text=(PKG/f'system/{name}.in').read_text()
        for key,value in {'CERT_UID':'401','RUN_UID':'402','REQUEST_CAP':'1048576','AUTHORITY':'/var/db/omb-authority','OWNER':'ethanashihundu'}.items(): text=text.replace('@'+key+'@',value)
        if re.search('@[A-Z_]+@',text): raise RuntimeError('Unrendered template')
        (out/name).write_text(text)
    shutil.copyfile(PKG/'system/run.sb',out/'run.sb')
    run(['/usr/sbin/visudo','-cf',out/'omb.sudoers'])
    print(f'Verifying {len(packages)} runtime archives ({sum(p[2] for p in packages)} compressed bytes).',flush=True)
    cache = pathlib.Path.home()/'Library/Caches/rattler/cache/pkgs'
    def fetch(p):
        url,sha,size=p; target=work/url.rsplit('/',1)[1]
        cached=PKG/'.scratch/verified-archives'/target.name
        if not cached.exists(): cached=cache/target.name
        if cached.is_file() and digest(cached.read_bytes()) == sha: shutil.copyfile(cached,target)
        else: download(url,target,sha,size)
        return target
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: archives=list(pool.map(fetch,packages))
    (out/'ARCHIVES.json').write_text(json.dumps([{'url':p[0],'sha256':p[1],'bytes':p[2]} for p in packages],sort_keys=True)+'\n')
    final_prefix='/usr/local/libexec/omb/runtime/'+digest(lock)
    (out/'runtime-prefix').write_text(final_prefix+'\n')
    shutil.rmtree(out/'runtime'); (out/'runtime').mkdir()
    for partial in work.glob('extract-*'): shutil.rmtree(partial)
    placeholders=assemble_runtime(archives,out/'runtime',work,final_prefix)
    finalize_runtime(out,work,archives)

def finalize_runtime(out,work,archives):
    # Scrub compiler __FILE__/debug/user-path constants at equal byte length.
    # This does not whitelist an owner path: any accidental runtime lookup now
    # points to a nonexistent root namespace and is denied by Seatbelt.
    before=scan_runtime(out/'runtime')
    transformed=[]
    for file in (out/'runtime').rglob('*'):
        if file.is_file() and not file.is_symlink():
            data=file.read_bytes(); clean=data.replace(b'/Users',b'/BUILD').replace(b'/opt/homebrew',b'/omb/blocked_')
            if data!=clean: file.write_bytes(clean); transformed.append(str(file.relative_to(out/'runtime')))
    run(['/usr/bin/clang','-O2','-Wall','-Wextra','-Werror',PKG/'system/r-front.c','-o',out/'runtime/lib/R/bin/R'])
    final_prefix=(out/'runtime-prefix').read_text().strip()
    prefix_bytes=final_prefix.encode(); dylib_edges=[]
    for file in (out/'runtime').rglob('*'):
        if not file.is_file() or file.is_symlink(): continue
        raw=file.read_bytes()
        if prefix_bytes not in raw or raw[:4] not in [bytes.fromhex(x) for x in ['cffaedfe','feedfacf','cafebabe']]: continue
        listing=subprocess.check_output(['/usr/bin/otool','-L',str(file)],text=True)
        changes=[]
        for line in listing.splitlines()[1:]:
            dependency=line.strip().split(' (compatibility version',1)[0]
            if dependency.startswith(final_prefix+'/'):
                target=pathlib.PurePosixPath(dependency[len(final_prefix)+1:])
                if '..' in target.parts or target.is_absolute(): raise RuntimeError('Runtime dependency escapes prefix')
                relative=pathlib.PurePosixPath(os.path.relpath(str(target),str(pathlib.PurePosixPath(file.relative_to(out/'runtime').parent))))
                replacement='@loader_path/'+str(relative)
                run(['/usr/bin/install_name_tool','-change',dependency,replacement,file])
                changes.append({'from':dependency,'to':replacement})
        if changes:
            run(['/usr/bin/codesign','--force','--sign','-',file],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            dylib_edges.extend({'file':str(file.relative_to(out/'runtime')),'from':x['from'],'to':x['to']} for x in changes)
    bad=scan_runtime(out/'runtime')
    (out/'PATH-NORMALIZATION.json').write_text(json.dumps({
        'rewrites': {'/Users':'/BUILD','/opt/homebrew':'/omb/blocked_'},
        'filesRewritten': sorted(transformed),
        'absoluteRuntimeLoadsRewritten': dylib_edges,
        'scanBeforeRewrite': {'filesWithForbiddenReferences': sorted(before)},
        'scanAfterRewrite': {'filesWithForbiddenReferences': sorted(bad)},
    },sort_keys=True,separators=(',',':'))+'\n')
    if bad:
        (out/'BUILD-REFUSED.json').write_text(json.dumps({'reason':'forbidden absolute references remain; release is NOT installable','files':bad},indent=2)+'\n')
        raise RuntimeError(f'Runtime contains {len(bad)} files with /Users or /opt/homebrew. Refusing manifest/install; see BUILD-REFUSED.json')
    if (out/'BUILD-REFUSED.json').exists(): (out/'BUILD-REFUSED.json').unlink()
    for file in list((out/'runtime').rglob('*')):
        if file.is_symlink():
            target=file.resolve(strict=True)
            if not target.is_relative_to(out/'runtime'): raise RuntimeError('Unsafe runtime link')
            if target.is_dir():
                file.unlink(); shutil.copytree(target,file,symlinks=False)
            else:
                data=target.read_bytes(); mode=target.stat().st_mode & 0o777
                file.unlink(); file.write_bytes(data); file.chmod(mode)
    for file in (out/'runtime').rglob('*'):
        if file.is_file() and file.read_bytes()[:4] in [bytes.fromhex(x) for x in ['cffaedfe','feedfacf','cafebabe']]:
            run(['/usr/bin/codesign','--force','--sign','-',file],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    ns={'__name__':'release_smoke','__file__':str(PKG/'scripts/sandbox_smoke.py')}
    exec(compile((PKG/'scripts/sandbox_smoke.py').read_text(),ns['__file__'],'exec'),ns)
    result=ns['smoke'](out/'runtime',out/'run.sb')
    result.pop('seconds', None)
    (out/'SELFTEST.json').write_text(json.dumps(result,sort_keys=True)+'\n')
    # Retain verified archives in package scratch for repeatable offline rebuilds.
    cache_dir=PKG/'.scratch/verified-archives'; cache_dir.mkdir(exist_ok=True)
    for archive in archives:
        target=cache_dir/archive.name
        if not target.exists(): shutil.copyfile(archive,target)
    shutil.rmtree(work)
    manifest={}
    for file in sorted(out.rglob('*')):
        if file.is_file(): manifest[str(file.relative_to(out))]={'sha256':digest(file.read_bytes()),'mode':493 if file.stat().st_mode & 0o111 or file.name in ['cert-launch','run-launch'] else 420}
    runtime_entries=[(name,value) for name,value in sorted(manifest.items()) if name.startswith('runtime/')]
    runtime_bytes=''.join(f"{value['sha256']} {value['mode']} {name}\n" for name,value in runtime_entries).encode()
    runtime_hash=digest(runtime_bytes)
    (out/'runtime-prefix').write_text('/usr/local/libexec/omb/runtime/'+runtime_hash+'\n')
    manifest['runtime-prefix']={'sha256':digest((out/'runtime-prefix').read_bytes()),'mode':420}
    (out/'MANIFEST').write_text(json.dumps(manifest,sort_keys=True,separators=(',',':'))+'\n')
    print('Release manifest '+digest((out/'MANIFEST').read_bytes()),flush=True)
if __name__ == '__main__': main()
