/** Called only inside the author-only grading scratch. Emits categories/counts, never truth. */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { verifyContractBytes } from '../../omb-certify/src/contract-verifier.ts';
const [task,raw,publicPath,privatePath,assets]=process.argv.slice(2) as [string,string,string,string,string];
const pub=JSON.parse(readFileSync(publicPath,'utf8')),priv=JSON.parse(readFileSync(privatePath,'utf8'));
const files=new Map(readdirSync(raw).map(n=>[n,readFileSync(path.join(raw,n))]));
for(const n of readdirSync(assets))files.set('contract-assets/'+n,readFileSync(path.join(assets,n)));
const result=verifyContractBytes({public:pub,sealed_private:priv},files,{expectedContractHash:pub.hash,expectedPrivateContractHash:priv.hash,requirePrivate:true});
console.log(JSON.stringify({task,verified:result.ok,...(!result.ok?{code:result.code}:{tables:result.value.tables.size})}));
process.exitCode=result.ok?0:1;
