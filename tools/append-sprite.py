"""Adds icons to the committed sprite sheet without rebuilding it: icons already in data/sprite-index.json keep
their cells, new ones (any icon data/defs.json or the artifacts use that the sheet lacks) go at the end. Use it after
tools/build-defs.mjs adds plugs, when the full data/raw icon cache isn't at hand. tools/fetch-icons.mjs keeps the same
order, so a full rebuild (fetch-icons + build-sprite) gives the same cells.
Usage: python tools/append-sprite.py   (downloads the missing icons from bungie.net, in memory)
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
def add(t):
    if isinstance(t, str) and t.startswith(P): t = t[len(P):]
    if isinstance(t, str) and t and t not in have and t not in want: want.append(t)
# every icon data/defs.json uses (same walk as tools/fetch-icons.mjs), then the artifacts
d = json.loads((root / 'data/defs.json').read_text(encoding='utf-8'))
for m in ('pi', 'pw', 'pa'):
    for p in d.get(m, {}).values(): add(p[0])
for st in d['sets']:
    for p in st['p']: add(p.get('i'))
for c in d['sub'].values():
    for e in c.values():
        add(e.get('i'))
        for lst in e['s'].values():
            for a2 in lst: add(a2.get('i'))
for a in json.loads((root / 'data/interactions/artifacts.json').read_text(encoding='utf-8')):
    for t in [a.get('i')] + [p[4] for p in a.get('p', []) if len(p) > 4]: add(t)
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
# lossy like build-sprite.py (lossless is ~6 MB, too heavy for phones); each append re-encodes the sheet once
sheet.save(spr_path, 'WEBP', quality=90, method=6, alpha_quality=100)
idx_path.write_text(json.dumps(tails + want, separators=(',', ':')), encoding='utf-8', newline='\n')
print(f'sprite: added {len(want)} icons, now {n} ({COLS} x {rows}), {spr_path.stat().st_size} bytes')
