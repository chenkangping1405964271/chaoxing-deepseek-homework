"""Optional fixture regeneration: pip install fonttools, then run this file.

Original geometric glyphs for the MIT-licensed tests. No third-party or course font.
U+E001 draws a triangle, U+E002 draws a square. Browser checks need only the built TTF.
"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

font = FontBuilder(1000, isTTF=True)
order = ['.notdef', 'space', 'triangle', 'square']
font.setupGlyphOrder(order)
font.setupCharacterMap({32: 'space', 0xE001: 'triangle', 0xE002: 'square'})
glyphs = {}
for name in order:
    pen = TTGlyphPen(None)
    points = {'triangle': [(100, 0), (900, 0), (500, 800)],
              'square': [(100, 0), (900, 0), (900, 800), (100, 800)]}.get(name, [])
    if points:
        pen.moveTo(points[0])
        for point in points[1:]:
            pen.lineTo(point)
        pen.closePath()
    glyphs[name] = pen.glyph()
font.setupGlyf(glyphs)
font.setupHorizontalMetrics({name: (1000, 0) for name in order})
font.setupHorizontalHeader(ascent=900, descent=-100)
font.setupNameTable({'familyName': 'CXDS Test Shapes', 'styleName': 'Regular',
                    'uniqueFontIdentifier': 'cxds-test-shapes-1',
                    'fullName': 'CXDS Test Shapes Regular', 'psName': 'CXDSTestShapes-Regular'})
font.setupOS2(sTypoAscender=900, sTypoDescender=-100, usWinAscent=900, usWinDescent=100)
font.setupPost()
font.setupMaxp()
font.save(Path(__file__).with_name('encoded-font.ttf'))
