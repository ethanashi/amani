// SPDX-License-Identifier: AGPL-3.0-only
// Apache components must be usable with only Node and each other.
import ts from 'typescript';
import { readFileSync, readdirSync, realpathSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const packages = ['omb-certificate', 'omb-verifier'];
const builtins = new Set(['node:crypto', 'node:fs', 'node:path']);
export function checkApacheBoundary(root) {
  root = realpathSync(root);
  const roots = packages.map(p => path.join(root, 'packages', p));
  const inside = f => roots.some(r => f.startsWith(r + path.sep));
  const errors = [];
  function checkSpec(spec, file) {
    if (builtins.has(spec) || packages.some(p => spec === '@omerta-bio/' + p.slice(4))) return;
    if (!spec.startsWith('.')) { errors.push(`${file}: forbidden dependency ${spec}`); return; }
    try {
      if (!inside(realpathSync(path.resolve(path.dirname(file), spec)))) errors.push(`${file}: import escapes Apache packages`);
    } catch { errors.push(`${file}: unresolved dependency ${spec}`); }
  }
  function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (lstatSync(file).isSymbolicLink()) { errors.push(`${file}: source symlink forbidden`); continue; }
      if (entry.isDirectory()) { scan(file); continue; }
      if (!/\.(?:ts|js)$/.test(file)) { errors.push(`${file}: unexpected production asset`); continue; }
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      if (source.referencedFiles.length || source.typeReferenceDirectives.length) errors.push(`${file}: external reference directive`);
      function visit(node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) checkSpec(node.moduleSpecifier.text, file);
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) checkSpec(node.argument.literal.text, file);
        if (ts.isImportEqualsDeclaration(node)) errors.push(`${file}: import assignment forbidden`);
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')) {
          if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) errors.push(`${file}: computed dependency forbidden`);
          else checkSpec(node.arguments[0].text, file);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  for (const dir of roots) {
    const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (manifest.license !== 'Apache-2.0' || !readFileSync(path.join(dir, 'LICENSE'), 'utf8').includes('Apache License')) errors.push(`${dir}: Apache licence missing`);
    for (const kind of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
      for (const name of Object.keys(manifest[kind] || {})) {
        if (!packages.some(p => name === '@omerta-bio/' + p.slice(4))) errors.push(`${dir}: forbidden manifest dependency ${name}`);
      }
    }
    scan(path.join(dir, 'src'));
  }
  return errors;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkApacheBoundary(fileURLToPath(new URL('../../', import.meta.url)));
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('Apache verifier and certificate packages: isolated from AGPL engine.');
}
