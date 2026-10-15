/** Public, offline release verification. An embedded public key is informational;
 * callers must supply a separately trusted key and expected paper/build identities.
 * Signing is exposed only by the in-process release capability, not this module.
 */
import {createHash,createPublicKey,createPrivateKey,generateKeyPairSync,verify,type KeyObject} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readFileSync,writeFileSync,mkdirSync,lstatSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {canonicalJson} from '../../../bio-core/src/index.ts';
import {requireThat} from '../common.ts';
import type {ReleaseRecord} from './release.ts';
export interface PersistedRelease {readonly schema:'omb/release-certificate@1';readonly algorithm:'Ed25519';readonly keyId:string;readonly record:ReleaseRecord;readonly signature:string}
export const releaseHash=(v:string|Uint8Array):string=>createHash('sha256').update(v).digest('hex');
export const releaseKeyId=(key:KeyObject):string=>releaseHash((key.type==='public'?key:createPublicKey(key)).export({type:'spki',format:'der'}));
export const releaseSigningBytes=(record:ReleaseRecord,keyId:string):Buffer=>Buffer.from(canonicalJson({domain:'omb/release-certificate@1',algorithm:'Ed25519',keyId,record}));
/** Reject non-regular entries, path traversal, duplicates, trailing payload and
 * unchecked PAX/link semantics. The writer uses this same simple USTAR dialect. */
export function tarInventory(gzip:Uint8Array):Record<string,string>{
 const bytes=gunzipSync(gzip,{maxOutputLength:256*1024*1024});const files:Record<string,string>=Object.create(null);let at=0,ended=false;
 const field=(b:Buffer,a:number,n:number)=>b.subarray(a,a+n).toString('utf8').replace(/\0.*$/su,'');
 while(at+512<=bytes.length){const h=bytes.subarray(at,at+512);if(h.every(v=>v===0)){requireThat(bytes.subarray(at).every(v=>v===0),'release: trailing tar payload');ended=true;break;}
  const checksum=Number.parseInt(field(h,148,8).trim(),8);let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:h[i]!;requireThat(sum===checksum,'release: tar checksum mismatch');
  const prefix=field(h,345,155),name=(prefix?prefix+'/':'')+field(h,0,100),kind=field(h,156,1);
  requireThat((kind===''||kind==='0')&&/^[A-Za-z0-9_.\/-]+$/u.test(name)&&!name.startsWith('/')&&!name.split('/').some(x=>x==='..'||x==='.'||!x)&&!Object.hasOwn(files,name),'release: unsafe or duplicate tar member');
  const sizeText=field(h,124,12).trim();requireThat(/^[0-7]+$/u.test(sizeText),'release: unsupported tar size');const size=Number.parseInt(sizeText,8);requireThat(Number.isSafeInteger(size)&&at+512+size<=bytes.length,'release: truncated tar member');
  files[name]=releaseHash(bytes.subarray(at+512,at+512+size));at+=512+Math.ceil(size/512)*512;
 }
 requireThat(ended,'release: tar end marker missing');return files;
}
export function verifyPersistedRelease(envelope:PersistedRelease,files:ReadonlyMap<string,Uint8Array>,expected:{publicKey:KeyObject;paperInputHash:string;buildId:string}):{ok:boolean;issues:string[]}{
 try {
  requireThat(envelope.schema==='omb/release-certificate@1'&&envelope.algorithm==='Ed25519','release: unsupported certificate');
  requireThat(expected.publicKey.type==='public'&&expected.publicKey.asymmetricKeyType==='ed25519','release: trusted Ed25519 public key required');
  requireThat(envelope.keyId===releaseKeyId(expected.publicKey)&&verify(null,releaseSigningBytes(envelope.record,envelope.keyId),expected.publicKey,Buffer.from(envelope.signature,'base64')),'release: signature verification failed');
  const r=envelope.record;requireThat(r.paperInputHash===expected.paperInputHash&&r.buildId===expected.buildId,'release: record belongs to a different paper or build');
  requireThat(files.size===Object.keys(r.artifacts).length,'release: artifact inventory differs');
  for(const [name,b] of files)requireThat(r.artifacts[name]?.sha256===releaseHash(b),`release: artifact hash differs: ${name}`);
  for(const [name,inventory] of Object.entries(r.archives??{})){requireThat(files.has(name),'release: archive missing');requireThat(canonicalJson(tarInventory(files.get(name)!))===canonicalJson(inventory),`release: archive file list differs: ${name}`);}
  return {ok:true,issues:[]};
 }catch(e){return {ok:false,issues:[e instanceof Error?e.message:'release verification failed']};}
}
/** Host-only storage, with exclusive creation and no symlink following. Never
 * pass this capability, path, private key or span key into drafter prompts. */
export function loadReleaseKey(directory=path.join(homedir(),'.omerta-bio','release-keys')):KeyObject {
 requireThat(path.basename(directory)==='release-keys'&&!path.resolve(directory).split(path.sep).some(p=>p==='keys'||p==='oneshot'),'release: dedicated release-keys directory required');
 mkdirSync(directory,{recursive:true,mode:0o700});const d=lstatSync(directory);requireThat(d.isDirectory()&&!d.isSymbolicLink()&&(d.mode&0o077)===0,'release: key directory must be private and not a symlink');
 const file=path.join(directory,'ed25519.pem');let fd:number;
 try {fd=openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{const {privateKey}=generateKeyPairSync('ed25519');writeFileSync(fd,privateKey.export({type:'pkcs8',format:'pem'}));}finally{closeSync(fd);}}
 catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
 fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=fstatSync(fd);requireThat(s.isFile()&&(s.mode&0o777)===0o600&&s.nlink===1,'release: private key must be a regular mode-600 file');const key=createPrivateKey(readFileSync(fd));requireThat(key.asymmetricKeyType==='ed25519','release: wrong private key algorithm');return key;}finally{closeSync(fd);}
}
