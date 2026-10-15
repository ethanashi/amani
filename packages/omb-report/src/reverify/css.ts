import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { requireThat } from '../common.ts';
/** A deliberately small local-file CSS closure. Unknown URL/escape syntax fails closed. */
export function verifyCssClosure(entry: string, assets: ReadonlyMap<string, string | Uint8Array>, hashes: Readonly<Record<string,string>>): void {
 const visited = new Set<string>();
 const resolve = (from: string, target: string) => {
  requireThat(/^[A-Za-z0-9_.\/-]+$/u.test(target) && !target.startsWith('/'), 'CSS: unsupported asset URL');
  const path = posix.normalize(posix.join(posix.dirname(from),target));
  requireThat(!path.startsWith('../'), 'CSS: asset escapes closure'); return path;
 };
 const visit = (path: string, css: boolean) => {
  if (visited.has(path)) return;
  visited.add(path);
  const bytes = assets.get(path);
  requireThat(bytes !== undefined && hashes[path] === createHash('sha256').update(bytes).digest('hex'), `CSS: missing or changed closure asset ${path}`);
  if (!css) return;
  let source = Buffer.from(bytes).toString('utf8').replace(/\/\*[\s\S]*?\*\//gu,'');
  requireThat(!source.includes('\\') && !source.includes('/*'), 'CSS: unsupported escape or comment');
  requireThat(!/(?:^|[;{])\s*(?:content|counter-increment|counter-reset|list-style(?:-type)?)\s*:/iu.test(source), 'CSS: generated content is forbidden');
  source = source.replace(/@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*;/giu, (_all, target: string) => { visit(resolve(path,target),true); return ''; });
  requireThat(!/@import/iu.test(source), 'CSS: unsupported import syntax');
  source = source.replace(/url\(\s*(?:"([^"\n]+)"|'([^'\n]+)'|([^\s()"']+))\s*\)/giu, (_all,a: string,b: string,c: string) => { visit(resolve(path,a??b??c),false); return ''; });
  requireThat(!/url\s*\(|(?:image-set|src|local|paint)\s*\(/iu.test(source), 'CSS: unsupported URL syntax');
 };
 visit(entry,true);
 requireThat(Object.keys(hashes).every(path => visited.has(path)), 'CSS: profile contains unreachable closure assets');
}
