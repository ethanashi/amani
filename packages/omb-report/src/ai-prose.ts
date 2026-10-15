import {canonicalSha256} from '../../bio-core/src/index.ts';
import {type ReportContext,assertContext} from './context.ts';
import {record,requireThat} from './common.ts';
import {confusableSkeleton} from './normalise.ts';
import {fuzzyNameHits} from './ai-fuzzy.ts';

// Display text is never rewritten. These folds are only for security comparisons.
const lookalikes:Record<string,string>={ø:'o',ł:'l',đ:'d',ǥ:'g',ƈ:'c',ɋ:'q',ɑ:'a',ɢ:'g',ʊ:'u',ɗ:'d',ʀ:'r',ɴ:'n',ʟ:'l',ɘ:'e',æ:'a',ᴀ:'a',ʙ:'b',ᴄ:'c',ᴅ:'d',ᴇ:'e',ꜰ:'f',ʜ:'h',ɪ:'i',ᴊ:'j',ᴋ:'k',ᴌ:'l',ᴍ:'m',ᴏ:'o',ᴘ:'p',ꜱ:'s',ᴛ:'t',ᴜ:'u',ᴠ:'v',ᴡ:'w',ʏ:'y',ᴢ:'z'};
export function aiComparisonKey(text:string):string {
 const fold=(s:string)=>[...s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/ß/gu,'ss')].map(c=>lookalikes[c]??c).join('');
 return [...fold(text)].map(c=>/[a-z0-9]/u.test(c)?c:fold(confusableSkeleton(c))).join('');
}
/** Literal catalog, versioned with the checker. Tests pin every member independently. */
export const AI_PRODUCTS=Object.freeze(['Claude','ChatGPT','GPT','Codex','Gemini','Llama','Mistral','Mixtral','Grok','DeepSeek','Qwen','Gemma','Bard','Copilot','Perplexity','AutoGPT','Haiku','Sonnet','Opus','Fable','Astra','Omerta Bio','xAI','Devin','Cursor','Kimi','Phi','Cohere','Elicit','Grammarly','QuillBot','BioGPT','PaLM','Galactica','Ernie','Bing Chat','Jasper','Mythos','Windsurf','o3','o4-mini']);
const companies=['Meta','Google','Microsoft','Anthropic','OpenAI','DeepMind','Hugging Face'];
const patterns=new Map<string,RegExp>();
function expression(name:string):RegExp {
 let re=patterns.get(name);if(re)return re;
 const letters=[...aiComparisonKey(name).replace(/[\s\p{P}]/gu,'')];
 const body=letters.map(c=>c.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')).join('[\\s\\p{P}]*');
 re=new RegExp(`(?<![\\p{L}\\p{N}])${body}${name==='GPT'?'(?:[\\s\\p{P}]*[0-9]+[a-z0-9-]*)?':''}(?![\\p{L}\\p{N}])`,'gu');patterns.set(name,re);return re;
}
const words=(text:string)=>text;
const attribution=/\b(?:write|writes|wrote|written|draft\w*|author\w*|ghostwrit\w*|generat\w*|compos\w*|penned|rewr\w*|edited|craft\w*|prepared|implemented|performed|conceptualized|supervised|reviewed|checked|carried out|did the writing|produced|created|assisted|helped)\b/u;
const work=/\b(?:paper|manuscript|discussion|abstract|introduction|section|text|prose|code\w*|script\w*|analysis|analyses|writing|study|work|project|author\w*)\b/u;
function suspicious(text:string):boolean{return attribution.test(words(text))||/\b(?:used|using|involved|assisted|assistance|assisting)\b/u.test(text);}
/** Exceptions apply only to the occurrence's sentence and never to attribution.
 * Abbreviation definitions may be elsewhere in this same draft, not guessed. */
function scientific(name:string,sentence:string,paper:string):boolean {
 if(attribution.test(words(sentence)))return false;
 const n=name.toLowerCase();
 const rules:Record<string,RegExp>={
  claude:/\bclaude bernard\b/u,gemma:/\bgemma jones\b/u,bard:/\bbard college\b/u,
  gpt:/\b(?:serum|enzyme|aminotransferase|transaminase|alanine|liver)\b/u,
  llama:/\b(?:nanobod\w*|antibod\w*|camelid\w*|alpaca\w*)\b/u,
  gemini:/\b(?:trial|cohort|registry|study)\b/u,astra:/\b(?:trial|registry|platform|zeneca)\b/u,
  codex:/\b(?:imaging|alimentarius|ancient|manuscript collection)\b/u,
  opus:/\b(?:spectroscopy|magnum|opus of work)\b/u,sonnet:/\b(?:poem|memorial|poetry)\b/u,haiku:/\b(?:poem|poetry)\b/u,
  mistral:/\b(?:wind|weather)\b/u,phi:/\b(?:angle|coefficient|distribution)\b/u,
 };
 // Compare rules against the normalized sentence, never a different occurrence.
 const plain=sentence;
 if(rules[n]?.test(plain))return true;
 if(n==='ai')return /(?:aromatase inhibitor|allelic imbalance|adequate intake)\s*\(ai\)|ai\s*\((?:aromatase inhibitor|allelic imbalance|adequate intake)\)/u.test(paper);
 return false;
}
export interface AIReviewFlag {id:string;reason:string;paperHash:string;proseHash:string}
export interface AIProseAssessment {paperHash:string;proseHash:string;flags:AIReviewFlag[]}
export function assessAIProse(ctx:ReportContext,prose:string):AIProseAssessment {
 assertContext(ctx);
 const reasons=aiProseReasons(ctx.input.runMetadata,prose),proseHash=canonicalSha256(prose);
 const flags=reasons.map(reason=>({id:canonicalSha256({paperHash:ctx.input.sha256,proseHash,reason}),paperHash:ctx.input.sha256,proseHash,reason}));
 return {paperHash:ctx.input.sha256,proseHash,flags};
}
/** Pre-results lexical screening only; this cannot issue paper-bound review evidence.
 * Final assembly repeats assessment with the authenticated full ReportContext. */
export function checkBlindAIProse(prose:string):void {aiProseReasons({},prose);}
function aiProseReasons(runMetadata:unknown,prose:string):string[] {
 requireThat(typeof prose==='string'&&prose.length<=200_000,'invalid AI prose');
 requireThat(!/\p{Cf}|\p{Default_Ignorable_Code_Point}|[\u2800\u3164\uffa0\u115f\u1160]/u.test(prose),'AI disclosure: invisible prose character');
 const key=aiComparisonKey(prose),reasons=new Set<string>();
 requireThat(!/\b(?:written|generated|drafted|authored) by (?:a |an |the )?(?:large )?language models?\b/u.test(key),'AI attribution requires the software-generated AI-use disclosure section');
 const repair='AI mentions, authorship and AI credit require the software-generated AI-use disclosure section';
 // Provider names never become model names. Opaque run IDs are not product labels.
 const names=[...AI_PRODUCTS],providers=new Set(companies);
 for(const model of Array.isArray(record(runMetadata).models)?record(runMetadata).models as unknown[]:[]){const m=record(model);if(typeof m.provider==='string')providers.add(m.provider);if(typeof m.name==='string'&&!companies.some(c=>aiComparisonKey(c)===aiComparisonKey(m.name as string)))names.push(m.name);}
 const local=(index:number,end:number)=>{
  // Do not split on periods internal to a spaced/obfuscated model occurrence.
  const left=key.slice(0,index).split(/[.!?](?:\s|$)/u).at(-1)??'';
  const right=key.slice(end).split(/[.!?](?:\s|$)/u)[0]??'';
  return left+key.slice(index,end)+right;
 };
 for(const phrase of ['AI written','AI generated'])requireThat(![...key.matchAll(expression(phrase))].length,repair);
 for(const name of names)for(const hit of key.matchAll(expression(name))){const sentence=local(hit.index,hit.index+hit[0].length);requireThat(scientific(name,sentence,key),repair);}
 // A misspelling is never silently accepted. No fixed list of work objects is
 // involved: attribution to a near-name blocks; other near-names need review.
 for(const hit of fuzzyNameHits(key,names.map(aiComparisonKey))){
  const sentence=local(hit.start,hit.end);
  const repaired=sentence.replace(key.slice(hit.start,hit.end),aiComparisonKey(hit.name));
  if(scientific(hit.name,repaired,key))continue;
  const passive=/\bby\s+(?:the\s+)?$/u.test(key.slice(0,hit.start));
  requireThat(!attribution.test(sentence)&&!passive,repair);
  reasons.add('possible-ai-name:'+aiComparisonKey(hit.name));
 }
 // AI is a whole token, never the start of "A is". Generic scientific language
 // remains reviewable; explicit attribution/use is the blocking case.
 for(const name of ['AI','LLM','language model','artificial intelligence','generative AI','chatbot','chatbots','LLMs','language models','neural network','neural networks']){
  for(const hit of key.matchAll(expression(name))){const sentence=local(hit.index,hit.index+hit[0].length);if(scientific(name,sentence,key))continue;
   if(!attribution.test(sentence)&&/\b(?:radiology|neuroscience|image segmentation|scientific questions|motor cortex)\b/u.test(sentence)){reasons.add('generic-ai-language');continue;}
   if(!attribution.test(sentence)&&/\b(?:neural networks?|artificial intelligence)\b/u.test(name.toLowerCase())){if(name==='artificial intelligence')reasons.add('generic-ai-language');continue;}
   requireThat(!(suspicious(sentence)&&(/\b(?:ai|llm|chatbot)\b/u.test(aiComparisonKey(name))||work.test(words(sentence))||/\b(?:used|involved|assisted)\b/u.test(sentence))),repair);
   if(!name.startsWith('neural network'))reasons.add('generic-ai-language');
  }
 }
 // Plural/compound generics, unknown agents and indirect attribution belong to
 // the high-recall tier, never a subject-agnostic prose refusal.
 if(/\b(?:automated assistant|computer.generated|software agent|genai|machine.generated|virtual assistant|digital assistant|autonomous agent|conversational agent|synthetic author|text generator|foundation model|generative model|llms|chatbots|aiassistant|generativeai|ai.written|ai.generated)\b/u.test(key)||attribution.test(words(key))&&work.test(words(key)))reasons.add('possible-ai-contribution');
 for(const company of providers)if([...key.matchAll(expression(company))].length)reasons.add('provider-mention');
 // Unknown spellings cannot silently turn a writing/use assertion into prose.
 if(/\bhumans? did not write\b/u.test(key))reasons.add('possible-ai-contribution');
 if(suspicious(key)&&/\b(?:assistant|agent|bot|bots|machine|machines|computer|algorithm|pipeline|system|systems|tool|transformer|network|autocomplete|model|models|robot|software|auto.generated)\b/u.test(key))reasons.add('automated-use');
 return [...reasons].sort();
}
