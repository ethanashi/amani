"""Download only the official Node executable and notices; verify SHA-256 first."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import Request, urlopen
from pathlib import Path
import hashlib
import shutil
import tarfile
import sys

VERSION = '24.19.0'
ARCHIVE = f'node-v{VERSION}-darwin-arm64.tar.gz'
URL = f'https://nodejs.org/dist/v{VERSION}/{ARCHIVE}'
root = Path(__file__).resolve().parent.parent
runtime = Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root / '.runtime'
runtime.mkdir(parents=True,exist_ok=True)
PINNED_SHA256 = '8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d'
archive = runtime / ARCHIVE
if not archive.is_file() or hashlib.sha256(archive.read_bytes()).hexdigest() != PINNED_SHA256:
    with urlopen(Request(URL, method='HEAD'), timeout=30) as response:
        size = int(response.headers['Content-Length'])
    step = (size + 7) // 8
    def download_part(index):
        start=index*step;end=min(size-1,start+step-1)
        target=runtime/f'node-part-{index}'
        with urlopen(Request(URL,headers={'Range':f'bytes={start}-{end}'}),timeout=300) as response:
            if response.status!=206: raise RuntimeError('Server did not honor byte range')
            with target.open('wb') as output: shutil.copyfileobj(response,output)
        if target.stat().st_size!=end-start+1: raise RuntimeError('Incomplete Node segment')
        return index
    try:
        with ThreadPoolExecutor(max_workers=8) as executor:
            for future in as_completed([executor.submit(download_part,i) for i in range(8)]):
                print('Downloaded Node segment',future.result(),flush=True)
        with archive.open('wb') as output:
            for i in range(8):
                with (runtime/f'node-part-{i}').open('rb') as source: shutil.copyfileobj(source,output)
    finally:
        for i in range(8): (runtime/f'node-part-{i}').unlink(missing_ok=True)
actual=hashlib.sha256(archive.read_bytes()).hexdigest()
if actual!=PINNED_SHA256: raise RuntimeError('Node archive differs from pinned official SHA-256')
with tarfile.open(archive) as tar:
    for name, destination in [('bin/node', runtime / 'node-24'), ('LICENSE', root / 'Node-LICENSE.txt')]:
        with tar.extractfile(f'node-v{VERSION}-darwin-arm64/{name}') as source:
            content=source.read()
        if name=='LICENSE':
            if destination.read_bytes()!=content: raise RuntimeError('Bundled Node notices differ from pinned archive')
        else: destination.write_bytes(content)
(runtime / 'node-24').chmod(0o755)
(runtime / 'node-sha256.txt').write_text(actual + '\n')
print('Verified official Node:', actual)
