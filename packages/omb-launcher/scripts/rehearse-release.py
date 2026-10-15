"""Install the real release into a fresh task-owned fake root; never runs sudo."""
import hashlib, os, pathlib, shutil, subprocess, tempfile
PKG = pathlib.Path(__file__).resolve().parent.parent
release = PKG / '.scratch/release'
manifest = release / 'MANIFEST'
digest = hashlib.sha256(manifest.read_bytes()).hexdigest()
base = pathlib.Path(tempfile.mkdtemp(prefix='rehearsal-', dir=PKG / '.scratch'))
fake = base / 'root'
for directory in ['private/var/db/omb-authority', 'private/etc/sudoers.d', 'usr/local']:
    (fake / directory).mkdir(parents=True, exist_ok=True)
(fake / 'private/var/db/omb-authority').chmod(0o700)
(fake / 'var').symlink_to('private/var')
(fake / 'etc').symlink_to('private/etc')
pin = base / 'MANIFEST'
shutil.copyfile(manifest, pin)
pin.chmod(0o644)
log = PKG / '.scratch/rehearsal.log'
with log.open('w') as output:
    result = subprocess.run(['/usr/bin/env', '-i', 'PATH=/usr/bin:/bin:/usr/sbin', 'HOME=/var/empty', 'LANG=C', '/usr/bin/perl', '-T', str(PKG / 'scripts/install-release.pl'), str(release), str(pin), digest, '--test-root', str(fake), str(os.getuid())], stdout=output, stderr=subprocess.STDOUT)
summary = f'fakeRoot={fake}\nmanifest={digest}\nexitCode={result.returncode}\n'
if result.returncode == 0:
    assert (fake / 'usr/local/libexec/omb/current').readlink() == pathlib.Path('releases') / digest
    assert (fake / 'usr/local/libexec/omb/releases' / digest / 'MANIFEST').read_bytes() == manifest.read_bytes()
    summary += 'current-and-manifest-verified=true\n'
(PKG / '.scratch/rehearsal-summary.txt').write_text(summary)
print(summary, end='')
raise SystemExit(result.returncode)
