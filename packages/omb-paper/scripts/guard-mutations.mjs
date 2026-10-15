import ts from 'typescript';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root='packages/omb-paper', main=`${root}/src/index.ts`, sqlite=`${root}/src/sqlite-journal.ts`;
const original=new Map([main,sqlite].map(f=>[f,readFileSync(f,'utf8')]));
const mutations=[];
function guard(name,needle,file=main){const text=original.get(file), ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);let match;
 const visit=n=>{if(ts.isThrowStatement(n)&&n.getText(ast).includes(needle))match=n;ts.forEachChild(n,visit);};visit(ast);
 if(!match)throw new Error(`mutation not found: ${name}: ${needle}`);
 mutations.push({name,file,start:match.getStart(ast),end:match.end,replacement:'void 0;',description:`Remove guard: ${needle}`});}
function change(name,needle,replacement){const text=original.get(main),start=text.indexOf(needle);if(start<0||text.indexOf(needle,start+1)>=0)throw new Error(`ambiguous mutation ${name}`);mutations.push({name,file:main,start,end:start+needle.length,replacement,description:`Replace ${needle}`});}
for(const [name,message] of [
 ['certCount','store certification inventory'],['lookCount','store look inventory'],['lookSeqMatch','native looks differ'],['missingClaims','missing certification claim(s)'],
 ['nullSingletons','must be an object'],['emptyArrays','lineage evidence is incomplete'],['contactRequired','require author contact'],['evidenceHashes','evidence type/hash'],
 ['paperSetVsLock','locked plan paper_set differs'],['v5v7Lock','V5/V7 lock record differs'],['dupContent','duplicate certification content hash'],['manifestBind','input manifest binding'],['frozenBind','frozen code binding'],['execBind','execution binding'],['planBinding','certification plan binding'],['stage1Hash','stage-1 introduction'],['approvalActor','approved-plan actor differs'],['declOrder','timestamp ordered'],['metricsPathForbid','metricsPath is forbidden in lineage inventory'],
 ['seal','body seal missing'],['gateMac','unsigned or invalid gate'],['gateCompleteness','incomplete gate set'],['labelRebuild','certification label mismatch'],['inventoryMac','inventory is incomplete or unverifiable'],['lockReceipt','plan lock is unverifiable'],['timestampReceipt','timestamp receipt is unverifiable'],['timestampBinding','does not cover plan before lock'],['approvalTime','must precede the L4 lock'],['ownerActor','actor is not authorized'],['workerSeal','worker output differs'],['metricCollision','metric key collision'],['claimRebinding','cross-claim metric rebinding'],['draftBinding','contact draft hash'],['endorsement','verification key is unavailable'],['reportHash','report hash differs'],['statusSummary','claim statuses differ'],['supersession','supersession differs from journal'],['emptyPaperSet','locked paper_set must'],['nativeLock','native L4 lock differs'],['lookLedger','look ledger differs'],['phaseChain','phase output chain is invalid'],['phaseOrder','V7 phase order is invalid']])guard(name,message);
guard('journalHash','journal hash is invalid',sqlite);guard('journalChain','journal chain is incomplete',sqlite);
change('signedG2Demotion',"lateLock: c.certificate.gates.some(g => g.result.gate === 'G2' && g.result.outcome === 'failed')",'lateLock: false');
change('classification',"a.status === 'tentative' ? 'tentative' : 'undecided'","a.status === 'tentative' ? 'undecided' : 'undecided'");
change('deviationsEmpty','deviations: amendments','deviations: []');
change('reasonFallback',"'No reason was recorded at the time of the change'","''");
change('exploratoryRows','found: [...found, ...exploratory]','found: [...found]');
change('regHyp','const registeredHypotheses = parsed.plan.claims.filter(c => !c.exploratory).length','const registeredHypotheses = 0');
change('planOrder','let plannedClaimIds = ids.filter(id => expected.claims.includes(foldKey(id)))','let plannedClaimIds = ids.filter(id => expected.claims.includes(foldKey(id))).sort()');
change('kernelFacts',"source === 'kernel' ? 'kernel-recomputed'","source === 'kernel' ? 'worker-reported-unverified'");

// Exact original review locations, plus per-field/disjunct removals. Paired mutants remove
// redundant checks together; a whole-throw mutation is not substituted for these operators.
function multiple(name,edits){let result=original.get(main);for(const [a,b]of edits){if(!result.includes(a)||result.indexOf(a)!==result.lastIndexOf(a))throw new Error(`ambiguous composite ${name}: ${a}`);result=result.replace(a,b);}mutations.push({name,file:main,customText:result,description:edits.map(([a])=>`Remove/replace ${a}`).join('; ')});}
for(const [n,msg]of [['jStoreChain','V7 lineage journal chain is incomplete'],['jStoreHash','V7 lineage journal hash is invalid'],['ledgerChain','V7 ledger journal chain is incomplete'],['ledgerHash','V7 ledger journal hash is invalid'],['stepReceipt','no matching step receipt'],['compatLockDiffers','authenticated V5 lock record is missing'],['unknownActor','unknown lock approval actor'],['planBytesPin','locked plan artifact bytes differ'],['deliverableHash','V7 paper deliverable hash differs'],['unusedCerts','certification artifacts from another lineage'],['anchorMissing','terminal journal anchor missing'],['anchorList','terminal journal anchor certification list'],['terminalRequired','no terminal deliverable']])guard(n,msg);
change('lookCountJournal','journalLooks.length !== lineage.looks.length || ','');
change('lookJournalMatch',"if (journalLooks.some(v => {", "if (false && journalLooks.some(v => {");
multiple('lookBoth',[["journalLooks.length !== lineage.looks.length || ",""],["if (journalLooks.some(v => {","if (false && journalLooks.some(v => {"]]);
change('contactMeta'," || ['reanalysisOfOthersData','differingNumbers','pipelineReuse'].some(k => metadata[k] === true)",'');
for(const key of ['reanalysisOfOthersData','differingNumbers','pipelineReuse'])change('contact_'+key,`'${key}'`,"'disabled'");
change('evidenceSha',' && e.sha256 === a.evidence','');
change('earliestLookMax','const earliestLook = Math.min','const earliestLook = Math.max');
change('v5v7PaperSet','canonicalJson(lockOutput.paperSet) !== canonicalJson(lock.paper_set) || ','');
change('v5v7Actor',' || lockOutput.approvalActor !== request.approvalActor','');
change('lockReceiptNative','v7Lock.sequence !== nativeLock.sequence || v7Lock.hash !== entry.hash','false');
change('nativeReceiptSequence','v7Lock.sequence !== nativeLock.sequence || ','');
change('nativeReceiptHash',' || v7Lock.hash !== entry.hash','');
change('lockReceiptCompat','v7Lock.sequence!==compatibility.seq||v7Lock.hash!==compatibility.hash','false');
change('compatReceiptSequence','v7Lock.sequence!==compatibility.seq||','');
change('compatReceiptHash','||v7Lock.hash!==compatibility.hash','');
change('stage1Regex'," || !/^[a-f0-9]{64}$/u.test(t.stage1IntroductionHash)",'');
change('planOrderPaperSet','let plannedClaimIds = ids.filter(id => expected.claims.includes(foldKey(id)))','let plannedClaimIds = expected.claims.filter(id=>ids.includes(id))');
change('primaryMark','rawClaims.find(c => c.primary === true && plannedClaimIds.includes(foldKey(String(c.id)))) ?? ','');
change('abandonedNoCert','ids.filter(id => !assessments.some(a => a.claimId === id))','ids.filter(()=>false)');
change('voidedClass',"a.assessment.label.voided === true ? 'voided' : ",'');
multiple('plainBoth',[["if ((plan.plain_statement ?? plan.plainStatement) !== plainStatement)","if (false)"],["loaded.certificate.certification.plain_statement !== plainStatement || ",""]]);
multiple('supBoth',[["rows[i]!.supersedes !== rows[i - 1]!.certificationId","false"],[" || source.supersedes !== expectedPrevious",""]]);
change('deliverableLineage',"paper.lineageId!==lineageId||paper.schema!=='omb-investigate/paper-input-fields@1'",'false');
change('deliverableId','paper.lineageId!==lineageId||','');
change('deliverableSchema',"||paper.schema!=='omb-investigate/paper-input-fields@1'",'');
change('lockBeforeLook','const ledgerLateLock=lookSequences.some(seq=>seq<=lockSequence)','const ledgerLateLock=false');
change('g2LockBinding','g2Evidence.lockedAt!==lockSequence || ','');
change('g2LookBinding',' || g2Evidence.firstLookAt!==firstLookSequence','');
change('anyPassG2','assessments.filter(a=>a.lateLock).map(a=>a.claimId)','assessments.filter(a=>a.lateLock && a.certificationId===certificates.at(-1)?.id).map(a=>a.claimId)');
change('demotedPlan','plannedClaimIds=plannedClaimIds.filter(id=>!demoted.has(id));','');
change('demotedCount','registeredHypotheses-rawClaims.filter(c=>!c.exploratory&&demoted.has(foldKey(String(c.id)))).length','registeredHypotheses');
change('workerProducer',"producerGate: source === 'kernel' ? 'certifier-seal' : null","producerGate: source === 'kernel' || kernel.has(key) ? 'certifier-seal' : null");
change('ownerApprovalStatus','&& ownerApproved ?', '?');
change('anchorSequence','anchor.headSequence!==head.seq || ','');
change('anchorHash',' || anchor.headEventHash!==head.hash','');
change('authorityMac',"typeof value.receipt!=='string'||!store.verifyAuthority(record,value.receipt)","typeof value.receipt!=='string'");
change('hardStopReplay','board, hardStops });','board });');
// PW0 final-verification operators, including the original per-field locations.
change('R_anchorAmbiguous','anchors.length!==1','anchors.length<1');
change('R_authorityLineage',' || record.investigationId!==lineageId','');
guard('R_ownerConfigAmbiguous','owner configuration is ambiguous');
change('R_draftHashMatch','.some(r=>r.draftHash===lineage.contact.draftHash)','.some(()=>true)');
change('R_contactKindIntegrity',"c.kind === 'data-integrity' ||",'');
guard('R_contactDraftBinding','contact record is bound to a different draft');
guard('R_contactDraftRequired','contact record must bind a prior draft hash');
change('R_workerDeciding',"deciding: source === 'kernel' && claimId",'deciding: claimId');
change('R_requestInvestigation','request.investigationId !== lineage.lineageId || ','');
change('R_gateSetG3G4',"['G1','G2','G3','G4']","['G1','G2']");
change('R_gateSetG3',"['G1','G2','G3','G4']","['G1','G2','G4']");
change('R_gateSetG4',"['G1','G2','G3','G4']","['G1','G2','G3']");
change('R_labelVoided',' || rebuilt.voided !== assessment.label?.voided','');
change('R_firstLookMax','const firstLookSequence=Math.min','const firstLookSequence=Math.max');
change('R_timestampAfterLock',' || Date.parse(t.at) > lockAt','');
change('R_ownerApprovedTime',' && Date.parse(approval.at)<=lockAt','');
change('R_evidenceUnmapped',"typeof evidenceTypes[a.action] !== 'string' || ",'');
change('demotedRowLateLock',"lateLock: true, status: 'exploratory'","lateLock: false, status: 'exploratory'");
change('demotedDisplayAssessment',"assessment: {status: 'exploratory', label: {status: 'exploratory'}, reason}",'assessment: a.assessment');
const reviewLocations={jStoreChain:200,jStoreHash:203,ledgerChain:252,ledgerHash:252,stepReceipt:238,lookCountJournal:517,lookJournalMatch:520,lookBoth:'517+520',contactMeta:593,evidenceSha:565,earliestLookMax:464,v5v7PaperSet:511,v5v7Actor:511,lockReceiptNative:502,lockReceiptCompat:507,compatLockDiffers:505,unknownActor:559,stage1Regex:555,planOrderPaperSet:452,primaryMark:472,abandonedNoCert:463,voidedClass:459,plainBoth:'536+576',supBoth:'457+586',planBytesPin:643,deliverableHash:651,deliverableLineage:653,unusedCerts:663};
Object.assign(reviewLocations,{R_anchorAmbiguous:294,R_authorityLineage:284,R_ownerConfigAmbiguous:616,R_draftHashMatch:661,R_contactKindIntegrity:658,R_contactDraftBinding:483,R_contactDraftRequired:474,R_workerDeciding:356,R_requestInvestigation:565,R_gateSetG3G4:387,R_gateSetG3:387,R_gateSetG4:387,R_labelVoided:383,R_firstLookMax:607,R_timestampAfterLock:611,R_ownerApprovedTime:622,R_evidenceUnmapped:626});

const acceptance=new Set(['R_workerDeciding','paperSetVsLock','stage1Hash','endorsement','emptyPaperSet','signedG2Demotion','classification','deviationsEmpty','exploratoryRows','regHyp','planOrder','kernelFacts','planOrderPaperSet','primaryMark','demotedPlan','demotedCount','workerProducer','voidedClass','hardStopReplay']);
const lineage=new Set(['demotedRowLateLock','demotedDisplayAssessment','planBytesPin','deliverableHash','unusedCerts','supBoth','deliverableLineage','deliverableId','deliverableSchema','anyPassG2']);
const originalPaper=new Set(['R_timestampAfterLock','certCount','lookCount','lookSeqMatch','missingClaims','nullSingletons','emptyArrays','contactRequired','evidenceHashes','v5v7Lock','dupContent','manifestBind','frozenBind','execBind','planBinding','approvalActor','declOrder','metricsPathForbid','seal','gateMac','gateCompleteness','labelRebuild','inventoryMac','lockReceipt','timestampReceipt','timestampBinding','approvalTime','ownerActor','workerSeal','metricCollision','claimRebinding','draftBinding','reportHash','statusSummary','supersession','nativeLock','lookLedger','phaseChain','phaseOrder','journalHash','journalChain','reasonFallback','lookCountJournal','lookJournalMatch','lookBoth','evidenceSha','v5v7PaperSet','lockReceiptNative','nativeReceiptSequence','nativeReceiptHash','voidedClass']);
for(const m of mutations)m.testFile=`${root}/test/${acceptance.has(m.name)?'acceptance':lineage.has(m.name)?'lineage':originalPaper.has(m.name)?'paper':'round4'}.test.ts`;
const only=process.argv.slice(2), selected=only.length?mutations.filter(m=>only.includes(m.name)):mutations;
if(only.some(n=>!selected.some(m=>m.name===n)))throw new Error('unknown requested mutation');
const run=(m)=>spawnSync('nice',['-n','15',process.execPath,'node_modules/vitest/vitest.mjs','run',m?.testFile??`${root}/test`,'--maxWorkers=2'],{encoding:'utf8',timeout:30000,maxBuffer:4_000_000});
const baseline=run();if(baseline.status!==0)throw new Error('baseline failed: '+baseline.stdout+baseline.stderr);
const results=[];
try {for(const m of selected){const text=original.get(m.file);writeFileSync(m.file,m.customText??text.slice(0,m.start)+m.replacement+text.slice(m.end));let r;try{r=run(m);}finally{writeFileSync(m.file,text);}const failedTests=[...r.stdout.concat(r.stderr).matchAll(/^ FAIL +[^>]+> (.+)$/gm)].map(x=>x[1]);const status=r.error?'inconclusive':r.status===0?'survived':failedTests.length?'killed':'inconclusive';results.push({name:m.name,status,description:m.description,file:m.file,testFile:m.testFile,line:m.start===undefined?null:text.slice(0,m.start).split('\n').length,reviewLocation:reviewLocations[m.name]??null,failedTests});process.stdout.write(`${m.name}: ${status}\n`);}}
finally{for(const [file,text]of original)writeFileSync(file,text);}
const dest=`${root}/integration/mutation-results${only.length?'-targeted':''}.json`;writeFileSync(dest,JSON.stringify({operator:'source guard deletion / per-disjunct deletion / semantic replacement',testSelection:'full package baseline; targeted test file per mutant; exact killing test titles recorded',sourceSha256:Object.fromEntries([...original].map(([p,s])=>[p,createHash('sha256').update(s).digest('hex')])),baselineTests:Number(baseline.stdout.match(/Tests\s+(\d+) passed/)?.[1]??0),total:results.length,killed:results.filter(r=>r.status==='killed').length,results},null,2)+'\n');
writeFileSync(dest.replace('.json','.md'),'| Guard | Review index.ts location | Result | Killing tests |\n|---|---|---|---|\n'+results.map(r=>`| ${r.name} | ${r.reviewLocation??''} | ${r.status} | ${r.failedTests.join('; ').replaceAll('|','/')} |`).join('\n')+'\n');
