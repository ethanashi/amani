/** Only CLI stderr and structured top-level provider errors are evidence. */
export function providerError(stdout:string,stderr:string):string|null {
 const details=[stderr];
 for(const line of stdout.split('\n'))try{const e=JSON.parse(line);if(['error','turn.failed'].includes(e.type))details.push(JSON.stringify(e.error??e));}catch{}
 const text=details.join('\n');
 return /\b(?:401|403|5\d\d)\b|(?:400[^\n]*model|model[^\n]*(?:unsupported|not supported))|unauthenticated|authentication failed|overloaded|error sending request|ECONNRESET|ENOTFOUND|network unreachable/i.test(text)?text.slice(-2000):null;
}

export const OUTCOMES=['ok','transport','server','rate-limit','auth','refusal','non-compliance','stall','loop','context-overflow','disagreement','family-violation'] as const;
export type OutcomeType=typeof OUTCOMES[number];
export interface ProviderOutcome {type:OutcomeType;text?:string;resetAt?:number;missing?:string[];tokens?:{input:number;output:number};}
/** Answer text is evidence only when a structured error identifies it as error text. */
export function classifyProvider(input:{status?:number;text?:string;error?:boolean;exitCode?:number|null;refusal?:string;stopReason?:string;timedOut?:boolean;progress?:boolean;missing?:string[];disagreement?:boolean}):ProviderOutcome {
 const text=input.refusal??input.text??'',base={text};
 const error=input.error||input.status!==undefined&&input.status>=400||input.exitCode!==undefined&&input.exitCode!==null&&input.exitCode!==0;
 const details=(input.error||input.status!==undefined&&input.status>=400)?text:'';
 if(input.status===401||input.status===403||/unauthenticated|authentication failed|bad api key|invalid api key/i.test(details))return {type:'auth',...base};
 if(input.status===429||/quota exhausted|rate.limit|usage limit/i.test(details))return {type:'rate-limit',...base};
 if(input.status&&input.status>=500)return {type:'server',...base};
 if(input.status===413||/context.{0,25}(limit|length|exceed)|maximum.*tokens|too many tokens/i.test(details)||['length','max_tokens','context_length_exceeded'].includes(input.stopReason??''))return {type:'context-overflow',...base};
 if(input.disagreement)return {type:'disagreement',...base};
 if(input.refusal!==undefined||['refusal','content_filter','safety'].includes(input.stopReason??'')||/flagged for possible cybersecurity risk/i.test(details))return {type:'refusal',...base};
 if(input.timedOut)return {type:input.progress?'stall':'transport',...base};
 if(input.status===408||/ECONNRESET|ENOTFOUND|ETIMEDOUT|fetch failed|network unreachable/i.test(details))return {type:'transport',...base};
 if(/overloaded|internal server error/i.test(details))return {type:'server',...base};
 if(error||input.missing?.length||!text.trim())return {type:'non-compliance',...base,...(input.missing?{missing:input.missing}:{})};
 return {type:'ok',...base};
}

/** Successful narration is never an error stream or a structured appeal. */
export function cliProviderOutcome(stdout:string,stderr:string):ProviderOutcome|null {
 for(const line of stdout.split('\n'))try{const e=JSON.parse(line);
  if(['error','turn.failed'].includes(e.type)||e.type==='result'&&e.is_error){
   const text=typeof e.error==='string'?e.error:JSON.stringify(e.error??e);
   return classifyProvider({text,error:true,status:e.status??e.error?.status});
  }
  const stopReason=e.message?.stop_reason??e.stop_reason??e.finish_reason;
  const refusal=e.message?.refusal??e.refusal;
  if(refusal!==undefined||['refusal','content_filter','safety','length','max_tokens','context_length_exceeded'].includes(stopReason))return classifyProvider({text:typeof refusal==='string'?refusal:'',stopReason,...(typeof refusal==='string'?{refusal}:{})});
 }catch{}
 if(stderr.trim()){
  const status=/\b(401|403|429|5\d\d)\b/.exec(stderr);
  const o=classifyProvider({text:stderr,error:true,...(status?{status:Number(status[1])}:{})});
  if(o.type!=='non-compliance')return o;
 }
 return null;
}

/** Final answer extraction for read-only ledger selection, never outcome classification. */
export function cliAnswer(stdout:string):string {
 let answer='';for(const line of stdout.split('\n'))try{const e=JSON.parse(line);
  if(e.item?.type==='agent_message'&&typeof e.item.text==='string')answer=e.item.text;
  if(e.type==='assistant')answer=(e.message?.content??[]).filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n');
  if(e.type==='result'&&typeof e.result==='string')answer=e.result;
 }catch{}return answer;
}
