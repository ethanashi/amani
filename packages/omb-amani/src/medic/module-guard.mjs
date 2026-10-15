// Host-owned Node 24 gate loader. Generated scratch is never a module source.
import { registerHooks } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const manifest=JSON.parse(readFileSync(process.env.AMANI_GATE_MANIFEST,'utf8'));
registerHooks({load(url,context,next){
  if(url.startsWith('file:')){
    const file=realpathSync(fileURLToPath(url));
    const expected=manifest[file];
    if(!expected || createHash('sha256').update(readFileSync(file)).digest('hex')!==expected)
      throw new Error('unreviewed gate module refused: '+file);
  }
  return next(url,context);
}});
