import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
export const PROVIDER_KINDS = ['codex-cli','claude-code-cli','openrouter','opencode','anthropic-api','openai-api'] as const;
export const ROLES = ['worker','reviewer','drafter','referee','assistant'] as const;
export type Role = typeof ROLES[number];
export type ProviderKind = typeof PROVIDER_KINDS[number];
export interface Provider {kind:ProviderKind; enabled:boolean; keyRef?:string; baseUrl?:string; opencodeProvider?:string}
export interface ModelEntry {provider:string;model:string;effort?:string}
export interface ProviderConfig {
 version:1; providers:Record<string,Provider>; roles:Record<Role,{chain:ModelEntry[]}>;
 policy:{crossFamily:'require'|'prefer'|'off';retry:{maxAttempts:number;baseDelayMs:number;maxDelayMs:number};circuitBreaker:{failures:number;cooldownMinutes:number};callTimeoutMinutes:number;stallMinutes:number;repairNudges:number;onAllFailed:'needs-you'};
}
export const INDETERMINATE='INDETERMINATE';
export const toolCapable=(kind:ProviderKind)=>['codex-cli','claude-code-cli','opencode'].includes(kind);
export const validModel=(model:unknown):model is string=>typeof model==='string'&&model.length>0&&model.length<1024&&!/^\s*-|[\x00-\x1f\x7f]/.test(model)&&model.trim()===model;
export const EFFORTS=['none','minimal','low','medium','high','xhigh','max'] as const;
export function modelFamily(model:string):string {
 const normalized=model.toLowerCase().trim().replace(/[_. ]/g,'-');
 const parts=normalized.split('/');
 if(parts.some(p=>/^(auto|router|automatic|default|free)(?:[:.-]|$)/.test(p)))return INDETERMINATE;
 const vendors:Record<string,string>={anthropic:'anthropic',openai:'openai',google:'google','meta-llama':'meta',meta:'meta','x-ai':'xai',xai:'xai',mistralai:'mistral',mistral:'mistral',deepseek:'deepseek',qwen:'alibaba',alibaba:'alibaba',cohere:'cohere',amazon:'amazon'};
 for(const part of parts.slice(0,-1))if(vendors[part])return vendors[part]!;
 const m=parts.at(-1)!;
 for(const [vendor,family] of Object.entries(vendors))if(new RegExp('^(?:(?:us|eu|apac|global)-)?'+vendor+'-').test(m))return family;
 for(const [pattern,family] of [[/^(claude|opus|sonnet|haiku)(?:-|$)/,'anthropic'],[/^(gpt|chatgpt|codex|o\d)(?:-|\d|$)/,'openai'],[/^(gemini|gemma)/,'google'],[/^(meta-)?llama/,'meta'],[/^qwen/,'alibaba'],[/^deepseek/,'deepseek'],[/^(mistral|mixtral|codestral|ministral)/,'mistral'],[/^grok/,'xai'],[/^command(?:-|$)/,'cohere'],[/^nova(?:-|$)/,'amazon']] as const)if(pattern.test(m))return family;
 return INDETERMINATE;
}
export function providerWarnings(config:ProviderConfig):string[]{
 return config.policy.crossFamily==='prefer'?ROLES.flatMap(role=>config.roles[role].chain.filter(e=>modelFamily(e.model)===INDETERMINATE).map(e=>`roles.${role}: INDETERMINATE model family for ${e.model}; cross-family independence cannot be verified`)):[];
}
export function defaultProviders():ProviderConfig {
 const codex={provider:'codex',model:'gpt-6-astra',effort:'high'},claude={provider:'claude',model:'claude-sonnet-5'};
 return {version:1,providers:{codex:{kind:'codex-cli',enabled:true},claude:{kind:'claude-code-cli',enabled:true}},roles:{worker:{chain:[codex]},reviewer:{chain:[claude,{...codex}]},drafter:{chain:[codex]},referee:{chain:[claude]},assistant:{chain:[claude]}},policy:{crossFamily:'require',retry:{maxAttempts:3,baseDelayMs:2000,maxDelayMs:60000},circuitBreaker:{failures:3,cooldownMinutes:15},callTimeoutMinutes:60,stallMinutes:20,repairNudges:2,onAllFailed:'needs-you'}};
}
export class ProviderConfigError extends Error {constructor(readonly errors:string[]){super(errors.join('; '));this.name='ProviderConfigError';}}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const str=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<1024&&!/[\0\r\n]/.test(v);
export function validateProviders(value:unknown):ProviderConfig {
 const errors:string[]=[];
 if(!obj(value)||value.version!==1||!obj(value.providers)||!obj(value.roles)||!obj(value.policy))throw new ProviderConfigError(['Expected providers config version 1 with providers, roles and policy']);
 const allowed=(v:Record<string,unknown>,keys:string[],at:string)=>{if(Object.keys(v).some(k=>!keys.includes(k)))errors.push(`${at}: unknown field (secrets are not permitted)`);};
 allowed(value,['version','providers','roles','policy'],'config');
 allowed(value.roles,[...ROLES],'roles');
 for(const [id,p] of Object.entries(value.providers)){
  if(['__proto__','constructor','prototype'].includes(id)||!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||!obj(p)){errors.push('Invalid provider entry');continue;}
  allowed(p,['kind','enabled','keyRef','baseUrl','opencodeProvider'],`providers.${id}`);
  if(!PROVIDER_KINDS.includes(p.kind as ProviderKind))errors.push(`providers.${id}: unknown provider kind`);
  if(typeof p.enabled!=='boolean')errors.push(`providers.${id}: enabled must be boolean`);
  if(['openrouter','anthropic-api','openai-api'].includes(String(p.kind))&&!p.keyRef)errors.push(`providers.${id}: missing keyRef`);
  if(p.keyRef!==undefined&&(typeof p.keyRef!=='string'||!/^keychain:amani\/[A-Za-z0-9._/-]+$/.test(p.keyRef)))errors.push(`providers.${id}: invalid keyRef`);
  if(p.kind==='opencode'&&!str(p.opencodeProvider))errors.push(`providers.${id}: missing opencodeProvider`);
  if(p.kind==='opencode'&&str(p.opencodeProvider)&&p.baseUrl===undefined)try{providerEndpoint(p as unknown as Provider);}catch{errors.push(`providers.${id}: OpenCode provider requires compatible baseUrl`);}
  if(p.baseUrl!==undefined)try{const u=new URL(String(p.baseUrl));if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw 0;}catch{errors.push(`providers.${id}: baseUrl must be HTTPS without credentials/query`);}
 }
 for(const role of ROLES){
  const r=value.roles[role];
  if(!obj(r)||!Array.isArray(r.chain)||!r.chain.length){errors.push(`roles.${role}: nonempty chain required`);continue;}
  if(role==='reviewer'&&!r.chain.some(e=>obj(e)&&typeof e.provider==='string'&&obj(value.providers)&&(()=>{const provider=value.providers[e.provider];return obj(provider)&&toolCapable(provider.kind as ProviderKind);})()))errors.push('roles.reviewer: no tool-capable provider for role reviewer; add codex-cli, claude-code-cli or opencode for replication');
  allowed(r,['chain'],`roles.${role}`);
  for(const entry of r.chain){
   if(!obj(entry)||!str(entry.provider)||!validModel(entry.model)){errors.push(`roles.${role}: invalid chain entry`);continue;}
   allowed(entry,['provider','model','effort'],`roles.${role}`);
   const p=value.providers[entry.provider];
   if(!obj(p))errors.push(`roles.${role}: unknown provider ${entry.provider}`);
   else if(!p.enabled)errors.push(`roles.${role}: disabled provider ${entry.provider}`);
   else if(role==='worker'&&['openrouter','anthropic-api','openai-api'].includes(String(p.kind)))errors.push(`roles.worker: API-only provider ${entry.provider} has no agent tools; use opencode`);
   if(entry.effort!==undefined&&!EFFORTS.includes(entry.effort as typeof EFFORTS[number]))errors.push(`roles.${role}: invalid effort`);
  }
 }
 const p=value.policy;
 const bounds:Record<string,number>={callTimeoutMinutes:240,stallMinutes:60,repairNudges:5};
 for(const [key,max] of Object.entries(bounds))if(typeof p[key]==='number'&&p[key]>max)errors.push(`policy.${key}: maximum ${max}`);
 for(const [section,limits] of Object.entries({retry:{maxAttempts:10,baseDelayMs:60000,maxDelayMs:300000},circuitBreaker:{failures:10,cooldownMinutes:1440}})){
  const values=p[section];if(obj(values))for(const [key,max] of Object.entries(limits))if(typeof values[key]==='number'&&values[key]>max)errors.push(`policy.${section}.${key}: maximum ${max}`);
 }

 allowed(p,['crossFamily','retry','circuitBreaker','callTimeoutMinutes','stallMinutes','repairNudges','onAllFailed'],'policy');
 if(!['require','prefer','off'].includes(String(p.crossFamily))||p.onAllFailed!=='needs-you')errors.push('Invalid crossFamily/onAllFailed policy');
 for(const [k,v,min] of [['callTimeoutMinutes',p.callTimeoutMinutes,0.001],['stallMinutes',p.stallMinutes,0.001],['repairNudges',p.repairNudges,0]] as const)if(typeof v!=='number'||!Number.isFinite(v)||v<min)errors.push(`Invalid policy.${k}`);
 if(!Number.isSafeInteger(p.repairNudges))errors.push('repairNudges must be an integer');
 for(const [name,fields] of [['retry',['maxAttempts','baseDelayMs','maxDelayMs']],['circuitBreaker',['failures','cooldownMinutes']]] as const){const v=p[name];if(!obj(v)){errors.push(`Invalid policy.${name}`);continue;}allowed(v,[...fields],`policy.${name}`);for(const k of fields)if(typeof v[k]!=='number'||!Number.isFinite(v[k])||Number(v[k])<=0)errors.push(`Invalid policy.${name}.${k}`);}
 if(obj(p.retry)&&(!Number.isSafeInteger(p.retry.maxAttempts)||Number(p.retry.maxDelayMs)<Number(p.retry.baseDelayMs)))errors.push('Invalid retry bounds');
 if(obj(p.circuitBreaker)&&!Number.isSafeInteger(p.circuitBreaker.failures))errors.push('Invalid circuit breaker failures');
 if(errors.length)throw new ProviderConfigError(errors);
 const config=structuredClone(value) as unknown as ProviderConfig;
 if(config.policy.crossFamily==='require')for(const role of ROLES)for(const e of config.roles[role].chain)if(modelFamily(e.model)===INDETERMINATE)errors.push(`roles.${role}: INDETERMINATE model family for ${e.model}; crossFamily require needs an identifiable family`);
 if(config.policy.crossFamily==='require')for(const [source,review] of [['worker','reviewer'],['drafter','referee']] as const)for(const entry of config.roles[source].chain)if(!config.roles[review].chain.some(r=>modelFamily(r.model)!==modelFamily(entry.model)))errors.push(`crossFamily: ${review} cannot review ${source} model ${entry.model}`);
 if(errors.length)throw new ProviderConfigError(errors);
 return config;
}
export const providerConfigPath=()=>path.join(homedir(),'.omerta-bio','config','providers.json');
export function loadProviders(file=providerConfigPath()):ProviderConfig {
 if(!existsSync(file))return defaultProviders();
 const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0)throw new ProviderConfigError(['providers.json must be a regular mode 600 file']);
 let parsed:unknown;try{parsed=JSON.parse(readFileSync(file,'utf8'));}catch{throw new ProviderConfigError(['providers.json is not valid JSON']);}
 return validateProviders(parsed);
}
export function saveProviders(value:unknown,file=providerConfigPath()):ProviderConfig {
 const c=validateProviders(value);mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=`${file}.${process.pid}.tmp`;
 writeFileSync(tmp,JSON.stringify(c,null,2)+'\n',{mode:0o600,flag:'wx',flush:true});renameSync(tmp,file);return c;
}

export function providerEndpoint(provider:Provider):string {
 if(provider.baseUrl)return provider.baseUrl;
 if(provider.kind==='openrouter')return 'https://openrouter.ai/api/v1';
 if(provider.kind==='anthropic-api')return 'https://api.anthropic.com/v1';
 if(provider.kind==='openai-api')return 'https://api.openai.com/v1';
 const endpoints:Record<string,string>={openrouter:'https://openrouter.ai/api/v1',openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1',google:'https://generativelanguage.googleapis.com/v1beta/openai',deepseek:'https://api.deepseek.com/v1',mistral:'https://api.mistral.ai/v1',xai:'https://api.x.ai/v1',groq:'https://api.groq.com/openai/v1'};
 const endpoint=endpoints[provider.opencodeProvider??''];if(!endpoint)throw new ProviderConfigError(['OpenCode provider requires an explicit compatible baseUrl']);return endpoint;
}
