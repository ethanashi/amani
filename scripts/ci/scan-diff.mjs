import { auditTree } from '../publish/audit.mjs';
const findings = auditTree(process.argv[2]).findings.filter(f => ['secret', 'personal-email'].includes(f.category));
for (const f of findings) console.log(JSON.stringify(f));
console.log(`${findings.length} secret/personal-email findings in changed files (values redacted)`);
process.exitCode = findings.length ? 1 : 0;
