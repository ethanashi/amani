import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson, canonicalSha256 } from '../../bio-core/src/index.ts';
import { validateLockTimeline, type LockTimeline, type AmendmentArtifacts, type DataContract, type FieldEvidence, type ValidationContext } from '../../omb-contract/src/index.ts';
import { citationBytesVerified, type VerifiedContract } from './contract-verifier.ts';

export interface ContractHistory {
  timeline: LockTimeline;
  amendments: Record<string, AmendmentArtifacts>;
  /** Authority's outcome-blind audit, bound to the exact amendment, never worker assertions. */
  reviews: {amendmentHash:string; outcomeBlind:boolean; previousPassedClaims:string[]; amendedPassedClaims:string[]}[];
}
export interface ContractReceipt {
  version:'omb-contract-authority/v1'; publicHash:string; privateHash:string|null;
  manifestHash:string; partitionHash:string; historyHash:string; producerIds:string[]; mac:string;
}
function arrayIdentity(value:unknown,arrayName:string):string{
  if(typeof value==='string')return `value:${value}`;
  if(value&&typeof value==='object'&&!Array.isArray(value)){
    const v=value as Record<string,unknown>;
    if(arrayName==='aliases')return `alias:${canonicalSha256([v.namespace,v.encoding,v.original,v.canonical,v.node])}`;
    if(arrayName==='edges'&&typeof v.from==='string'&&typeof v.to==='string'&&typeof v.relation==='string')return `edge:${canonicalSha256([v.from,v.to,v.relation])}`;
    if(typeof v.node==='string')return `node:${v.node}`;
    if(typeof v.id==='string')return `id:${v.id}`;
    if(typeof v.grouping_node==='string'&&Array.isArray(v.members))return `group:${canonicalSha256([v.kind,v.grouping_node,[...v.members].sort()])}`;
  }
  return `value:${canonicalSha256(value)}`;
}
function semanticEvidence(evidence:FieldEvidence,root:unknown):{key:string;subjectNode:string|null}{
  const parts=evidence.pointer.split('/').slice(1).map(p=>p.replaceAll('~1','/').replaceAll('~0','~'));
  let value:unknown=root,prior='',subjectNode:string|null=null;const normalized:string[]=[];
  for(const part of parts){
    if(Array.isArray(value)&&/^\d+$/.test(part)){
      const item=value[Number(part)];normalized.push('@'+prior+':'+arrayIdentity(item,prior));
      if(item&&typeof item==='object'&&!Array.isArray(item)){
        const v=item as Record<string,unknown>;
        if(typeof v.node==='string')subjectNode=v.node;
        else if(prior==='aliases'&&typeof v.node==='string')subjectNode=v.node;
        else if(prior==='nodes'&&typeof v.id==='string')subjectNode=v.id;
        else if(typeof v.from==='string')subjectNode=v.from;
      }
      value=item;
    }else{normalized.push(part);value=value&&typeof value==='object'?(value as Record<string,unknown>)[part]:undefined;}
    prior=part;
  }
  return {key:'/'+normalized.join('/'),subjectNode};
}
/** Evidence grades never authorize silent identity-structure deletion. */
export function identityStructureDeletionsAllowed(before:unknown,after:unknown,removedNodes:ReadonlySet<string>):boolean{
  if(!before||typeof before!=='object'||!after||typeof after!=='object')return false;
  const prior=before as Record<string,unknown>,next=after as Record<string,unknown>;
  const array=(a:unknown,b:unknown,mayDrop:(item:Record<string,unknown>)=>boolean)=>{
    if(!Array.isArray(a)||!Array.isArray(b))return false;
    const retained=new Set(b.map(item=>canonicalJson(item)));
    return a.every(item=>retained.has(canonicalJson(item))||!!item&&typeof item==='object'&&!Array.isArray(item)&&mayDrop(item as Record<string,unknown>));
  };
  const deleted=(key:string,mayDrop:(item:Record<string,unknown>)=>boolean)=>array(prior[key],next[key],mayDrop);
  const removed=(value:unknown)=>typeof value==='string'&&removedNodes.has(value);
  if(!deleted('aliases',item=>removed(item.node)))return false;
  if(!deleted('collision_merges',item=>removed(item.merged_node)))return false;
  if(!deleted('replicate_groups',item=>Array.isArray(item.members)&&item.members.length>0&&item.members.every(removed)))return false;
  if(!deleted('partitions',item=>Array.isArray(item.units)&&item.units.length>0&&item.units.every(unit=>!!unit&&typeof unit==='object'&&removed((unit as Record<string,unknown>).node))))return false;
  const oldGraph=prior.graph,newGraph=next.graph;
  if(!oldGraph||typeof oldGraph!=='object'||!newGraph||typeof newGraph!=='object')return false;
  const old=oldGraph as Record<string,unknown>,fresh=newGraph as Record<string,unknown>;
  if(!array(old.nodes,fresh.nodes,item=>removed(item.id)))return false;
  if(!array(old.edges,fresh.edges,item=>removed(item.from)||removed(item.to)))return false;
  return true;
}
function nodeExists(node:string,contract:DataContract,partition:unknown):boolean{
  const structures=[contract.public.content.structure,...(contract.sealed_private?[contract.sealed_private.content.structure]:[])];
  if(structures.some(s=>s.graph.nodes.some(n=>n.id===node)))return true;
  const parts=(partition as {partitions?:{units?:{node:string}[]}[]}|null)?.partitions??[];
  return parts.some(p=>p.units?.some(u=>u.node===node));
}
/** Capability held by the trusted host account only. A MAC authenticates the accountable
 * approval and history, not the biological correctness of a curator's declarations. */
export class ContractAuthority {
  readonly #key:Buffer;
  constructor(key:Uint8Array){if(key.length<32)throw new Error('authority key too short');this.#key=Buffer.from(key);}
  private mac(value:unknown):string{return createHmac('sha256',this.#key).update('omb-contract-authority/v1\0'+canonicalJson(value)).digest('hex');}
  deriveKey(domain:string):Buffer{
    if(!domain.trim()||domain.length>128)throw new Error('invalid contract authority key domain');
    return createHmac('sha256',this.#key).update('omb-contract-derived-key/v1\0'+domain).digest();
  }
  approve(v:VerifiedContract,history:ContractHistory|null):ContractReceipt{
    const body={version:'omb-contract-authority/v1' as const,publicHash:v.contract.public.hash,privateHash:v.contract.sealed_private?.hash??null,
      manifestHash:v.manifestHash,partitionHash:v.partitionHash,historyHash:canonicalSha256(history),producerIds:[...new Set([v.contract.public.content,...(v.contract.sealed_private?[v.contract.sealed_private.content]:[])].flatMap(l=>l.producers.map(p=>p.id)))].sort()};
    return {...body,mac:this.mac(body)};
  }
  verify(receipt:unknown,v:VerifiedContract,history:ContractHistory|null,context:ValidationContext={}):boolean{
    try{
      if(!receipt||typeof receipt!=='object')return false;
      const {mac,...body}=receipt as ContractReceipt;
      const expected=this.approve(v,history);const {mac:expectedMac,...expectedBody}=expected;
      if(typeof mac!=='string'||!/^[a-f0-9]{64}$/.test(mac)||canonicalJson(body)!==canonicalJson(expectedBody)||!timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(expectedMac,'hex')))return false;
      if(!history)return true; // initial authority approval, with no claimed amendments
      const check=validateLockTimeline(history.timeline,history.amendments,context);if(!check.ok)return false;
      let publicHash:string|null=null,privateHash:string|null=null,partitionHash:string|null=null;
      for(const entry of history.timeline){const r=entry.record;
        if(r.stage==='L1-contract-lock'){publicHash=r.public_contract_hash;privateHash=r.private_contract_hash;}
        if(r.stage==='L2-partition-lock')partitionHash=r.partition_hash;
        if(r.stage!=='L7-post-look-amendment')continue;
        const artifacts=history.amendments[r.amendment_hash]!,review=history.reviews.find(x=>x.amendmentHash===r.amendment_hash);
        if(!review?.outcomeBlind)return false;
        for(const partition of [artifacts.previousPartition,artifacts.amendedPartition])if(!citationBytesVerified(partition.content.evidence,v.files))return false;
        for(const contract of [artifacts.previousContract,artifacts.amendedContract])for(const layer of [contract.public.content,...(contract.sealed_private?[contract.sealed_private.content]:[])])if(!citationBytesVerified(layer.evidence,v.files))return false;
        // Conservative allowlist: no outcome definition, assignment, exclusions, time, table,
        // producer or evidence edits can hide inside an identity amendment.
        const identityPointer=(p:string)=>/^\/structure\/(graph|aliases|collision_merges|replicate_groups|partitions)(?:\/|$)/.test(p);
        const amendmentPointer=(p:string)=>identityPointer(p)||/^\/structure\/limitations(?:\/|$)/.test(p);
        const projection=(c:typeof artifacts.previousContract)=>{
          const metadata=(l:typeof c.public.content|NonNullable<typeof c.sealed_private>['content'])=>({...l,
            ...('public_hash' in l?{public_hash:null}:{}),
            structure:{...l.structure,graph:null,aliases:null,collision_merges:null,replicate_groups:null,partitions:null,limitations:null},
            evidence:l.evidence.filter(e=>!amendmentPointer(e.pointer))});
          return {public:metadata(c.public.content),private:c.sealed_private?metadata(c.sealed_private.content):null};
        };
        if(canonicalJson(projection(artifacts.previousContract))!==canonicalJson(projection(artifacts.amendedContract)))return false;
        const removedNodes=new Set(r.amendment.changes.flatMap(change=>change.kind==='remove-held-out-units'?change.nodes:
          change.kind==='coarsen-units'?change.merges.flatMap(merge=>merge.from_nodes):[]));
        const structurePairs:[[typeof artifacts.previousContract.public.content.structure,typeof artifacts.amendedContract.public.content.structure],...Array<[typeof artifacts.previousContract.public.content.structure,typeof artifacts.amendedContract.public.content.structure]>]=[
          [artifacts.previousContract.public.content.structure,artifacts.amendedContract.public.content.structure],
          ...(artifacts.previousContract.sealed_private&&artifacts.amendedContract.sealed_private?[[artifacts.previousContract.sealed_private.content.structure,artifacts.amendedContract.sealed_private.content.structure] as [typeof artifacts.previousContract.public.content.structure,typeof artifacts.amendedContract.public.content.structure]]:[])];
        if(structurePairs.some(([before,after])=>!identityStructureDeletionsAllowed(before,after,removedNodes)))return false;
        const conservative=(before:FieldEvidence[],after:FieldEvidence[],beforeRoot:unknown,afterRoot:unknown,afterContract:typeof artifacts.amendedContract,selected=identityPointer,allowNewAuthor=false)=>{
          const oldByKey=new Map(before.filter(e=>selected(e.pointer)).map(e=>[semanticEvidence(e,beforeRoot).key,e]));
          const newByKey=new Map(after.filter(e=>selected(e.pointer)).map(e=>[semanticEvidence(e,afterRoot).key,e]));
          for(const e of after.filter(e=>selected(e.pointer))){
          const old=oldByKey.get(semanticEvidence(e,afterRoot).key);
          if(!old){if(e.status==='assumed'||e.status==='contested'||allowNewAuthor&&(e.status==='author'||e.status==='cited'))continue;return false;}
          const oldComparable={...old,pointer:null},newComparable={...e,pointer:null};
          if(canonicalJson(oldComparable)===canonicalJson(newComparable))continue;
          // Only an explicit downgrade can change existing evidence. Provenance cannot
          // be swapped, nor can a contested field become an assumption or assertion.
          if(!((e.status==='contested'&&old.status!=='contested'||e.status==='assumed'&&['author','cited'].includes(old.status))&&
            canonicalJson(e.producer_ids)===canonicalJson(old.producer_ids)&&canonicalJson(e.citations)===canonicalJson(old.citations)))return false;
          }
          for(const old of before.filter(e=>selected(e.pointer))){
            const identity=semanticEvidence(old,beforeRoot);if(newByKey.has(identity.key))continue;
            if(identity.subjectNode&&removedNodes.has(identity.subjectNode)&&!['assumed','contested'].includes(old.status))continue;
            if(identity.subjectNode&&nodeExists(identity.subjectNode,afterContract,afterRoot))return false;
            if(old.status==='assumed'||old.status==='contested')return false;
            if(identity.subjectNode&&!removedNodes.has(identity.subjectNode))return false;
          }
          return true;
        };
        if(!conservative(artifacts.previousContract.public.content.evidence,artifacts.amendedContract.public.content.evidence,
          artifacts.previousContract.public.content,artifacts.amendedContract.public.content,artifacts.amendedContract))return false;
        if(!conservative(artifacts.previousContract.sealed_private?.content.evidence??[],artifacts.amendedContract.sealed_private?.content.evidence??[],
            artifacts.previousContract.sealed_private?.content,artifacts.amendedContract.sealed_private?.content,artifacts.amendedContract))return false;
        const partitionMetadata=(p:typeof artifacts.previousPartition)=>({...p.content,antecedent_public_contract_hash:null,partitions:null,evidence:null});
        if(canonicalJson(partitionMetadata(artifacts.previousPartition))!==canonicalJson(partitionMetadata(artifacts.amendedPartition)))return false;
        if(!conservative(artifacts.previousPartition.content.evidence,artifacts.amendedPartition.content.evidence,
            artifacts.previousPartition.content,artifacts.amendedPartition.content,artifacts.amendedContract,()=>true,
            r.amendment.changes.some(change=>change.kind==='coarsen-units'||change.kind==='add-replicate-groups')))return false;
        publicHash=r.amendment.amended_contract_hash;privateHash=r.amendment.amended_private_contract_hash;partitionHash=r.amendment.amended_partition_hash;
      }
      return publicHash===v.contract.public.hash&&privateHash===(v.contract.sealed_private?.hash??null)&&partitionHash===v.partitionHash;
    }catch{return false;}
  }
}
export function passedBothHistory(history:ContractHistory|null,claimId:string):boolean{
  if(!history)return true;
  return history.timeline.filter(e=>e.record.stage==='L7-post-look-amendment').every(e=>{
    if(e.record.stage!=='L7-post-look-amendment')return false;
    const amendmentHash=e.record.amendment_hash,review=history.reviews.find(r=>r.amendmentHash===amendmentHash);
    return review?.outcomeBlind===true&&review.previousPassedClaims.includes(claimId)&&review.amendedPassedClaims.includes(claimId);
  });
}
