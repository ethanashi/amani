import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const mutations=JSON.parse(readFileSync(new URL('./pw8-round1-mutants.json',import.meta.url),'utf8'));
const mutant=mutations.find(m=>m.id===process.env.PW8_ROUND1_MUTANT);
export default {
 plugins: mutant ? [{name:'pw8-round1-directed-mutant',enforce:'pre',transform(code,id){
  if(id.split('?')[0]!==root+'packages/omb-report/src/'+mutant.file)return;
  if(code.split(mutant.from).length!==2)throw Error('mutation site is not unique: '+mutant.id);
  process.stderr.write('APPLIED '+mutant.id+'\n');
  return {code:code.replace(mutant.from,()=>mutant.to),map:null};
 }}] : [],
 test:{include:['packages/omb-report/test/pw8-review.test.ts','packages/omb-report/test/pw8-release.test.ts'],testTimeout:10000,hookTimeout:10000,pool:'forks'}
};
