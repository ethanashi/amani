import {BriefLedger,type FrozenBrief} from '../../omb-literature/src/brief.ts';
import {StoreJournal} from '../../omb-investigate/src/store-adapter.ts';
/** Authority-owned preparation and one-look ticket protocol. No caller gate, path, key or
 * executable callback is accepted. All file names are relative and bytes are content addressed. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson, canonicalSha256 } from '../../bio-core/src/index.ts';
import { gateResult, parsePlan, planLockHash, type GateResult, type PlanClaim } from '../../omb-gauntlet/src/index.ts';
import { verifyContractBytes, type VerifiedContract } from '../../omb-certify/src/contract-verifier.ts';
import { performanceKernel, type PerformanceSettings } from '../../omb-certify/src/performance.ts';
import { factGate } from '../../omb-certify/src/facts.ts';
import { GateAuthority, type Binding } from '../../omb-certify/src/auth.ts';
import type { StagedInputs } from '../../omb-certify/src/stage.ts';
import { createSealedPartition, type OmbStore, type ConfirmBackend, type OSUserAttestation, type ApplyPlan, type ConfirmResult } from '../../omb-store/src/index.ts';
import type { PublicEnvelope } from '../../omb-contract/src/index.ts';
import { NativeStoreLedger, StoreConfirmLauncher, type NativeBindings } from '../../omb-investigate/src/native-store.ts';
import type { PlanLockRequest, LookRequest } from '../../omb-investigate/src/ports.ts';
import { parseCertifyRequest, certifyFromTicket, CERTIFY_BYTES_CAP, type CertificationTicket } from './certify.ts';
import { signResult } from './signing.ts';
import { sha256 } from './os-backend.ts';

export const AUTHORITY_PROTOCOL = 'omb-authority/v1';
export const TICKET_TTL_MS = 12 * 60 * 60 * 1000;
export interface WireFile { name: string; hash: string; base64: string }
export interface AuthorityRequest { schema: typeof AUTHORITY_PROTOCOL; investigationId: string; op: string; [key: string]: unknown }
interface Prepared { datasetId: string; investigationId: string; inputHash: string; contract: PublicEnvelope; files: Record<string,string>; partitionId: string; partitionHash: string; schemaHash: string; devArtifact: string }
interface State { phase: 'prepared'|'locked'|'frozen'|'evaluated'; prepared: Prepared; native?: NativeBindings; lock?: PlanLockRequest; planArtifact?: string; frozenHash?: string; bundle?: Record<string,string>; look?: LookRequest; certification?: CertificationTicket }
interface Ticket { schema: 'omb-authority-ticket/v1'; releaseHash: string; expires: number; state: State; mac: string }
function fail(message: string): never { throw new Error(`authority refused: ${message}`); }
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function exact(v: unknown, fields: string): Record<string,unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== fields.split(',').sort().join(',')) fail('schema fields');
  return v as Record<string,unknown>;
}
export function authorityRequest(value: unknown): AuthorityRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('request object');
  const r = value as AuthorityRequest;
  if (r.schema !== AUTHORITY_PROTOCOL || typeof r.investigationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/.test(r.investigationId)) fail('request identity');
  const fields: Record<string,string> = { prepare:'contract,files', lock:'ticket,request,plan', freeze:'ticket,files,expectedHash', evaluate:'ticket,look', certify:'ticket,executionId' };
  if (!Object.hasOwn(fields,r.op)) fail('operation');
  exact(r, `schema,investigationId,op,${fields[r.op]}${r.op==='lock'&&Object.hasOwn(r,'literature')?',literature':''}`);
  return r;
}
function files(value: unknown): Map<string,Buffer> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) fail('file inventory');
  const names = new Set<string>();
  const encodings = new Map<string,unknown>();
  const artifacts = value.map(v => {
    const f = exact(v,'name,hash,base64');
    if (typeof f.name !== 'string' || f.name.length > 240 || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(f.name) || f.name.split('/').some(p=>p==='.'||p==='..') || names.has(f.name)) fail('file name');
    if(encodings.has(String(f.hash))&&encodings.get(String(f.hash))!==f.base64)fail('conflicting duplicate digest');
    encodings.set(String(f.hash),f.base64);names.add(f.name); return {hash:f.hash,base64:f.base64};
  });
  // Multiple paths may contain identical bytes. Validate content once, count transfer bytes once.
  const unique = [...new Map(artifacts.map(a=>[String(a.hash),a])).values()];
  const decoded = parseCertifyRequest({schema:'omb-certify/v1',ticket:'0'.repeat(64),artifacts:unique}).bytes;
  const inventory=new Map(value.map((f:WireFile)=>[f.name,decoded.get(f.hash)!]));
  if([...inventory.values()].reduce((n,b)=>n+b.length,0)>CERTIFY_BYTES_CAP)fail('decoded inventory cap');
  return inventory;
}
function applyRule(claim:PlanClaim,contract:PublicEnvelope):ApplyPlan|null {
  if(claim.kind!=='out-of-sample')return null;
  const config=claim.knobs.performance as Record<string,unknown>|undefined;
  if(!config||!Object.hasOwn(config,'features'))return null;
  const table=contract.content.structure.tables.find(t=>t.file.path===claim.knobs.table);
  if(!table||!claim.outcome||!Array.isArray(config.features)||!config.features.every(f=>typeof f==='string'))fail('locked prediction features');
  return {table:table.id,features:config.features as string[],outcome:claim.outcome,...(typeof config.simpleRuleColumn==='string'?{simpleRule:config.simpleRuleColumn}:{})};
}
export interface AuthorityOptions {
  store: OmbStore; hostKey: Uint8Array; sealingKey: Uint8Array; releaseHash: string; now: ()=>number;
  /** Production factories are fixed in cert-main; only tests inject the OS backend. */
  backend: (code: Buffer, training: Buffer)=>ConfirmBackend; attest: ()=>OSUserAttestation;
  checkpoint: ()=>Promise<void>;
}
export class AuthoritySession {
  constructor(private readonly o: AuthorityOptions) {}
  private put(v:unknown) { return this.o.store.putArtifact(Buffer.from(canonicalJson(v))); }
  private mac(v:unknown) { return createHmac('sha256',this.o.hostKey).update('omb-authority-ticket/v1\0'+canonicalJson(v)).digest('hex'); }
  private issue(state:State):string {
    const body={schema:'omb-authority-ticket/v1' as const,releaseHash:this.o.releaseHash,expires:this.o.now()+TICKET_TTL_MS,state};
    return this.put({...body,mac:this.mac(body)});
  }
  private ticket(id:unknown, investigationId:string):State {
    if(!hash(id))fail('ticket required');
    const t=JSON.parse(this.o.store.artifact(id).toString()) as Ticket;
    exact(t,'schema,releaseHash,expires,state,mac');
    const {mac,...body}=t;
    if(t.schema!=='omb-authority-ticket/v1'||!hash(mac)||!timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(this.mac(body),'hex'))||t.releaseHash!==this.o.releaseHash||!Number.isSafeInteger(t.expires)||t.expires<this.o.now()||t.expires>this.o.now()+TICKET_TTL_MS||t.state.prepared.investigationId!==investigationId)fail('expired, foreign or unauthenticated ticket');
    return t.state;
  }
  private verified(p:Prepared):VerifiedContract {
    const checked=verifyContractBytes({public:p.contract},new Map(Object.entries(p.files).map(([n,h])=>[n,this.o.store.artifact(h)])),{expectedContractHash:p.contract.hash});
    if(!checked.ok)fail('contract bytes: '+checked.code); return checked.value;
  }
  private ledger(state:State) { if(!state.native)fail('native preparation missing'); return new NativeStoreLedger(this.o.store,()=>state.native!,new StoreJournal(this.o.store,this.o.now)); }
  validateReplay(value:unknown):void { const r=authorityRequest(value);if(r.op!=='prepare')this.ticket(r.ticket,r.investigationId); }
  async handle(value:unknown) {
    const r=authorityRequest(value), store=this.o.store;
    let result:unknown;
    if(r.op==='prepare') {
      const uploaded=files(r.files), contract=r.contract as PublicEnvelope;
      const checked=verifyContractBytes({public:contract},uploaded,{expectedContractHash:contract?.hash});
      if(!checked.ok)fail('contract bytes: '+checked.code);
      const v=checked.value,s=v.structure;
      if(s.batch.length||s.tables.some(t=>t.orientation.layout!=='records'||t.orientation.unit_axis!=='rows'))fail('native preparation currently requires record tables without batch declarations');
      const manifest=Object.fromEntries([...uploaded].map(([n,b])=>[n,store.putArtifact(b)])),inputHash=this.put(manifest);
      const datasetId=s.dataset_id,contractHash=this.put(contract.content);
      const floor=v.resolver.hierarchy.floor!,nodes=s.graph.nodes.filter(n=>n.level===floor);
      const nodeFor=new Map(nodes.map(n=>[v.resolver.nodeKey('public',n.id),n.id]));
      const tables=[...v.tables.values()].map(t=>({id:t.definition.id,headers:t.header,rows:t.rows,rowNodes:t.units.map(u=>[nodeFor.get(u)??fail('unresolved independent unit')]),columnNodes:t.header.map(()=>[])}));
      store.lock(datasetId,{stage:'L0-source-lock',source_hash:inputHash});
      store.lock(datasetId,{stage:'L1-contract-lock',public_contract_hash:contractHash,private_contract_hash:null});
      const partitionId='p-'+canonicalSha256([r.investigationId,inputHash,contractHash]);
      const sealed=createSealedPartition({contract,expectedContractHash:contractHash,partitionId,tables,units:nodes.map(n=>({node:n.id,donor:n.id,stratum:'all',batches:[],identities:[]})),hostKey:this.o.sealingKey,priorExposure:store.priorExposure(contract,inputHash),readSourceArtifact:h=>store.artifact(h)});
      store.putArtifact(sealed.sealedBytes);store.putArtifact(sealed.partitionBytes);store.putArtifact(sealed.commitmentBytes);store.commitPartition(sealed.commitment);
      store.lock(datasetId,{stage:'L2-partition-lock',public_contract_hash:contractHash,partition_hash:sealed.commitment.partitionHash});
      const schemaHash=this.put(sealed.schemaView);
      store.lock(datasetId,{stage:'L3-schema-view',partition_hash:sealed.commitment.partitionHash,schema_view_hash:schemaHash,dev_only:true});
      const prepared:Prepared={datasetId,investigationId:r.investigationId,inputHash,contract,files:manifest,partitionId,partitionHash:sealed.commitment.partitionHash,schemaHash,devArtifact:this.put(sealed.devView.map(t=>({...t,rows:t.rows.filter((_,i)=>!t.rowNodes[i]!.some(n=>sealed.canaryTokens.includes(n)))})))};
      result={ticket:this.issue({phase:'prepared',prepared}),inputHash,contractHash,partitionId,partitionHash:prepared.partitionHash,seed:store.seed({registryVersion:AUTHORITY_PROTOCOL,planLockHash:schemaHash,contractHash,frozenCodeHash:schemaHash,dataHash:inputHash},'investigation-seeds')};
    } else {
      const state=this.ticket(r.ticket,r.investigationId),p=state.prepared;
      if(r.op==='lock') {
        if(state.phase!=='prepared')fail('lock phase');
        const request=exact(r.request,'investigationId,datasetId,planHash,planBytesHash,contractHash,partitionHash,procedures,registryVersion,plainStatement,paperSet,approvalActor'+(Object.hasOwn((r.request??{}) as object,'literatureBriefHash')?',literatureBriefHash':'')) as unknown as PlanLockRequest;
        if(!hash(request.planHash)||!hash(request.planBytesHash)||!(request.partitionHash===null||hash(request.partitionHash))||!(request.registryVersion===null||typeof request.registryVersion==='string'&&request.registryVersion.length>0&&request.registryVersion.length<=128)||typeof request.plainStatement!=='string'||request.plainStatement.length>32000||!Array.isArray(request.paperSet)||request.paperSet.length>128||!request.paperSet.every(p=>typeof p==='string'&&p.length<=256)||!['owner','policy'].includes(request.approvalActor)||!request.procedures||typeof request.procedures!=='object'||Array.isArray(request.procedures)||Object.keys(request.procedures).length>128||!Object.values(request.procedures).every(v=>v===null||typeof v==='string'&&v.length<=256))fail('lock schema');
        if(typeof r.plan!=='string'||Buffer.byteLength(r.plan)>1_000_000)fail('plan cap');
        const plan=parsePlan(r.plan).plan;
        if(!plan||planLockHash(plan)!==request.planHash||sha256(Buffer.from(r.plan))!==request.planBytesHash||request.investigationId!==r.investigationId||request.datasetId!==p.datasetId||request.contractHash!==p.contract.hash)fail('plan binding');
        const planArtifact=store.putArtifact(Buffer.from(r.plan));
        // A deterministic fact has no statistical apply rule. Its native look uses a fixed zero
        // predictor only to exercise the separated runner; G1 is recomputed on pinned source bytes.
        const s=p.contract.content.structure;
        const table=s.tables.find(t=>t.columns.some(c=>c.structural_kind==='measurement')&&t.columns.some(c=>c.structural_kind==='annotation'));
        const configured=plan.claims.map(c=>applyRule(c,p.contract)).find(a=>a!==null);
        const apply:ApplyPlan=!configured&&table?{table:table.id,outcome:table.columns.find(c=>c.structural_kind==='measurement')!.name,features:[table.columns.find(c=>c.structural_kind==='annotation')!.name]}:configured as unknown as ApplyPlan;
        if(!apply)fail('locked native apply rule missing');
        const native:NativeBindings={datasetId:p.datasetId,partitionId:p.partitionId,dataHash:p.inputHash,contractHash:p.contract.hash,partitionHash:p.partitionHash,registryVersion:request.registryVersion??AUTHORITY_PROTOCOL,calibrationResultHash:this.put({status:'not-run',reason:'calibration is not inferred from OS separation'}),trainingArtifactHash:this.put(null),route:'P',confirmingManifestHash:p.inputHash,apply};
        const lock={...request,partitionHash:p.partitionHash,registryVersion:native.registryVersion};
        const next:State={phase:'locked',prepared:p,native,lock,planArtifact};
        if(request.literatureBriefHash!==undefined){
          if(!hash(request.literatureBriefHash)||!r.literature)fail('literature binding');
          const literature=new BriefLedger(new StoreJournal(store,this.o.now),r.investigationId);
          const brief=r.literature as FrozenBrief;
          if(brief.sha256!==request.literatureBriefHash)fail('literature hash');
          literature.freeze(brief);literature.bindPlan(request.planHash);
        }else if(Object.hasOwn(r,'literature'))fail('unbound literature');
        const receipt=await this.ledger(next).lockPlan(lock);
        store.recordProbe(p.datasetId, canonicalJson(plan.claims));
        result={ticket:this.issue(next),receipt};
      } else if(r.op==='freeze') {
        if(state.phase!=='locked')fail('freeze phase');
        const uploaded=files(r.files),bundle=Object.fromEntries([...uploaded].map(([n,b])=>[n,store.putArtifact(b)]));
        if(uploaded.size>128||[...uploaded.values()].reduce((n,b)=>n+b.length,0)>1_000_000||bundle['plan.json']!==state.planArtifact)fail('frozen bundle inventory');
        const frozenHash=this.put(bundle);if(frozenHash!==r.expectedHash)fail('frozen bundle hash');
        if(bundle['code/training.json'])state.native!.trainingArtifactHash=bundle['code/training.json'];
        const receipt=await this.ledger(state).recordFreeze({investigationId:r.investigationId,planHash:state.lock!.planHash,frozenCodeHash:frozenHash,attempt:1});
        result={ticket:this.issue({...state,phase:'frozen',frozenHash,bundle}),receipt};
      } else if(r.op==='evaluate') {
        if(state.phase!=='frozen')fail('evaluate phase');
        const look=exact(r.look,'investigationId,datasetId,partitionId,route,planHash,frozenCodeHash,contractHash,inputManifestHash,executionId') as unknown as LookRequest;
        if(look.investigationId!==r.investigationId||look.datasetId!==p.datasetId||look.planHash!==state.lock!.planHash||look.frozenCodeHash!==state.frozenHash||look.contractHash!==p.contract.hash||look.inputManifestHash!==p.inputHash||typeof look.partitionId!=='string'||look.partitionId.length>256||typeof look.executionId!=='string'||!look.executionId.length||look.executionId.length>256||!['P','H','N'].includes(look.route))fail('look binding');
        const plan=parsePlan(store.artifact(state.planArtifact!).toString()).plan!;
        const integrityOnly=!plan.claims.some(c=>applyRule(c,p.contract));
        const code=integrityOnly?Buffer.from("import os,csv\nwith open(os.environ['OMB_FEATURES']) as src,open(os.environ['OMB_OUTPUT'],'w') as dst:\n r=csv.DictReader(src,delimiter='\\t');dst.write('token\\tprediction\\n')\n for row in r: dst.write(row['token']+'\\t0\\n')\n"):store.artifact(state.bundle!['code/apply.py']??fail('code/apply.py required'));
        const backend=this.o.backend(code,store.artifact(state.native!.trainingArtifactHash));
        const wrapped:ConfirmBackend={execute:input=>{if(sha256(input.frozenCode)!==state.frozenHash)fail('native frozen manifest');return backend.execute({...input,frozenCode:code});}};
        const launcher=new StoreConfirmLauncher(wrapped,this.o.attest);
        const l4=store.timeline(p.datasetId).find(e=>e.record.stage==='L4-plan-lock')!;
        if(l4.record.stage!=='L4-plan-lock')fail('L4 missing');
        const applied=await launcher.confirm({store,datasetId:p.datasetId,partitionId:p.partitionId,tuple:{registryVersion:state.native!.registryVersion,planLockHash:l4.record.plan_hash,contractHash:p.contract.hash,frozenCodeHash:state.frozenHash!,dataHash:p.inputHash},executionId:look.executionId,sealingKey:this.o.sealingKey,curatedContract:false,trainingNetworkEvidence:'unavailable',trainingNetworkEvidenceHash:null,persistCheckpoint:this.o.checkpoint});
        if(applied.status!=='completed'||!applied.look?.executable)fail('native confirmation incomplete');
        const binding:Binding={planHash:state.lock!.planHash,inputManifestHash:p.inputHash,frozenCodeHash:state.frozenHash!,executionId:look.executionId,contractHash:p.contract.hash,partitionHash:p.partitionHash};
        const gates=this.evaluateFacts(this.verified(p),plan.claims,binding);
        const prediction=this.evaluatePredictions(state,plan.claims,applied,binding);
        gates.push(...prediction.gates);
        const primaryArtifact=prediction.primary?this.put(prediction.primary):null;
        const gatesArtifact=this.put(gates),certification:CertificationTicket={schema:'omb-certification-ticket/v1',datasetId:p.datasetId,binding,planArtifact:state.planArtifact!,primaryArtifact,gatesArtifact,artifacts:[state.planArtifact!,gatesArtifact,...(primaryArtifact?[primaryArtifact]:[])],hardStops:[]};
        const record={investigationId:r.investigationId,partitionId:look.partitionId,route:look.route,number:applied.look.number,executable:applied.look.executable,sequence:applied.look.record.sequence,hash:applied.look.hash,executionId:look.executionId,frozenCodeHash:state.frozenHash};
        result={ticket:this.issue({...state,phase:'evaluated',look,certification}),record,separation:applied.separation,claimCeiling:applied.claimCeiling,summary:this.predictionSummary(applied)};
      } else {
        if(state.phase!=='evaluated'||!state.certification||r.executionId!==state.look!.executionId)fail('certification requires the evaluated execution ticket');
        const ticket=state.certification;
        const wire={schema:'omb-certify/v1',ticket:canonicalSha256(ticket),artifacts:[]};
        const a=this.o.attest(),separated=a.certUser==='_ombcert'&&a.runUser==='_ombrun'&&a.certUid>0&&a.runUid>0&&a.certUid!==a.runUid&&a.effectiveUid===a.certUid&&a.storeOwnerUid===a.certUid&&a.keyOwnerUid===a.certUid&&a.storeMode===0o700&&a.keyMode===0o600;
        result=certifyFromTicket({request:wire,ticket,store,hostKey:this.o.hostKey,releaseHash:this.o.releaseHash,separated}).result;
      }
    }
    await this.o.checkpoint();
    return signResult(result,this.o.releaseHash,canonicalSha256(r),this.o.hostKey);
  }
  private evaluatePredictions(state:State,claims:NonNullable<ReturnType<typeof parsePlan>['plan']>['claims'],out:ConfirmResult,binding:Binding) {
    const entries:Record<string,unknown>={},gates:GateResult[]=[];
    for(const claim of claims.filter(c=>c.kind==='out-of-sample')) {
      try {
        const apply=applyRule(claim,state.prepared.contract);
        if(!apply||claim.test!=='paired prediction permutation')fail('locked feature-only apply and paired prediction permutation required');
        if(canonicalJson(apply)!==canonicalJson(state.native!.apply))fail('claim apply differs from L4');
        const config=claim.knobs.performance as unknown as PerformanceSettings;
        const dev=JSON.parse(this.o.store.artifact(state.prepared.devArtifact).toString()) as {id:string;headers:string[];rows:unknown[][]}[];
        const t=dev.find(t=>t.id===state.native!.apply.table)??fail('development table');
        const yi=t.headers.indexOf(state.native!.apply.outcome),ys=t.rows.map(r=>Number(r[yi]));
        if(!ys.length||!ys.every(y=>y===0||y===1)||out.predictions.some(p=>p.simpleRule===undefined))fail('binary dev outcomes and locked simple rule required');
        // Training and pipeline audit gates are unavailable until their own trusted producers run.
        // This bridge scores the immutable apply output without re-opening or executing held-out data.
        const pack=performanceKernel(claim,{units:out.predictions.map(p=>p.unit),outcome:out.predictions.map(p=>Number(p.outcome)),probability:out.predictions.map(p=>p.prediction),simpleRule:out.predictions.map(p=>Number(p.simpleRule)),trainingUnits:t.rows.map((_,i)=>'dev:'+i),trainingPrevalence:ys.reduce<number>((a,b)=>a+b,0)/ys.length,trustedHeldOut:false,heldOutProvenance:'OS-user apply verified; training/pipeline sequestration evidence unavailable'},config,canonicalSha256([binding.planHash,binding.inputManifestHash,binding.frozenCodeHash,claim.id]));
        entries[claim.id]=pack.entry;gates.push(pack.gate);
      } catch { gates.push(gateResult('G9','not-run','Native prediction scoring unavailable for the locked configuration',{claimId:claim.id})); }
    }
    return {primary:Object.keys(entries).length?{claims:entries}:null,gates:gates.map(g=>new GateAuthority(this.o.hostKey).seal(binding,g))};
  }
  private predictionSummary(out:ConfirmResult) {
    // Aggregate only. Neither labels, tokens nor per-unit predictions cross the authority boundary.
    const ys=out.predictions.map(p=>Number(p.outcome));
    return {rows:ys.length,meanSquaredError:ys.every(Number.isFinite)?ys.reduce((n,y,i)=>n+(y-out.predictions[i]!.prediction)**2,0)/ys.length:null};
  }
  private evaluateFacts(v:VerifiedContract,claims:NonNullable<ReturnType<typeof parsePlan>['plan']>['claims'],binding:Binding) {
    const datasets=[...v.tables.values()].map(t=>({path:t.definition.file.path,allowed:true,rowCount:t.rows.length,effectiveN:new Set(t.units).size}));
    const facts:Record<string,number>={};
    for(const d of datasets){facts[d.path.toLowerCase()+'.input_n']=d.rowCount;facts[d.path.toLowerCase()+'.effective_n']=d.effectiveN;}
    const gate=gateResult('G1','passed','authority verified source bytes and contract units',{evidence:{facts,datasets}});
    const staged:StagedInputs={directory:'',inputManifestHash:binding.inputManifestHash,effectiveManifestHash:binding.inputManifestHash,groups:[],units:[],gate,elapsedMs:0,cacheHit:false,contractMode:true,verifiedContract:v};
    const gates:GateResult[]=[gate,...claims.filter(c=>c.kind==='data-integrity'&&c.knobs.producer).map(c=>factGate(staged,c))];
    return gates.map(g=>new GateAuthority(this.o.hostKey).seal(binding,g));
  }
}
