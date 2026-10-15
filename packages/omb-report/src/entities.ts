import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { normalise } from './normalise.ts';
import { requireThat } from './common.ts';
export type RegistrySource='HGNC'|'miRBase'|'UniProt'|'Cellosaurus'|'MONDO'|'EFO'|'panel'|'platform';
export interface RegistryEntry {id:string;label:string;aliases?:readonly string[];previousSymbols?:readonly string[]}
export interface RegistryPack {source:RegistrySource;version:string;sha256:string;entries:readonly RegistryEntry[]}
export interface EntityMatch {start:number;end:number;id:string;label:string;source:RegistrySource;version:string}
export interface EntityRegistry {readonly packs:readonly RegistryPack[];readonly entries:readonly {name:string;entry:RegistryEntry;pack:RegistryPack}[]}
const registries=new WeakSet<EntityRegistry>();
function freeze<T>(value:T,seen=new WeakSet<object>()):T{if(value&&typeof value==='object'&&!seen.has(value)){seen.add(value);Object.values(value).forEach(v=>freeze(v,seen));Object.freeze(value);}return value;}
export function buildRegistry(packs:readonly RegistryPack[]):EntityRegistry{
 const entries:{name:string;entry:RegistryEntry;pack:RegistryPack}[]=[];const seen=new Map<string,string>();
 for(const original of packs){const pack=structuredClone(original);requireThat(['HGNC','miRBase','UniProt','Cellosaurus','MONDO','EFO','panel','platform'].includes(pack.source)&&normalise(pack.version)===pack.version&&/^[\p{L}\p{N}][\p{L}\p{N} ._@+-]*$/u.test(pack.version)&&canonicalSha256(pack.entries)===pack.sha256,'invalid registry version/hash');
 for(const entry of pack.entries)for(const name of [entry.label,...entry.aliases??[],...entry.previousSymbols??[]]){
  const clean=normalise(name).trim();
  // Accessions, genome builds and rsIDs must use explicit [d:]/[e:] records.
  if(!/\p{L}/u.test(clean)||/^(?:rs\d+|GRCh\d+|hg\d+|GSE\d+|GSM\d+|SR[ARPX]\d+|ENSG\d+|[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?%?)$/iu.test(clean))continue;
  const key=clean.toLowerCase();requireThat(!seen.has(key)||seen.get(key)===entry.id,'ambiguous registry alias');seen.set(key,entry.id);entries.push({name:clean,entry,pack});
 }}
 entries.sort((a,b)=>b.name.length-a.name.length||a.name.localeCompare(b.name,'en'));
 const registry=freeze({packs:structuredClone(packs),entries});registries.add(registry);return registry;
}
export function tagEntities(text:string,registry:EntityRegistry):EntityMatch[]{
 requireThat(registries.has(registry),'registry must be built from pinned packs');
 const hits:EntityMatch[]=[];const lower=text.toLowerCase();
 for(let i=0;i<text.length;){const row=registry.entries.find(r=>lower.startsWith(r.name.toLowerCase(),i)&&!/[\p{L}\p{N}_-]/u.test(text[i-1]??'')&&!/[\p{L}\p{N}_-]/u.test(text[i+r.name.length]??''));
 if(row){hits.push({start:i,end:i+row.name.length,id:row.entry.id,label:normalise(row.entry.label),source:row.pack.source,version:row.pack.version});i+=row.name.length;}else i++;}
 return hits;
}
