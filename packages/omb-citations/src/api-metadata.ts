/** Small metadata-only API path for bibliography and independent publication audit.
 * Does not call PW4's verifier, metadataMismatch or ScholarlyResolver. Transport is trusted
 * and injected; an author/LLM cannot submit a metadata object to this path. */
import { crossrefFlags } from './sources.ts';
import { HttpClient, Unavailable } from './http.ts';
import { firstText, nodes, parseXml, textOf } from './xml.ts';
import type { Metadata, Receipt } from './types.ts';
export type MetadataApi = 'crossref' | 'pubmed' | 'europe-pmc';
export interface ApiMetadata { readonly metadata: Metadata; readonly receipt: Receipt; readonly api: MetadataApi; readonly retracted:boolean; readonly flags:readonly string[]; readonly statusReceipts:readonly Receipt[] }
export function parseIdentifier(key: string): {kind:'doi'|'pmid';value:string} {
  if(typeof key!=='string') throw new Unavailable('only identifier keys are accepted; typed bibliographic entries are forbidden');
  if(/^doi:10\.\d{4,9}\/[^\s<>"{}]+$/i.test(key)) return {kind:'doi',value:key.slice(4).toLowerCase()};
  if(/^pmid:[1-9]\d*$/.test(key)) return {kind:'pmid',value:key.slice(5)};
  throw new Unavailable('unsupported or malformed identifier');
}
const obj=(x:unknown):Record<string,unknown>=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[];
const str=(x:unknown):string=>typeof x==='string'?x.trim():'';
const first=(x:unknown)=>str(arr(x)[0]);
const nullable=(x:unknown)=>str(x)||null;
function complete(m:Metadata,key:string):Metadata {
  const id=parseIdentifier(key);
  if((id.kind==='doi'?m.doi:m.pmid)!==id.value) throw new Unavailable('API returned a different identifier');
  if(!m.title || !m.journal || !m.authors.length || m.authors.some(a=>!a.trim()) || !Number.isInteger(m.year) || m.year<1500 || m.year>9999) throw new Unavailable('incomplete API metadata');
  return m;
}
async function retrievePrimaryMetadata(client:HttpClient,key:string,api?:MetadataApi,fresh=false):Promise<ApiMetadata> {
  const id=parseIdentifier(key), source=api??(id.kind==='doi'?'crossref':'pubmed');
  if(!['crossref','pubmed','europe-pmc'].includes(source)) throw new Unavailable('unsupported metadata API');
  if(source==='crossref'&&id.kind!=='doi' || source==='pubmed'&&id.kind!=='pmid') throw new Unavailable('identifier/API mismatch');
  const url=source==='crossref'?`https://api.crossref.org/works/${encodeURIComponent(id.value)}`:
    source==='pubmed'?`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${id.value}&retmode=xml`:
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(id.kind==='doi'?`DOI:"${id.value}"`:`EXT_ID:${id.value} AND SRC:MED`)}&format=json&resultType=core&pageSize=2`;
  const reply=await client.get(url,fresh);
  if(reply.status!==200) throw new Unavailable('metadata identifier unavailable');
  let m:Metadata; let cr:Record<string,unknown>={}; const signals:string[]=[]; const statusReceipts:Receipt[]=[];
  if(source==='pubmed') {
    const root=parseXml(reply.body), articles=nodes(root,'PubmedArticle');
    if(articles.length!==1) throw new Unavailable('ambiguous PubMed metadata');
    signals.push(...nodes(root,'PublicationType').map(textOf),...nodes(root,'CommentsCorrections').map(n=>n.attrs.RefType??''));
    const a=articles[0]!,journal=nodes(a,'Journal')[0],date=journal&&nodes(journal,'PubDate')[0];
    const doiNode=nodes(a,'ArticleId').find(n=>n.attrs.IdType==='doi');
    const dateText=date?textOf(date):'';
    const years=dateText.match(/\b(?:1[5-9]|[2-9]\d)\d{2}\b/g)??[];
    if(new Set(years).size!==1) throw new Unavailable('missing/ambiguous PubMed year');
    m={doi:doiNode?textOf(doiNode).toLowerCase():null,pmid:firstText(a,'PMID'),title:firstText(a,'ArticleTitle'),
      authors:nodes(a,'Author').map(n=>firstText(n,'LastName')||firstText(n,'CollectiveName')),year:Number(years[0]),
      journal:journal?firstText(journal,'Title'):'',journalAbbrev:nullable(firstText(a,'ISOAbbreviation')),volume:nullable(firstText(a,'Volume')),pages:nullable(firstText(a,'MedlinePgn'))};
  } else {
    let raw:unknown;try{raw=JSON.parse(reply.body);}catch{throw new Unavailable('malformed API JSON');}
    const body=obj(raw);
    if(source==='crossref') {
      if(body.status!=='ok') throw new Unavailable('Crossref status unavailable');
      const x=obj(body.message); cr=x;
      const dates=['published','published-print','published-online','issued'].map(k=>arr(arr(obj(x[k])['date-parts'])[0])[0]);
      const year=dates.find(y=>typeof y==='number'&&Number.isInteger(y)&&y>=1500);
      m={doi:str(x.DOI).toLowerCase(),pmid:null,title:first(x.title),authors:arr(x.author).map(a=>str(obj(a).family)||str(obj(a).name)),
        year:typeof year==='number'?year:0,journal:first(x['container-title']),journalAbbrev:nullable(first(x['short-container-title'])),volume:nullable(x.volume),pages:nullable(x.page??x['article-number'])};
    } else {
      const hits=arr(obj(body.resultList).result);
      if(body.hitCount!==1 || hits.length!==1) throw new Unavailable('missing/ambiguous Europe PMC metadata');
      const x=obj(hits[0]); signals.push(...arr(obj(x.pubTypeList).pubType).map(str)); const ji=obj(x.journalInfo),journal=obj(ji.journal);
      m={doi:nullable(str(x.doi).toLowerCase()),pmid:nullable(x.pmid??(x.source==='MED'?x.id:null)),title:str(x.title),
        authors:arr(obj(x.authorList).author).map(a=>str(obj(a).lastName)||str(obj(a).collectiveName)),year:Number(x.pubYear),journal:str(journal.title),
        journalAbbrev:nullable(journal.medlineAbbreviation),volume:nullable(ji.volume),pages:nullable(x.pageInfo)};
    }
  }
  complete(m,key);
  let notices:Record<string,unknown>[]=[];
  if(m.doi) {
    const reply=await client.get(`https://api.crossref.org/works?filter=${encodeURIComponent('updates:'+m.doi)}&rows=100`,fresh);
    if(reply.status!==200) throw new Unavailable('Crossref status check unavailable');
    let raw:unknown; try {raw=JSON.parse(reply.body);} catch {throw new Unavailable('malformed Crossref updates');}
    const body=obj(raw),message=obj(body.message);
    if(body.status!=='ok') throw new Unavailable('incomplete Crossref updates: status');
    if(!Array.isArray(message.items)) throw new Unavailable('incomplete Crossref updates: items');
    if(!Number.isInteger(message['total-results'])) throw new Unavailable('incomplete Crossref updates: integer');
    if(Number(message['total-results'])<0) throw new Unavailable('incomplete Crossref updates: negative');
    if(Number(message['total-results'])!==message.items.length) throw new Unavailable('incomplete Crossref updates: count');
    if(message.items.length>100) throw new Unavailable('incomplete Crossref updates: limit');
    notices=message.items.map(obj);statusReceipts.push(reply.receipt);
  }
  const status=crossrefFlags(cr,notices,m.doi??'');
  const signal=signals.join(' ');
  const retracted=status.retracted||/retract|withdraw|remov/i.test(signal);
  const flags=[...new Set([...status.flags,...(/concern/i.test(signal)?['expression-of-concern']:[])])].sort();
  return {metadata:m,receipt:reply.receipt,api:source,retracted,flags,statusReceipts};
}

/** Publication status is independent of the author's printed identifiers and chosen
 * metadata provider. Explicit empty search results are recorded; unavailable,
 * ambiguous or mismatched secondary responses are not a clean status check. */
export async function retrieveApiMetadata(client:HttpClient,key:string,api?:MetadataApi,fresh=false):Promise<ApiMetadata> {
  const primary=await retrievePrimaryMetadata(client,key,api,fresh);
  const m=primary.metadata, results=[primary], receipts:Receipt[]=[];
  let pmid=m.pmid, doi=m.doi, epSignals:string[]=[];
  if(primary.api!=='europe-pmc') {
    const query=doi?`DOI:"${doi}"`:`EXT_ID:${pmid} AND SRC:MED`;
    const reply=await client.get(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=2`,fresh);
    if(reply.status!==200) throw new Unavailable('Europe PMC status unavailable');
    let body:Record<string,unknown>;try{body=obj(JSON.parse(reply.body));}catch{throw new Unavailable('malformed Europe PMC status');}
    const list=obj(body.resultList).result;
    if(!Array.isArray(list)||!Number.isInteger(body.hitCount)||Number(body.hitCount)<0||Number(body.hitCount)>1||body.hitCount!==list.length) throw new Unavailable('ambiguous Europe PMC status');
    receipts.push(reply.receipt);
    if(list.length) {
      const x=obj(list[0]), foundDoi=nullable(str(x.doi).toLowerCase()), foundPmid=nullable(x.pmid??(x.source==='MED'?x.id:null));
      if((doi&&foundDoi!==doi)||(pmid&&foundPmid!==pmid)) throw new Unavailable('Europe PMC status identifier mismatch');
      doi=doi??foundDoi;pmid=pmid??foundPmid;
      epSignals=arr(obj(x.pubTypeList).pubType).map(str);
    }
  }
  if(!pmid&&doi) {
    const reply=await client.get(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(doi+'[AID]')}&retmode=json&retmax=2`,fresh);
    if(reply.status!==200) throw new Unavailable('PubMed status search unavailable');
    let body:Record<string,unknown>;try{body=obj(obj(JSON.parse(reply.body)).esearchresult);}catch{throw new Unavailable('malformed PubMed status search');}
    const ids=body.idlist;
    if(!Array.isArray(ids)||!['0','1'].includes(str(body.count))||Number(body.count)!==ids.length) throw new Unavailable('ambiguous PubMed status search');
    receipts.push(reply.receipt);
    if(ids.length) pmid=str(ids[0]);
  }
  if(primary.api!=='pubmed'&&pmid) {
    const pm=await retrievePrimaryMetadata(client,'pmid:'+pmid,'pubmed',fresh);
    if(doi&&pm.metadata.doi!==doi) throw new Unavailable('PubMed status DOI mismatch');
    doi=doi??pm.metadata.doi;results.push(pm);
  }
  if(primary.api!=='crossref'&&doi) results.push(await retrievePrimaryMetadata(client,'doi:'+doi,'crossref',fresh));
  const signal=epSignals.join(' ');
  return {...primary,retracted:results.some(r=>r.retracted)||/retract|withdraw|remov/i.test(signal),
    flags:[...new Set([...results.flatMap(r=>r.flags),...(/concern/i.test(signal)?['expression-of-concern']:[])])].sort(),
    statusReceipts:[...primary.statusReceipts,...receipts,...results.slice(1).flatMap(r=>[r.receipt,...r.statusReceipts])]};
}
