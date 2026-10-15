/** Deterministic AST enumeration, independent of test results. No sampling or score filtering. */
import ts from 'typescript';
export interface SourceMutant {id:string;file:string;from:string;to:string;start?:number;end?:number;operator?:string}
export function generateConditionMutants(file:string,source:string):SourceMutant[] {
 const root=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),out:SourceMutant[]=[];
 const add=(node:ts.Node,to:string,operator:string,variant='')=>{
  const start=node.getStart(root),end=node.getEnd(),from=source.slice(start,end),line=root.getLineAndCharacterOfPosition(start).line+1;
  out.push({id:`AUTO ${file}:${line}:${start}-${end}:${operator}${variant}`,file,from,to,start,end,operator});
 };
 const logical=(node:ts.Node):node is ts.BinaryExpression=>ts.isBinaryExpression(node)&&[ts.SyntaxKind.BarBarToken,ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind);
 const visit=(node:ts.Node):void=>{
  if(ts.isIfStatement(node)) add(node.expression,`!(${node.expression.getText(root)})`,'negate-if-condition');
  if(logical(node)&&!(logical(node.parent)&&node.parent.operatorToken.kind===node.operatorToken.kind)) {
   const operands:ts.Expression[]=[];
   const flatten=(part:ts.Expression):void=>{
    if(logical(part)&&part.operatorToken.kind===node.operatorToken.kind) {flatten(part.left);flatten(part.right);} else operands.push(part);
   };flatten(node);
   operands.forEach((_,i)=>add(node,'('+operands.filter((_,j)=>i!==j).map(p=>p.getText(root)).join(` ${node.operatorToken.getText(root)} `)+')','drop-logical-operand',`:${i}`));
  }
  if(ts.isConditionalExpression(node)) [node.whenTrue,node.whenFalse].forEach((branch,i)=>add(node,`(${branch.getText(root)})`,'force-ternary-branch',`:${i}`));
  ts.forEachChild(node,visit);
 };visit(root);return out;
}
