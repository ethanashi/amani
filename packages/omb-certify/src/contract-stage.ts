import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256 } from '../../bio-core/src/index.ts';
import { gateResult, type PlanClaim, type GateResult } from '../../omb-gauntlet/src/index.ts';
import type { DataContract, ValidationContext, Partition } from '../../omb-contract/src/index.ts';
import { verifyContractBytes, snapshotContractFiles, sha256, type ContractVerificationOptions, type VerifiedContract } from './contract-verifier.ts';
import { ContractAuthority, passedBothHistory, type ContractReceipt, type ContractHistory } from './contract-authority.ts';
import { PREPARE, treeManifest, type StagedInputs } from './stage.ts';

export interface ContractHostInput extends ContractVerificationOptions {
  contract:DataContract;
  authority?:ContractAuthority; receipt?:ContractReceipt; history?:ContractHistory|null;
  /** Derived by the host from its persistent secret; never placed in worker scope. */
  tokenKey?:Uint8Array;
}
export const unitToken=(identity:string,key:Uint8Array):string=>{
  if(key.byteLength<32)throw new Error('host unit-token key unavailable');
  return 'u_'+createHmac('sha256',key).update('omb-public-unit/v1\0'+identity).digest('hex');
};
export function encodeTable(file:string,header:readonly string[],rows:readonly (readonly string[])[]):string{
  if(file.endsWith('.json'))return JSON.stringify(rows.map(row=>Object.fromEntries(header.map((h,i)=>[h,row[i]]))))+'\n';
  const sep=file.endsWith('.csv')?',':'\t';return [header,...rows].map(row=>row.map(v=>v.includes(sep)||/["\r\n]/.test(v)?'"'+v.replaceAll('"','""')+'"':v).join(sep)).join('\n')+'\n';
}
/** V3 staging never consults plan.staging, model columns, or inferred identity. */
export function stageWithContract(raw:string,directory:string,host:ContractHostInput|undefined,contractSuppliedWithoutObject=false):StagedInputs{
  const snapshot=snapshotContractFiles(raw),inputManifestHash=canonicalSha256(Object.fromEntries([...snapshot].map(([k,v])=>[k,sha256(v)])));
  const contractSupplied=host!==undefined||contractSuppliedWithoutObject;
  const tokenRoot=host?.tokenKey??host?.authority?.deriveKey('omb-public-unit-token-root/v1');
  const tokenReady=!host||!!tokenRoot&&tokenRoot.byteLength>=32;
  const result=host?verifyContractBytes(host.contract,snapshot,host):null;
  const publicResult=result?.ok&&host&&tokenReady?verifyContractBytes({public:host.contract.public},snapshot,{expectedContractHash:host.expectedContractHash,...(host.registry?{registry:host.registry}:{}),...(host.antecedents?{antecedents:host.antecedents}:{})}):null;
  const verified=result?.ok&&publicResult?.ok&&tokenReady?result.value:undefined;
  const contractUnitKey=verified&&tokenRoot?createHmac('sha256',tokenRoot).update('omb-public-unit/v1\0'+canonicalJson([inputManifestHash,verified.contract.public.hash])).digest():
    Buffer.from(canonicalSha256(['omb-public-unit-internal/v1',inputManifestHash,verified?.contract.public.hash??null]),'hex');
  const context:ValidationContext=host?.registry?{derivationRegistry:{version:host.registry.version,implementations:Object.fromEntries(Object.entries(host.registry.converters).map(([k,v])=>[k,v.implementationHash]))}}:{};
  const authenticated=!!(host?.authority&&verified&&host.authority.verify(host.receipt,verified,host.history??null,context));
  mkdirSync(path.join(directory,'RAW'),{recursive:true,mode:0o700});mkdirSync(path.join(directory,'SOURCE'),{mode:0o700});
  const publicFiles=new Set(verified?.contract.public.content.structure.source_files.map(f=>f.path)??[]);
  for(const [name,bytes] of snapshot)for(const scope of ['SOURCE','RAW']){
    // With no host contract, preserve the legacy exploratory worker input. A supplied
    // contract that fails either verification pass still withholds every worker byte.
    if(scope==='RAW'&&contractSupplied&&(!verified||!publicFiles.has(name)))continue;
    const full=path.join(directory,scope,name);mkdirSync(path.dirname(full),{recursive:true,mode:0o700});writeFileSync(full,bytes,{mode:0o400});
  }
  const tableUnits:Record<string,string[]>={},units=new Set<string>(),facts:Record<string,number>={},datasets:{path:string;allowed:boolean;rowCount:number;effectiveN:number}[]=[];
  if(verified)for(const t of verified.tables.values()){
    const ids=t.units.map(identity=>unitToken(verified.resolver.atLevel(verified.layer,identity,verified.resolver.hierarchy.floor!),contractUnitKey));tableUnits[t.definition.file.path]=[...new Set(ids)];ids.forEach(id=>units.add(id));
    const n=new Set(ids).size;facts[t.definition.file.path.toLowerCase()+'.effective_n']=n;facts[t.definition.file.path.toLowerCase()+'.input_n']=ids.length;
    datasets.push({path:t.definition.file.path,allowed:true,rowCount:ids.length,effectiveN:n});
  }
  if(verified&&publicResult?.ok&&tokenRoot)for(const t of publicResult.value.tables.values()){
    const ids=t.units.map(identity=>unitToken(publicResult.value.resolver.atLevel(publicResult.value.layer,identity,publicResult.value.resolver.hierarchy.floor!),contractUnitKey));
    if(publicFiles.has(t.definition.file.path)&&t.definition.orientation.unit_axis==='rows'){
      const header=[...t.header],col=header.indexOf('unit_id');if(col<0)header.push('unit_id');
      const rows=t.rows.map((r,i)=>{const row=[...r];if(col<0)row.push(ids[i]!);else row[col]=ids[i]!;return row;});
      chmodSync(path.join(directory,'RAW',t.definition.file.path),0o600);
      writeFileSync(path.join(directory,'RAW',t.definition.file.path),encodeTable(t.definition.file.path,header,rows),{mode:0o400});
      chmodSync(path.join(directory,'RAW',t.definition.file.path),0o400);
    }
  }
  facts.effective_n=units.size;
  writeFileSync(path.join(directory,'prepare.sh'),PREPARE,{mode:0o500});
  const gate=gateResult('G1',verified&&authenticated?'passed':'not-run',verified?'contract bytes verified':'data contract verification unavailable',{code:result&&!result.ok?result.code:'contract-missing',evidence:{facts,datasets,contractVerified:!!verified}});
  return {directory,inputManifestHash,effectiveManifestHash:canonicalSha256(treeManifest(directory)),groups:[...units].map(u=>[u]),units:[...units],tableUnits,gate,elapsedMs:0,cacheHit:false,
    contractMode:true,...(verified?{verifiedContract:verified}:{}),contractAuthenticated:authenticated,contractUnitKey,contractHistory:host?.history??null};
}
export function claimContractUnits(v:VerifiedContract,claim:PlanClaim,key:Uint8Array):string[]{
  const table=[...v.tables.values()].find(t=>t.definition.file.path===claim.knobs.table);if(!v.contract.public.content.structure.tables.some(t=>t.file.path===claim.knobs.table)||!table)throw new Error('claim table absent from contract');
  // unit_id is the software-generated alias for the verified independence floor.
  const level=claim.unit==='unit_id'?v.resolver.hierarchy.floor!:claim.unit;
  if(!level||!v.resolver.hierarchy.allowed.has(level))throw new Error('claim unit is finer than the contract floor');
  if(claim.outcome){const col=table.definition.columns.find(c=>c.name===claim.outcome);if(!col?.measurement)throw new Error('outcome measurement metadata unavailable');}
  for(const [use,names] of [['outcome',[claim.outcome]],['exposure',[claim.exposure]],['covariate',claim.adjustment]] as const)for(const name of names)if(name&&v.structure.forbidden_uses.some(f=>f.column.table===table.definition.id&&f.column.column===name&&f.uses.includes(use)))throw new Error('contract forbids selected use');
  return table.units.map(u=>unitToken(v.resolver.atLevel(v.layer,u,level),key));
}
export function contractGates(staged:StagedInputs|null,claims:readonly PlanClaim[],effectiveInputsVerified:boolean,planHash?:string):GateResult[]{
  const v=staged?.verifiedContract;
  return claims.flatMap(claim=>{
    const gates:GateResult[]=[];
    const make=(gate:'G1a'|'G1b',outcome:'passed'|'failed'|'not-run',summary:string,evidence:Record<string,unknown>={},code?:string)=>gateResult(gate,outcome,summary,{claimId:claim.id,evidence,...(code?{code}:{})});
    if(!v){gates.push(make('G1a','not-run','host-pinned data contract unavailable',{},'contract-unavailable'));if(claim.kind==='out-of-sample')gates.push(make('G1b','not-run','contract partition unavailable'));return gates;}
    try{
      const units=claimContractUnits(v,claim,staged!.contractUnitKey!),n=new Set(units).size;
      // Only descriptive limitations are known to carry no identity or analysis semantics.
      // Unknown pointers fail closed. Assumptions need amendment-9 validation before use;
      // author approval alone is not that validation.
      const evidence=[...v.contract.public.content.evidence,...(v.contract.sealed_private?.content.evidence??[]),...v.partitionEvidence];
      const unresolved=evidence.some(e=>['assumed','contested'].includes(e.status)&&!/^\/structure\/limitations(?:\/|$)/.test(e.pointer));
      const history=staged!.contractHistory;const planBound=!history||history.timeline.some(e=>e.record.stage==='L4-plan-lock'&&e.record.plan_hash===planHash);
      const approved=planBound&&!unresolved&&staged!.contractAuthenticated===true&&passedBothHistory(staged!.contractHistory??null,claim.id);
      const verified=approved&&effectiveInputsVerified&&n>0;
      gates.push(make('G1a',verified?'passed':'not-run',verified?'contract units verified after replicate collapse':'contract authority, dual evaluation or execution unavailable',{
        ruleVersion:'contract-v3',contractHash:v.contract.public.hash,bytesVerified:true,authenticated:approved,effectiveInputsVerified,rows:units.length,nUnits:n,effectiveN:n,findings:[]
      }));
      if(claim.kind==='out-of-sample'){
        const table=[...v.tables.values()].find(t=>t.definition.file.path===claim.knobs.table)!;
        const level=claim.unit==='unit_id'?v.resolver.hierarchy.floor!:claim.unit!;
        const matching=v.partitions.filter(p=>partitionContains(v,p,table.units,'held-out',level));
        const ok=verified&&matching.length===1;
        gates.push(make('G1b',ok?'passed':'failed',ok?'trusted contract held-out partition is unit-disjoint':'claim units are not an unambiguous held-out contract partition',{
          ruleVersion:'contract-v3',contractHash:v.contract.public.hash,partitionHash:matching.length===1?canonicalSha256(matching[0]):null,
          authenticated:approved,disjoint:ok,rows:units.length,units:n,findings:ok?[]:['partition-unverified']
        },ok?undefined:'contract-partition-unverified'));
      }
    }catch(error){const outside=error instanceof Error&&['outcome measurement metadata unavailable','claim table absent from contract'].includes(error.message);if(!gates.some(g=>g.gate==='G1a'))gates.push(make('G1a','failed',outside?'claim falls outside contract measurement or table metadata':'claim contradicts contract units or permitted column uses',{},outside?'claim-outside-contract':'contract-contradicted'));if(claim.kind==='out-of-sample')gates.push(make('G1b','failed','contract units unavailable'));}
    return gates;
  });
}

/** Compare identities at the coarser of the claim and partition levels. A coarser
 * claim spanning both allocations is rejected, even if its selected rows are held out. */
export function partitionContains(v:VerifiedContract,p:Partition,units:readonly string[],allocation:'dev'|'held-out',claimLevel=v.resolver.hierarchy.floor!):boolean{
  try{
    const level=v.resolver.hierarchy.coarser(p.unit_level,claimLevel)?claimLevel:p.unit_level;
    const key=(u:string)=>v.resolver.atLevel(v.layer,u,level);
    const selected=new Set(p.units.filter(u=>u.allocation===allocation).map(u=>key(v.resolver.nodeKey(v.layer,u.node))));
    const other=new Set(p.units.filter(u=>u.allocation!==allocation).map(u=>key(v.resolver.nodeKey(v.layer,u.node))));
    return units.length>0&&selected.size>0&&p.units.some(u=>u.allocation===(allocation==='dev'?'held-out':'dev'))&&units.every(u=>selected.has(key(u))&&!other.has(key(u)));
  }catch{return false;}
}
