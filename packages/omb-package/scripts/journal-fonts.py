"""Reproducible OFL derivative: distinct Unicode aliases retain distinct glyph IDs.

XeTeX otherwise emits U+2011 for ASCII hyphens in the original Source Serif 4
shared glyph. Clone the alias glyphs, preserving outlines and advance widths;
never normalize extracted paper text. Reserved Font Name 'Source' is removed
from derivative family/PostScript names. Original copyright/licence is retained.
"""
from pathlib import Path
from copy import deepcopy
from fontTools.ttLib import TTFont
ROOT=Path(__file__).resolve().parents[1]/'vendor/fonts'
for source,style in [('Regular','Regular'),('Bold','Bold'),('It','Italic')]:
    font=TTFont(ROOT/f'SourceSerif4-{source}.ttf',recalcTimestamp=False)
    cmap=font.getBestCmap();ascii_glyphs={g for c,g in cmap.items() if 32<=c<127}
    aliases={c:g for c,g in cmap.items() if c>=127 and g in ascii_glyphs}
    order=list(font.getGlyphOrder())
    for code,glyph in sorted(aliases.items()):
        name=f'uni{code:04X}.distinct'
        font['glyf'][name]=deepcopy(font['glyf'][glyph]);font['hmtx'].metrics[name]=font['hmtx'].metrics[glyph];order.append(name)
        for table in font['cmap'].tables:
            if table.isUnicode() and code in table.cmap:table.cmap[code]=name
    font.setGlyphOrder(order)
    family='Amani Journal Serif';postscript='AmaniJournalSerif-'+style
    for item in font['name'].names:
        if item.nameID in [1,2,3,4,6,16,17]:
            value={1:family,2:style,3:'Amani Journal Serif 4.005R mapping v1 '+style,4:family+' '+style,6:postscript,16:family,17:style}[item.nameID]
            item.string=value.encode(item.getEncoding())
    font.save(ROOT/f'AmaniJournalSerif-{style}.ttf')
