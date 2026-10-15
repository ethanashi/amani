import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
export const mutants=JSON.parse(readFileSync(new URL('./pw8-mutants.json',import.meta.url),'utf8')).mutants.map(m=>({...m,...({
 'F-figure-exact':{from:'const explained = figure !== null && figureEnd === found;',to:'const explained = figure !== null;'},
 'P-invisible':{from:'invisible: mode !== 0 || white || opacity < 1,',to:'invisible: false,'},
 'D-readback-findings':{from:'const hidden = [...x.findings, ...styleIssues(x, profile)];',to:'const hidden = [...styleIssues(x, profile)];'},
}[m.id]??{})}));
const mutant=mutants.find(m=>m.id===process.env.PW8_MERGED_MUTANT);
export default {plugins:mutant?[{name:'pw8-merged-mutant',enforce:'pre',transform(code,id){
 if(id.split('?')[0]!==root+'packages/omb-report/src/'+mutant.file)return;
 if(code.split(mutant.from).length!==2)throw Error('mutation site is not unique: '+mutant.id);
 process.stderr.write('APPLIED '+mutant.id+'\n');return {code:code.replace(mutant.from,()=>mutant.to),map:null};
}}]:[],test:{include:['packages/omb-report/test/pw8-*.test.ts'],testTimeout:10000,hookTimeout:10000,pool:'forks'}};
