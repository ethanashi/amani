#!/usr/bin/env python3
"""Pinned Latin Modern outlines in a renamed TrueType container for Chromium.
GUST/LPPL derivative; cubic-to-quadratic tolerance 0.25/1000 em. FontTools 4.60.1.
Original OTFs are used unchanged by LaTeX. No system font is consulted.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
root=Path(__file__).resolve().parents[1]
f=TTFont(root/'vendor/fonts/lmroman10-bold.otf');order=f.getGlyphOrder();source=f.getGlyphSet();glyphs={}
for name in order:
 pen=TTGlyphPen(source);source[name].draw(Cu2QuPen(pen,f['head'].unitsPerEm/4000,reverse_direction=True));glyphs[name]=pen.glyph()
b=FontBuilder(f['head'].unitsPerEm,isTTF=True);b.setupGlyphOrder(order);b.setupCharacterMap(f.getBestCmap());b.setupGlyf(glyphs)
b.setupHorizontalMetrics({n:(f['hmtx'][n][0],getattr(glyphs[n],'xMin',0)) for n in order})
b.setupHorizontalHeader(ascent=f['hhea'].ascent,descent=f['hhea'].descent,lineGap=f['hhea'].lineGap)
b.setupNameTable({'familyName':'PW9 Latin Modern Roman','styleName':'Bold','uniqueFontIdentifier':'PW9-LatinModernRoman-2.004-TTF1','fullName':'PW9 Latin Modern Roman Bold','psName':'PW9LatinModernRoman-Bold','version':'Version 2.004; PW9 TTF derivative 1','copyright':f['name'].getDebugName(0),'licenseDescription':'GUST Font License 1.0, based on LPPL 1.3c; see bundled licence.'})
b.setupOS2();b.font['OS/2']=f['OS/2'];b.setupPost()
for name in ['GPOS','GSUB','GDEF','kern']:
 if name in f:b.font[name]=f[name]
b.font['head'].created=b.font['head'].modified=3029529600
b.save(root/'vendor/fonts/PW9LatinModernRoman-Bold.ttf')
