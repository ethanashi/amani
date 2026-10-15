import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface StabilityRecord {
  schema:'omb-amani/medic-stability@1'; id:string; at:number;
  kind:'run-start'|'invocation'|'healed'|'run-completed'|'no-heal'|'resolved';
  run:string; invocation?:string; classification?:string; commit?:string;
  status?:string; reviewReference?:string; phase?:string;
}
export function statsDirectory(repo:string):string { return path.resolve(process.env.AMANI_MEDIC_STATS_DIR||path.join(repo,'.amani-medic')); }
export function records(repo:string):StabilityRecord[] {
  const dir=path.join(statsDirectory(repo),'records');
  if(!existsSync(dir))return[];
  return readdirSync(dir).filter(f=>f.endsWith('.json')).sort().map(f=>{
    const r=JSON.parse(readFileSync(path.join(dir,f),'utf8')) as StabilityRecord;
    if(r.schema!=='omb-amani/medic-stability@1'||!r.id||!r.run||!Number.isFinite(r.at)||!['run-start','invocation','healed','run-completed','no-heal','resolved'].includes(r.kind))throw new Error('invalid medic stability record');
    return r;
  });
}
export function summarize(rows:StabilityRecord[]) {
  const byRun=new Map<string,StabilityRecord[]>();
  for(const r of rows){const list=byRun.get(r.run)??[];list.push(r);byRun.set(r.run,list);}
  let consecutiveNoHealRuns=0;
  // An unfinished or refused run breaks the streak; it cannot disappear from the denominator.
  const eligible=(run:StabilityRecord[])=>run.some(r=>r.kind==='no-heal')&&run.some(r=>r.kind==='run-completed'&&r.status==='complete')&&!run.some(r=>r.kind==='invocation');
  const activity=(run:StabilityRecord[])=>Math.max(0,...run.filter(r=>r.kind!=='resolved').map(r=>r.at));
  // Completion order matters for overlapping runs. Closing an old fix is not a new run.
  // Ambiguous simultaneous outcomes place the unsafe run last, conservatively breaking a streak.
  const runs=[...byRun.values()].sort((a,b)=>activity(a)-activity(b)||Number(eligible(b))-Number(eligible(a)));
  for(const run of runs) {
    if(eligible(run))consecutiveNoHealRuns++;
    else consecutiveNoHealRuns=0;
  }
  const totalHealsByFaultClass:Record<string,number>={},successfulHealsByFaultClass:Record<string,number>={};
  for(const r of rows)if(r.kind==='invocation')totalHealsByFaultClass[r.classification??'unknown']=(totalHealsByFaultClass[r.classification??'unknown']??0)+1;
  for(const r of rows)if(r.kind==='healed')successfulHealsByFaultClass[r.classification??'unknown']=(successfulHealsByFaultClass[r.classification??'unknown']??0)+1;
  const openPermanentFixItems=rows.filter(r=>r.kind==='healed'&&!rows.some(x=>x.kind==='resolved'&&x.invocation===r.invocation)).map(r=>({invocation:r.invocation,run:r.run,commit:r.commit,classification:r.classification}));
  return{consecutiveNoHealRuns,totalHealsByFaultClass,successfulHealsByFaultClass,openPermanentFixItems,releaseTarget:{consecutiveNoHealRuns:50,openPermanentFixItems:0,variedCardsAndRealProblemsRequired:true}};
}
export function medicStats(repo:string){return{directory:statsDirectory(repo),...summarize(records(repo))};}
