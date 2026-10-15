/** Namespace-aware closed document grammar for the trusted pandoc converter. */
import { isElement, type ParsedElement } from '../../../omb-figures/src/xml.ts';
import type { OutputIssue } from './outputs.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const grammars: Record<string, string> = {
 [W]: 'document body p pPr pStyle r rPr rStyle t tab br cr noBreakHyphen softHyphen delText ins del moveFrom moveTo bookmarkStart bookmarkEnd sectPr footnotePr numRestart tbl tblPr tblStyle tblW tblLook tblCaption tblDescription tblGrid gridCol tr trPr tblHeader tc tcPr tcW gridSpan vMerge vanish specVanish webHidden sz szCs color b bCs i iCs u strike dstrike caps smallCaps vertAlign rFonts lang spacing kern position highlight shd keepNext keepLines pageBreakBefore jc ind contextualSpacing pgSz pgMar cols docGrid drawing fldSimple fldChar instrText hyperlink commentRangeStart commentRangeEnd commentReference',
 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing': 'inline extent effectExtent docPr',
 'http://schemas.openxmlformats.org/drawingml/2006/main': 'graphic graphicData picLocks blip extLst ext stretch fillRect xfrm off prstGeom avLst noFill ln headEnd tailEnd',
 'http://schemas.openxmlformats.org/drawingml/2006/picture': 'pic nvPicPr cNvPr cNvPicPr blipFill spPr',
 'http://schemas.microsoft.com/office/drawing/2010/main': 'useLocalDpi',
 'http://schemas.microsoft.com/office/drawing/2016/SVG/main': 'svgBlip',
};
const children: Record<string, string> = {
 "blip": "extLst",
 "blipFill": "blip stretch",
 "body": "bookmarkEnd bookmarkStart del ins moveFrom moveTo p sectPr tbl",
 "cNvPicPr": "picLocks",
 "del": "p r",
 "document": "body",
 "drawing": "inline",
 "ext": "svgBlip useLocalDpi",
 "extLst": "ext",
 "fldSimple": "r",
 "footnotePr": "numRestart",
 "graphic": "graphicData",
 "graphicData": "pic",
 "hyperlink": "r",
 "inline": "docPr effectExtent extent graphic",
 "ins": "p r",
 "ln": "headEnd noFill tailEnd",
 "moveFrom": "p r",
 "moveTo": "p r",
 "nvPicPr": "cNvPicPr cNvPr",
 "p": "commentRangeEnd commentRangeStart commentReference del fldSimple hyperlink ins moveFrom moveTo pPr r",
 "pPr": "contextualSpacing ind jc keepLines keepNext pStyle pageBreakBefore rPr spacing",
 "pic": "blipFill nvPicPr spPr",
 "prstGeom": "avLst",
 "r": "br commentReference cr delText drawing fldChar instrText noBreakHyphen rPr softHyphen t tab",
 "rPr": "b bCs caps color dstrike highlight i iCs kern lang position rFonts rStyle shd smallCaps spacing specVanish strike sz szCs u vanish vertAlign webHidden",
 "sectPr": "cols docGrid footnotePr pgMar pgSz",
 "spPr": "ln noFill prstGeom xfrm",
 "stretch": "fillRect",
 "tbl": "tblGrid tblPr tr",
 "tblGrid": "gridCol",
 "tblPr": "tblCaption tblDescription tblLook tblStyle tblW",
 "tc": "p tcPr",
 "tcPr": "gridSpan tcW vMerge",
 "tr": "tc trPr",
 "trPr": "tblHeader",
 "xfrm": "ext off"
};
export function checkDocumentGrammar(root: ParsedElement): OutputIssue[] {
 const issues: OutputIssue[] = [];
 const fail = (detail: string) => issues.push({code:'hidden-text', where:'docx grammar', detail});
 const visit = (e: ParsedElement, inherited: Map<string,string>, parent: string) => {
  const ns = new Map(inherited);
  for (const [k,v] of e.attrs) if (k === 'xmlns') ns.set('',v); else if (k.startsWith('xmlns:')) ns.set(k.slice(6),v);
  const parts = e.tag.split(':'); const name = parts.at(-1)!; const uri = ns.get(parts.length === 2 ? parts[0]! : '') ?? '';
  if (!grammars[uri]?.split(' ').includes(name)) fail(`unsupported OOXML node ${e.tag} (${uri})`);
  if (parent && !children[parent.slice(parent.lastIndexOf(':') + 1)]?.split(' ').includes(name)) fail(`unsupported OOXML placement ${e.tag}`);
  if (uri === W && name === 't' && parent !== `${W}:r`) fail('text outside a supported run');
  if (e.children.some(c => !isElement(c) && c.text.trim()) && !(uri === W && ['t','delText','instrText'].includes(name))) fail(`unknown text-bearing node ${e.tag}`);
  for (const [k] of e.attrs) if (k.includes(':') && !k.startsWith('xmlns:')) {
   const prefix = k.split(':')[0]!;
   if (prefix !== 'xml' && !ns.has(prefix)) fail(`unresolved attribute namespace ${k}`);
  }
  for (const c of e.children) if (isElement(c)) visit(c, ns, `${uri}:${name}`);
 };
 visit(root, new Map(), '');
 return issues;
}
