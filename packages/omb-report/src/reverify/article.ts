import {buildRegistry,type EntityRegistry} from '../entities.ts';
import {canonicalSha256} from '../../../bio-core/src/index.ts';
import {CHECKLIST_NAMES} from '../checklists.ts';
/** Host-only article metadata, derived from authenticated owner/matter records. */
import {assertMatter,deriveMatterInput,type MatterDocument} from '../matter.ts';
import type {ReportContext} from '../context.ts';
import {record,requireThat} from '../common.ts';
export interface ArticleEdition {version:string;date:string;licence?:'CC-BY 4.0'}
export interface ArticleField {key:string;text:string}
const decode=(s:string)=>s.replace(/&#(\d+);/gu,(_,n)=>String.fromCodePoint(Number(n))).replaceAll('&amp;','&');
export function editionFields(edition:ArticleEdition):ArticleField[]{
 requireThat(/^[1-9]\d*(?:\.\d+){0,2}$/u.test(edition.version),'invalid article version');
 requireThat(/^\d{4}-\d{2}-\d{2}$/u.test(edition.date)&&Number.isFinite(Date.parse(edition.date))&&new Date(edition.date).toISOString().slice(0,10)===edition.date,'invalid article date');
 requireThat(edition.licence===undefined||edition.licence==='CC-BY 4.0','unapproved article licence');
 return [{key:'article:edition',text:`Version ${edition.version}; ${edition.date}`},{key:'article:licence',text:'Licence: CC-BY 4.0 (Creative Commons Attribution).'}];
}
export function articleFields(ctx:ReportContext,doc:MatterDocument,edition:ArticleEdition):ArticleField[]{
 assertMatter(ctx,doc);
 const source=deriveMatterInput(ctx),matter=(heading:string)=>decode(doc.regions.find(r=>r.heading===heading)?.text??'Owner statement pending.');
 return [...editionFields(edition),
  {key:'article:data',text:'Data availability: '+source.data.map(d=>`${d.source} (${d.accession})`).join('; ')+'. Access records and checksums appear in Declarations.'},
  {key:'article:code',text:`Code availability: ${source.code.rerunCommand}. Bundle details and the open verifier appear in Declarations.`},
  {key:'article:funding',text:'Funding: '+matter('Funding').replace(/[.]$/u,'')+'.'},
  {key:'article:interests',text:'Competing interests: '+matter('Competing interests').replace(/[.]$/u,'')+'.'},
  {key:'article:verification',text:'Amani generation and verification: prose is assembled from the recorded drafts; numbers and released artifacts are checked against certified records. These checks do not establish scientific validity or substitute for the pending independent and human reviews.'},
 ];
}
export function authorFields(ctx:ReportContext,doc:MatterDocument):ArticleField[][]{
 assertMatter(ctx,doc);const {authors}=deriveMatterInput(ctx),owner=record(ctx.input.ownerConfiguration);
 const affiliations=[...new Set(authors.map(a=>a.affiliation??'Independent researcher'))];
 const people:ArticleField[]=authors.flatMap((a,i)=>[{key:`author:${a.actor}:name`,text:(i?', ':'')+a.name},{key:`author:${a.actor}:marker`,text:String(affiliations.indexOf(a.affiliation??'Independent researcher')+1)+((a.corresponding??a.actor===owner.ownerActor)?'*':'')}]);
 const rows:ArticleField[][]=[people,...affiliations.map((text,i)=>[{key:`author:affiliation:${i+1}:marker`,text:String(i+1)},{key:`author:affiliation:${i+1}:text`,text:` ${text}`}])];
 for(const a of authors){const contact=doc.contactSlots.find(c=>c.actor===a.actor)!;
  if(a.corresponding??a.actor===owner.ownerActor)rows.push([{key:`author:${a.actor}:correspondence`,text:`* Correspondence: ${a.name}; ${a.contactApproved&&contact.email?contact.email:'email withheld pending owner approval'}.`}]);
  if(contact.orcid)rows.push([{key:`author:${a.actor}:orcid`,text:a.contactApproved?`${a.name} — ORCID: ${contact.orcid}`:`${a.name} — ORCID withheld pending owner approval.`}]);
 }
 return rows;
}

/** Exact publication identifiers are names, not permissions for arbitrary acronyms. */
export function publicationRegistry(registry:EntityRegistry):EntityRegistry {
 const entries=['CC-BY 4.0','ORCID',...CHECKLIST_NAMES].map(label=>({id:'article-name-'+label.toLowerCase().replaceAll(' ','-'),label}));
 const existing=new Set(registry.entries.map(e=>e.entry.label));const added=entries.filter(e=>!existing.has(e.label));
 return added.length?buildRegistry([...registry.packs,{source:'platform',version:'article-identifiers@1',entries:added,sha256:canonicalSha256(added)}]):registry;
}
