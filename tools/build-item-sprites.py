"""Item icon sprite sheets for builds that can't load bungie.net images (the claude.ai artifact).

Reads data/item-art.json (tools/build-item-art.mjs), downloads each weapon/armor icon and its season watermark
from www.bungie.net into data/raw/item-icons/ (cache), bakes the watermark onto the icon at 64px and packs the
results into data/item-sprites/items-N.webp sheets (32x32 cells). Writes data/item-sprites/index.json:
  {"cell": 64, "cols": 32, "per": 1024, "sheets": ["items-0.webp", ...], "i": {hash: index}}
Identical icon + watermark pairs share one cell.
"""
import io, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
art = json.load(open(os.path.join(root, 'data', 'item-art.json'), encoding='utf-8'))
cache = os.path.join(root, 'data', 'raw', 'item-icons'); os.makedirs(cache, exist_ok=True)
out = os.path.join(root, 'data', 'item-sprites'); os.makedirs(out, exist_ok=True)
B = 'https://www.bungie.net/common/destiny2_content/icons/'
CELL, COLS = 64, 32; PER = COLS * COLS

def name_of(icon):
    return icon if icon.endswith('.png') else icon + '.jpg'

need = set()
for h, (icon, wm, _) in art['i'].items():
    need.add(name_of(icon))
    if wm >= 0: need.add(art['wm'][wm])
todo = [n for n in sorted(need) if not os.path.exists(os.path.join(cache, n))]
print('icons needed', len(need), 'to download', len(todo), flush=True)

def get(n):
    for attempt in range(4):
        try:
            req = urllib.request.Request(B + n, headers={'User-Agent': 'Ghost-build/1.0'})
            with urllib.request.urlopen(req, timeout=30) as r: data = r.read()
            open(os.path.join(cache, n), 'wb').write(data); return None
        except Exception as e:
            if getattr(e, 'code', 0) == 404: return n
            time.sleep(1.5 * (attempt + 1))
    return n
missing = set()
with ThreadPoolExecutor(6) as ex:
    for i, r in enumerate(ex.map(get, todo)):
        if r: missing.add(r)
        if i % 500 == 499: print(' ', i + 1, 'downloaded', flush=True)
print('missing after retries:', len(missing), flush=True)

cells, index = {}, {}
for h, (icon, wm, _) in sorted(art['i'].items(), key=lambda kv: kv[1][0]):
    ic = name_of(icon); wn = art['wm'][wm] if wm >= 0 else ''
    if ic in missing or not os.path.exists(os.path.join(cache, ic)): continue
    key = ic + '|' + wn
    if key not in cells: cells[key] = len(cells)
    index[h] = cells[key]
sheets = []
for s in range(0, len(cells), PER):
    keys = list(cells)[s:s + PER]
    rows = -(-len(keys) // COLS)
    sheet = Image.new('RGBA', (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    for k, key in enumerate(keys):
        ic, wn = key.split('|')
        im = Image.open(os.path.join(cache, ic)).convert('RGBA')
        if wn and os.path.exists(os.path.join(cache, wn)):
            w = Image.open(os.path.join(cache, wn)).convert('RGBA').resize(im.size, Image.LANCZOS)
            im = Image.alpha_composite(im, w)
        sheet.paste(im.resize((CELL, CELL), Image.LANCZOS), ((k % COLS) * CELL, (k // COLS) * CELL))
    fn = f'items-{s // PER}.webp'
    sheet.save(os.path.join(out, fn), quality=78, method=6)
    sheets.append(fn)
    print(fn, len(keys), 'icons', os.path.getsize(os.path.join(out, fn)) // 1024, 'KB', flush=True)
json.dump({'cell': CELL, 'cols': COLS, 'per': PER, 'sheets': sheets, 'i': index}, open(os.path.join(out, 'index.json'), 'w'), separators=(',', ':'))
print('items mapped', len(index), 'cells', len(cells))
