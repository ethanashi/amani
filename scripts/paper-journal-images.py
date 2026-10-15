from pathlib import Path
from PIL import Image,ImageOps,ImageDraw,ImageFont
import json,re
root=Path('../_logs');review=root/'paper-ref';review.mkdir(exist_ok=True)
font=ImageFont.truetype('packages/omb-package/vendor/fonts/AmaniJournalSerif-Regular.ttf',24)
rows=json.loads((root/'paper-journal-results.json').read_text())['releases']
for row in rows:
 stem=Path(row['file']).stem
 pages=sorted(root.glob(stem+'-*.png'),key=lambda p:int(p.stem.rsplit('-',1)[-1]) if p.stem.rsplit('-',1)[-1].isdigit() else 999)
 pages=[p for p in pages if re.fullmatch(re.escape(stem)+r'-\d+\.png',p.name)]
 assert len(pages)==row['pages'],f'page inventory mismatch: {stem}'
 for old in review.glob(f"inspect-{row['name']}-*.png"):
  if re.fullmatch(r'inspect-'+re.escape(row['name'])+r'-\d+\.png',old.name):old.unlink()
 for start in range(0,len(pages),9):
  sheet=Image.new('RGB',(1800,3*890),'#dddddd');d=ImageDraw.Draw(sheet)
  for j,p in enumerate(pages[start:start+9]):
   im=Image.open(p).convert('RGB');im.thumbnail((590,845));x=j%3*600;y=j//3*890;sheet.paste(im,(x+(600-im.width)//2,y+32));d.text((x+10,y+3),f"{row['name']} — page {start+j+1}",font=font,fill='black')
  sheet.save(review/f"inspect-{row['name']}-{start//9+1}.png")
ours=next(r for r in rows if r['name']=='confirmed');stem=Path(ours['file']).stem
for label,page,reference in [('page1',1,'pm-01.png'),('table',ours['tablePage'],'pm-08.png')]:
 f=root/f'{stem}-{page:02d}.png'
 if not f.exists():f=root/f'{stem}-{page}.png'
 ims=[]
 for p in [f,review/reference]:
  im=Image.open(p).convert('RGB');im=im.resize((round(im.width*1500/im.height),1500));ims.append(im)
 canvas=Image.new('RGB',(sum(i.width for i in ims)+40,1600),'#e6e6e6');d=ImageDraw.Draw(canvas);x=10
 for im,title in zip(ims,[f'Amani — journal preprint, page {page}',f'PLOS Medicine — reference, page {1 if page==1 else 8}']):
  d.text((x+10,10),title,font=font,fill='black');canvas.paste(im,(x,45));x+=im.width+20
 d.text((20,1560),'Reference: Pang et al. (2025), PLOS Medicine 22:e1004545. CC BY 4.0. Page images resized.',font=font,fill='black')
 canvas.save(review/f'compare-{label}.png')
print('Contact sheets and two comparisons written.')
