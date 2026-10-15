/**
 * Regenerates the PW8 PDF and DOCX fixtures from the synthetic signed HTML with the same tools the
 * PW9 chain uses: headless Chrome (print to PDF) and pandoc (HTML to DOCX). Not run by the test
 * suite. Usage: node packages/omb-report/scripts/pw8-render-fixtures.ts
 * The temporary render directory is deleted before exit.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDocx, extractPdf, trustedPdfLayout } from '../src/reverify/index.ts';
import { baseHtml, forest, base } from '../test/pw8-fixture.ts';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PANDOC = process.env.PANDOC ?? 'pandoc';
const SOURCE_DATE_EPOCH = '1760000000';
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/pw8-fixtures');
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env, timeout: 120_000 });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr}`);
  return r.stdout;
};

const work = mkdtempSync(path.join(tmpdir(), 'pw8-render-'));
try {
  mkdirSync(path.join(work, 'figures'));
  writeFileSync(path.join(work, 'paper.html'), baseHtml);
  writeFileSync(path.join(work, 'figures', `${forest.id}.svg`), forest.svg);
  run(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--user-data-dir=${path.join(work, 'profile')}`, `--print-to-pdf=${path.join(work, 'paper.pdf')}`, `file://${path.join(work, 'paper.html')}`]);
  run(PANDOC, ['-f', 'html', '-t', 'docx', path.join(work, 'paper.html'), '-o', path.join(work, 'paper.docx'), `--resource-path=${work}`], { ...process.env, SOURCE_DATE_EPOCH });
  const pdf = readFileSync(path.join(work, 'paper.pdf'));
  const docx = readFileSync(path.join(work, 'paper.docx'));
  const pdfExtracted = extractPdf(pdf);
  const { Title: _title, ...pdfInfo } = pdfExtracted.info;
  const x = extractDocx(docx);
  const docxProperties = Object.fromEntries(Object.entries(x.properties).filter(([k]) => !['core:title', 'core:description', 'core:keywords'].includes(k)));
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'paper.pdf'), pdf);
  writeFileSync(path.join(out, 'paper.docx'), docx);
  const profile = {
    schema: 'omb/pw8/chain-profile@1',
    note: 'Pinned values a PW9 chain would record for this render. Synthetic fixture only.',
    tools: { chrome: run(CHROME, ['--version']).trim(), pandoc: run(PANDOC, ['--version']).split('\n')[0]!.trim(), sourceDateEpoch: SOURCE_DATE_EPOCH },
    htmlSha256: sha(baseHtml), pdfSha256: sha(pdf), docxSha256: sha(docx),
    pdfInfo, pdfFontSha256: pdfExtracted.fontSha256,
    pdfLayout: trustedPdfLayout(pdfExtracted,base),
    docxStyleParts: x.styleParts, docxStyleReferences: [...new Set(x.styleReferences)],
    docxProperties, docxMediaSha256: x.referencedMedia,
  };
  writeFileSync(path.join(out, 'chain-profile.json'), JSON.stringify(profile, null, 2) + '\n');
  process.stdout.write(`wrote ${out}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
