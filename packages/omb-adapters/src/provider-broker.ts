import {randomBytes,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import type {Socket} from 'node:net';
import {redactSecrets} from './provider-secrets.ts';
/** Host-only credential boundary: neither agent tools nor their children inherit a real key.
 * HTTP client credentials arrive via an explicit environment, never model data or command args.
 * The broker has no filesystem API, redirects or arbitrary URL forwarding. */
export async function credentialBroker(o:{model:string;baseUrl:string;anthropic:boolean;env:NodeJS.ProcessEnv;fetch?:typeof fetch;timeoutMs:number}){
 const token=randomBytes(32).toString('hex');
 const key=o.env.OMB_PROVIDER_KEY??'',upstream=new URL(o.baseUrl),sockets=new Set<Socket>();
 if(upstream.protocol!=='https:'||upstream.username||upstream.password)throw new Error('Invalid provider endpoint');
 const usage={input:0,output:0,known:false},models=new Set<string>();
 const server=createServer(async(req,res)=>{
  try{
   const host=server.address();const expected=host&&typeof host!=='string'?`127.0.0.1:${host.port}`:'';
   const auth=Buffer.from(req.headers.authorization??''),wanted=Buffer.from(`Bearer ${token}`);
   if(req.headers.host!==expected||req.headers.origin!==undefined||auth.length!==wanted.length||!timingSafeEqual(auth,wanted)){res.writeHead(403).end();return;}
   const route=req.url?.replace(/^\/v1/,'');
   if(req.method!=='POST'||!['/chat/completions','/messages','/responses'].includes(route??'')){res.writeHead(403).end();return;}
   const chunks:Buffer[]=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>16_000_000)throw new Error('request too large');chunks.push(chunk);}
   const body=Buffer.concat(chunks).toString();
   if(!o.model||JSON.parse(body).model!==o.model){res.writeHead(403).end();return;}
   // The key can never be part of a model request, even if supplied by a compromised client.
   if(key&&body.includes(key))throw new Error('secret in request');
   const headers:Record<string,string>={'content-type':'application/json',...(o.anthropic?{'x-api-key':key,'anthropic-version':'2023-06-01'}:{authorization:`Bearer ${key}`})};
   const r=await (o.fetch??fetch)(upstream.href.replace(/\/$/,'')+route,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(o.timeoutMs)});
   const reader=r.body?.getReader();const parts:Uint8Array[]=[];let n=0;
   if(reader)for(;;){const c=await reader.read();if(c.done)break;n+=c.value.length;if(n>16_000_000){await reader.cancel();throw new Error('response too large');}parts.push(c.value);}
   const text=redactSecrets(Buffer.concat(parts).toString(),[key]);
   let last:{input:number;output:number}|undefined;
   for(const piece of [text,...text.split('\n').filter(l=>l.startsWith('data: ')).map(l=>l.slice(6))])try{const d=JSON.parse(piece);const model=d.model??d.message?.model;if(typeof model==='string')models.add(model);const u=d.usage??d.message?.usage;if(u){const input=u.input_tokens??u.prompt_tokens??last?.input,output=u.output_tokens??u.completion_tokens??last?.output;if(Number.isFinite(input)&&Number.isFinite(output)&&input>=0&&output>=0)last={input,output};}}catch{}
   if(last){usage.input+=last.input;usage.output+=last.output;usage.known=true;}

   res.writeHead(r.status,{'content-type':r.headers.get('content-type')??'application/json',...(r.headers.get('retry-after')?{'retry-after':r.headers.get('retry-after')!}:{})});res.end(text);
  }catch{if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});res.end('{"error":{"type":"transport","message":"Provider transport unavailable"}}');}
 });
 server.on('connection',s=>{sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw new Error('Broker unavailable');
 return {token,port:address.port,usage,models,close:async()=>{for(const s of sockets)s.destroy();await new Promise<void>(r=>server.close(()=>r()));}};
}
