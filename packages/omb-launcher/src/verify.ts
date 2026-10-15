import { createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createClient } from './client.ts';
import { AUTHORITY, INSTALL } from './constants.ts';
import { sha256 } from './os-backend.ts';
import { boundedProcess } from './process.ts';
export async function verifyInstall(expectedHash: string): Promise<{ verified: true; releaseHash: string }> {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw Error('expected release hash required');
  const check = async (path: string, mode?: number): Promise<void> => {
    const s = await lstat(path);
    if (s.isSymbolicLink() || s.uid !== 0 || (s.mode & 0o022) || (mode !== undefined && (s.mode & 0o7777) !== mode) || (s.isFile() && s.nlink !== 1)) throw Error(`untrusted installed path: ${path}`);
    const permissions = execFileSync('/bin/ls', ['-lde', path], { env: {}, encoding: 'utf8' }).split(/\s/)[0]!;
    if (permissions.includes('+')) throw Error(`ACL requires audit: ${path}`);
  };
  const ancestors = async (path: string): Promise<void> => {
    let p = path;
    while (true) { await check(p); if (p === '/') break; p = dirname(p); }
  };
  const current = await lstat(`${INSTALL}/current`);
  if (!current.isSymbolicLink() || current.uid !== 0) throw Error('current is not a root-owned pointer');
  const release = await realpath(`${INSTALL}/current`);
  if (!new RegExp(`^${INSTALL}/releases/[a-f0-9]{64}$`).test(release)) throw Error('release path');
  await ancestors(release);
  const raw = await readFile(`${release}/MANIFEST`), hash = sha256(raw);
  if (release.split('/').at(-1) !== hash || hash !== expectedHash) throw Error('manifest binding');
  // Sudoers is root-only (0440) and this verifier refuses to run as root, so
  // its bytes cannot be read here. Bind its metadata to the release copy; the
  // sudo -n -l audit below checks what sudo actually parsed from it.
  const installedSudoers = await lstat('/private/etc/sudoers.d/omb-launcher');
  const releaseSudoers = await readFile(`${release}/omb.sudoers`);
  if (installedSudoers.isSymbolicLink() || !installedSudoers.isFile() || installedSudoers.uid !== 0 || installedSudoers.gid !== 0 || (installedSudoers.mode & 0o7777) !== 0o440 || installedSudoers.nlink !== 1 || installedSudoers.size !== releaseSudoers.length) throw Error('sudoers metadata differs from release');
  await ancestors('/private/etc/sudoers.d');
  const manifest = JSON.parse(raw.toString()) as Record<string, { sha256: string; mode: number }>;
  const files = new Set<string>();
  const walk = async (path: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix + entry.name, full = `${path}/${entry.name}`;
      if (entry.isDirectory()) { await check(full, 0o755); await walk(full, `${name}/`); }
      else {
        files.add(name); const expected = manifest[name];
        if (name.startsWith('runtime/')) throw Error('runtime duplicated in release');
        if (name !== 'MANIFEST' && (!expected || ![0o644, 0o755].includes(expected.mode))) throw Error('extra file or unknown mode');
        await check(full, name === 'MANIFEST' ? 0o644 : expected!.mode);
        if (name !== 'MANIFEST' && sha256(await readFile(full)) !== expected!.sha256) throw Error(`digest: ${name}`);
      }
    }
  };
  await walk(release, '');
  const releaseEntries = Object.keys(manifest).filter(name => !name.startsWith('runtime/'));
  if (files.size !== releaseEntries.length + 1) throw Error('missing release files');
  for (const name of ['cert-launch', 'run-launch']) {
    await ancestors(`${INSTALL}/bin/${name}`); await check(`${INSTALL}/bin/${name}`, 0o755);
    const expected = `#!/bin/sh\nexec /usr/bin/env -i PATH=/usr/bin:/bin HOME=/var/empty LANG=C /bin/sh ${release}/${name} "$@"\n`;
    if (await readFile(`${INSTALL}/bin/${name}`, 'utf8') !== expected) throw Error('wrapper binding');
  }
  const runtime = (await readFile(`${release}/runtime-prefix`, 'utf8')).trim();
  const runtimeInventory = Object.entries(manifest).filter(([name]) => name.startsWith('runtime/')).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, info]) => `${info.sha256} ${info.mode} ${name}\n`).join('');
  if (runtime !== `${INSTALL}/runtime/${sha256(Buffer.from(runtimeInventory))}`) throw Error('runtime content binding');
  await ancestors(runtime);
  for (const [name, info] of Object.entries(manifest)) if (name.startsWith('runtime/')) {
    const target = `${runtime}/${name.slice(8)}`;
    await check(target, info.mode);
    if (sha256(await readFile(target)) !== info.sha256) throw Error('runtime digest');
  }
  // The owner may have ordinary password-requiring administrator rights. Audit
  // every NOPASSWD entry, not those password-protected owner rights.
  const execute = boundedProcess();
  const listing = (await execute({ command: '/usr/bin/sudo', args: ['-n', '-l'], input: Buffer.alloc(0), outputCap: 65536, timeoutMs: 1000 })).toString();
  validateSudoListing(listing);
  let denied = false;
  try { await readdir(AUTHORITY); } catch (error) { denied = ['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? ''); }
  if (!denied) throw Error('owner authority isolation missing');
  const client = createClient();
  const attestation = await client('attest');
  validateAuthorityProtocol(attestation.result, hash);
  const selftest = await client('selftest'); const result = selftest.result as Record<string, unknown>;
  if (result.verified !== true || result.releaseHash !== hash || result.r !== true || JSON.stringify(result.checks) !== JSON.stringify({ authority: true, tcp: true, dns: true, outside: true, python: true, sysv_ipc: true })) throw Error('selftest missing or failed');
  // Invoke sudo with hostile caller env; the installed sudo/launchers must strip it.
  const hostile = execFileSync('/usr/bin/sudo', ['-n', '-u', '_ombcert', `${INSTALL}/bin/cert-launch`, 'attest'], { cwd: '/', env: { NODE_OPTIONS: '--require=/nonexistent/omb-injection.js', DYLD_INSERT_LIBRARIES: '/nonexistent/omb-injection.dylib' }, input: '{}', timeout: 2000, maxBuffer: 65536, encoding: 'utf8' });
  if (JSON.parse(hostile).result.releaseHash !== hash) throw Error('environment injection affected attestation');
  for (const args of [['-n', '-u', '_ombcert', `${INSTALL}/bin/cert-launch`, 'attest', 'extra'], ['-n', '-u', '_ombrun', `${INSTALL}/bin/run-launch`, '../bad']]) {
    let refused = false; try { await execute({ command: '/usr/bin/sudo', args, input: Buffer.from('{}'), outputCap: 65536, timeoutMs: 1000 }); } catch { refused = true; }
    if (!refused) throw Error('forbidden invocation succeeded');
  }
  return { verified: true, releaseHash: hash };
}
export function validateSudoListing(listing: string): void {
  // sudo -l wraps long entries at the terminal width (80 columns without a
  // tty) and indents continuations past the 4-space entry indent. Rejoin them
  // so every entry is audited whole.
  const entries: string[] = [];
  for (const line of listing.split('\n')) {
    if (/^[ \t]{5,}\S/.test(line) && entries.length) entries[entries.length - 1] += ` ${line.trim()}`;
    else entries.push(line);
  }
  const lines = entries.filter(line => line.includes('NOPASSWD:'));
  const commandList = `/usr/local/libexec/omb/bin/cert-launch attest, /usr/local/libexec/omb/bin/cert-launch confirm, /usr/local/libexec/omb/bin/cert-launch selftest, /usr/local/libexec/omb/bin/cert-launch certify`;
  if (lines.length !== 1 || lines[0]!.trim() !== `(_ombcert) NOPASSWD: ${commandList}`) throw Error(`unexpected passwordless sudo delegation: ${JSON.stringify(lines.map(line => line.trim()))}`);
}

/** Owner verification also proves the installed release advertises the new ticket protocol. */
export function validateAuthorityProtocol(value:unknown,releaseHash:string):void {
  const a=value as Record<string,unknown>|null;
  if(!a||a.releaseHash!==releaseHash||a.authorityProtocol!=='omb-authority/v1'||a.certifyProtocol!=='omb-certify/v1'||typeof a.signingPublicKey!=='string')throw Error('authority protocol or release mismatch');
  const key=createPublicKey({key:Buffer.from(a.signingPublicKey,'base64'),format:'der',type:'spki'});
  if(key.asymmetricKeyType!=='ed25519')throw Error('authority signing algorithm');
}
