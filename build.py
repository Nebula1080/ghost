"""Build the single-page app from src/ + data/.

  python build.py                    -> dist/         (claude.ai artifact build; also opens straight from disk)
  python build.py --target hosted    -> dist-hosted/  (GitHub Pages build: strict CSP with script hashes)

Both inline src/core.js and data/defs.json into src/app.html, so the page is self-contained.
"""
import argparse, base64, hashlib, json, re, shutil
from pathlib import Path

root = Path(__file__).parent
ap = argparse.ArgumentParser()
ap.add_argument('--target', choices=['artifact', 'hosted'], default='artifact')
TARGET = ap.parse_args().target
OUT = root / ('dist' if TARGET == 'artifact' else 'dist-hosted')

s = (root / 'src/app.html').read_text(encoding='utf-8')
# db snapshots are frozen objects: clone everything read from the store before mutating
for a, b in [
    ("chunks.forEach(c => (c?.items || []).forEach(it => (it.kind === 'armor' ? a : w).push(it)));",
     "chunks.forEach(c => (c?.items || []).forEach(it => (it.kind === 'armor' ? a : w).push(structuredClone(it))));"),
    ("S.panes = panes?.list?.length ? panes.list : defaultPanes();",
     "S.panes = panes?.list?.length ? structuredClone(panes.list) : defaultPanes();"),
    ("S.edits = Object.fromEntries(edits.map(([id, d]) => [id, d]));",
     "S.edits = Object.fromEntries(edits.map(([id, d]) => [id, structuredClone(d)]));"),
]:
    assert a in s, 'build anchor missing: ' + a[:60]
    s = s.replace(a, b)
core = (root / 'src/core.js').read_text(encoding='utf-8').replace("if (typeof module !== 'undefined') module.exports = Core;", '')
assert '/*__CORE__*/' in s
assert '</script' not in core.lower(), 'core.js must not contain "</script"'
# an HTML comment opener/closer inside an inline script can be stripped by the host page pipeline, breaking the script
for bad in ('<!--', '-->'):
    assert bad not in core, f'core.js must not contain "{bad}" (write it as \\x3c!-- / --\\x3e)'
s = s.replace('/*__CORE__*/', core)

# ---- Ghost design: stylesheet, embedded fonts (OFL, data/fonts), art next to the page ----
assert '/*__GHOST_CSS__*/' in s and '/*__FONTS__*/' in s
ghost_css = (root / 'src/ghost.css').read_text(encoding='utf-8')
assert '</style' not in ghost_css.lower()
s = s.replace('/*__GHOST_CSS__*/', ghost_css)
fonts = []
for fam, f, wght in (('Hanken Grotesk', 'hanken-latin.woff2', '100 900'), ('Cinzel', 'cinzel-latin.woff2', '400 900')):
    fp = root / 'data/fonts' / f
    if fp.exists():
        b64 = base64.b64encode(fp.read_bytes()).decode()
        fonts.append(f'@font-face{{font-family:"{fam}";src:url(data:font/woff2;base64,{b64}) format("woff2");font-weight:{wght};font-style:normal;font-display:swap}}')
s = s.replace('/*__FONTS__*/', '\n'.join(fonts))
OUT.mkdir(exist_ok=True)
(OUT / 'art').mkdir(exist_ok=True)
art_files = sorted((root / 'data/art').glob('*.webp'))
for f in art_files: shutil.copyfile(f, OUT / 'art' / f.name)
print('art:', len(art_files), 'files')
# artifact build: Bungie item icons as bundled sprite sheets (tools/build-item-sprites.py), since bungie.net is blocked there
assert '/*__ISPR__*/null' in s
isp = root / 'data/item-sprites/index.json'
if TARGET == 'artifact' and isp.exists():
    ispr = json.loads(isp.read_text(encoding='utf-8'))
    (OUT / 'isprites').mkdir(exist_ok=True)
    for f in ispr['sheets']: shutil.copyfile(root / 'data/item-sprites' / f, OUT / 'isprites' / f)
    ispr_json = json.dumps(ispr, separators=(',', ':')); assert '<' not in ispr_json
    s = s.replace('/*__ISPR__*/null', ispr_json)
    print('item sprites:', len(ispr['sheets']), 'sheets,', len(ispr['i']), 'items')
# Bungie item icons / screenshots (hosted only: the claude.ai artifact's CSP blocks bungie.net)
assert '/*__ART__*/null' in s
ia = root / 'data/item-art.json'
if TARGET == 'hosted' and ia.exists():
    art_json = json.dumps(json.loads(ia.read_text(encoding='utf-8')), separators=(',', ':'))
    assert '<' not in art_json
    s = s.replace('/*__ART__*/null', art_json)

# reference data (icons, breakers, Clarity + Data Compendium); run tools/build-defs.mjs to refresh
OUT.mkdir(exist_ok=True)
defs_path = root / 'data/defs.json'
assert '/*__DEFS__*/null' in s
if defs_path.exists():
    d = json.loads(defs_path.read_text(encoding='utf-8'))
    # icons come from the sprite sheet (tools/fetch-icons.mjs + tools/build-sprite.py), never from bungie.net:
    # replace every icon path with its index in the sheet and ship the sheet next to the page.
    # Prefers the WebP sheet (Pillow); falls back to the PNG from tools/build-sprite.ps1.
    # In CI (no data/raw cache) the committed data/sprite-index.json stands in for data/raw/icons/list.json.
    lst = next((p for p in [root / 'data/raw/icons/list.json', root / 'data/sprite-index.json'] if p.exists()), None)
    spr = next((p for p in [root / 'data/sprite.webp', root / 'data/sprite.png'] if p.exists()), None)
    if lst and spr:
        tails = json.loads(lst.read_text(encoding='utf-8'))
        if lst.name == 'list.json':  # keep the CI copy in step with the local cache
            (root / 'data/sprite-index.json').write_text(json.dumps(tails, separators=(',', ':')), encoding='utf-8', newline='\n')
        idx = {t: i for i, t in enumerate(tails)}
        ix = lambda t: idx.get(t, -1) if t else -1
        for m in ('pi', 'pw', 'pa'):
            for p in d.get(m, {}).values(): p[0] = ix(p[0])
        for st in d['sets']:
            for p in st['p']: p['i'] = ix(p.get('i'))
        for c in d['sub'].values():
            for e in c.values():
                e['i'] = ix(e.get('i'))
                for lst2 in e['s'].values():
                    for a in lst2: a['i'] = ix(a.get('i'))
        fname = 'icons' + spr.suffix
        d['spr'] = {'n': len(idx), 'c': 48, 'r': -(-len(idx) // 48), 'f': fname}
        for old in OUT.glob('icons.*'):
            if old.name != fname: old.unlink()
        shutil.copyfile(spr, OUT / fname)
        print('sprite:', fname, spr.stat().st_size, 'bytes')
    else:
        print('warning: no sprite sheet; run node tools/fetch-icons.mjs and python tools/build-sprite.py')
    # JSON inside <script>: "</" and "<!--" are the only sequences that can end the script or switch the parser
    # into its escaped state, so neither may appear in the data (both escapes stay valid JSON/JS strings)
    defs = json.dumps(d, separators=(',', ':'), ensure_ascii=False).replace('</', '<\\/').replace('<!--', '<\\u0021--').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    assert '</' not in defs and '<!--' not in defs
    s = s.replace('/*__DEFS__*/null', defs)
else:
    print('warning: data/defs.json missing; building without icons/reference data')

# ---- hosted target: strict Content Security Policy (GitHub Pages can't send headers, so it's a <meta>) ----
if TARGET == 'hosted':
    # no third-party stylesheets/fonts at runtime (CSP font-src 'self' data:, and no requests to Google)
    s = re.sub(r'\s*<link rel="preconnect" href="https://fonts\.googleapis\.com">', '', s)
    s = re.sub(r'\s*<link href="https://fonts\.googleapis\.com/[^"]*" rel="stylesheet">', '', s)
    assert 'fonts.googleapis' not in s and 'fonts.gstatic' not in s
    scripts = re.findall(r'<script>(.*?)</script>', s, flags=re.S)
    assert scripts and len(scripts) == s.count('<script'), 'every script must be a plain inline <script> (no src, no attributes)'
    assert not re.search(r'<[^>]+\son[a-z]+\s*=', s.split('<script>')[0]), 'inline event handler attribute in the page markup'
    hashes = ' '.join("'sha256-%s'" % base64.b64encode(hashlib.sha256(x.encode('utf-8')).digest()).decode() for x in scripts)
    csp = '; '.join([
        "default-src 'none'",
        f"script-src {hashes}",
        "connect-src 'self' https://www.bungie.net",
        "img-src 'self' data: https://www.bungie.net",
        # 'unsafe-inline' for styles only: the UI sets hundreds of style="" attributes (rarity / element / pane
        # colours as CSS variables, bar widths) and adds <style> blocks for the sprite and Compendium classes.
        # Style hashes can't cover style attributes. Every value placed in them is a number, a constant, a
        # validated #hex colour or Core.sanitizeCss output, never raw user or API text.
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self' data:",
        "manifest-src 'self'",
        "worker-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
    ])
    meta = f'<meta http-equiv="Content-Security-Policy" content="{csp}">\n<meta name="referrer" content="no-referrer">\n'
    assert s.count('<meta charset="utf-8">') == 1
    s = s.replace('<meta charset="utf-8">\n', '<meta charset="utf-8">\n' + meta, 1)
    (OUT / 'csp.txt').write_text(csp + '\n', encoding='utf-8', newline='\n')
    print('CSP:', len(scripts), 'script hashes')

(OUT / 'index.html').write_text(s, encoding='utf-8', newline='\n')

# ---- installable web app (hosted copies): manifest, home-screen icons, offline service worker ----
for n in ('icon-192.png', 'icon-512.png'):
    if (root / 'data' / n).exists(): shutil.copyfile(root / 'data' / n, OUT / n)
sprite_name = next((f.name for f in OUT.glob('icons.*')), None)
(OUT / 'manifest.webmanifest').write_text(json.dumps({
    'name': 'Ghost', 'short_name': 'Ghost', 'start_url': './', 'scope': './', 'display': 'standalone',
    'background_color': '#170f1c', 'theme_color': '#170f1c', 'orientation': 'any',
    'icons': [{'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png'}, {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'any maskable'}],
}, indent=1), encoding='utf-8', newline='\n')
version = hashlib.sha1(s.encode('utf-8')).hexdigest()[:10]
assets = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'] + ([sprite_name] if sprite_name else []) + ['art/' + f.name for f in art_files]
# Security (GHOST_PLAN): cache only this build's own static files. Never cache bungie.net, API calls,
# anything with an Authorization header, or any URL not in ASSETS. Old caches are deleted on activate.
(OUT / 'sw.js').write_text(f'''// Offline cache for hosted copies. The version changes with every build, so updates replace the cache.
const CACHE = 'ghost-{version}';
const ASSETS = {json.dumps(assets)};
const SCOPE = new URL('./', self.registration.scope).pathname;
const PATHS = new Set(ASSETS.map(a => SCOPE + (a === './' ? '' : a)));
// install bypasses the HTTP cache (GitHub Pages sends max-age=600), so a new worker never stores the old page
self.addEventListener('install', e => {{ e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, {{ cache: 'reload' }})))).then(() => self.skipWaiting())); }});
self.addEventListener('activate', e => {{ e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); }});
const PAGE = new Set([SCOPE, SCOPE + 'index.html']);
// this build's static files only. The page itself is network-first (revalidated, so a deploy shows on the next
// open); the cache answers only offline. Art, icons and the manifest are cache-first, refreshed in the background.
self.addEventListener('fetch', e => {{
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || !PATHS.has(u.pathname) || r.headers.has('Authorization')) return;
  e.respondWith(caches.open(CACHE).then(async c => {{
    const hit = await c.match(r, {{ ignoreSearch: true }});
    if (PAGE.has(u.pathname)) {{
      try {{ const res = await fetch(u.pathname, {{ cache: 'no-cache', credentials: 'same-origin' }}); if (res.ok && res.type === 'basic') c.put(r, res.clone()); return res; }}
      catch {{ return hit || Response.error(); }}
    }}
    const net = fetch(r).then(res => {{ if (res.ok && res.type === 'basic') c.put(r, res.clone()); return res; }}).catch(() => hit);
    return hit || net;
  }}));
}});
''', encoding='utf-8', newline='\n')
print(f'[{TARGET}] wrote PWA files (sw version {version})')
print(f'[{TARGET}] wrote {OUT.name}/index.html', len(s.encode('utf-8')), 'bytes')
