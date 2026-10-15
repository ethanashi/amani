import path from 'node:path';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {toolchain,command} from '../../packages/omb-package/src/toolchain.ts';
import {Chromium} from '../../packages/omb-package/src/chromium.ts';
const root=path.resolve('.'),out=path.resolve('../_logs/readme-previews');mkdirSync(out,{recursive:true});
const tc=await toolchain();
const css=`:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#fff;color:#1f2328;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.markdown-body{max-width:1240px;margin:0 auto;padding:36px 44px 80px}h1{font-size:36px;margin:0 0 18px;line-height:1.2}h2{font-size:26px;line-height:1.3;margin:30px 0 16px;padding-bottom:8px;border-bottom:1px solid #d8dee4}h3{font-size:20px}p{margin:0 0 16px}a{color:#0969da;text-decoration:none}strong{font-weight:650}img{max-width:100%;height:auto}table{width:100%;border-collapse:collapse;font-size:14px;line-height:1.45;margin:18px 0 24px}th,td{padding:11px 12px;border:1px solid #d0d7de;text-align:left;vertical-align:top}th{background:#f6f8fa;font-weight:650}tr:nth-child(even){background:#f6f8fa}td:first-child{font-weight:600}pre,code{font-family:ui-monospace,SFMono-Regular,monospace;background:#f6f8fa;border-radius:6px}pre{padding:16px;overflow:auto}code{font-size:.85em;padding:2px 5px}pre code{padding:0}blockquote{margin:16px 0;border-left:4px solid #d0d7de;padding:0 16px;color:#656d76}div[align=center]{margin-bottom:24px}div[align=center] img{vertical-align:middle}details{margin:18px 0}summary{cursor:pointer;font-weight:600}`;
for(const [name,file] of [['main','README.md'],['index','examples/replications/README.md']]){
 const source=path.join(root,file!),base=path.dirname(source);let body=await command(tc.pandoc,['-f','gfm','-t','html5',source]);
 const sources=[...body.matchAll(/<img[^>]+src="([^"]+)"/gu)].map(m=>m[1]!);
 for(const src of new Set(sources)){
  const raw=src.replaceAll('&amp;','&');let data:Uint8Array;let mime:string;
  if(/^https?:/u.test(raw)){const response=await fetch(raw);if(!response.ok)throw Error('preview image unavailable');data=new Uint8Array(await response.arrayBuffer());mime=response.headers.get('content-type')??'image/svg+xml';}
  else {data=readFileSync(path.resolve(base,raw));mime=raw.endsWith('.svg')?'image/svg+xml':raw.endsWith('.jpg')?'image/jpeg':'image/png';}
  body=body.replaceAll(`src="${src}"`,`src="data:${mime};base64,${Buffer.from(data).toString('base64')}"`);
 }
 body=body.replace(/href="(?!https?:|#|mailto:)([^"]+)"/gu,(_m,href:string)=>`href="${pathToFileURL(path.resolve(base,href)).href}"`);
 const html=`<!doctype html><html><head><meta charset="utf-8"><title>Amani blind replications — ${name}</title><style>${css}</style></head><body><article class="markdown-body">${body}</article></body></html>`;
 const target=path.join(out,`amani-replications-${name}.html`);writeFileSync(target,html);
 const browser=await Chromium.launch(tc.chromium,path.join(out,`chromium-${name}-${Date.now()}`));
 try{await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});await browser.send('Emulation.setEmulatedMedia',{media:'screen'});await browser.open(target);writeFileSync(path.join(out,`amani-replications-${name}.png`),await browser.png(1440,1200));}
 finally{await browser.close();}
 console.log(target);
}
