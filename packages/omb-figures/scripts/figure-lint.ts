import { readFileSync } from 'node:fs';
import { auditPublicationSvg, AUDIT_EXIT } from '../src/publication-audit.ts';
try {
 const path=process.argv[2];const result=auditPublicationSvg(path?readFileSync(path,'utf8'):undefined);
 process.stdout.write(JSON.stringify(result,null,2)+'\n');process.exitCode=result.exitCode;
} catch(error) {
 process.stderr.write(JSON.stringify({state:'ERROR',exitCode:AUDIT_EXIT.ERROR,findings:[{code:'read-error',detail:String(error)}]})+'\n');process.exitCode=AUDIT_EXIT.ERROR;
}
