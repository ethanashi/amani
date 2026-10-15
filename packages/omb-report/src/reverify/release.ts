import {assertDecisionConsistency} from '../decision-consistency.ts';
/** Primary release boundary. Only this capability may authorize artifacts for packaging.
 * Construct it in the trusted host, never in drafter/owner context. A render callback is a
 * privileged port: it must execute the pinned renderer with the supplied resource closure.
 * There is deliberately no API to sign/import a caller-supplied artifact record.
 */
import { createHash, sign, type KeyObject } from 'node:crypto';
import {releaseKeyId,releaseSigningBytes,tarInventory,type PersistedRelease} from './persisted.ts';
import {verifyTex,type TexProfile} from './tex.ts';
import { canonicalJson } from '../../../bio-core/src/index.ts';
import { requireThat } from '../common.ts';
import { verifyFirstDraft, reverifyEdit } from './edit.ts';
import { renderSignedHtml, verifySignedHtml } from './html.ts';
import { verifyPdf, type PdfProfile } from './outputs.ts';
import { verifyDocx, type DocxProfile } from './docx.ts';
import { SpanSigner } from './sign.ts';
import { figureReadbackManuscript, type Manuscript, type ManuscriptPlan } from './manuscript.ts';
import type { EditMode } from './skeleton.ts';

export type ReleaseFormat = 'html' | 'pdf' | 'docx' | 'svg' | 'css' | 'resource' | 'tex';
export interface ReleaseProfile {
 readonly tex?: TexProfile;
 readonly pdfArtifacts?: Readonly<Record<string,Omit<PdfProfile,'extractor'>>>;
 readonly figurePdf?: Readonly<Record<string,Omit<PdfProfile,'extractor'>>>;
 /** Explicit trusted renderer output paths; every byte remains hash-bound. */
 readonly additionalArtifacts?: readonly string[];
 readonly rendererVersions: Readonly<Record<string,string>>;
 readonly sourceDateEpoch: string;
 readonly resources: Readonly<Record<string,string>>;
 readonly stylesheet?: string;
 readonly cssSha256?: Readonly<Record<string,string>>;
 readonly pdf: Omit<PdfProfile, 'extractor'>;
 readonly docx: DocxProfile;
 /** HTML, SVG, CSS and DOCX are always byte deterministic. Opt in others only after proving it. */
 readonly byteDeterministic?: readonly ReleaseFormat[];
}
export interface RenderRequest {
 readonly manuscript: Manuscript;
 readonly html: string;
 readonly assets: ReadonlyMap<string, Uint8Array>;
 readonly profile: ReleaseProfile;
 readonly profileSha256: string;
}
export interface RenderResult {
 readonly artifacts: ReadonlyMap<string, Uint8Array>;
 readonly profileSha256: string;
}
export interface ReleaseRecord {
 readonly schema: 'omb/pw8/release@1';
 readonly paperInputHash: string;
 readonly archives: Readonly<Record<string,Readonly<Record<string,string>>>>;
 readonly buildId: string;
 readonly sourceSha256: string;
 readonly profileSha256: string;
 readonly artifacts: Readonly<Record<string, {readonly sha256: string; readonly format: ReleaseFormat; readonly binding: 'byte-deterministic' | 'render-time-hash'}>>;
}
export interface ReleaseBuild { readonly record: ReleaseRecord; readonly signature: string }
export interface ReleaseResult {
 readonly ok: boolean;
 readonly issues: readonly string[];
 /** Only private copies of trusted-renderer outputs; never bytes supplied for verification. */
 readonly artifacts?: ReadonlyMap<string, Uint8Array>;
 readonly record?: ReleaseRecord;
}
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const copy = (files: ReadonlyMap<string, Uint8Array>) => new Map([...files].map(([p,b]) => [p,Uint8Array.from(b)]));
const format = (name: string): ReleaseFormat => {
 const ext = name.split('.').at(-1)!;
 return ['html','pdf','docx','svg','css','tex'].includes(ext) ? ext as ReleaseFormat : 'resource';
};

export function createReleaseVerifier(config: {
 readonly masterKey: Uint8Array;
 readonly profile: ReleaseProfile;
 readonly resources: ReadonlyMap<string, Uint8Array>;
 readonly render: (request: RenderRequest) => Promise<RenderResult>;
}) {
 const profile: ReleaseProfile = structuredClone(config.profile);
 const key = Uint8Array.from(config.masterKey), resources = copy(config.resources), render = config.render;
 requireThat(key.length >= 32, 'release: renderer signing key is required');
 requireThat(Object.keys(profile.rendererVersions).length > 0 && Object.values(profile.rendererVersions).every(v => v.length > 0), 'release: renderer versions must be pinned');
 requireThat(/^\d+$/u.test(profile.sourceDateEpoch), 'release: SOURCE_DATE_EPOCH must be pinned');
 requireThat(!('extractor' in profile.pdf) && !!profile.pdf.fontSha256 && !!profile.pdf.layout, 'release: pinned PDF fonts and layout required; extractor overrides forbidden');
 requireThat(!!profile.docx.styleParts && !!profile.docx.styleReferences, 'release: pinned DOCX style profile required');
 requireThat(Object.keys(profile.resources).length === resources.size && [...resources].every(([p,b]) => profile.resources[p] === hash(b)), 'release: renderer resource closure differs from profile');
 for(const fp of [...Object.values(profile.figurePdf??{}),...Object.values(profile.pdfArtifacts??{})])requireThat(!('extractor' in fp)&&!!fp.fontSha256&&!!fp.layout,'release: pinned figure fonts and layout required; extractor overrides forbidden');
 const profileSha256 = hash(canonicalJson(profile));
 const builds = new WeakMap<ReleaseBuild, {m: Manuscript; html: string; files: Map<string,Uint8Array>; record: ReleaseRecord; signature: string}>();
 const produce = async (m: Manuscript, html: string): Promise<Map<string,Uint8Array>> => {
  const assets = copy(resources);
  for (const section of m.sections) for (const block of section.blocks) if (block.kind === 'figure') {
   requireThat(!assets.has(block.src), 'release: renderer resource shadows a regenerated figure');
   assets.set(block.src,Buffer.from(block.svg));
  }
  const signer = new SpanSigner(key,m.buildId);
  const htmlCheck = verifySignedHtml(html,m,signer,{assets,...profile.stylesheet ? {stylesheet:profile.stylesheet} : {},...profile.cssSha256 ? {cssSha256:profile.cssSha256} : {}});
  requireThat(htmlCheck.ok && htmlCheck.prose.length === 0, 'release: canonical HTML or CSS closure failed verification');
  const result = await render({manuscript:structuredClone(m),html,assets:copy(assets),profile:structuredClone(profile),profileSha256});
  requireThat(result.profileSha256 === profileSha256, 'release: renderer profile attestation differs');
  const files = copy(result.artifacts);
  for (const [path,bytes] of new Map([['paper.html',Buffer.from(html)], ...assets])) {
   requireThat(!files.has(path) || hash(files.get(path)!) === hash(bytes), `release: renderer changed canonical asset ${path}`);
   files.set(path,Uint8Array.from(bytes));
  }
  for (const path of files.keys()) requireThat(/^[A-Za-z0-9_.\/-]+$/u.test(path) && !path.startsWith('/') && !path.split('/').includes('..'), 'release: invalid artifact path');
  requireThat(files.has('paper.pdf') && files.has('paper.docx'), 'release: PDF and DOCX are mandatory');
  // All additional text-bearing formats must have an explicit byte identity contract.
  for (const path of result.artifacts.keys()) requireThat(['paper.pdf','paper.docx','paper.html'].includes(path) || assets.has(path) || (format(path) === 'tex' && !!profile.tex && profile.byteDeterministic?.includes('tex')) || profile.additionalArtifacts?.includes(path), `release: undeclared renderer output ${path}`);
  for(const path of result.artifacts.keys()) {
   if(path==='paper.pdf'||path==='paper.docx'||path==='paper.html'||assets.has(path))continue;
   if(format(path)==='tex'){requireThat(path==='paper.tex','release: undeclared TeX manuscript');}
   if(format(path)==='html'||format(path)==='docx')requireThat(false,'release: extra text-bearing format needs a verified manuscript profile');
   if(format(path)==='pdf'&&profile.pdfArtifacts?.[path]){const check=verifyPdf(files.get(path)!,m,profile.pdfArtifacts[path]!);requireThat(check.ok,'release: additional PDF read-back failed: '+check.issues.map(i=>i.detail).join('; '));continue;}
   if(format(path)==='pdf') {
    const figure=m.sections.flatMap(s=>s.blocks).find(b=>b.kind==='figure'&&b.src.replace(/\.svg$/u,'.pdf')===path);
    requireThat(figure?.kind==='figure'&&profile.figurePdf?.[path],'release: extra PDF needs a verified figure profile');
    const fm=figureReadbackManuscript(m,figure);
    const check=verifyPdf(files.get(path)!,fm,profile.figurePdf[path]!);
    requireThat(check.ok,'release: figure PDF read-back failed: '+check.issues.map(i=>i.detail).join('; '));
   }
  }
  if(files.has('release-profile.json'))requireThat(hash(files.get('release-profile.json')!)===profileSha256,'release: published profile differs');
  if(files.has('paper.tex')) {requireThat(profile.tex,'release: TeX profile required');verifyTex(Buffer.from(files.get('paper.tex')!).toString('utf8'),m,profile.tex);}
  const pdf = verifyPdf(files.get('paper.pdf')!,m,profile.pdf), docx = verifyDocx(files.get('paper.docx')!,m,profile.docx);
  requireThat(pdf.ok, `release: PDF read-back failed: ${pdf.issues.map(i => i.detail).join('; ')}`);
  requireThat(docx.ok, `release: DOCX read-back failed: ${docx.issues.map(i => i.detail).join('; ')}`);
  for(const [name,bytes] of files)if(name.endsWith('.tar.gz'))for(const [member,digest] of Object.entries(tarInventory(bytes)))requireThat(files.has(member)&&hash(files.get(member)!)===digest,`release: archive contains unbound member: ${member}`);
  return files;
 };
 const capability = {
  async build(plan: ManuscriptPlan, revision?: {baseline: Manuscript; mode: EditMode}): Promise<ReleaseBuild> {
   assertDecisionConsistency(plan.ctx);
   const checked = revision ? reverifyEdit(revision.baseline,plan,revision.mode) : verifyFirstDraft(plan);
   requireThat(checked.ok && checked.manuscript, `release: source verification failed: ${checked.refusal ?? 'skeleton or must-appear violation'}`);
   const m = structuredClone(checked.manuscript);
   const signer = new SpanSigner(key,m.buildId);
   const html = renderSignedHtml(m,signer,profile.stylesheet ? {stylesheet:profile.stylesheet} : {});
   const files = await produce(m,html);
   const record: ReleaseRecord = {schema:'omb/pw8/release@1',paperInputHash:m.paperInputHash,archives:Object.fromEntries([...files].filter(([p])=>p.endsWith('.tar.gz')).map(([p,b])=>[p,tarInventory(b)])),buildId:m.buildId,sourceSha256:hash(html),profileSha256,
    artifacts:Object.fromEntries([...files].map(([path,bytes]) => {const kind=format(path); return [path,{sha256:hash(bytes),format:kind,binding:['html','svg','css','resource','docx',...profile.byteDeterministic ?? []].includes(kind) ? 'byte-deterministic' : 'render-time-hash'}];}))};
   const signature = signer.sign({d:'omb/pw8/release@1',record});
   const handle = Object.freeze({record:structuredClone(record),signature});
   builds.set(handle,{m,html,files,record,signature});
   return handle;
  },
  async persist(build:ReleaseBuild,privateKey:KeyObject):Promise<PersistedRelease> {
   requireThat(privateKey.type==='private'&&privateKey.asymmetricKeyType==='ed25519','release: Ed25519 private key required');
   const result=await capability.verifyRelease(build);requireThat(result.ok&&result.record,'release: cannot persist an unverified build: '+result.issues.join('; '));
   const keyId=releaseKeyId(privateKey),record=result.record;
   return {schema:'omb/release-certificate@1',algorithm:'Ed25519',keyId,record,signature:sign(null,releaseSigningBytes(record,keyId),privateKey).toString('base64')};
  },
  async verifyRelease(build: ReleaseBuild, supplied?: ReadonlyMap<string,Uint8Array>): Promise<ReleaseResult> {
   try {
    const trusted = builds.get(build);
    requireThat(trusted, 'release: record was not issued by this trusted renderer');
    requireThat(canonicalJson(build.record) === canonicalJson(trusted.record) && build.signature === trusted.signature, 'release: build record changed');
    requireThat(trusted.record.profileSha256 === profileSha256, 'release: profile hash differs');
    if (supplied) {
     requireThat(supplied.size === trusted.files.size, 'release: supplied artifact inventory differs');
     for (const [path,bytes] of supplied) requireThat(trusted.record.artifacts[path]?.sha256 === hash(bytes), `release: artifact hash differs: ${path}`);
    }
    const regenerated = await produce(trusted.m,trusted.html);
    requireThat(regenerated.size === trusted.files.size && [...regenerated.keys()].every(p => trusted.files.has(p)), 'release: regenerated artifact inventory differs');
    for (const [path,entry] of Object.entries(trusted.record.artifacts)) {
     requireThat(hash(trusted.files.get(path)!) === entry.sha256, `release: stored artifact hash differs: ${path}`);
     if (entry.binding === 'byte-deterministic') requireThat(Buffer.from(regenerated.get(path)!).equals(Buffer.from(trusted.files.get(path)!)), `release: byte-deterministic regeneration differs: ${path}`);
    }
    return {ok:true,issues:[],artifacts:copy(trusted.files),record:structuredClone(trusted.record)};
   } catch (error) {return {ok:false,issues:[error instanceof Error ? error.message : 'release verification failed']};}
  },
 };
 return capability;
}
