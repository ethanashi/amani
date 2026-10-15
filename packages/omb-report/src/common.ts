export class ReportRefusal extends Error { constructor(message:string){super(message);this.name='ReportRefusal';} }
export function refuse(message:string):never {throw new ReportRefusal(message);}
export function requireThat(ok:unknown,message:string):asserts ok {if(!ok)refuse(message);}
/** Port of bio-report plain(): protect Markdown as well as HTML and table cells. */
export function plain(text:string):string{return text.replace(/[\r\n\t\u0000-\u001f\u007f]+/gu,' ').replace(/[&<>\\`*_{}\[\]()#+!|~:@=]/gu,c=>`&#${c.codePointAt(0)};`).replace(/www\./giu,'www&#46;').replace(/(^|\s)-(?=\s|--)/gu,'$1&#45;');}
export const html=(text:string)=>text.replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const record=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
export const strings=(v:unknown):string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string')?v:[];
