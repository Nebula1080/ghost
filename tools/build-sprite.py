"""Packs every downloaded Bungie icon (data/raw/icons/b, order from data/raw/icons/list.json) into one
WebP sprite sheet, data/sprite.webp, so the page never loads images from bungie.net (claude.ai blocks them).
Needs Pillow (pip install pillow). tools/build-sprite.ps1 is the no-install fallback (PNG, ~3x larger).
Usage: python tools/build-sprite.py [--size 48] [--cols 48] [--quality 90]
"""
import argparse, json
from pathlib import Path
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('--size', type=int, default=48)
ap.add_argument('--cols', type=int, default=48)
ap.add_argument('--quality', type=int, default=90)
a = ap.parse_args()
root = Path(__file__).resolve().parent.parent
lst = json.loads((root / 'data/raw/icons/list.json').read_text(encoding='utf-8'))
rows = -(-len(lst) // a.cols)
sheet = Image.new('RGBA', (a.cols * a.size, rows * a.size), (0, 0, 0, 0))
missing = 0
for i, t in enumerate(lst):
    f = root / 'data/raw/icons/b' / t.replace('/', '_')
    try:
        im = Image.open(f).convert('RGBA').resize((a.size, a.size), Image.LANCZOS)
        sheet.paste(im, ((i % a.cols) * a.size, (i // a.cols) * a.size))
    except Exception:
        missing += 1
out = root / 'data/sprite.webp'
sheet.save(out, 'WEBP', quality=a.quality, method=6, alpha_quality=100)
print(f'sprite: {len(lst)} icons, {a.cols} x {rows} at {a.size}px, missing {missing}, {out.stat().st_size} bytes')
