import {createHmac} from 'node:crypto';
import {mkdirSync,writeFileSync,openSync,closeSync,fstatSync,readFileSync,constants} from 'node:fs';
import path from 'node:path';
import {canonicalJson,canonicalSha256} from '../../bio-core/src/index.ts';
import {snapshotContractFiles,verifyContractBytes,sha256} from '../../omb-certify/src/contract-verifier.ts';
import {buildTrustedIntegrityWithIdentities,unavailableIntegrity,type IntegrityIdentities,type TrustedIntegrity} from '../../omb-investigate/src/integrity.ts';
import {emptyIdentities} from '../../omb-investigate/src/integrity-linkage.ts';
import {translateCardContract} from './card-contract.ts';
import type {Json} from './results.ts';
import type {IntegrityEvidence} from './integrity.ts';
export type CardIntegrityResult={integrity:TrustedIntegrity;identities:IntegrityIdentities;contractHash:string|null;inputManifestHash:string};
/** A parallel host inventory; this contract must never be sent to Investigation or claim certify. */
export function computeCardIntegrity({publicContract,dataDir,key}:{publicContract:Json;dataDir:string;key:Buffer}):CardIntegrityResult {
 let inputManifestHash=canonicalSha256({}),contractHash:string|null=null;
 const unavailable=(reason:string):CardIntegrityResult=>{const integrity=unavailableIntegrity(reason);integrity.provenance={inputHash:inputManifestHash,contractHash,authenticated:false,contractSource:'served-card-translation'};return {integrity,identities:emptyIdentities(),contractHash,inputManifestHash};};
 try{
  if(key.length<32)return unavailable('card integrity key unavailable');
  const files=snapshotContractFiles(dataDir);inputManifestHash=canonicalSha256(Object.fromEntries([...files].map(([p,b])=>[p,sha256(b)])));
  const translated=translateCardContract(publicContract,files);if(!translated.ok)return unavailable(translated.reason);
  contractHash=translated.contract.public.hash;
  const verified=verifyContractBytes(translated.contract,new Map([...files,...translated.assets]),{expectedContractHash:contractHash});
  if(!verified.ok)return unavailable(verified.code);
  const unitKey=createHmac('sha256',key).update('omb-amani/card-integrity-unit/v1\0'+canonicalJson([inputManifestHash,contractHash])).digest();
  const result=buildTrustedIntegrityWithIdentities({verifiedContract:verified.value,contractUnitKey:unitKey,inputManifestHash,contractAuthenticated:false},[],null,{}, {recordSets:translated.recordSets,contractSource:'served-card-translation'});
  return {...result,contractHash,inputManifestHash};
 }catch{return unavailable('card integrity input unreadable or computation failed');}
}
export function cardIntegrityEvidence(result:CardIntegrityResult):IntegrityEvidence & {identities:{value:IntegrityIdentities;fileSha256:string}} {
 return {value:result.integrity,fileSha256:sha256(canonicalJson(result.integrity)+'\n'),identities:{value:result.identities,fileSha256:sha256(canonicalJson(result.identities)+'\n')}};
}
export function writeCardIntegrity(dir:string,result:CardIntegrityResult):ReturnType<typeof cardIntegrityEvidence> {
 mkdirSync(dir,{recursive:true,mode:0o700});
 writeOrVerify(path.join(dir,'card-integrity.json'),canonicalJson(result.integrity)+'\n');
 writeOrVerify(path.join(dir,'card-integrity-identities.json'),canonicalJson(result.identities)+'\n');
 return cardIntegrityEvidence(result);
}

/** A repeat stage may reuse identical private host facts, but can never replace them. */
function writeOrVerify(file:string,content:string):void {
 try { writeFileSync(file,content,{mode:0o600,flag:'wx'}); return; }
 catch(error) { if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error; }
 let fd:number|undefined;
 try {
  fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  const stat=fstatSync(fd);
  if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o777)!==0o600||stat.size!==Buffer.byteLength(content))throw new Error('unsafe sidecar');
  if(sha256(readFileSync(fd))!==sha256(content))throw new Error('different sidecar');
 } catch(error) {
  throw new Error(`card integrity sidecar conflict or unsafe existing file: ${path.basename(file)}`,{cause:error});
 } finally { if(fd!==undefined)closeSync(fd); }
}
