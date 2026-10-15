/** Date inventories: parse and render without copying any real interval or rank. */
export interface DateInventory { min:number; max:number; quantum:number; templates:string[]; render:(value:number,choice?:number)=>string; parse:(value:string)=>number|null }
const pad=(v:number,n=2)=>String(v).padStart(n,'0');
function singleDateInventory(values:readonly string[],format?:string):DateInventory|null {
 if(!values.length)return null;
 const sample=values[0]!;
 let parse:(v:string)=>number|null,render:(v:number,choice?:number)=>string,quantum=86400000;
 if(/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(sample)){
  const pattern=/^(\d{4}-\d{2}-\d{2})(?:([T ])(\d{2}:\d{2})(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
  const offset=(zone:string)=>zone&&zone!=='Z'?(zone[0]==='-'?-1:1)*(Number(zone.slice(1,3))*60+Number(zone.replace(':','').slice(3,5)))*60000:0;
  const styles=[...new Set(values.map(v=>{const m=pattern.exec(v);return m?JSON.stringify([m[2]??'',!!m[4],m[5]?.length?m[5].length-1:0,m[6]??'']):'';}))].sort();
  if(styles.includes(''))return null;
  quantum=Math.min(...styles.map(s=>{const [time,seconds,digits]=JSON.parse(s);return time?(digits?10**Math.max(0,3-digits):seconds?1000:60000):86400000;}));
  parse=v=>{
   const m=pattern.exec(v);if(!m)return null;
   const zone=m[6]??'',n=Date.parse(m[2]?v.replace(' ','T')+(zone?'':'Z'):v+'T00:00:00Z');
   // Validate using this cell's offset, including local dates across UTC midnight.
   return Number.isFinite(n)&&new Date(n+offset(zone)).toISOString().slice(0,10)===m[1]?n:null;
  };
  render=(n,choice=0)=>{const [time,seconds,digits,zone]=JSON.parse(styles[Math.min(styles.length-1,Math.floor(choice*styles.length))]!);const s=new Date(n+offset(zone)).toISOString();return s.slice(0,10)+(time?time+s.slice(11,seconds?19:16)+(digits?'.'+s.slice(20,23).padEnd(digits,'0').slice(0,digits):'')+zone:'');};
 }else if(/^\d{1,2}([/.])\d{1,2}\1\d{4}$/.test(sample)){
  const separator=sample.includes('/')?'/':'.',eu=format==='EU'||format==='DD/MM/YYYY'||values.some(v=>Number(v.split(separator)[0])>12);
  const sizes=sample.split(separator).map(x=>x.length);
  parse=v=>{const p=v.split(separator);if(p.length!==3)return null;const day=Number(p[eu?0:1]),month=Number(p[eu?1:0]),year=Number(p[2]);const n=Date.UTC(year,month-1,day),d=new Date(n);return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day?n:null;};
  render=n=>{const d=new Date(n),a=[eu?d.getUTCDate():d.getUTCMonth()+1,eu?d.getUTCMonth()+1:d.getUTCDate(),d.getUTCFullYear()];return a.map((v,i)=>pad(v,sizes[i])).join(separator);};
 }else if(/^\d{1,2} [A-Za-z]+ \d{4}$/.test(sample)){
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'],m=/^(\d+) ([A-Za-z]+) (\d{4})$/.exec(sample)!,short=m[2]!.length===3;
  parse=v=>{const m=/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(v);if(!m)return null;const month=months.findIndex(x=>[x.toLowerCase(),x.slice(0,3).toLowerCase()].includes(m[2]!.toLowerCase())),day=Number(m[1]),year=Number(m[3]);if(month<0)return null;const n=Date.UTC(year,month,day),d=new Date(n);return d.getUTCFullYear()===year&&d.getUTCMonth()===month&&d.getUTCDate()===day?n:null;};
  render=n=>{const d=new Date(n);let month=months[d.getUTCMonth()]!;if(short)month=month.slice(0,3);if(m[2]===m[2]!.toLowerCase())month=month.toLowerCase();else if(m[2]===m[2]!.toUpperCase())month=month.toUpperCase();return `${pad(d.getUTCDate(),m[1]!.length)} ${month} ${d.getUTCFullYear()}`;};
 }else if(/^\d{4}-\d{2}$/.test(sample)){
  quantum=1;parse=v=>{const m=/^(\d{4})-(\d{2})$/.exec(v);return m&&Number(m[2])>=1&&Number(m[2])<=12?Number(m[1])*12+Number(m[2])-1:null;};
  render=n=>`${pad(Math.floor(n/12),4)}-${pad(n%12+1)}`;
 }else return null;
 const parsed=values.map(parse);if(parsed.some(n=>n===null))return null;
 const templates=[...new Set(values.map((_,i)=>render(quantum===1?24000:Date.UTC(2000,0,15),i/values.length)))].sort();
 return {templates,min:(parsed as number[]).reduce((a,n)=>Math.min(a,n),Infinity),max:(parsed as number[]).reduce((a,n)=>Math.max(a,n),-Infinity),quantum,parse,render};
}

/** A column may contain multiple legitimate date grammars. Keep only their format
 * set, never the row-aligned choice or its empirical frequency. */
export function dateInventory(values:readonly string[],format?:string):DateInventory|null{
 if(!values.length)return null;
 const groups=new Map<string,string[]>();
 for(const v of values){let family:string;
  if(/^\d{4}-\d{2}-\d{2}(?:[T ]|$)/.test(v))family='iso';
  else if(/^\d{1,2}([/.])\d{1,2}\1\d{4}$/.test(v)){const parts=v.split(/[/.]/);family=JSON.stringify(['slash',v.includes('/')?'/':'.',parts[0]!.length,parts[1]!.length]);}
  else if(/^\d{4}-\d{2}$/.test(v))family='partial';
  else {const m=/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(v);if(!m)return null;family=JSON.stringify(['named',m[1]!.length,m[2]!.length===3,m[2]===m[2]!.toLowerCase()?'lower':m[2]===m[2]!.toUpperCase()?'upper':'title']);}
  const g=groups.get(family)??[];g.push(v);groups.set(family,g);
 }
 if(groups.has('partial')&&groups.size>1)return null;
 const inventories=[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([,vs])=>singleDateInventory(vs,format??(values.some(v=>/^\d{1,2}([/.])\d{1,2}\1\d{4}$/.test(v)&&Number(v.split(/[/.]/)[0])>12)?'EU':undefined)));if(inventories.some(v=>!v))return null;
 const ds=inventories as DateInventory[];
 return {min:Math.min(...ds.map(d=>d.min)),max:Math.max(...ds.map(d=>d.max)),quantum:Math.min(...ds.map(d=>d.quantum)),templates:[...new Set(ds.flatMap(d=>d.templates))].sort(),
 parse:v=>{for(const d of ds){const n=d.parse(v);if(n!==null)return n;}return null;},
 render:(n,choice=0)=>{const at=Math.min(ds.length-1,Math.floor(choice*ds.length));return ds[at]!.render(n,choice*ds.length-at);}};
}
