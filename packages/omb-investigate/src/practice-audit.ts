import {auditDictionaryProjection,validateDictionaryTargets,checkDictionaryRows} from './measurement-dictionary.ts';
import {gwasShape,validGwas,alleleFields,frequencyFields} from './practice-gwas.ts';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
/** Independent host audit of worker-visible fields. No practiceStructure classifier,
 * generator RNG, or generator role exemptions are used here. This is a conservative
 * finite-sample diagnostic, not a proof of information-theoretic independence.
 */
import type { Table } from './tabular.ts';
import type { PracticeViolation, StructureDeclaration } from './practice-structure.ts';

const absent=(v:string)=>['','na','nan','null','none','.','n/a','-'].includes(v.toLowerCase());
function correlation(x:number[],y:number[]):number {
  if(!x.length||!y.length||x.every(v=>v===x[0])||y.every(v=>v===y[0]))return 0;
  const mx=x.reduce((s,v)=>s+v,0)/x.length,my=y.reduce((s,v)=>s+v,0)/y.length;
  let xy=0,xx=0,yy=0;for(let i=0;i<x.length;i++){const a=x[i]!-mx,b=y[i]!-my;xy+=a*b;xx+=a*a;yy+=b*b;}
  return xx&&yy?xy/Math.sqrt(xx*yy):0;
}
const logFactorials=[0];
/** Exact conditional permutation tail for two binary projections. A perfect
 * match of three rare cells at n=105 is not 105 observations of evidence. */
function binaryExactP(x:number[],y:number[]):number|null{
 const indices=x.flatMap((v,i)=>Number.isFinite(v)&&Number.isFinite(y[i])?[i]:[]),xs=new Set(indices.map(i=>x[i])),ys=new Set(indices.map(i=>y[i]));
 if(xs.size!==2||ys.size!==2)return null;
 const xv=[...xs][0],yv=[...ys][0],n=indices.length,a=indices.filter(i=>x[i]===xv).length,b=indices.filter(i=>y[i]===yv).length,k=indices.filter(i=>x[i]===xv&&y[i]===yv).length;
 for(let i=logFactorials.length;i<=n;i++)logFactorials.push(logFactorials[i-1]!+Math.log(i));
 const choose=(n:number,k:number)=>logFactorials[n]!-logFactorials[k]!-logFactorials[n-k]!;
 const probability=(k:number)=>choose(a,k)+choose(n-a,b-k)-choose(n,b),observed=probability(k);let p=0;
 for(let j=Math.max(0,a+b-n);j<=Math.min(a,b);j++){const q=probability(j);if(q<=observed+1e-10)p+=Math.exp(q);}
 return Math.min(1,p);
}
/** Enumerate numeric, categorical, missingness and lexical numeric projections.
 * Saturated identifiers are checked for source bytes separately, not treated as
 * hundreds of one-observation categories with meaningless in-sample fit.
 */
function features(values:string[]):{id:string;values:number[]}[] {
  const out:{id:string;values:number[]}[]=[{id:'missing',values:values.map(v=>Number(absent(v)))}];
  const present=values.filter(v=>!absent(v));
  if(present.length && present.every(v=>Number.isFinite(Number(v))))out.push({id:'numeric',values:values.map(v=>absent(v)?0:Number(v))});
  if(present.length && present.every(v=>/^\d{4}-\d{2}-\d{2}/.test(v)&&Number.isFinite(Date.parse(v))))out.push({id:'date',values:values.map(v=>absent(v)?0:Date.parse(v))});
  const decorated=(v:string)=>/^[<>≤≥=\s]*([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?)(?:\s*[%\p{L}µμ][\p{L}\p{N}µμ%/ .^−-]*)?$/u.exec(v)?.[1];
  if(present.length&&!present.every(v=>Number.isFinite(Number(v)))&&present.every(v=>decorated(v)!==undefined))out.push({id:'formatted-number',values:values.map(v=>absent(v)?0:Number(decorated(v)!.replace(',','.')))});
  const levels=[...new Set(present)];
  if(levels.length<=32&&!(levels.length<=2&&present.every(v=>Number.isFinite(Number(v)))))for(const level of levels)out.push({id:`level:${level}`,values:values.map(v=>Number(v===level))});
  else {
    const prefixes=values.map(v=>v.replace(/[0-9]+/g,'#'));
    if(new Set(prefixes).size<=32)for(const prefix of new Set(prefixes))out.push({id:`prefix:${prefix}`,values:prefixes.map(v=>Number(v===prefix))});
    if(!present.every(v=>Number.isFinite(Number(v)))&&values.every(v=>/\d/.test(v)))out.push({id:'lexical-number',values:values.map(v=>Number(v.match(/\d+/)?.[0]??0))});
  }
  out.push({id:'length',values:values.map(v=>v.length)},{id:'decimal-places',values:values.map(v=>v.match(/[.,](\d+)/)?.[1]?.length??0)});
  for(const f of [...out].filter(f=>['numeric','formatted-number','date'].includes(f.id))){
    const ordered=[...new Set(f.values)].sort((a,b)=>a-b),ranks=new Map(ordered.map((v,i)=>[v,i]));
    out.push({id:f.id+':rank',values:f.values.map(v=>ranks.get(v)!)},{id:f.id+':square',values:f.values.map(v=>v*v)});
  }
  if(levels.length>32){const order=[...levels].sort(),ranks=new Map(order.map((v,i)=>[v,i]));out.push({id:'category-rank',values:values.map(v=>ranks.get(v)??0)});}
  return out.filter(f=>!f.values.every(v=>v===f.values[0])&&(!/^(level|prefix):/.test(f.id)||f.values.filter(v=>v===1).length>=3&&f.values.filter(v=>v===0).length>=3));
}

export function auditPracticeLeakage(real:readonly Table[], practice:readonly Table[], declarations:Readonly<Record<string,StructureDeclaration>>, observe?:(id:string,correlation:number,units:number)=>void):PracticeViolation[] {
  const dictionary=auditDictionaryProjection(real,practice,declarations);
  const failures:PracticeViolation[]=[...dictionary.failures];
  for(const t of practice)if(!validGwas(t))failures.push({file:t.file,check:'gwas-shape',detail:'invalid biallelic practice tuple'});
  const correlationShape=(t:Table)=>{
    const d=declarations[t.file];if(!d?.matrix)return false;
    const key=t.header.findIndex(h=>d.keys.includes(h));if(key<0||t.rows.length+1!==t.header.length)return false;
    const axis=t.rows.map(r=>t.header.indexOf(r[key]!));if(axis.some(j=>j<0))return false;
    return t.rows.every((r,i)=>axis.every((j,k)=>Number.isFinite(Number(r[j]))&&Math.abs(Number(r[j]))<=1&&Math.abs(Number(r[j])-Number(t.rows[k]![axis[i]!]))<1e-9&&(i!==k||Number(r[j])===1)));
  };
  const correlationFiles=new Set(real.filter(correlationShape).map(t=>t.file));
  // A plan role cannot exempt an explicitly served matrix identity from leak checks.
  const keys=new Map(real.map(t=>[t.file,new Set((declarations[t.file]?.keys??[]).filter(k=>declarations[t.file]?.matrix||!declarations[t.file]?.exposures?.includes(k)&&!declarations[t.file]?.outcomes?.includes(k)))]));
  for(const [file,fields] of dictionary.fields)for(const name of fields)keys.get(file)?.delete(name);
  type Edge={from:string;a:number;to:string;b:number};const edges:Edge[]=[];
  const keyParts=(t:Table,j:number,value:string)=>{const separator=declarations[t.file]?.keySeparators?.[t.header[j]!];return (separator?value.split(separator):[value]).filter(v=>!absent(v)&&!declarations[t.file]?.missing?.includes(v));};
  const domains=new Map<Table,Map<number,Set<string>>>();
  const domainOf=(t:Table,j:number)=>{let columns=domains.get(t);if(!columns){columns=new Map();domains.set(t,columns);}let values=columns.get(j);if(!values){values=new Set(t.rows.flatMap(r=>keyParts(t,j,r[j]??'')));columns.set(j,values);}return values;};
  const measurement=(d:StructureDeclaration|undefined,name:string)=>!d?.keys.includes(name)&&/^(integer|decimal|number|float|count|measurement|outcome)$/.test(d?.roles?.[name]??'');
  // Independently discover exact key inclusions. Numeric measurement coincidences
  // are not identity, and adjacent dictionary payloads never become exceptions.
  for(const t of real)for(const target of real){if(t===target)continue;
    for(let a=0;a<t.header.length;a++)for(let b=0;b<target.header.length;b++){
      const da=declarations[t.file],db=declarations[target.file],an=t.header[a]!,bn=target.header[b]!;
      if(dictionary.fields.get(t.file)?.has(an)||dictionary.fields.get(target.file)?.has(bn)||da?.outcomes?.includes(an)||db?.outcomes?.includes(bn))continue;
      // A declared measurement can coincide with a numeric identifier domain
      // without becoming a foreign key. It remains in the relationship audit;
      // only independently declared identities may override a measurement role.
      if(measurement(da,an)||measurement(db,bn))continue;
      if(da?.keyNamespaces?.[an]&&db?.keyNamespaces?.[bn]&&da.keyNamespaces[an]!==db.keyNamespaces[bn])continue;
      if(!keys.get(target.file)!.has(bn)&&!keys.get(t.file)!.has(an))continue;
      const domain=domainOf(target,b),values=domainOf(t,a);
      if(values.size<2||values.size>domain.size||![...values].every(v=>domain.has(v)))continue;
      edges.push({from:t.file,a,to:target.file,b});
      if(!da?.exposures?.includes(an))keys.get(t.file)!.add(an);
      if(!db?.exposures?.includes(bn))keys.get(target.file)!.add(bn);
    }
  }
  const numericColumns=new Map<Table,Map<number,number[]|null>>();
  const numericColumn=(t:Table,j:number):number[]|null=>{
    let cache=numericColumns.get(t);if(!cache){cache=new Map();numericColumns.set(t,cache);}
    if(cache.has(j))return cache.get(j)!;
    const parse=(v:string|undefined)=>v===undefined||absent(v)?NaN:Number.isFinite(Number(v))?Number(v):/^\d{4}-\d{2}-\d{2}/.test(v)?Date.parse(v):NaN;
    const values=t.rows.map(r=>parse(r[j]));const result=values.every(Number.isFinite)?values:null;cache.set(j,result);return result;
  };
  const orderCache=new Map<string,'none'|'fresh'|'copied'>();
  const orderShape=(source:Table,generated:Table,a:number,b:number):'none'|'fresh'|'copied'=>{
    const key=JSON.stringify([source.file,Math.min(a,b),Math.max(a,b)]);if(orderCache.has(key))return orderCache.get(key)!;
    const x=numericColumn(source,a),y=numericColumn(source,b);let result:'none'|'fresh'|'copied'='none';
    if(x&&y&&x.length){let negative=false,positive=false;
      for(let i=0;i<x.length;i++){negative ||= x[i]!<y[i]!;positive ||= x[i]!>y[i]!;if(negative&&positive)break;}
      if(negative!==positive){result='fresh';
        if(x.length>=12&&new Set(x).size>=12&&new Set(y).size>=12){const px=numericColumn(generated,a),py=numericColumn(generated,b);
          if(px&&py){const fresh=px.map((v,i)=>v-py[i]!);const gaps=x.map((v,i)=>v-y[i]!);
            if(new Set(fresh).size===1||JSON.stringify(fresh.sort((a,b)=>a-b))===JSON.stringify(gaps.sort((a,b)=>a-b)))result='copied';}
        }
      }
    }
    orderCache.set(key,result);return result;
  };
  for(const source of real){const p=practice.find(t=>t.file===source.file),d=declarations[source.file];if(!p||!d)continue;
    for(const key of keys.get(source.file)!){if(dictionary.fields.get(source.file)?.has(key))continue;const j=source.header.indexOf(key);const original=domainOf(source,j);if(p.rows.some(r=>keyParts(p,j,r[j]??'').some(v=>original.has(v))))failures.push({file:p.file,check:'key-leakage',detail:`original identity bytes remain in ${key}`});}
    if(correlationFiles.has(source.file))continue;
    type Reach={table:Table;rows:number[][]};const reached:Reach[]=[{table:p,rows:p.rows.map((_,i)=>[i])}],seen=new Set([p.file]);
    for(let at=0;at<reached.length;at++){
      const here=reached[at]!;
      for(const edge of edges.filter(e=>e.from===here.table.file)){
        if(seen.has(edge.to))continue;const target=practice.find(t=>t.file===edge.to);if(!target)continue;
        const domain=new Map<string,number[]>();target.rows.forEach((r,i)=>{const v=r[edge.b]??'';for(const value of keyParts(target,edge.b,v)){const indices=domain.get(value);if(indices)indices.push(i);else domain.set(value,[i]);}});
        const rows=here.rows.map(indices=>[...new Set(indices.flatMap(i=>keyParts(here.table,edge.a,here.table.rows[i]![edge.a]??'').flatMap(v=>domain.get(v)??[])))]);
        reached.push({table:target,rows});seen.add(target.file);
      }
    }
    const unit=d.randomization?.unit??[...d.units].filter(n=>p.header.includes(n)).sort((a,b)=>new Set(p.rows.map(r=>r[p.header.indexOf(a)])).size-new Set(p.rows.map(r=>r[p.header.indexOf(b)])).size)[0],uj=unit?p.header.indexOf(unit):-1;
    const blocks=new Map<string,number[]>();p.rows.forEach((r,i)=>{const k=uj>=0?r[uj]!:String(i);const indices=blocks.get(k);if(indices)indices.push(i);else blocks.set(k,[i]);});
    const design=(dd:StructureDeclaration|undefined,name:string)=>!!dd&&(dd.exposures?.includes(name)&&dd.randomization?.mode!=='summary'||dd.randomization?.columns?.includes(name)||dd.randomization?.strata?.includes(name)||dd.randomization?.visit===name);
    const fields=reached.filter(r=>!correlationFiles.has(r.table.file)).flatMap(r=>r.table.header.flatMap((name,j)=>[{population:keys.get(r.table.file)?.has(name)?new Set(r.table.rows.map(row=>row[j])).size:r.table.rows.length,key:keys.get(r.table.file)?.has(name)??false,id:JSON.stringify([r.table.file,name]),file:r.table.file,name,design:dictionary.fields.get(r.table.file)?.has(name)||design(declarations[r.table.file],name),features:features(r.table.rows.map(row=>row[j]??'')).map(f=>({id:f.id,values:r.rows.map(indices=>indices.length?indices.reduce((s,i)=>s+f.values[i]!,0)/indices.length:NaN)}))}]));
    const blockRows=[...blocks.values()];
    const singleton=blockRows.every(b=>b.length===1);
    const moments=new Map<number[],{mean:number;ss:number}>();
    const moment=(v:number[])=>{let m=moments.get(v);if(!m){const mean=v.every(n=>n===v[0])?v[0]!:v.reduce((s,n)=>s+n,0)/v.length;m={mean,ss:v.reduce((s,n)=>s+(n-mean)**2,0)};moments.set(v,m);}return m;};
    const featureCache=new Map<number[],{constant:boolean;aggregate:number[]}>();
    const cached=(v:number[])=>{let c=featureCache.get(v);if(!c){c={constant:singleton||blockRows.every(indices=>indices.every(i=>v[i]===v[indices[0]!])),aggregate:singleton?v:blockRows.map(indices=>{const present=indices.map(i=>v[i]!).filter(Number.isFinite);return present.length?present.reduce((s,x)=>s+x,0)/present.length:NaN;})};featureCache.set(v,c);}return c;};
    const allFeatures=fields.flatMap(f=>f.features.map(v=>v.values));
    const dense=allFeatures.length**2*p.rows.length>2_000_000?denseCorrelations(allFeatures):null;
    const rowVectors=new Set(allFeatures),unitVectors=singleton?[]:allFeatures.map(v=>cached(v).aggregate);
    const unitDense=unitVectors.length**2*blockRows.length>2_000_000?denseCorrelations(unitVectors):null;
    const pairCorrelation=(x:number[],y:number[]):{correlation:number;count:number}=>{
      if(dense&&rowVectors.has(x)&&rowVectors.has(y))return dense(x,y);
      if(unitDense&&!rowVectors.has(x)&&!rowVectors.has(y))return unitDense(x,y);
      let xx=x,yy=y;if(x.some((v,i)=>!Number.isFinite(v)||!Number.isFinite(y[i]))){const indices=x.flatMap((v,i)=>Number.isFinite(v)&&Number.isFinite(y[i])?[i]:[]);xx=indices.map(i=>x[i]!);yy=indices.map(i=>y[i]!);}
      if(!xx.length)return{correlation:0,count:0};const a=moment(xx),b=moment(yy);if(!a.ss||!b.ss)return{correlation:0,count:xx.length};let xy=0;for(let i=0;i<xx.length;i++)xy+=(xx[i]!-a.mean)*(yy[i]!-b.mean);return{correlation:xy/Math.sqrt(a.ss*b.ss),count:xx.length};
    };
    const effectiveRows=Math.min(p.rows.length,Math.max(blocks.size,p.rows.length/blockRows.reduce((n,v)=>Math.max(n,v.length),1)));
    const threshold=Math.max(6,Math.sqrt(2*Math.log(2*Math.max(1,fields.reduce((n,f)=>n+f.features.length,0)**2)/1e-6)));
    for(let a=0;a<fields.length;a++)for(let b=0;b<a;b++){
      const x=fields[a]!,y=fields[b]!;if(x.design&&y.design||x.key||y.key)continue;
      const gx=practice.find(t=>t.file===x.file),gy=practice.find(t=>t.file===y.file);
      if(gx&&gy&&gwasShape(gx)&&gwasShape(gy)&&((alleleFields.includes(x.name)&&alleleFields.includes(y.name))||(x.file===y.file&&frequencyFields.includes(x.name)&&frequencyFields.includes(y.name))))continue;
      // A universal order is public shape. Its induced correlation is expected,
      // but constant/copied gaps are not: the byte rebuild remains authoritative.
      if(x.file===y.file){
        const source=real.find(t=>t.file===x.file)!,generated=practice.find(t=>t.file===x.file)!;
        const a=source.header.indexOf(x.name),b=source.header.indexOf(y.name);
        const shape=orderShape(source,generated,a,b);
        if(shape==='copied')failures.push({file:x.file,check:'pairwise-leakage',detail:`${x.name}/${y.name} retained a constant gap`});
        if(shape!=='none')continue;
      }
      const shapes=d.randomization?.increasing??[];
      if(x.file===y.file){const bounds=declarations[x.file]?.randomization?.inequalities??[],connected=new Set([x.name]);for(let pass=0;pass<bounds.length;pass++)for(const c of bounds)if(connected.has(c.lower)||connected.has(c.upper)){connected.add(c.lower);connected.add(c.upper);}if(connected.has(y.name))continue;}
      if(x.file===y.file&&shapes.some(c=>[c.column,c.index??d.randomization?.visit].includes(x.name)&&[c.column,c.index??d.randomization?.visit].includes(y.name)))continue;
      for(const fx of x.features)for(const fy of y.features){
        const cx=cached(fx.values),cy=cached(fy.values),atUnit=cx.constant||cy.constant;
        const xx=atUnit?cx.aggregate:fx.values,yy=atUnit?cy.aggregate:fy.values;
        const statistic=pairCorrelation(xx,yy),corr=statistic.correlation,n=Math.min(x.population,y.population,statistic.count,atUnit?xx.length:effectiveRows);
        const id=JSON.stringify([p.file,x.id,fx.id,y.id,fy.id]);observe?.(id,corr,n);
        if(Math.abs(corr)*Math.sqrt(Math.max(0,n-1))>threshold || n>=12&&Math.abs(corr)>1-1e-12&&new Set(xx).size>=12&&new Set(yy).size>=12){const exact=binaryExactP(xx,yy);if(exact!==null&&exact>1e-6/Math.max(1,allFeatures.length**2))continue;failures.push({file:p.file,check:'pairwise-leakage',detail:`${x.file}:${x.name} is associated with ${y.file}:${y.name}`});break;}
      }
    }
  }
  // Matrix header keys join sample-level metadata. Audit the numeric column
  // summaries on that axis as well as every ordinary column pair above.
  for(const source of real.filter(t=>declarations[t.file]?.matrix&&!correlationFiles.has(t.file))){
    const p=practice.find(t=>t.file===source.file);if(!p)continue;
    const d=declarations[source.file]!,indices=source.header.flatMap((h,j)=>d.keys.includes(h)||d.formats?.[h]?[]:[j]);
    if(!indices.length)continue;
    const project=(t:Table):Table=>({...t,file:source.file+'::axis-audit',header:['axis','mean','variance'],rows:indices.map(j=>{
      const values=t.rows.map(r=>Number(r[j])).filter(Number.isFinite),mean=values.reduce((s,v)=>s+v,0)/(values.length||1),variance=values.reduce((s,v)=>s+(v-mean)**2,0)/(values.length||1);
      return[t.header[j]!,String(mean),String(variance)];
    })});
    const left=project(source),right=project(p),metadata=real.filter(t=>!declarations[t.file]?.matrix),copies=practice.filter(t=>metadata.some(r=>r.file===t.file));
    if(metadata.length)failures.push(...auditPracticeLeakage([left,...metadata],[right,...copies],{...declarations,[left.file]:{keys:['axis'],units:['axis'],keyNamespaces:{axis:d.matrixNamespace??''}}},observe));
  }
  return failures;
}

/** Across independently seeded draws, a practice contrast must not track the
 * real contrast. Used by host validation, not by worker code or its reports. */
export function auditRepeatedEffects(draws:readonly {real:number;practice:number}[]):boolean {
  if(draws.length<16||draws.some(d=>!Number.isFinite(d.real)||!Number.isFinite(d.practice)))return false;
  return Math.abs(correlation(draws.map(d=>d.real),draws.map(d=>d.practice)))<.5;
}

/** Host diagnostic over independently seeded draws: a persistent correlation that
 * is too weak to flag in one small sample must not survive averaging over draws.
 * This checks the full reachable field projection, not only the selected outcome.
 */
export function auditPracticeDraws(real:readonly Table[],draws:Iterable<readonly Table[]>,declarations:Readonly<Record<string,StructureDeclaration>>):PracticeViolation[] {
  let drawCount=0;
  const failures:PracticeViolation[]=[];
  const scores=new Map<string,{sum:number;count:number;units:number}>();
  for(const draw of draws){drawCount++;failures.push(...auditPracticeLeakage(real,draw,declarations,(id,corr,units)=>{
    const old=scores.get(id)??{sum:0,count:0,units};old.sum+=corr;old.count++;old.units=Math.min(old.units,units);scores.set(id,old);
  }));}
  if(drawCount<16)throw new Error('Host independence audit requires at least 16 draws');
  const threshold=Math.max(6,Math.sqrt(2*Math.log(2*Math.max(1,scores.size)/1e-6)));
  for(const [id,s] of scores)if(s.count>=16&&Math.abs(s.sum/s.count)*Math.sqrt(Math.max(0,s.units-1)*s.count)>threshold){
    const [file,left,,right]=JSON.parse(id) as string[];
    failures.push({file:file!,check:'repeated-exposure-leakage',detail:`persistent ${left} association with ${right} across ${s.count} draws`});
  }
  return failures;
}

/** Repeated host simulations use a bounded, hash-selected cohort of declared
 * identities. Every column remains; common namespaces select the same identities
 * across tables. The actual worker-visible draw is always audited in full first. */
export function repeatedAuditCohort(tables:readonly Table[],declarations:Readonly<Record<string,StructureDeclaration>>,limit=256):Table[]{
 validateDictionaryTargets(tables,declarations);
 const selection=new Map<string,Set<string>>(),primary=new Map<string,{j:number;namespace:string}>();
 for(const t of tables){
  const d=declarations[t.file]!;if(d.measurementDictionary){checkDictionaryRows(t,d.measurementDictionary,true);continue;}
  const names=d.randomization?.unit?[d.randomization.unit]:d.units.length?d.units:d.keys;
  const candidates=names.map(n=>({name:n,j:t.header.indexOf(n)})).filter(c=>c.j>=0).map(c=>({...c,count:new Set(t.rows.map(r=>r[c.j])).size})).sort((a,b)=>a.count-b.count);
  const key=candidates[0];if(!key)continue;
  const namespace=d.keyNamespaces?.[key.name]??'',domain=selection.get(namespace)??new Set<string>();
  for(const r of t.rows)domain.add(r[key.j]!);selection.set(namespace,domain);primary.set(t.file,{j:key.j,namespace});
 }
 for(const [ns,domain] of selection)if(domain.size>limit)selection.set(ns,new Set([...domain].map(v=>({v,rank:cohortHash(v)})).sort((a,b)=>a.rank.localeCompare(b.rank)).slice(0,limit).map(x=>x.v)));
 return tables.map(t=>{
  const key=primary.get(t.file),d=declarations[t.file]!;
  if(d.measurementDictionary)return t;
  let rows=key?t.rows.filter(r=>selection.get(key.namespace)!.has(r[key.j]!)):t.rows.length<=limit?t.rows:t.rows.map((r,i)=>({r,rank:cohortHash(String(i))})).sort((a,b)=>a.rank.localeCompare(b.rank)).slice(0,limit).map(x=>x.r);
  let header=t.header;
  // Preserve square matrix structure in the host-only projection.
  if(d.matrix&&key&&t.header.length===t.rows.length+1&&t.rows.every(r=>t.header.includes(r[key.j]!))){const ids=new Set(rows.map(r=>r[key.j]!)),indices=t.header.flatMap((h,j)=>j===key.j||ids.has(h)?[j]:[]);header=indices.map(j=>t.header[j]!);rows=rows.map(r=>indices.map(j=>r[j]!));}
  return {...t,header,rows};
 });
}
import {createHash} from 'node:crypto';
function cohortHash(value:string):string{return createHash('sha256').update('host-audit-cohort:'+value).digest('hex');}

/** Same statistic as the scalar oracle, vectorized for wide/full matrices. */
function denseCorrelations(vectors:number[][]):(a:number[],b:number[])=>{correlation:number;count:number}{
 const m=vectors.length,n=vectors[0]!.length,indices=new Map(vectors.map((v,i)=>[v,i]));
 const buffer=Buffer.allocUnsafe(m*n*8);let at=0;for(const v of vectors)for(const x of v){buffer.writeDoubleLE(x,at);at+=8;}
 const python=fileURLToPath(new URL('../../bio-baseline/.pixi/envs/default/bin/python',import.meta.url));
 const bridge=fileURLToPath(new URL('./practice-correlations.py',import.meta.url));
 const r=spawnSync(python,[bridge,String(m),String(n)],{input:buffer,maxBuffer:Math.max(1_000_000,m*m*16+1024),timeout:120_000,env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1',PYTHONDONTWRITEBYTECODE:'1'}});
 if(r.status!==0||r.stdout.length!==m*m*16)throw new Error(`Host pairwise audit failed: ${r.error??r.stderr.toString().slice(0,500)}`);
 return(a,b)=>{const offset=(indices.get(a)!*m+indices.get(b)!)*8;return{correlation:r.stdout.readDoubleLE(offset),count:r.stdout.readDoubleLE(m*m*8+offset)};};
}
