"""Emit, but NEVER execute, the exact owner install command requested for OSL-wire."""
import hashlib, pathlib, shlex
PKG = pathlib.Path(__file__).resolve().parent.parent
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest = sha(PKG / '.scratch/release/MANIFEST')
shell = sha(PKG / 'scripts/install-launcher.sh')
perl = sha(PKG / 'scripts/install-release.pl')
body = f'''set -eu; umask 022; T=$(/usr/bin/mktemp -d /var/root/omb-install.XXXXXX); S={shlex.quote(str(PKG))}; /bin/cp "$S/scripts/install-launcher.sh" "$S/scripts/install-release.pl" "$S/.scratch/release/MANIFEST" "$T/"; /bin/chmod 0755 "$T/install-launcher.sh"; /bin/chmod 0644 "$T/install-release.pl" "$T/MANIFEST"; cd "$T"; printf "%s  %s\\n" {shell} install-launcher.sh {perl} install-release.pl {manifest} MANIFEST | /usr/bin/shasum -a 256 -c; /bin/sh "$T/install-launcher.sh" "$S/.scratch/release" "$T/MANIFEST" {manifest}; cd /; /bin/rm -rf "$T"'''
command = '/usr/bin/sudo /bin/sh -c ' + shlex.quote(body) + '\n'
# This is the user's one explicitly requested output outside the worktree.
pathlib.Path('/Users/Shared/omb-install-command-v2.txt').write_text(command)
(PKG / '.scratch/owner-install-command.txt').write_text(command)
verify = f'/bin/sh {shlex.quote(str(PKG / "scripts/verify-install.sh"))} {manifest}\n'
(PKG / '.scratch/owner-verify-command.txt').write_text(verify)
(PKG / '.scratch/release-hashes.txt').write_text(f'{manifest}  MANIFEST\n{shell}  install-launcher.sh\n{perl}  install-release.pl\n')
print((PKG / '.scratch/release-hashes.txt').read_text(), end='')
print(verify, end='')
# Validate the exact emitted shell syntax without executing its privileged command.
import subprocess
subprocess.run(['/bin/sh', '-n'], input=command, text=True, check=True)
