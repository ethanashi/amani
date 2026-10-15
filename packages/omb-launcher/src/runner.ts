import { constants } from 'node:fs';
import { chmod, lstat, mkdtemp, open, readFile, realpath, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { CERT_UID, RESPONSE_CAP, RUN_UID, STAGE } from './constants.ts';
import { boundedProcess, LauncherError } from './process.ts';
export async function runAnalysis(id: string, release: string): Promise<void> {
  if (process.geteuid!() !== RUN_UID || !/^[a-f0-9]{32}$/.test(id)) throw new LauncherError('refused', 'runner identity or ID');
  const stage = `${STAGE}/${id}`, s = await lstat(stage);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== CERT_UID || (s.mode & 0o7777) !== 0o755) throw new LauncherError('refused', 'stage ownership');
  for (const name of ['runtime', 'release', 'features.tsv', 'training.bin']) {
    const f = await lstat(`${stage}/${name}`);
    if (!f.isFile() || f.isSymbolicLink() || f.uid !== CERT_UID || (f.mode & 0o7777) !== 0o444 || f.nlink !== 1) throw new LauncherError('refused', 'stage file ownership');
  }
  if ((await readFile(`${stage}/release`, 'utf8')) !== release.split('/').at(-1)) throw new LauncherError('refused', 'release changed during dispatch');
  const language = await readFile(`${stage}/runtime`, 'utf8');
  if (language !== 'python' && language !== 'r') throw new LauncherError('refused', 'runtime');
  const entry = `${stage}/${language === 'python' ? 'entry.py' : 'entry.R'}`;
  const e = await lstat(entry);
  if (!e.isFile() || e.uid !== CERT_UID || (e.mode & 0o7777) !== 0o444 || e.nlink !== 1) throw new LauncherError('refused', 'entry ownership');
  // Runtime is copied, never symlinked, into each release. Binaries use relative
  // loader paths; R_HOME and R executable arguments supply the relocated prefix.
  const runtime = (await readFile(`${release}/runtime-prefix`, 'utf8')).trim();
  if (!/^\/usr\/local\/libexec\/omb\/runtime\/[a-f0-9]{64}$/.test(runtime)) throw new LauncherError('refused', 'runtime prefix');
  const tmp = await mkdtemp('/private/var/db/omb-run-tmp/run-');
  try {
    await chmod(tmp, 0o700);
    const canonicalStage = await realpath(stage), canonicalTmp = await realpath(tmp);
    if (canonicalStage !== stage || canonicalTmp !== tmp) throw new LauncherError('refused', 'stage or tmp is not a physical path');
    const environment = { PATH: '/usr/bin:/bin', HOME: '/var/empty', LANG: 'C', TMPDIR: tmp, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1', R_HOME: `${runtime}/lib/R`, RHOME: `${runtime}/lib/R`, R_ENVIRON_USER: '/dev/null', R_PROFILE_USER: '/dev/null', R_LIBS_USER: '/nonexistent', OMB_FEATURES: `${stage}/features.tsv`, OMB_TRAINING: `${stage}/training.bin`, OMB_OUTPUT: `${tmp}/predictions.tsv` };
    // Rscript uses a root-owned exec-only C frontend in place of conda's shell.
    const binary = language === 'python' ? `${runtime}/bin/python3.13` : `${runtime}/lib/R/bin/Rscript`;
    const args = language === 'python' ? ['-I', '-B', entry] : ['--vanilla', entry];
    const { spawn } = await import('node:child_process');
    const execute = boundedProcess({ spawn: (command, argv) => spawn(command, argv, { cwd: tmp, env: { ...environment, R_SHARE_DIR: `${runtime}/lib/R/share`, R_INCLUDE_DIR: `${runtime}/lib/R/include`, R_DOC_DIR: `${runtime}/lib/R/doc` }, stdio: ['pipe', 'pipe', 'pipe'] }), timer: setTimeout, clearTimer: clearTimeout });
    await execute({ command: '/usr/bin/sandbox-exec', args: ['-f', `${release}/run.sb`, '-D', `STAGE=${canonicalStage}`, '-D', `RUNTIME=${runtime}`, '-D', `TMP=${canonicalTmp}`, binary, ...args], input: Buffer.alloc(0), outputCap: 65_536, timeoutMs: 20_000 });
    const file = await open(`${tmp}/predictions.tsv`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.uid !== RUN_UID || info.nlink !== 1 || info.size > RESPONSE_CAP) throw new LauncherError('refused', 'output file');
      await pipeline(file.createReadStream({ autoClose: false, end: RESPONSE_CAP }), process.stdout);
    } finally { await file.close(); }
  } finally { await rm(tmp, { recursive: true, force: true }); }
}
