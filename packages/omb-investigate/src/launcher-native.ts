import type {Journal} from './journal.ts';
import {BriefLedger} from '../../omb-literature/src/brief.ts';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import path from 'node:path';
import {parsePlan} from '../../omb-gauntlet/src/index.ts';
import {canonicalSha256} from '../../bio-core/src/index.ts';
import {snapshotContractFiles} from '../../omb-certify/src/contract-verifier.ts';
import {createClient} from '../../omb-launcher/src/client.ts';
import {verifyResult,type SignedResult} from '../../omb-launcher/src/signing.ts';
import {AUTHORITY_PROTOCOL,type AuthorityRequest,type WireFile} from '../../omb-launcher/src/authority.ts';
import {sha256} from '../../omb-launcher/src/os-backend.ts';
import {NativeConfirmation,NativeStoreLedger} from './native-store.ts';
import type {StagedData,ContractPin,LockLedgerPort,PlanLockRequest,LookRecord,ConfirmationPort,CertifyResult} from './ports.ts';

export interface AuthorityPins { releaseHash:string; signingPublicKey:string; authorityProtocol:string }
type Prepared={ticket:string;inputHash:string;contractHash:string;partitionId:string;partitionHash:string;seed:string};
type Receipt={ticket:string;receipt:{sequence:number;hash:string}};
type Evaluated={ticket:string;record:LookRecord;separation:string;claimCeiling:string;summary:{rows:number;meanSquaredError:number|null}};
let authorityQueue:Promise<unknown>=Promise.resolve();
type Saved={request:AuthorityRequest;signed:SignedResult};
const upload=(files:ReadonlyMap<string,Buffer>):WireFile[]=>[...files].map(([name,b])=>({name,hash:sha256(b),base64:b.toString('base64')}));

/** Owner-side transport only. Authority tickets and signatures, rather than this cache or its
 * filesystem permissions, authorize operations. No secret key, outcomes or prediction rows return. */
export class LauncherNativeSession implements ConfirmationPort {
  readonly ledger:NativeStoreLedger;
  readonly confirmation:NativeConfirmation;
  private prepared!:Prepared;
  private saved:Record<string,Saved>={};
  private constructor(private readonly o:{investigationId:string;root:string;pins:AuthorityPins;literatureJournal?:Journal;client:ReturnType<typeof createClient>}) {
    mkdirSync(o.root,{recursive:true,mode:0o700});
    if(existsSync(this.file))this.saved=JSON.parse(readFileSync(this.file,'utf8'));
    for(const v of Object.values(this.saved))this.verify(v);
    const ledger:LockLedgerPort={
      lockPlan:r=>this.lock(r),recordFreeze:r=>this.freeze(r),recordLook:async()=>{throw new Error('native look must run through the authority confirmation bridge');},
      looks:async id=>{if(id!==o.investigationId)throw new Error('foreign investigation');const v=this.cached<Evaluated>('evaluate');return v?[v.record]:[];},
      seed:(tuple,purpose)=>canonicalSha256([this.prepared.seed,tuple,purpose]),
    };
    this.ledger=NativeStoreLedger.remote(ledger,o.literatureJournal);this.confirmation=NativeConfirmation.remote(this);
  }
  static async open(o:{investigationId:string;root:string;pins:AuthorityPins;staged:StagedData;contract:ContractPin;literatureJournal?:Journal;client?:ReturnType<typeof createClient>}):Promise<LauncherNativeSession> {
    if(o.pins.authorityProtocol!==AUTHORITY_PROTOCOL||!o.contract.publicPath||!o.staged.contractInput)throw new Error('authority protocol or verified contract input unavailable');
    const session=new LauncherNativeSession({...o,client:o.client??createClient()});
    const contract=JSON.parse(readFileSync(o.contract.publicPath,'utf8'));
    const prepared=await session.call<Prepared>('prepare',{contract,files:upload(snapshotContractFiles(o.staged.contractInput.dir))});
    if(prepared.contractHash!==o.contract.expectedContractHash||prepared.inputHash!==o.staged.contractInput.manifestHash)throw new Error('authority prepared a different contract/input');
    session.prepared=prepared;return session;
  }
  private get file(){return path.join(this.o.root,'authority-session.json');}
  private verify<T>(entry:Saved):T {
    if(entry.request.investigationId!==this.o.investigationId)throw new Error('foreign cached authority response');
    return verifyResult<T>(entry.signed,this.o.pins.signingPublicKey,this.o.pins.releaseHash,canonicalSha256(entry.request));
  }
  private cached<T>(op:string):T|null {const entry=this.saved[op];return entry?this.verify<T>(entry):null;}
  private async call<T>(op:string,fields:Record<string,unknown>):Promise<T> {
    const request:AuthorityRequest={schema:AUTHORITY_PROTOCOL,investigationId:this.o.investigationId,op,...fields};
    // Always cross the authority on a retry, so expired tickets and checkpoints are rechecked.
    const pending=authorityQueue.then(()=>this.o.client('certify',request));
    authorityQueue=pending.catch(()=>{});
    const reply=await pending,signed=reply.result as SignedResult;
    const entry={request,signed},result=this.verify<T>(entry);
    this.saved[op]=entry;
    const tmp=this.file+'.tmp';writeFileSync(tmp,JSON.stringify(this.saved),{mode:0o600,flush:true});renameSync(tmp,this.file);
    return result;
  }
  private async lock(r:PlanLockRequest) {
    const {planFile,...request}=r;if(!planFile)throw new Error('native plan source required');
    return (await this.call<Receipt>('lock',{ticket:this.prepared.ticket,request,plan:readFileSync(planFile,'utf8'),...(r.literatureBriefHash?{literature:new BriefLedger(this.o.literatureJournal!,r.investigationId).frozen()}: {})})).receipt;
  }
  private async freeze(r:Parameters<LockLedgerPort['recordFreeze']>[0]) {
    const locked=this.cached<Receipt>('lock');if(!locked||!r.bundleDir||r.investigationId!==this.o.investigationId||r.attempt!==1)throw new Error('immutable native freeze requires locked plan and first bundle');
    return (await this.call<Receipt>('freeze',{ticket:locked.ticket,files:upload(snapshotContractFiles(r.bundleDir)),expectedHash:r.frozenCodeHash})).receipt;
  }
  async run(r:Parameters<ConfirmationPort['run']>[0]) {
    const frozen=this.cached<Receipt>('freeze');if(!frozen)throw new Error('authority freeze ticket missing');
    const out=await this.call<Evaluated>('evaluate',{ticket:frozen.ticket,look:r.look});
    const look=r.look,record=out.record;
    if(record.investigationId!==look.investigationId||record.partitionId!==look.partitionId||record.route!==look.route||record.executionId!==look.executionId||record.frozenCodeHash!==look.frozenCodeHash||!record.executable||record.number!==1||out.separation!=='OS-user separation'||out.claimCeiling!=='requires-certification')throw new Error('authority look identity or OS separation refused');
    mkdirSync(r.execution.outDir,{recursive:true,mode:0o700});
    const bytes=JSON.stringify(out.summary)+'\n';writeFileSync(path.join(r.execution.outDir,'native-summary.json'),bytes,{mode:0o600});
    return {record,result:{status:'ok' as const,category:null,errorText:null,outputsHash:canonicalSha256({'native-summary.json':sha256(Buffer.from(bytes))}),files:['native-summary.json']},reason:null};
  }
  async certify(r:Parameters<ConfirmationPort['certify']>[0]):Promise<CertifyResult> {
    try { return await this.certifyChecked(r); }
    catch {
      const plan=parsePlan(readFileSync(path.join(r.bundleDir,'plan.json'),'utf8')).plan;
      return {claims:(plan?.claims??[]).map(c=>({claimId:c.id,kind:c.kind,status:'insufficient-evidence',taskStatus:'insufficient-evidence',reasons:['Authority certificate unavailable or refused'],limitations:['No valid certify ticket and signature for this look'],voided:false})),metrics:{},gates:[],multiplicity:[],warnings:['Authority certificate refused; no local certification fallback'],report:'Authority certificate unavailable or refused'};
    }
  }
  private async certifyChecked(r:Parameters<ConfirmationPort['certify']>[0]):Promise<CertifyResult> {
    const evaluated=this.cached<Evaluated>('evaluate');if(!evaluated)throw new Error('evaluated certify ticket missing');
    const result=await this.call<{binding:{planHash:string;inputManifestHash:string;frozenCodeHash:string;contractHash:string;executionId:string};claims:CertifyResult['claims'];metrics:CertifyResult['metrics'];gates:CertifyResult['gates'];separation:string}>('certify',{ticket:evaluated.ticket,executionId:evaluated.record.executionId});
    if(result.binding.planHash!==r.lock.planHash||result.binding.inputManifestHash!==r.expectedInputHash||result.binding.frozenCodeHash!==r.expectedCodeHash||result.binding.contractHash!==r.expectedContractHash||result.binding.executionId!==evaluated.record.executionId)throw new Error('authority certification differs from investigation pins');
    if(r.degraded||!r.osUserSeparation||result.separation!=='OS-user separation')result.claims=result.claims.map(c=>['confirmed','replicated','refuted'].includes(c.status)?{...c,status:c.status==='refuted'?'insufficient-evidence':'tentative',taskStatus:c.status==='refuted'?'insufficient-evidence':'tentative',limitations:[...c.limitations,'OS-user separation not established']} :c);
    return {...result,report:result.claims.map(c=>`${c.claimId}: ${c.status}`).join('\n'),warnings:[],multiplicity:[]};
  }
}
