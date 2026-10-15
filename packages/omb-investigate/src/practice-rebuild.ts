/** Deliberately tiny separate-process entry point. No source-data path is accepted. */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {renderPractice} from './practice-provenance.ts';
import {writePhysical} from './physical-format.ts';
const [, ,input,out]=process.argv;
if(!input||!out)throw new Error('Rebuild requires inventory and output paths');
const allowed=JSON.parse(readFileSync(input,'utf8'));
mkdirSync(out,{recursive:true});writePhysical(out,renderPractice(allowed));

if(allowed.schema!==undefined){mkdirSync(out+'-schema',{recursive:true});writeFileSync(out+'-schema/schema.json',JSON.stringify(allowed.schema,null,2)+'\n');}
