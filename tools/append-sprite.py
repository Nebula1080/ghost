"""Adds icons to the committed sprite sheet without rebuilding it: icons already in data/sprite-index.json keep
their cells, new ones go at the end. For icons that tools/fetch-icons.mjs started collecting later (artifacts), when
the full data/raw icon cache isn't at hand. A full rebuild (fetch-icons + build-sprite) gives the same order.
Usage: python tools/append-sprite.py   (downloads missing artifact icons from bungie.net into a temp folder)
"""
import io, json, urllib.request
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
SIZE, COLS = 48, 48
idx_path, spr_path = root / 'data/sprite-index.json', root / 'data/sprite.webp'
tails = json.loads(idx_path.read_text(encoding='utf-8'))
have = set(tails)
P = '/common/destiny2_content/icons/'
want = []
for a in json.loads((root / 'data/interactions/artifacts.json').read_text(encoding='utf-8')):
    for t in [a.get('i')] + [p[4] for p in a.get('p', []) if len(p) > 4]:
        if isinstance(t, str) and t.startswith(P):
            t = t[len(P):]
            if t not in have and t not in want: want.append(t)
if not want:
    print('sprite: nothing to add'); raise SystemExit
old = Image.open(spr_path).convert('RGBA')
n = len(tails) + len(want); rows = -(-n // COLS)
sheet = Image.new('RGBA', (COLS * SIZE, rows * SIZE), (0, 0, 0, 0))
sheet.paste(old.crop((0, 0, old.width, min(old.height, rows * SIZE))), (0, 0))
for k, t in enumerate(want):
    req = urllib.request.Request('https://www.bungie.net/common/destiny2_content/icons/' + t, headers={'User-Agent': 'ghost-icons/1.0'})
    im = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert('RGBA').resize((SIZE, SIZE), Image.LANCZOS)
    i = len(tails) + k
    sheet.paste(im, ((i % COLS) * SIZE, (i // COLS) * SIZE))
sheet.save(spr_path, 'WEBP', quality=90, method=6, alpha_quality=100)
idx_path.write_text(json.dumps(tails + want, separators=(',', ':')), encoding='utf-8', newline='\n')
print(f'sprite: added {len(want)} icons, now {n} ({COLS} x {rows}), {spr_path.stat().st_size} bytes')
