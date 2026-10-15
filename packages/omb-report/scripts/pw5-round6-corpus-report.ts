import {readFileSync,writeFileSync} from 'node:fs';
import ts from 'typescript';
import {canonicalSha256} from '../../bio-core/src/index.ts';
import {assessAIProse} from '../src/ai-prose.ts';
import {assessMethodsNarrative} from '../src/methods-narrative.ts';
import {createReportContext} from '../src/context.ts';
import {fixture} from '../test/fixtures.ts';
import {methodsFixture} from '../test/pw5-fixtures.ts';
// Read the literal regression corpus without importing Vitest into this script.
function corpus(file:string,name:string):string[]{
 const ast=ts.createSourceFile(file,readFileSync(new URL('../test/'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 let rows:string[]|undefined;
 const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name&&n.initializer&&ts.isArrayLiteralExpression(n.initializer)){rows=n.initializer.elements.map(e=>{if(!ts.isStringLiteral(e))throw Error('Nonliteral corpus entry');return e.text;});}ts.forEachChild(n,visit);};visit(ast);
 if(!rows?.length)throw Error('Missing corpus '+name);return rows;
}
const prior=JSON.parse(readFileSync(new URL('../test/pw5-round5-corpus.json',import.meta.url),'utf8')) as {text:string;honest:boolean}[];
const ctx=createReportContext(fixture()),methodCtx=methodsFixture().ctx;
const ai=prior.concat(corpus('pw5-round6-ai.test.ts','evasions').map(text=>({text,honest:false})));
function assess(rows:{text:string;honest:boolean}[],check:(text:string)=>{flags:{reason:string}[]}){
 const results=rows.map(row=>{try{const flags=check(row.text).flags;return {...row,outcome:flags.length?'flagged':'allowed',reasons:flags.map(f=>f.reason)};}catch(e){return {...row,outcome:'blocked',reasons:[String(e)]};}});
 const count=(honest:boolean)=>Object.fromEntries(['allowed','flagged','blocked'].map(outcome=>[outcome,results.filter(r=>r.honest===honest&&r.outcome===outcome).length]));
 return {honest:count(true),evasion:count(false),results};
}
const methods=[...corpus('pw5-round6-methods.test.ts','controls').map(text=>({text,honest:true})),...corpus('pw5-round6-methods.test.ts','contradictions').map(text=>({text,honest:false}))];
const report={scope:'AI corpus at AI boundary; Methods corpus directly at record comparison boundary (additional end-to-end tests cover six regions)',ai:assess(ai,text=>assessAIProse(ctx,text)),methods:assess(methods,text=>assessMethodsNarrative(methodCtx,text)),sourceHashes:Object.fromEntries(['ai-prose.ts','ai-fuzzy.ts','methods-narrative.ts'].map(file=>[file,canonicalSha256(readFileSync(new URL('../src/'+file,import.meta.url),'utf8'))]))};
writeFileSync(new URL('../PW5-FIX6-CORPUS-RESULTS.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ai:{honest:report.ai.honest,evasion:report.ai.evasion},methods:{honest:report.methods.honest,evasion:report.methods.evasion}}));
if(report.ai.results.some(r=>r.honest?r.outcome==='blocked':r.outcome==='allowed')||report.methods.results.some(r=>r.honest?r.outcome==='blocked':r.outcome!=='blocked'))process.exitCode=1;
