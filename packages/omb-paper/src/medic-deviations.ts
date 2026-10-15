/** Called only with the already hash-verified host journal. Derive disclosure directly from
 * the code-change record so a missing redundant deviation note cannot hide exposure. */
export function medicDeviations(events:readonly {type?:unknown;payload?:unknown}[]):unknown[] {
 return events.filter(e=>e.type==='code-version-changed').flatMap(e=>{
  const p=e.payload as {failure?:{postExposure?:unknown};oldCommit?:unknown;newCommit?:unknown;diffHash?:unknown};
  if(p?.failure?.postExposure!==true)return [];
  if(![p.oldCommit,p.newCommit,p.diffHash].every(v=>typeof v==='string'&&v.length>0))throw new Error('incomplete medic code-change provenance');
  return [{reason:'protocol-deviation: mid-run code change after exposure',postFirstLook:true,
    changes:[{kind:'plumbing-code-change',oldCommit:p.oldCommit,newCommit:p.newCommit,diffHash:p.diffHash}]}];
 });
}
