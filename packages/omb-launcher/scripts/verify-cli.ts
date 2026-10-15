import { verifyInstall } from '../src/verify.ts';
try { console.log(JSON.stringify(await verifyInstall(process.argv[2] ?? ''))); }
catch { console.error('Installation verification failed or unavailable; no passed evidence.'); process.exitCode = 1; }
