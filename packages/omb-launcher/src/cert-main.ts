import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rmdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { OmbStore, runConfirm, type ContentTuple, type StoreCheckpoint } from '../../omb-store/src/index.ts';
import { certifyFromTicket, parseCertifyRequest, CERTIFY_INPUT_CAP } from './certify.ts';
import { AuthoritySession, authorityRequest, AUTHORITY_PROTOCOL } from './authority.ts';
import { signingPublicKey } from './signing.ts';
import { attest } from './attest.ts';
import { AUTHORITY, CERT_UID, REQUEST_CAP, RESPONSE_CAP, isSubcommand, type Subcommand } from './constants.ts';
import { createOSBackend, sha256 } from './os-backend.ts';
import { boundedProcess, LauncherError } from './process.ts';
import { runAnalysis } from './runner.ts';
export async function readRequest(stream: AsyncIterable<Uint8Array>, cap = REQUEST_CAP): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const part of stream) { size += part.length; if (size > cap) throw new LauncherError('request-limit', 'request too large'); chunks.push(Buffer.from(part)); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new LauncherError('refused', 'invalid request'); }
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LauncherError('refused', 'expected object'); return value as Record<string, unknown>; }
async function privateRead(path: string, cap = REQUEST_CAP): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { const s = await file.stat(); if (!s.isFile() || s.uid !== CERT_UID || s.nlink !== 1 || (s.mode & 0o7777) !== 0o600 || s.size > cap) throw new LauncherError('refused', 'private file metadata'); return await file.readFile(); } finally { await file.close(); }
}
async function checkpointWrite(checkpoint: StoreCheckpoint, root = AUTHORITY): Promise<void> {
  const tmp = `${root}/checkpoint-${randomBytes(16).toString('hex')}`;
  try {
    const f = await open(tmp, 'wx', 0o600); try { await f.writeFile(JSON.stringify(checkpoint)); await f.sync(); } finally { await f.close(); }
    await rename(tmp, `${root}/checkpoint.json`);
    const directory = await open(root, 'r'); try { await directory.sync(); } finally { await directory.close(); }
  } finally { await unlink(tmp).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
}
interface Ticket { datasetId: string; partitionId: string; tuple: ContentTuple; executionId: string; artifactHash: string; runtime: 'python' | 'r'; curatedContract: boolean; trainingNetworkEvidence: 'verified-no-egress' | 'egress' | 'unavailable'; trainingNetworkEvidenceHash: string | null }
export async function dispatch(command: Subcommand, request: unknown, releaseHash: string, now: () => number): Promise<unknown> {
  const req = object(request);
  if (command !== 'confirm' && command !== 'certify' && Object.keys(req).length) throw new LauncherError('refused', 'unexpected fields');
  const identity = attest();
  if (command === 'attest') {
    const key = await privateRead(`${AUTHORITY}/host.key`, 32);
    try { return { ...identity, releaseHash, signingPublicKey: signingPublicKey(key), certifyProtocol: 'omb-certify/v1', authorityProtocol: AUTHORITY_PROTOCOL }; } finally { key.fill(0); }
  }
  if (command === 'selftest') return selftest(releaseHash);
  if (command === 'certify' && req.schema === AUTHORITY_PROTOCOL) return dispatchAuthority(req, releaseHash, now);
  if (command === 'certify') parseCertifyRequest(req);
  if ((command === 'confirm' && Object.keys(req).join(',') !== 'ticket') || typeof req.ticket !== 'string' || !/^[a-f0-9]{64}$/.test(req.ticket)) throw new LauncherError('refused', 'authority ticket ID required');
  // Only a ticket written inside authority by the trusted K2b host may configure
  // confirmation. No owner-supplied paths, code, keys, contracts or callbacks.
  const ticketBytes = await privateRead(`${AUTHORITY}/requests/${req.ticket}.json`);
  if (sha256(ticketBytes) !== req.ticket) throw new LauncherError('refused', 'ticket digest');
  const ticket = object(JSON.parse(ticketBytes.toString())) as unknown as Ticket;
  await mkdir(`${AUTHORITY}/active-request`, { mode: 0o700 });
  let store: OmbStore | undefined, hostKey: Buffer | undefined, sealingKey: Buffer | undefined;
  try {
    hostKey = await privateRead(`${AUTHORITY}/host.key`, 32);
    sealingKey = await privateRead(`${AUTHORITY}/seal.key`, 32);
    if (hostKey.length !== 32 || sealingKey.length !== 32) throw new LauncherError('refused', 'authority key size');
    let minimumCheckpoint: StoreCheckpoint | undefined;
    try { minimumCheckpoint = JSON.parse((await privateRead(`${AUTHORITY}/checkpoint.json`)).toString()) as StoreCheckpoint; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try { await lstat(`${AUTHORITY}/store/store.sqlite`); throw new LauncherError('refused', 'existing store requires checkpoint'); }
      catch (missing) { if ((missing as NodeJS.ErrnoException).code !== 'ENOENT') throw missing; }
    }
    store = new OmbStore({ root: `${AUTHORITY}/store`, hostKey, now, separation: 'os-users', ...(minimumCheckpoint ? { minimumCheckpoint } : {}) });
    if (command === 'certify') {
      const result = certifyFromTicket({ request, ticket, store, hostKey, releaseHash, separated: true });
      await checkpointWrite(store.checkpoint());
      return result;
    }
    const backend = createOSBackend({ codeHash: ticket.tuple.frozenCodeHash, artifactHash: ticket.artifactHash, runtime: ticket.runtime }, { releaseHash, persistEvidence: bytes => store!.putArtifact(bytes) });
    const result = await runConfirm({ store, datasetId: ticket.datasetId, partitionId: ticket.partitionId, tuple: ticket.tuple, executionId: ticket.executionId, sealingKey, curatedContract: ticket.curatedContract, trainingNetworkEvidence: ticket.trainingNetworkEvidence, trainingNetworkEvidenceHash: ticket.trainingNetworkEvidenceHash, mode: { kind: 'os-users', backend, attest }, persistCheckpoint: checkpoint => checkpointWrite(checkpoint) });
    await checkpointWrite(store.checkpoint());
    // Do not return predictions, outcomes, decrypted tables, private exceptions,
    // or full store events to the owner account. K2b consumes these internally.
    return { status: result.status, claimCeiling: result.claimCeiling, separation: result.separation, sequestration: result.sequestration, limitation: result.limitation };
  } finally {
    try { store?.close(); } finally { hostKey?.fill(0); sealingKey?.fill(0); await rmdir(`${AUTHORITY}/active-request`); }
  }
}
async function dispatchAuthority(request: unknown, releaseHash: string, now: () => number): Promise<unknown> {
  const req = authorityRequest(request), root = `${AUTHORITY}/sessions/${sha256(req.investigationId)}`;
  await mkdir(`${AUTHORITY}/active-request`, {mode:0o700});
  let store: OmbStore | undefined, hostKey: Buffer | undefined, sealingKey: Buffer | undefined;
  try {
    await mkdir(root, {recursive:true,mode:0o700});
    hostKey = await privateRead(`${AUTHORITY}/host.key`,32);
    sealingKey = await privateRead(`${AUTHORITY}/seal.key`,32);
    let minimumCheckpoint: StoreCheckpoint | undefined;
    try { minimumCheckpoint=JSON.parse((await privateRead(`${root}/checkpoint.json`)).toString()); }
    catch(error) {
      if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
      try { await lstat(`${root}/store/store.sqlite`); throw new LauncherError('refused','session checkpoint missing'); }
      catch(missing) { if((missing as NodeJS.ErrnoException).code!=='ENOENT')throw missing; }
    }
    store=new OmbStore({root:`${root}/store`,hostKey,now,separation:'os-users',...(minimumCheckpoint?{minimumCheckpoint}:{})});
    // Successful retries return the exact signed bytes, never execute a second sealed look.
    const cache=`${root}/reply-${releaseHash}-${sha256(JSON.stringify(req))}.json`;
    const session=new AuthoritySession({store,hostKey,sealingKey,releaseHash,now,attest,
      checkpoint:()=>checkpointWrite(store!.checkpoint(),root),
      backend:(code,training)=>createOSBackend({codeHash:sha256(code),artifactHash:sha256(training),runtime:'python'}, {releaseHash,persistEvidence:bytes=>store!.putArtifact(bytes)})});
    session.validateReplay(req);
    try { return JSON.parse((await privateRead(cache, RESPONSE_CAP)).toString()); }
    catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
    const result=await session.handle(req), bytes=Buffer.from(JSON.stringify(result));
    if(bytes.length>RESPONSE_CAP)throw new LauncherError('response-limit','authority response cap');
    const file=await open(cache,'wx',0o600); try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    const directory=await open(root,'r'); try { await directory.sync(); } finally { await directory.close(); }
    return result;
  } finally { try { store?.close(); } finally { hostKey?.fill(0); sealingKey?.fill(0); await rmdir(`${AUTHORITY}/active-request`); } }
}
async function selftest(releaseHash: string): Promise<unknown> {
  const execute = boundedProcess();
  for (const args of [['bad'], ['a'.repeat(32), 'extra']]) {
    let refused = false;
    try { await execute({ command: '/usr/bin/sudo', args: ['-n', '-u', '_ombrun', '/usr/local/libexec/omb/bin/run-launch', ...args], input: Buffer.alloc(0), outputCap: 1024, timeoutMs: 1000 }); }
    catch (error) { refused = error instanceof LauncherError && error.code === 'refused'; }
    if (!refused) throw new LauncherError('refused', 'runner argument validation unavailable');
  }
  const names = ['authority', 'tcp', 'dns', 'outside', 'python', 'sysv_ipc'], tokens = names.map(sha256);
  const code = Buffer.from(`import os,socket,errno,ctypes\nimport numpy,pandas,scipy\nchecks=[]\ndef denied(f):\n try:\n  f(); return False\n except OSError as e:\n  return e.errno in (errno.EACCES,errno.EPERM)\nchecks.append(denied(lambda: os.listdir('${AUTHORITY}')))\ns=socket.socket(); s.settimeout(0.1)\nchecks.append(denied(lambda: s.connect(('1.1.1.1',443)))); s.close()\ns=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)\nchecks.append(denied(lambda: s.sendto(b'omb-denial-probe',('1.1.1.1',53)))); s.close()\nchecks.append(denied(lambda: open('/var/db/omb-run-tmp/outside-selftest','w')))\nchecks.append(float(numpy.sum([1,2]))==3 and pandas.Series([1]).sum()==1 and scipy.__version__!='')\nlibc=ctypes.CDLL(None,use_errno=True)\ndef ipc_denied(call):\n ctypes.set_errno(0); result=call(); return result == -1 and ctypes.get_errno() in (errno.EPERM,errno.EACCES)\nchecks.append(ipc_denied(lambda:libc.shmget(0x4f4d4211,1,0o1000|0o600)) and ipc_denied(lambda:libc.msgget(0x4f4d4212,0o1000|0o600)) and ipc_denied(lambda:libc.semget(0x4f4d4213,1,0o1000|0o600)))\nwith open(os.environ['OMB_OUTPUT'],'w') as f:\n f.write('token\\tprediction\\n')\n for token,value in zip(${JSON.stringify([...tokens, sha256('sysv-ipc')])},checks): f.write(token+'\\t'+str(int(value))+'\\n')\n`);
  const artifact = Buffer.alloc(0), proofs = new Map<string, Buffer>();
  const backend = createOSBackend({ codeHash: sha256(code), artifactHash: sha256(artifact), runtime: 'python' }, { releaseHash, persistEvidence: bytes => { const hash = sha256(bytes); proofs.set(hash, bytes); return hash; } });
  const result = await backend.execute({ headers: ['token', 'x'], rows: tokens.map(token => [token, 0]), frozenCode: code, trainingArtifact: artifact, network: 'none', acceptedOutput: 'predictions.tsv', runAs: '_ombrun' });
  const values = result.files['predictions.tsv']!.trim().split('\n').slice(1).map(line => line.split('\t')[1] === '1');
  if (values.length !== names.length || values.some(x => !x)) throw new LauncherError('refused', 'containment selftest failed');
  const rCode = Buffer.from(`library(stats)\nlibrary(utils)\nfit <- lm(mpg ~ wt, data=mtcars)\nstopifnot(is.finite(unname(coef(fit)[[2]])), nrow(model.frame(fit)) == 32)\nwriteLines(c("token\\tprediction", "${tokens[0]}\\t1"), Sys.getenv("OMB_OUTPUT"))\n`);
  const r = createOSBackend({ codeHash: sha256(rCode), artifactHash: sha256(artifact), runtime: 'r' }, { releaseHash, persistEvidence: bytes => sha256(bytes) });
  await r.execute({ headers: ['token', 'x'], rows: [[tokens[0]!, 0]], frozenCode: rCode, trainingArtifact: artifact, network: 'none', acceptedOutput: 'predictions.tsv', runAs: '_ombrun' });
  return { verified: true, checks: Object.fromEntries(names.map(name => [name, true])), r: true, releaseHash };
}
async function main(): Promise<void> {
  const release = dirname(fileURLToPath(import.meta.url)), sub = process.argv[2];
  if (sub === 'internal-run' && process.argv.length === 4) { await runAnalysis(process.argv[3]!, release); return; }
  if (process.geteuid!() !== CERT_UID || process.argv.length !== 3 || !isSubcommand(sub)) throw new LauncherError('refused', 'identity or command');
  const releaseHash = sha256(await readFile(`${release}/MANIFEST`));
  if (release.split('/').at(-1) !== releaseHash) throw new LauncherError('refused', 'release binding');
  const deadline = setTimeout(() => { process.stderr.write('request deadline\n'); process.exit(75); }, 5_000);
  try {
    const request = await readRequest(process.stdin, sub === 'certify' ? CERTIFY_INPUT_CAP : REQUEST_CAP);
    clearTimeout(deadline);
    const result = await dispatch(sub, request, releaseHash, Date.now);
    const reply = JSON.stringify({ ok: true, command: sub, result });
    if (Buffer.byteLength(reply) > RESPONSE_CAP) throw new LauncherError('response-limit', 'response cap');
    process.stdout.write(reply + '\n');
  } finally { clearTimeout(deadline); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) void main().catch(error => { process.stderr.write('launcher refused or unavailable\n'); process.exitCode = error instanceof LauncherError && error.code === 'unavailable' ? 69 : 77; });
