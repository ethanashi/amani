"""Build pinned Liberation advance-width data for the SVG audit. OFL font data."""
import json
from pathlib import Path
from fontTools.ttLib import TTFont
root=Path(__file__).resolve().parents[1]
f=TTFont(root/'vendor/fonts/LiberationSans-Regular.ttf')
u=f['head'].unitsPerEm
cmap=f.getBestCmap()
widths={chr(c):f['hmtx'][g][0]/u for c,g in cmap.items()}
bounds={}
for c,g in cmap.items():
    glyph=f['glyf'][g]
    if hasattr(glyph, 'xMin'):
        bounds[chr(c)]=[glyph.xMin/u,glyph.yMin/u,glyph.xMax/u,glyph.yMax/u]
    else:
        bounds[chr(c)]=[0,0,0,0]
(root/'vendor/fonts/liberation-metrics.json').write_text(json.dumps({'widths':widths,'bounds':bounds},sort_keys=True,ensure_ascii=True)+'\n')
