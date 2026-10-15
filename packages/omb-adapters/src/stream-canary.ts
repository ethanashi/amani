import {StringDecoder} from 'node:string_decoder';
const LIMIT=1024*1024,INPUT_SLICE=64*1024;
/** Preserve ordinary event/denial semantics. Oversized lines become unparsed output:
 * scan bounded overlapping windows, never retain an unbounded pending JSON event. */
export function streamCanary(scan:(line:string)=>boolean,canary?:string) {
 if(canary!==undefined&&(!canary.length||canary.length>4096))throw new RangeError('invalid canary length');
 const overlap=canary===undefined?4096:canary.length-1;
 const decoder=new StringDecoder('utf8');let pending='',oversized=false,found=false,observed=false;
 const raw=(text:string)=>canary===undefined?scan(text):text.includes(canary);
 const consume=(text:string)=>{
  let at=0;
  while(at<text.length){
   const end=text.indexOf('\n',at),stop=end<0?text.length:end;
   pending+=text.slice(at,stop);
   while(pending.length>LIMIT){oversized=true;found=raw(pending.slice(0,LIMIT))||found;pending=pending.slice(LIMIT-overlap);}
   if(end>=0){found=(oversized?raw(pending):scan(pending))||found;pending='';oversized=false;}
   at=stop+1;
  }
 };
 return {push(chunk:Buffer){observed=true;for(let i=0;i<chunk.length;i+=INPUT_SLICE)consume(decoder.write(chunk.subarray(i,i+INPUT_SLICE)));},finish(fallback:string){
  if(!observed){for(let i=0;i<fallback.length;i+=INPUT_SLICE)consume(fallback.slice(i,i+INPUT_SLICE));}
  consume(decoder.end());if(pending)found=(oversized?raw(pending):scan(pending))||found;pending='';return found;
 }};
}
