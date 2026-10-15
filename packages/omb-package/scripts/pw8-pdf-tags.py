"""Bind each PW8 figure Alt to the actual page Form invocation through an MCID.
The manifest order is the trusted figure order; every Form must be accounted for.
"""
import json,sys
from pypdf import PdfReader,PdfWriter
from pypdf.generic import DictionaryObject,NameObject,TextStringObject,ArrayObject,BooleanObject,NumberObject,ContentStream
source,out,inventory=sys.argv[1:]
writer=PdfWriter(clone_from=PdfReader(source))
figures=json.load(open(inventory))
if figures:
 root=DictionaryObject({NameObject('/Type'):NameObject('/StructTreeRoot')})
 root_ref=writer._add_object(root)
 children=[]; parents=[]; figure_index=0
 for page_index,page in enumerate(writer.pages):
  content=ContentStream(page.get_contents(),writer)
  operations=[]; page_children=[]
  objects=page.get('/Resources',{}).get('/XObject',{})
  if hasattr(objects,'get_object'):objects=objects.get_object()
  for operands,operator in content.operations:
   if operator==b'Do' and objects[operands[0]].get_object().get('/Subtype')=='/Form':
    assert figure_index<len(figures),'unlisted Form in paper'
    f=figures[figure_index];figure_index+=1;mcid=len(page_children)
    operations.append(([NameObject('/Figure'),DictionaryObject({NameObject('/MCID'):NumberObject(mcid)})],b'BDC'))
    operations.append((operands,operator));operations.append(([],b'EMC'))
    element=DictionaryObject({NameObject('/Type'):NameObject('/StructElem'),NameObject('/S'):NameObject('/Figure'),NameObject('/P'):root_ref,NameObject('/Pg'):page.indirect_reference,NameObject('/K'):NumberObject(mcid),NameObject('/Alt'):TextStringObject(f['alt']),NameObject('/ID'):TextStringObject(f['id'])})
    ref=writer._add_object(element);children.append(ref);page_children.append(ref)
   else:operations.append((operands,operator))
  content.operations=operations;page.replace_contents(content)
  if page_children:
   page[NameObject('/StructParents')]=NumberObject(page_index)
   parents.extend([NumberObject(page_index),ArrayObject(page_children)])
 assert figure_index==len(figures),'figure missing from actual page content'
 root[NameObject('/K')]=ArrayObject(children)
 root[NameObject('/ParentTree')]=writer._add_object(DictionaryObject({NameObject('/Nums'):ArrayObject(parents)}))
 writer.root_object[NameObject('/StructTreeRoot')]=root_ref
 writer.root_object[NameObject('/MarkInfo')]=DictionaryObject({NameObject('/Marked'):BooleanObject(True)})
with open(out,'wb') as f:writer.write(f)
