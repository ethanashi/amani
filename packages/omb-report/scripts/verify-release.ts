/** Offline verifier. Supply a separately trusted key and expected paper/build IDs.
 * node --experimental-transform-types .../verify-release.ts BUNDLE RECORD PUBLIC_KEY PAPER_HASH BUILD_ID
 * Detached envelope/key files are excluded only by these exact conventional names.
 */
import {createPublicKey} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {verifyPersistedRelease,type PersistedRelease} from '../src/reverify/persisted.ts';
const [root,recordFile,keyFile,paperInputHash,buildId]=process.argv.slice(2);
try{
 if(!root||!recordFile||!keyFile||!paperInputHash||!buildId)throw Error('usage: verify-release BUNDLE RECORD TRUSTED_PUBLIC_KEY PAPER_HASH BUILD_ID');
 const files=new Map<string,Uint8Array>();
 const walk=(rel='')=>{for(const name of readdirSync(path.join(root,rel)).sort()){
  const entry=rel?rel+'/'+name:name,full=path.join(root,entry),s=lstatSync(full);
  if(s.isSymbolicLink())throw Error('release: symlink in bundle: '+entry);
  if(s.isDirectory())walk(entry);else if(!s.isFile())throw Error('release: non-regular bundle entry: '+entry);
  else if(!['release-record.json','release-public.pem'].includes(entry))files.set(entry,readFileSync(full));
 }};walk();
 const result=verifyPersistedRelease(JSON.parse(readFileSync(recordFile,'utf8')) as PersistedRelease,files,{publicKey:createPublicKey(readFileSync(keyFile)),paperInputHash,buildId});
 console.log(JSON.stringify({...result,artifacts:files.size,paperInputHash,buildId}));if(!result.ok)process.exitCode=1;
}catch(e){console.error(JSON.stringify({ok:false,issues:[e instanceof Error?e.message:String(e)]}));process.exitCode=1;}
