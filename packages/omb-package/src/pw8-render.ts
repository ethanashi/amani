import {runningFooterText} from '../../omb-report/src/reverify/tex.ts';
import {JOURNAL_FONT_TEX,journalFontAssets} from './journal-fonts.ts';
import {assertDecisionConsistency} from '../../omb-report/src/decision-consistency.ts';
/** Trusted PW8 -> PW9 rendering port. No candidate PDF or Markdown is accepted.
 * Preparation and release use the same pinned binaries and verified fragments.
 */
import path from 'node:path';
import {mkdirSync,readFileSync,writeFileSync,rmSync,mkdtempSync} from 'node:fs';
import {randomBytes,type KeyObject} from 'node:crypto';
import {figureReadbackManuscript,createReleaseVerifier,verifyFirstDraft,renderSignedHtml,SpanSigner,renderVerifiedTex,verifyTex,extractPdf,extractDocx,trustedPdfLayout,verifyPdf,verifyDocx,releaseHash,type ManuscriptPlan,type Manuscript,type ReleaseProfile,type TexProfile,type RenderRequest,type PdfFurniture} from '../../omb-report/src/reverify/index.ts';
import {toolchain,command,ROOT,type Toolchain} from './toolchain.ts';
import {checkTexSource} from './latex.ts';
import {checkLatexPdf} from './latex-checks.ts';
import type {OutputProfile} from './output-profiles.ts';
import {assert,canonicalJson,canonicalSha256} from './common.ts';
import {renderVerifiedReview} from './pw8-review.ts';
import {Chromium} from './chromium.ts';
export function verifiedTexProfile(columns:1|2=1):TexProfile{return {schema:'omb/pw8/tex-profile@1',columns,figureWidthMm:178,preamble:String.raw`\documentclass[10pt,a4paper]{article}
\usepackage[a4paper,textwidth=160mm,centering,top=20mm,bottom=22mm,footskip=12mm]{geometry}
\usepackage{fontspec,graphicx,tabularx,placeins,flafter}
\usepackage[protrusion=true,expansion=false]{microtype}
${JOURNAL_FONT_TEX}
\renewcommand{\normalsize}{\fontsize{11}{14}\selectfont}
\AtBeginDocument{\normalsize}
\DeclareMathSizes{11}{10}{7}{5}
\newcommand{\ombval}[2]{#2}
\newcommand{\ombsup}[1]{\raisebox{.6ex}{\fontsize{8.5}{10}\selectfont #1}}
\makeatletter
\renewcommand{\section}{\@startsection{section}{1}{0pt}{-2.5ex plus -1ex minus -.2ex}{1ex plus .2ex}{\sffamily\bfseries\fontsize{13}{16}\selectfont}}
\renewcommand{\subsection}{\@startsection{subsection}{2}{0pt}{-1.8ex plus -.5ex minus -.2ex}{.7ex plus .2ex}{\sffamily\bfseries\fontsize{11.5}{14}\selectfont}}
\providecommand{\ombtotalpages}{?}
\newcommand{\ombfooterprefix}{}
\def\@oddfoot{\hbox to\textwidth{\fontsize{8.5}{10}\selectfont\sffamily\ombfooterprefix\hfill\thepage\ /\ \ombtotalpages}}
\let\@evenfoot\@oddfoot
\def\@oddhead{}\def\@evenhead{}
\AtEndDocument{\clearpage\addtocounter{page}{-1}\immediate\write\@auxout{\string\gdef\string\ombtotalpages{\thepage}}}
\makeatother
\hyphenpenalty=50
\tolerance=1000
\pretolerance=100
\language=\csname l@english\endcsname
\lefthyphenmin=2
\righthyphenmin=3
\exhyphenpenalty=50
\setlength{\columnsep}{8mm}
\setlength{\parindent}{1em}
\setlength{\parskip}{0pt}
\setlength{\emergencystretch}{1em}
\clubpenalty=10000
\widowpenalty=10000
\renewcommand{\topfraction}{0.85}
\renewcommand{\bottomfraction}{0.8}
\renewcommand{\dbltopfraction}{0.85}
\renewcommand{\textfraction}{0.10}
\renewcommand{\floatpagefraction}{0.70}
\renewcommand{\dblfloatpagefraction}{0.70}
\setcounter{topnumber}{2}
\setcounter{dbltopnumber}{2}
\setcounter{totalnumber}{3}
\setlength{\textfloatsep}{10pt plus 2pt minus 2pt}
\setlength{\dbltextfloatsep}{10pt plus 2pt minus 2pt}
\newcommand{\ombtitle}[1]{{\raggedright\noindent\fontsize{18}{21}\selectfont\bfseries #1\par}\medskip}
\newcommand{\ombcaptionfont}{\fontsize{9}{11}\selectfont}
\newcommand{\ombabstract}[1]{\noindent #1\par\smallskip}
\newcommand{\ombnotice}[1]{{\noindent\small\itshape #1\par}\smallskip}
\newenvironment{ombbox}{\par\medskip\noindent\setlength{\fboxsep}{3mm}\setlength{\fboxrule}{0.5pt}\begin{lrbox}{\ombboxsave}\begin{minipage}{\dimexpr\linewidth-6mm-1pt\relax}\setlength{\parindent}{0pt}\setlength{\parskip}{3pt}\small}{\end{minipage}\end{lrbox}\fbox{\usebox{\ombboxsave}}\par\medskip}
\newsavebox{\ombboxsave}
\newcommand{\ombboxtitle}[1]{\textbf{#1}\par}
\newenvironment{ombglossary}{\begin{description}\setlength{\itemsep}{3pt}\setlength{\parsep}{0pt}}{\end{description}}
\newcommand{\ombterm}[1]{\item[]\hspace*{-\leftmargin}#1}
\newcolumntype{L}{>{\raggedright\arraybackslash\hyphenpenalty=10000\exhyphenpenalty=10000}X}
\newcolumntype{F}{>{\hsize=.7\hsize\linewidth=\hsize\raggedright\arraybackslash\hyphenpenalty=10000\exhyphenpenalty=10000}X}
\newcolumntype{R}{>{\hsize=1.3\hsize\linewidth=\hsize\raggedright\arraybackslash\hyphenpenalty=10000\exhyphenpenalty=10000}X}
\newcolumntype{E}{>{\raggedright\arraybackslash\hyphenpenalty=10000\exhyphenpenalty=10000}X}
\newcommand{\ombtabletop}{\hline\noalign{\smallskip}}
\newcommand{\ombtablemid}{\\\noalign{\smallskip}\hline\noalign{\smallskip}}
\newcommand{\ombtablebottom}{\\\noalign{\smallskip}\hline}
\makeatletter
\newenvironment{ombtableblock}{\par\medskip\noindent\begin{minipage}{\linewidth}\def\@captype{table}}{\end{minipage}\par\medskip}
\newif\ifombpendingfloats
\newcommand{\ombdisplayboundary}{\ombpendingfloatsfalse\ifx\@deferlist\@empty\else\ombpendingfloatstrue\fi\ifx\@dbldeferlist\@empty\else\ombpendingfloatstrue\fi\ifx\@dbltoplist\@empty\else\ombpendingfloatstrue\fi\ifx\@toplist\@empty\else\ombpendingfloatstrue\fi\ifx\@botlist\@empty\else\ombpendingfloatstrue\fi\FloatBarrier\ifombpendingfloats\clearpage\fi}
\setlength{\@fptop}{0pt}
\setlength{\@dblfptop}{0pt}
\setlength{\@fpsep}{12pt}
\setlength{\@dblfpsep}{12pt}
\long\def\@makecaption#1#2{\vskip\abovecaptionskip{\ombcaptionfont\raggedright\noindent#2\par}\vskip\belowcaptionskip}
\makeatother
`,trailer:''};}
async function renderFragments(m:Manuscript,html:string,assets:ReadonlyMap<string,Uint8Array>,texProfile:TexProfile,dir:string,tc:Toolchain):Promise<Map<string,Uint8Array>>{
 dir=path.resolve(dir);mkdirSync(dir,{recursive:true});const files=await journalFontAssets(tc,dir);
 for(const [name,bytes] of assets){const dest=path.join(dir,name);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,bytes);}
 writeFileSync(path.join(dir,'paper.html'),html);
 const figures=m.sections.flatMap(s=>s.blocks.filter(b=>b.kind==='figure'));
 for(const f of figures)if(f.sourceCsv){assert(releaseHash(Buffer.from(f.sourceCsv))===f.csvSha256,'figure source CSV differs from certified hash');files.set(f.src.replace(/\.svg$/u,'.csv'),Buffer.from(f.sourceCsv));}
 if(figures.length){const browser=await Chromium.launch(tc.chromium,path.join(dir,'chromium'));try{for(const f of figures){
  const file=path.join(dir,f.src.replace(/\.svg$/u,'.html'));const font=readFileSync(path.join(ROOT,'../omb-figures/vendor/fonts/LiberationSans-Regular.ttf')).toString('base64');
  // Canonical SVG remains untouched. A local font is applied only in its print wrapper.
  const bold=readFileSync(path.join(ROOT,'../omb-figures/vendor/fonts/LiberationSans-Regular.ttf')).toString('base64');
  const svg=f.svg.replace(/(<svg[^>]*>)/u,`$1<style>@font-face{font-family:'PW9 Liberation Sans';src:url(data:font/ttf;base64,${font})}@font-face{font-family:'PW9 Liberation Sans';font-weight:700;src:url(data:font/ttf;base64,${bold})}text{font-family:'PW9 Liberation Sans' !important}</style>`);
  writeFileSync(path.join(dir,f.src+'.print.svg'),svg);
  writeFileSync(file,`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;line-height:0}svg{width:600px;height:auto}</style></head><body>${svg}</body></html>`);await browser.open(file);
  const size=await browser.evaluate('({w:document.querySelector("svg").getBoundingClientRect().width,h:document.querySelector("svg").getBoundingClientRect().height})');
  await browser.evaluate(`(()=>{const s=document.createElement('style');s.textContent='@page{size:${size.w}px ${size.h}px;margin:0}';document.head.append(s);})()`);
  const name=f.src.replace(/\.svg$/u,'.pdf');writeFileSync(path.join(dir,name+'.raw'),await browser.pdf());await command(tc.python,[path.join(ROOT,'scripts/normalize.py'),'pdf',path.join(dir,name+'.raw'),path.join(dir,name)]);files.set(name,readFileSync(path.join(dir,name)));
 }}finally{await browser.close();}}
 const tex=renderVerifiedTex(m,texProfile);verifyTex(tex,m,texProfile);checkTexSource(tex,{...JSON.parse(readFileSync(path.join(ROOT,'output-profiles/preprint-two-column.json'),'utf8')),columns:texProfile.columns} as OutputProfile,'amani-a4@1');writeFileSync(path.join(dir,'paper.tex'),tex);
 await command(tc.tectonic,['--bundle',tc.texBundle,'--only-cached','--untrusted','--keep-logs','paper.tex'],dir);
 const log=readFileSync(path.join(dir,'paper.log'),'utf8');assert(!/Missing character:|Undefined control sequence|LaTeX Error:|Overfull \\[hv]box/u.test(log),'verified TeX: missing glyph, error or overflow');
 writeFileSync(path.join(dir,'paper.raw.pdf'),readFileSync(path.join(dir,'paper.pdf')));await command(tc.python,[path.join(ROOT,'scripts/normalize.py'),'pdf',path.join(dir,'paper.raw.pdf'),path.join(dir,'paper.pdf')]);
 writeFileSync(path.join(dir,'figure-tags.json'),JSON.stringify(figures.map(f=>({id:f.figureId,alt:f.alt.text}))));
 await command(tc.python,[path.join(ROOT,'scripts/pw8-pdf-tags.py'),path.join(dir,'paper.pdf'),path.join(dir,'paper.tagged.pdf'),path.join(dir,'figure-tags.json')]);
 writeFileSync(path.join(dir,'paper.pdf'),readFileSync(path.join(dir,'paper.tagged.pdf')));
 checkLatexPdf(JSON.parse(await command(tc.python,[path.join(ROOT,'scripts/normalize.py'),'inspect-pdf',path.join(dir,'paper.pdf')])));
 await command(tc.pandoc,['-f','html','-t','docx','paper.html','-o','paper.docx','--resource-path',dir],dir);
 writeFileSync(path.join(dir,'paper.raw.docx'),readFileSync(path.join(dir,'paper.docx')));
 await command(tc.python,[path.join(ROOT,'scripts/normalize.py'),'docx',path.join(dir,'paper.raw.docx'),path.join(dir,'paper.docx'),path.join(ROOT,'vendor/fonts'),'false','false','closed-world']);
 for(const name of ['paper.pdf','paper.docx','paper.tex'])files.set(name,readFileSync(path.join(dir,name)));
 files.set('review.pdf',await renderVerifiedReview(html,dir,tc));
 const archive=path.join(dir,'arxiv-source');mkdirSync(archive,{recursive:true});
 const sourceFiles=new Map([...files].filter(([name])=>name.startsWith('fonts/')||name==='paper.tex'||name.startsWith('figures/')&&name.endsWith('.pdf')));
 const bib=m.sections.filter(s=>s.id==='references').flatMap(s=>s.blocks.flatMap(b=>b.kind==='paragraphs'?b.units:[])).flatMap(u=>u.inlines.filter(i=>i.t==='value'&&i.key.startsWith('bibliography:')).map(i=>`@misc{${i.t==='value'?i.key.slice(13):''}, note={${i.text.replace(/[{}\\]/gu,' ')}}}\n`)).join('');
 sourceFiles.set('paper.bib',Buffer.from('% Bibliographic records are also printed as verified manuscript units.\n'+bib));
 sourceFiles.set('paper.bbl',Buffer.from('% Bibliography is inline in the verified manuscript.\n'));
 sourceFiles.set('00README.json',Buffer.from(JSON.stringify({spec_version:1,process:{compiler:'xelatex'},sources:[{filename:'paper.tex',usage:'toplevel'}],texlive_version:2025,stamp:false})+'\n'));
 const cls=await command(tc.python,['-c',`import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);names=[n for n in z.namelist() if n.endswith('/article.cls') or n=='article.cls'];assert len(names)==1;sys.stdout.write(z.read(names[0]).decode())`,tc.texBundle]);sourceFiles.set('article.cls',Buffer.from(cls));
 for(const [name,bytes] of sourceFiles){const dest=path.join(archive,name);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,bytes);if(!files.has(name))files.set(name,bytes);}
 await command(tc.python,[path.join(ROOT,'scripts/tex-bundle.py'),'archive',archive,path.join(dir,'paper-arxiv.tar.gz')]);files.set('paper-arxiv.tar.gz',readFileSync(path.join(dir,'paper-arxiv.tar.gz')));
 return files;
}
/** Host-created capability. plan/keys never appear in drafter-controlled package JSON. */
export async function createPW8RenderAdapter(options:{expectedManuscriptSha256?:string;purpose?:'synthetic-preview'|'endorsed-package';plan:ManuscriptPlan;workDirectory:string;columns?:1|2;outputProfile?:'preprint'|'preprint-two-column'|'arxiv-source'|'journal-review';resources?:ReadonlyMap<string,Uint8Array>}){
 assertDecisionConsistency(options.plan.ctx);
 const checked=verifyFirstDraft(options.plan);assert(checked.ok&&checked.manuscript,'PW8 source verification failed: '+JSON.stringify({refusal:checked.refusal,mustAppear:checked.mustAppear}));const m=checked.manuscript,manuscriptHash=canonicalSha256(m);
 assert(options.purpose!=='endorsed-package'||!!options.expectedManuscriptSha256,'PW8: endorsed manuscript binding required');
 assert(!options.expectedManuscriptSha256||options.expectedManuscriptSha256===manuscriptHash,'PW8: plan differs from endorsed manuscript');
 const tc=await toolchain(),key=randomBytes(32),tex=verifiedTexProfile(options.columns??(options.outputProfile==='preprint-two-column'?2:1)),resources=new Map([...options.resources??[]].map(([p,b])=>[p,Uint8Array.from(b)])),assets=new Map<string,Uint8Array>(resources);
 for(const s of m.sections)for(const b of s.blocks)if(b.kind==='figure')assets.set(b.src,Buffer.from(b.svg));
 mkdirSync(options.workDirectory,{recursive:true});writeFileSync(path.join(options.workDirectory,'verified-manuscript.json'),JSON.stringify(m));const html=renderSignedHtml(m,new SpanSigner(key,m.buildId));
 const prep=await renderFragments(m,html,assets,tex,path.join(options.workDirectory,'preparation'),tc);
 const pdf=extractPdf(prep.get('paper.pdf')!),docx=extractDocx(prep.get('paper.docx')!);const {Title:_title,...info}=pdf.info;
 assert(pdf.visualSha256?.length===m.skeleton.context.figures.length,'PW8: unexpected figure Form inventory');
 const figurePdf:NonNullable<ReleaseProfile['figurePdf']>={};
 for(const section of m.sections)for(const f of section.blocks)if(f.kind==='figure'){
  const name=f.src.replace(/\.svg$/u,'.pdf'),x=extractPdf(prep.get(name)!),fm=figureReadbackManuscript(m,f);
  (figurePdf as Record<string,any>)[name]={figures:'vector',fontSha256:x.fontSha256,layout:trustedPdfLayout(x,fm),info:x.info};
 }
 const runningFooter=runningFooterText(m),paperFurniture:PdfFurniture[]=pdf.runs.filter(r=>r.y<54).map(r=>({...r,kind:'running-footer'}));
 const review=extractPdf(prep.get('review.pdf')!),furniture:PdfFurniture[]=review.runs.filter(r=>/^\d+$/u.test(r.text)&&(r.x<54||r.y<54)).map(r=>({...r,kind:r.y<54?'page':'line'}));
 const reviewProfile={figures:'vector' as const,info:review.info,fontSha256:review.fontSha256,furniture,layout:trustedPdfLayout(review,m,furniture)};
 const profile:ReleaseProfile={rendererVersions:{...tc.identity,releasePurpose:options.purpose??'synthetic-preview'},sourceDateEpoch:'946684800',resources:Object.fromEntries([...resources].map(([p,b])=>[p,releaseHash(b)])),tex,figurePdf,pdfArtifacts:{'review.pdf':reviewProfile},byteDeterministic:['tex','pdf'],additionalArtifacts:[...[...prep.keys()].filter(p=>!['paper.pdf','paper.docx','paper.tex'].includes(p)),'release-profile.json'],pdf:{figures:'vector',furniture:paperFurniture,runningFooter,visualAssets:pdf.visualSha256?.map((sha256,i)=>({sha256,figureSha256:m.skeleton.context.figures[i]!.svg})),info,fontSha256:pdf.fontSha256,layout:trustedPdfLayout(pdf,m,paperFurniture,runningFooter)},docx:{titleParagraph:true,properties:Object.fromEntries(Object.entries(docx.properties).filter(([k])=>!['core:title','core:description','core:keywords'].includes(k))),mediaSha256:docx.referencedMedia,styleParts:docx.styleParts,styleReferences:[...new Set(docx.styleReferences)]}};
 const outputFiles=(files:Map<string,Uint8Array>)=>{if(options.outputProfile==='journal-review'){files.set('preprint.pdf',files.get('paper.pdf')!);files.set('paper.pdf',files.get('review.pdf')!);}return files;};
 const finalProfile:ReleaseProfile=options.outputProfile==='journal-review'?{...profile,pdf:reviewProfile,pdfArtifacts:{...profile.pdfArtifacts,'preprint.pdf':profile.pdf},additionalArtifacts:[...profile.additionalArtifacts??[],'preprint.pdf']}:profile;
 const pcheck=verifyPdf(prep.get('paper.pdf')!,m,profile.pdf),dcheck=verifyDocx(prep.get('paper.docx')!,m,profile.docx);assert(pcheck.ok,'PW8 preparation PDF: '+JSON.stringify(pcheck.issues));assert(dcheck.ok,'PW8 preparation DOCX: '+JSON.stringify(dcheck.issues));
 let count=0;const verifier=createReleaseVerifier({masterKey:key,profile:finalProfile,resources,render:async(request:RenderRequest)=>{assert(canonicalSha256(request.manuscript)===manuscriptHash,'PW8: manuscript changed during rendering');const artifacts=outputFiles(await renderFragments(request.manuscript,request.html,request.assets,tex,path.join(options.workDirectory,'render-'+count++),tc));artifacts.set('release-profile.json',Buffer.from(canonicalJson(request.profile)));return {profileSha256:request.profileSha256,artifacts};}});
 const build=await verifier.build(options.plan);
 return {profile:finalProfile,build,verifyRelease:()=>verifier.verifyRelease(build),persist:(key:KeyObject)=>verifier.persist(build,key)};
}
