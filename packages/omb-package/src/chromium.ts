import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { assert } from './common.ts';

export class Chromium {
  #ws:WebSocket; #next=0; #session='';
  #pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
  private constructor(ws:WebSocket, readonly child:ReturnType<typeof spawn>){
    this.#ws=ws;
    ws.addEventListener('message',event=>{const m=JSON.parse(String(event.data));const p=this.#pending.get(m.id);if(p){clearTimeout(p.timer);this.#pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
    ws.addEventListener('close',()=>{for(const p of this.#pending.values()){clearTimeout(p.timer);p.reject(Error('Chromium connection closed'));}this.#pending.clear();});
  }
  static async launch(binary:string,profile:string):Promise<Chromium>{
    mkdirSync(profile,{recursive:true});
    const child=spawn(binary,['--headless','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--disable-gpu','--font-render-hinting=none','--host-resolver-rules=MAP * ~NOTFOUND','about:blank'],{stdio:['ignore','ignore','pipe']});
    try{
      const url=await new Promise<string>((resolve,reject)=>{let stderr='';const timer=setTimeout(()=>reject(Error('Chromium launch timed out')),30_000);child.stderr!.on('data',b=>{stderr+=String(b);const m=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]!);}});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);reject(Error(`Chromium exited ${code}: ${stderr.slice(-1000)}`));});});
      const ws=new WebSocket(url);await new Promise<void>((resolve,reject)=>{ws.addEventListener('open',()=>resolve(),{once:true});ws.addEventListener('error',()=>reject(Error('CDP connection failed')),{once:true});});
      const browser=new Chromium(ws,child);const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'});const {sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});browser.#session=sessionId;
      await browser.send('Page.enable');await browser.send('Network.enable');await browser.send('Network.setBlockedURLs',{urls:['http://*','https://*','ftp://*','ws://*','wss://*']});
      await browser.send('Emulation.setDeviceMetricsOverride',{width:816,height:1056,deviceScaleFactor:1,mobile:false});await browser.send('Emulation.setEmulatedMedia',{media:'print'});return browser;
    }catch(e){if(child.pid&&!child.killed)child.kill('SIGKILL');throw e;}
  }
  send(method:string,params:object={}):Promise<any>{
    const id=++this.#next;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.#pending.delete(id);reject(Error(`CDP timeout: ${method}`));},30_000);this.#pending.set(id,{resolve,reject,timer});this.#ws.send(JSON.stringify({id,method,params,...(this.#session?{sessionId:this.#session}:{})}));});
  }
  async evaluate(expression:string):Promise<any>{const r=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert(!r.exceptionDetails,`browser layout failed: ${JSON.stringify(r.exceptionDetails)}`);return r.result.value;}
  async open(file:string):Promise<void>{
    const r=await this.send('Page.navigate',{url:pathToFileURL(file).href});assert(!r.errorText,`navigation: ${r.errorText}`);
    await this.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+15000;const poll=()=>{if(document.readyState==='complete')document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode()))).then(resolve,reject);else if(Date.now()>end)reject(Error('document not ready'));else setTimeout(poll,20);};poll();})`);
  }
  async pdf():Promise<Buffer>{const r=await this.send('Page.printToPDF',{printBackground:true,displayHeaderFooter:false,preferCSSPageSize:true,generateTaggedPDF:true});return Buffer.from(r.data,'base64');}
  async png(width:number,height:number):Promise<Buffer>{const r=await this.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height,scale:2}});return Buffer.from(r.data,'base64');}
  async close():Promise<void>{
    try{await this.send('Browser.close');}catch{}finally{this.#ws.close();if(this.child.exitCode===null){const done=once(this.child,'exit');const timer=setTimeout(()=>{if(this.child.pid&&this.child.exitCode===null)this.child.kill('SIGKILL');},2000);await done;clearTimeout(timer);}}
  }
}
