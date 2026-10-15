import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const cases={
 annotation:{file:'pdf.ts',primary:['if (uri instanceof PStr) annotations.push(','if (false) annotations.push('],secondary:["annotations.push({key:'annotation', value:'undeclared annotation'});",'']},
 textbox:{file:'docx.ts',primary:["else if (t === 'txbxContent' || t === 'textbox') find(",'else if (false) find('],secondary:['findings.push(...checkDocumentGrammar(doc));','']},
 owner:{file:'docx.ts',primary:['const hidden = [...x.findings, ...styleIssues(x, profile)];','const hidden = [...styleIssues(x, profile)];'],secondary:['if (channels.length) return fail(channels);','']},
};
const selected=cases[process.env.PW8_OVERLAP_CASE],layer=process.env.PW8_OVERLAP_LAYER;
export default {plugins:selected?[{name:'pw8-overlap-proof',enforce:'pre',transform(code,id){
 if(id.split('?')[0]!==root+'packages/omb-report/src/reverify/'+selected.file)return;
 for(const [from,to] of layer==='both'?[selected.primary,selected.secondary]:[selected[layer]]){if(code.split(from).length!==2)throw Error('overlap site changed');code=code.replace(from,()=>to);}
 process.stderr.write('APPLIED OVERLAP '+process.env.PW8_OVERLAP_CASE+' '+layer+'\n');return {code,map:null};
}}]:[],test:{include:['packages/omb-report/test/pw8-overlap.test.ts'],pool:'forks',maxWorkers:1}};
