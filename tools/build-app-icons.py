"""Draws the home-screen icons (data/icon-192.png, data/icon-512.png): an amber diamond on dark gray.
Needs Pillow. Run once; build.py copies them into dist/.
Usage: python tools/build-app-icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
for size in (192, 512):
    s = size * 4  # draw large, then downsample for smooth edges
    im = Image.new('RGBA', (s, s), (24, 25, 26, 255))
    d = ImageDraw.Draw(im)
    c = s / 2
    def diamond(r, fill=None, outline=None, width=0):
        d.polygon([(c, c - r), (c + r, c), (c, c + r), (c - r, c)], fill=fill, outline=outline, width=width)
    diamond(s * 0.34, outline=(240, 194, 123, 255), width=int(s * 0.045))
    diamond(s * 0.14, fill=(240, 194, 123, 255))
    im.resize((size, size), Image.LANCZOS).save(root / f'data/icon-{size}.png')
    print('wrote', f'data/icon-{size}.png')
