import ts from 'typescript';

export const CHECKPOINT_ADAPTER = 'packages/omb-amani/src/transport/checkpoint-io.ts';
/** The only registered repair API is persistCheckpoint(write: () => void): void.
 * Its executable dependency closure is deliberately empty. Extending this grammar,
 * adding imports or adding transport entry points requires ordinary owner review.
 * Parse the entire file, not added diff lines: comments and type assertions cannot
 * hide an executable statement. Compare executable syntax after type erasure. */
export function executableSyntax(source: string): string {
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,removeComments:true},reportDiagnostics:true});
  if(js.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw new Error('invalid repair syntax');
  const scanner=ts.createScanner(ts.ScriptTarget.ESNext,true,ts.LanguageVariant.Standard,js.outputText);
  const tokens:string[]=[];
  for(let token=scanner.scan();token!==ts.SyntaxKind.EndOfFileToken;token=scanner.scan())
    tokens.push(token===ts.SyntaxKind.StringLiteral?JSON.stringify(scanner.getTokenValue()):scanner.getTokenText());
  return tokens.join(' ');
}
const bodies=[
  'write();',
  "try { write(); } catch (error) { if (error?.code !== 'ENOSPC') throw error; write(); }",
];
const approved=bodies.map(body=>executableSyntax(`export function persistCheckpoint(write: () => void): void { ${body} }`));
export function assertRepairAPI(source:string):void {
  const file=ts.createSourceFile('adapter.ts',source,ts.ScriptTarget.Latest,true);
  const check=(node:ts.Node):void=>{
    if(ts.isImportDeclaration(node)||ts.isImportEqualsDeclaration(node)||ts.isExportDeclaration(node)||node.kind===ts.SyntaxKind.ImportKeyword)
      throw new Error('all adapter module references, including erased types, are forbidden');
    ts.forEachChild(node,check);
  };check(file);
  if(!approved.includes(executableSyntax(source)))throw new Error('repair exceeds approved stateless checkpoint API (imports, globals and control bypasses forbidden)');
}
/** Cheap early warnings, not a JavaScript security grammar. The author is fallible,
 * not adversarial. Disposable processes and base-owned gates provide isolation. */
export function inspectRegression(source:string):string[] {
  const file=ts.createSourceFile('regression.ts',source,ts.ScriptTarget.Latest,true),issues:string[]=[];
  function visit(node:ts.Node):void {
    if(ts.isImportDeclaration(node)){
      const name=ts.isStringLiteral(node.moduleSpecifier)?node.moduleSpecifier.text:'';
      if(!node.importClause||!['vitest','../src/transport/checkpoint-io.ts'].includes(name))issues.push('unapproved regression dependency');
    }
    if(ts.isExportDeclaration(node)||ts.isImportEqualsDeclaration(node))issues.push('regression reexport/require forbidden');
    ts.forEachChild(node,visit);
  }
  visit(file);
  if(/__vite_ssr_import__|__defineGetter__|__defineSetter__|__proto__|globalThis\s*(?:\.[\w$]+|\[[^\]]+\])\s*=/.test(source))issues.push('loader or global mutation early warning');
  return issues;
}
