import { readFileSync } from 'node:fs';
/** Vendored OFL fonts; no system-font resolution and no network at render time. */
export function embeddedFonts(): string {
  return '<defs><style>' + ['Sans', 'Serif'].map(family => {
    const data = readFileSync(new URL(`../vendor/fonts/Liberation${family}-Regular.ttf`, import.meta.url)).toString('base64');
    return `@font-face{font-family:'Liberation ${family}';font-weight:400;src:url(data:font/ttf;base64,${data}) format('truetype');}`;
  }).join('') + '</style></defs>';
}
export function embedPublicationFonts(svg: string): string {
  return svg.replace(/(<svg\b[^>]*>)/u, '$1' + embeddedFonts()).replaceAll('Helvetica, Arial, sans-serif', 'Liberation Sans');
}
