// Shared by the standalone release builder and Studio's engine packager.
// Keep the identical module in both branches until their normal integration merge.
export const MEDIC_REPAIR_PREFIX = 'packages/omb-amani/src/medic/';
export function excludesMedicRuntime(file) {
  return file.startsWith(MEDIC_REPAIR_PREFIX) || file === 'packages/omb-amani/src/cli.ts';
}
export function releaseSource(file, source) {
  if (file === 'packages/omb-amani/src/engine.ts') {
    const begin = '// BEGIN TEMPORARY MEDIC SEAM', end = '// END TEMPORARY MEDIC SEAM';
    if (source.includes(begin) !== source.includes(end)) throw Error('incomplete medic seam markers');
    source = source.replace(/^[ \t]*\/\/ BEGIN TEMPORARY MEDIC SEAM[\s\S]*?\/\/ END TEMPORARY MEDIC SEAM\r?\n/m, '');
  }
  if (file.startsWith('packages/omb-amani/src/') && /(?:from\s*|import\s*\()['"]\.\/medic\//.test(source))
    throw Error(`release entry imports repair runtime: ${file}`);
  if (file === 'packages/omb-amani/package.json') {
    const manifest = JSON.parse(source);
    if (manifest.bin?.['amani-dev']) {
      delete manifest.bin['amani-dev'];
      manifest.bin.amani = './src/release-cli.ts';
    }
    source = JSON.stringify(manifest, null, 2) + '\n';
  }
  return source;
}
