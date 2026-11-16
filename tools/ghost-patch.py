"""One-off: applies the Ghost redesign to src/app.html (kept in tools/ as a record of the change)."""
import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()

def rep(a, b, count=1):
    global s
    n = s.count(a)
    assert n == count, f'expected {count}, found {n}: {a[:90]!r}'
    s = s.replace(a, b)

# ---------------- head ----------------
rep('<html lang="en">', '<html lang="en" data-theme="dusk">')
rep('<meta name="theme-color" content="#18191a">', '<meta name="theme-color" content="#170f1c">')
rep('<title>Vault Sorter</title>', '<title>Ghost</title>')
rep('<link rel="preconnect" href="https://fonts.googleapis.com">\n', '')
rep('<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">\n', '')

# ---------------- neutral colours in the old CSS -> theme tokens ----------------
css_start = s.index('<style>') + len('<style>')
css_end = s.index('</style>')
css = s[css_start:css_end]
KEEP = {'#fff', '#ffffff', '#000', '#000000'}
def tok(m):
    h = m.group(0)
    if h.lower() in KEEP: return h
    x = h[1:]
    if len(x) == 3: x = ''.join(c * 2 for c in x)
    r, g, b = (int(x[i:i + 2], 16) for i in (0, 2, 4))
    mx, mn = max(r, g, b), min(r, g, b)
    sat = (mx - mn) / mx if mx else 0
    v = mx / 255
    if h.lower() == '#f0c27b': return 'var(--accent)'
    if sat > 0.28 and v > 0.25: return h            # element, rarity and state colours stay
    for lim, t in ((.095, '--well'), (.125, '--panel'), (.16, '--panel2'), (.21, '--raise'), (.3, '--line'), (.45, '--line2'), (.6, '--faint'), (.82, '--dim')):
        if v < lim: return f'var({t})'
    return 'var(--text)'
lines = css.split('\n')
out = []
for ln in lines:
    if ln.lstrip().startswith(':root{') or ln.lstrip().startswith('--'):
        out.append(ln); continue
    out.append(re.sub(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b', tok, ln))
css = '\n'.join(out)
s = s[:css_start] + '\n/*__FONTS__*/' + css + '/*__GHOST_CSS__*/\n' + s[css_end:]

# ---------------- markup ----------------
SIG = '<svg class="sig" viewBox="0 0 48 48" aria-hidden="true"><use href="#g-ghost"/></svg>'
rep('<body>\n<div id="app">',
    '<body>\n<svg width="0" height="0" style="position:absolute" aria-hidden="true">'
    '<symbol id="g-ghost" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="24" cy="24" r="21"/><path d="M24 8 39 34H9Z"/><path d="M24 17 31 30H17Z" opacity=".6"/><circle cx="24" cy="25.5" r="2.4" fill="currentColor"/></symbol>'
    '</svg>\n<div id="app">')
rep('    <div class="brand h"><span class="logo">◇</span> Vault <b>Sorter</b></div>',
    f'    <div class="brand">{SIG}<span class="word">GHOST</span></div>')
nav_old = s[s.index('    <nav class="views">'):s.index('</nav>', s.index('    <nav class="views">')) + len('</nav>')]
nav_new = ('    <nav class="views">'
  '<button data-view="vault" class="on"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 4h16v16H4zM4 10h16M10 10v10M15 10v10"/></svg><span>Vault</span></button>'
  '<button data-view="clean"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M12 3 21 19H3Z"/><path d="M12 9v6M9 13h6"/></svg><span>Clean up</span></button>'
  '<button data-view="compare"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 20V9a4 4 0 0 1 8 0v11M13 20V9a4 4 0 0 1 8 0v11M2 20h20"/></svg><span>Compare <i id="cmpN"></i></span></button>'
  '<button data-view="subv"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="12" cy="12" r="9"/><path d="M12 5 18 16H6Z"/><circle cx="12" cy="13" r="1.4"/></svg><span>Subclasses</span></button>'
  '</nav>')
rep(nav_old, nav_new)
rep('    <button class="btn mmenu" id="bMenu" aria-label="Menu">⋯<i class="mdot" id="mDot"></i></button>\n  </header>',
    '    <button class="btn mmenu" id="bMenu" aria-label="Menu">⋯<i class="mdot" id="mDot"></i></button>\n'
    '    <div class="rail-foot"><div class="wpick" id="wpick" role="group" aria-label="Colour theme"></div><div class="wrow"><span id="wname"></span><button id="bMotion" type="button"></button></div></div>\n  </header>')
rep('  <div id="banner"></div>\n  <div id="paneChips"></div>\n  <div id="panes"></div>\n</div>',
    '  <div id="main">\n  <div id="banner"></div>\n'
    '  <section class="scene" id="vscene"><div><h1 class="title lw">Vault</h1><p class="sum" id="vsum"></p></div><span class="credit">Art: Bungie, Inc.</span></section>\n'
    '  <div id="paneChips"></div>\n  <div id="panes"></div>\n  </div>\n</div>')
rep('<div id="toast"></div>',
    '<div id="toast"></div>\n<div id="tip" aria-hidden="true"></div>\n'
    f'<div id="intro" aria-hidden="true">{SIG.replace(chr(34) + "sig" + chr(34), chr(34) + "sig" + chr(34))}<span>GHOST</span></div>')

# ---------------- JS: themes, motion, Bungie item art, helpers ----------------
rep("const SH = h => Core.sanitizeHtml(h);",
r"""const SH = h => Core.sanitizeHtml(h);
// ---------- Ghost: colour worlds (from the inspo set), motion preference, intro ----------
const WORLDS = [['dusk', 'Dusk', '#2b1e33', '#f2a65a'], ['oxblood', 'Oxblood', '#331618', '#ddb167'], ['gilded', 'Gilded', '#231c13', '#e2b552'], ['nebula', 'Nebula', '#251a42', '#ff8f5e'], ['abyss', 'Abyss', '#10282c', '#d9b75e'], ['verdant', 'Verdant', '#17281a', '#a6e84a'], ['bone', 'Bone & Sepia', '#ebe4d6', '#a25a16']];
const UI = { theme: 'dusk', motion: true };
try { const t = localStorage.getItem('vs:theme'); UI.theme = WORLDS.some(w => w[0] === t) ? t : (matchMedia('(prefers-color-scheme: light)').matches ? 'bone' : 'dusk'); UI.motion = localStorage.getItem('vs:motion') !== 'off'; } catch {}
function applyUI() {
  document.documentElement.dataset.theme = UI.theme; document.documentElement.dataset.motion = UI.motion ? 'on' : 'off';
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#170f1c';
  const wp = document.getElementById('wpick'); if (wp) wp.innerHTML = worldButtons();
  const wn = document.getElementById('wname'); if (wn) wn.textContent = (WORLDS.find(w => w[0] === UI.theme) || WORLDS[0])[1];
  const bm = document.getElementById('bMotion'); if (bm) { bm.textContent = UI.motion ? 'Motion on' : 'Motion off'; bm.setAttribute('aria-pressed', UI.motion); }
}
const worldButtons = () => WORLDS.map(([k, l, a, b]) => `<button type="button" data-world="${k}" title="${esc(l)}" aria-label="${esc(l)} theme" aria-pressed="${k === UI.theme}" style="--sw1:${a};--sw2:${b}"></button>`).join('');
document.addEventListener('click', e => {
  const w = e.target.closest('[data-world]'); if (w) { UI.theme = w.dataset.world; try { localStorage.setItem('vs:theme', UI.theme); } catch {} applyUI(); return; }
  if (e.target.closest('#bMotion,[data-motion-toggle]')) { UI.motion = !UI.motion; try { localStorage.setItem('vs:motion', UI.motion ? 'on' : 'off'); } catch {} applyUI(); }
});
applyUI();
const motionOK = () => UI.motion && !matchMedia('(prefers-reduced-motion: reduce)').matches;
(() => { const intro = document.getElementById('intro'); if (!intro) return; let seen = false; try { seen = !!sessionStorage.getItem('ghost-intro'); sessionStorage.setItem('ghost-intro', '1'); } catch {} if (seen || !motionOK()) intro.remove(); else setTimeout(() => intro.remove(), 1800); })();
// pointer light on holo surfaces (one listener, rAF-throttled)
let plRaf = 0;
document.addEventListener('pointermove', e => { if (plRaf) return; plRaf = requestAnimationFrame(() => { plRaf = 0; const h = e.target.closest?.('.pane,.tile'); if (!h) return; const r = h.getBoundingClientRect(); h.style.setProperty('--mx', (e.clientX - r.left) + 'px'); h.style.setProperty('--my', (e.clientY - r.top) + 'px'); }); }, { passive: true });
// a ring of Light where a tag button was pressed
document.addEventListener('click', e => { const b = e.target.closest('.tagbtn'); if (!b || !motionOK()) return; const r = b.getBoundingClientRect(); const i = document.createElement('i'); i.className = 'burst'; i.style.setProperty('--bx', (e.clientX - r.left) + 'px'); i.style.setProperty('--by', (e.clientY - r.top) + 'px'); b.appendChild(i); setTimeout(() => i.remove(), 600); });
const lightWrite = el => { if (!el) return; el.classList.remove('lw'); void el.offsetWidth; el.classList.add('lw'); };
// Bungie item icons / screenshots: hosted build only (the claude.ai artifact's CSP blocks bungie.net)
const ART = window.VS_ART || null;
const BNG = 'https://www.bungie.net/common/destiny2_content/';
const CAN_BNG = !!ART && !/claude\.ai|claudeusercontent/.test(location.hostname);
function itemArt(it) {
  const a = CAN_BNG && /^\d{1,12}$/.test(it.hash) ? ART.i?.[it.hash] : null; if (!a) return null;
  const icon = /^[0-9a-f]{32}(\.png)?$/.test(a[0]) ? BNG + 'icons/' + a[0] + (a[0].endsWith('.png') ? '' : '.jpg') : '';
  const wmName = a[1] >= 0 ? ART.wm?.[a[1]] : ''; const wm = /^[0-9a-f]{32}\.(png|jpg)$/.test(wmName || '') ? BNG + 'icons/' + wmName : '';
  const shot = a[2] === 1 ? BNG + 'screenshots/' + it.hash + '.jpg' : (typeof a[2] === 'string' && /^[\w.-]+\.(jpg|png)$/.test(a[2]) ? BNG + 'screenshots/' + a[2] : '');
  return icon ? { icon, wm, shot } : null;
}
function itemIcon(it, size = 48) {
  const a = itemArt(it); const sk = Core.sockets(it, D); const intr = (sk.intrinsic[0] || sk.exotic[0])?.n || it.frame;
  return `<span class="itm" style="--is:${size}px">${a ? `<img src="${esc(a.icon)}" alt="" loading="lazy" decoding="async">${a.wm ? `<img class="wm" src="${esc(a.wm)}" alt="" loading="lazy" decoding="async">` : ''}` : (intr ? plugIcon(intr, 'sq', pIdx(intr, it.kind)) : '')}${it.kind === 'weapon' && it.element ? elIcon(it.element, 'eli') : ''}${it.crafted ? '<i class="cr"></i>' : ''}</span>`;
}
const GILT_EXOTICS = []; // item hashes; filled after the exotic review with the user""")

rep("function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block';",
    "function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');")

# header summary sentence in the Vault scene
rep("  const md = $('#mDot'); if (md) md.style.display = n ? 'block' : 'none';\n}",
    "  const md = $('#mDot'); if (md) md.style.display = n ? 'block' : 'none';\n"
    "  const vs = $('#vsum'); if (vs) { const dupes = S.items.length ? Core.runQuery(Core.parseQuery('is:dupe'), S.items, S.ctx || Core.buildCtx(S.items, S.edits, D)).size : 0; vs.innerHTML = S.items.length ? `${S.weapons.length} weapons, ${S.armor.length} armor.${dupes ? ` <b>${dupes} duplicates</b> worth a look` : ''}${n ? `${dupes ? ' and' : ''} <b>${n} change${n > 1 ? 's' : ''}</b> waiting for DIM` : ''}${dupes || n ? '.' : ''}` : 'Load your DIM spreadsheets to begin.'; }\n}")

# views: right of the rail on desktop, under the header on phones
rep("  const hh = document.querySelector('header').offsetHeight + ($('#banner').offsetHeight || 0);\n  for (const id of ['subv', 'clean', 'compare']) { const el = $('#' + id); el.style.top = hh + 'px'; el.classList.toggle('open', v === id); }",
    "  placeViews();\n  for (const id of ['subv', 'clean', 'compare']) $('#' + id).classList.toggle('open', v === id);\n  lightWrite(document.querySelector(v === 'vault' ? '#vscene .title' : `#${v} .band h1, #${v} .svt`));")
rep("const placeViews = () => { const hh = document.querySelector('header').offsetHeight + ($('#banner').offsetHeight || 0); for (const id of ['subv', 'clean', 'compare']) $('#' + id).style.top = hh + 'px'; };",
    "const placeViews = () => { const hh = isMobile() ? document.querySelector('header').offsetHeight + ($('#banner').offsetHeight || 0) : ($('#banner').offsetHeight || 0); for (const id of ['subv', 'clean', 'compare']) $('#' + id).style.top = hh + 'px'; };")

# ---------------- item rows ----------------
rep("  if (it.tag) sub.push(F('tag', `${TAG_ICON[it.tag] || ''} ${esc(TAG_LABEL[it.tag] || it.tag)}`));\n", "")
rep("""  const showRating = it.kind === 'weapon' && (hits.has('rating') || ['rating', 'pve', 'pvp'].includes(sortKey));
  const rating = showRating ? `<span class="rate f${H('rating')}" style="color:${rateColor(it.rating)}" title="${it.rating == null ? 'No light.gg data yet' : `Perk rating ${it.rating}/100 · light.gg PvE ${it.pve ?? '–'}★ PvP ${it.pvp ?? '–'}★`}">${it.rating ?? '–'}</span>` : '';""",
"""  const showRating = it.kind === 'weapon' && (hits.has('rating') || ['rating', 'pve', 'pvp'].includes(sortKey));
  const rating = showRating ? `<span class="rate f${H('rating')}" title="${it.rating == null ? 'No light.gg data yet' : `Perk rating ${it.rating}/100 · light.gg PvE ${it.pve ?? '–'}★ PvP ${it.pvp ?? '–'}★`}">${it.rating ?? '–'}<span class="rbar" style="--v:${it.rating ?? 0}%;--mc:${rateColor(it.rating)}"><i></i></span></span>` : '';
  // identity strip: intrinsic + every equipped perk as icons; search hits light up in the pane colour
  const strip = [...sk.intrinsic, ...sk.exotic].map(p => ({ ...p, s: 1, sq: 1 })).concat(sk.cols.flatMap(c => c.perks.filter(p => p.s)));
  const stripHtml = strip.length ? `<div class="pstrip">${strip.map(p => `<span class="${hits.has('perk:' + p.n) ? 'on' : ''}" data-pk="${esc(p.n)}" title="${esc(p.n)}">${plugIcon(p.n, p.sq ? 'sq' : '', pIdx(p.n, it.kind))}</span>`).join('')}</div>` : '';""")
rep("""  return `<div class="card" data-id="${esc(it.id)}" style="--rc:${rarityColor(it.rarity)}">${pend}
    <div class="top"><span class="tagi f${H('tag')}" title="Tag: ${esc(it.tag || 'none')}">${TAG_ICON[it.tag] ?? ''}</span>
      <span class="nm f${H('name')}">${esc(it.name)}</span><span class="others">${others}</span>${rating}</div>
    <div class="sub">${sub.join('')}</div>
    ${perkHtml}
    ${statHtml ? `<div class="stats">${statHtml}</div>` : ''}
    ${it.notes ? `<div class="note f${H('notes')}">${esc(it.notes)}</div>` : ''}
  </div>`;""",
"""  const el = it.kind === 'weapon' && it.element ? elColor(it.element) : '';
  return `<div class="card" data-id="${esc(it.id)}"${el && el !== 'transparent' ? ` data-el="1"` : ''} style="--rc:${rarityColor(it.rarity)};--el:${el || 'transparent'}">${pend}
    ${itemIcon(it)}
    <div class="cmain">
      <div class="top"><span class="nm f${H('name')}">${esc(it.name)}</span>${it.tag ? `<span class="tagi f${H('tag')}" title="Tag: ${esc(TAG_LABEL[it.tag] || it.tag)}">${TAG_ICON[it.tag] || ''} ${esc(TAG_LABEL[it.tag] || it.tag)}</span>` : ''}<span class="grow"></span><span class="others">${others}</span>${rating}</div>
      <div class="sub">${sub.join('')}</div>
      ${stripHtml}
      ${perkHtml}
      ${statHtml ? `<div class="stats">${statHtml}</div>` : ''}
      ${it.notes ? `<div class="note f${H('notes')}">${esc(it.notes)}</div>` : ''}
    </div>
  </div>`;""")
# card perk names: only the searched ones (the strip already shows every equipped perk as an icon)
rep("  [...sk.intrinsic, ...sk.exotic].forEach(p => parts.push(`<div class=\"sk-col\">${skHtml({ ...p, s: 1 }, it, hits, { sq: true })}</div>`));\n  const hitPerks",
    "  const hitPerks")

# ---------------- dossier ----------------
rep("""  d.innerHTML = `<div class="d-head" style="--rc:${rarityColor(it.rarity)}">
      <div class="nm">${it.element ? elIcon(it.element, 'ico big') : ''}${esc(it.name)}${it.crafted ? ' ' + CRAFTED_SVG : ''}</div>""",
"""  const art = itemArt(it); const elc = it.element ? elColor(it.element) : '';
  d.style.setProperty('--rc', rarityColor(it.rarity)); d.style.setProperty('--el', elc && elc !== 'transparent' ? elc : rarityColor(it.rarity));
  d.classList.toggle('gilt', GILT_EXOTICS.includes(it.hash));
  const rv = it.kind === 'weapon' && it.rating != null ? it.rating : null;
  d.innerHTML = `<div class="hero">${art?.shot ? `<img class="shot" src="${esc(art.shot)}" alt="" decoding="async">` : ''}
      <div class="hin">${itemIcon(it, 64)}<div style="min-width:0"><div class="stat-pill" style="letter-spacing:.12em;text-transform:uppercase">${esc(it.rarity)} ${esc(it.type)}${it.tier != null ? ' · Tier ' + it.tier : ''}</div></div>
      ${it.kind === 'weapon' ? `<svg class="ring" viewBox="0 0 66 66" style="--d:${rv == null ? 0 : (rv / 100 * 182).toFixed(0)};--mc:${rateColor(rv)}" aria-label="Perk rating ${rv ?? 'not rated'}"><circle class="tr" cx="33" cy="33" r="29"/><circle class="vl" cx="33" cy="33" r="29" transform="rotate(-90 33 33)"/><text x="33" y="40">${rv ?? '–'}</text></svg>` : ''}</div></div>
    <div class="d-head" style="--rc:${rarityColor(it.rarity)}">
      <div class="nm">${esc(it.name)}${it.crafted ? ' ' + CRAFTED_SVG : ''}</div>
      <div class="facts">${it.element ? `<span>${elIcon(it.element)}${esc(it.element)}</span>` : ''}${it.ammo ? `<span>${ammoIcon(it.ammo)}${esc(it.ammo)}</span>` : ''}${Core.anyBreaker(it) ? `<span>${breakerIcon(it.breaker)}${esc(it.breaker)}</span>` : ''}${it.power != null ? `<span>Power ${esc(it.power)}</span>` : ''}${it.set ? `<span>◈ ${esc(it.set)}</span>` : ''}</div>""")
rep("""        <span class="rate" style="font-size:22px;color:${rateColor(it.rating)}">${it.rating ?? '–'}</span>
        <span class="stat-pill">""", """        <span class="stat-pill">""")
rep("function closeDrawer() { $('#drawer').classList.remove('open');",
    "function closeDrawer() { const dr = $('#drawer'); if (dr.classList.contains('open') && !isMobile() && motionOK()) { dr.classList.add('closing'); setTimeout(() => dr.classList.remove('closing'), 230); } dr.classList.remove('open');")

# ---------------- tooltip that follows the cursor ----------------
rep("$('#scrim').onclick = closeDrawer;",
r"""$('#scrim').onclick = closeDrawer;
// in-game style tooltip on item rows (desktop pointer only)
(() => {
  const tip = $('#tip'); let cur = null, timer = 0;
  const fine = () => matchMedia('(hover: hover) and (pointer: fine)').matches && !isMobile();
  document.addEventListener('pointerover', e => {
    const c = e.target.closest?.('.card'); if (c === cur) return; cur = c; clearTimeout(timer); tip.classList.remove('on');
    if (!c || !fine() || $('#drawer').classList.contains('open')) return;
    timer = setTimeout(() => {
      const it = S.byId.get(c.dataset.id); if (!it) return;
      const sk = Core.sockets(it, D); const pane = c.closest('.pane'); const pc = pane ? getComputedStyle(pane).getPropertyValue('--pc') : '';
      const hits = new Set([...c.querySelectorAll('.pstrip .on')].map(x => x.dataset.pk));
      const rows = [...sk.intrinsic, ...sk.exotic].map(p => [p.n, 1]).concat(sk.cols.flatMap(col => col.perks.filter(p => p.s).map(p => [p.n, 0])));
      tip.style.setProperty('--rc', rarityColor(it.rarity));
      tip.innerHTML = `<div class="th"><b>${esc(it.name)}</b><small>${esc(it.rarity)} ${esc(it.type)}</small></div><div class="tb">${rows.map(([n, sq]) => `<div class="${hits.has(n) ? 'hit2' : ''}">${plugIcon(n, sq ? 'sq' : '', pIdx(n, it.kind))}${esc(n)}</div>`).join('')}<div style="color:#b9aeb6;font-size:12px">Click to open</div></div>`;
      tip.classList.add('on');
    }, 320);
  });
  document.addEventListener('pointermove', e => { if (!tip.classList.contains('on')) return; tip.style.left = Math.min(innerWidth - 360, e.clientX + 22) + 'px'; tip.style.top = Math.max(8, Math.min(innerHeight - tip.offsetHeight - 12, e.clientY + 16)) + 'px'; }, { passive: true });
  document.addEventListener('click', () => { clearTimeout(timer); tip.classList.remove('on'); }, true);
})();""")

# ---------------- Clean up: counter + bar for space saved ----------------
rep("""  v.innerHTML = `<div class="band slim"><div class="band-row">
      <div><div class="eyebrow">Clean up · ${kind === 'weapon' ? 'Weapons' : 'Armor'} · group ${CL.gi + 1} of ${G.groups.length}</div>
        <h1>${g.parts.map((x, i) => `<span class="gchip">${chip(keys[i], x)}</span>`).join('<span class="gsep">/</span>')}</h1>""",
"""  const pool = G.groups.reduce((a, gg) => a + gg.items.length, 0);
  v.innerHTML = `<div class="band slim"><div class="band-row">
      <div><h1>Clean up</h1>
        <div class="saved"><b>${counts.trash}</b><span>slots saved</span><div class="sbar"><i style="width:${pool ? (counts.trash / pool * 100).toFixed(1) : 0}%"></i></div></div>
        <div class="gline">${g.parts.map((x, i) => `<span class="gchip">${chip(keys[i], x)}</span>`).join('<span class="gsep">/</span>')}<span class="stat-pill">Group ${CL.gi + 1} of ${G.groups.length} · ${kind === 'weapon' ? 'weapons' : 'armor'}</span></div>""")
rep("""      <div class="band-actions"><span class="tally"><b class="k">${counts.keep}</b> keep · <b class="t">${counts.trash}</b> trash</span>
        <button class="btn" id="clSetup">""", """      <div class="band-actions">
        <button class="btn" id="clSetup">""")
rep("v.querySelectorAll('[data-dec]').forEach(b => b.onclick = e => { e.stopPropagation(); const id = b.closest('.tile').dataset.id; const it = S.byId.get(id); const val = b.dataset.dec;",
    "v.querySelectorAll('[data-dec]').forEach(b => b.onclick = e => { e.stopPropagation(); const id = b.closest('.tile').dataset.id; const it = S.byId.get(id); const val = b.dataset.dec; CL.slam = id;")
rep("""  return `<div class="tile ${d}" data-id="${esc(it.id)}" style="--rc:${rarityColor(it.rarity)}">
    <div class="tile-h"><span class="rank">#${i + 1}</span><span class="tn">${esc(it.name)}</span>${it.crafted ? CRAFTED_SVG : ''}<span class="rv">${rv === -Infinity ? '–' : rv}</span></div>""",
"""  const slam = CL.slam === it.id && motionOK(); if (slam) CL.slam = null;
  return `<div class="tile ${d}" data-id="${esc(it.id)}" style="--rc:${rarityColor(it.rarity)}"><span class="stamp${slam ? ' slam' : ''}">${d === 'keep' ? 'KEEP' : 'TRASH'}</span>
    <div class="tile-h">${itemIcon(it, 44)}<span class="tn">${esc(it.name)}<br><span class="rank">#${i + 1}</span></span><span class="rv">${rv === -Infinity ? '–' : rv}</span></div>""")

# ---------------- Subclasses: Bungie's subclass art ----------------
rep("""  v.innerHTML = `<div class="sv-head"><div class="h">Subclasses</div>""",
"""  const fileEl = SV.el === 'prism' ? 'prismatic' : SV.el;
  const ecol = { solar: 'var(--solar)', arc: 'var(--arc)', void: 'var(--void)', stasis: 'var(--stasis)', strand: 'var(--strand)', prism: 'var(--prismatic)' }[SV.el] || 'var(--light)';
  v.style.setProperty('--ec', ecol);
  v.innerHTML = `<div class="sv-head" style="--art:url('art/sub-${['warlock', 'titan', 'hunter'].includes(SV.cls) ? SV.cls : 'warlock'}-${['solar', 'arc', 'void', 'stasis', 'strand', 'prismatic'].includes(fileEl) ? fileEl : 'solar'}.webp')"><div class="svt"><h1 class="title lw">${esc(sc?.n || 'Subclasses')}</h1><p class="sum">${esc(SV.cls[0].toUpperCase() + SV.cls.slice(1))} · <b>${esc((SV_ELS.find(x => x[0] === SV.el) || [, ''])[1])}</b></p></div><div class="h">Subclasses</div>""")

# ---------------- ⋯ menu on phones: name + themes ----------------
rep("  modal(`<h2>Vault Sorter</h2><p class=\"stat-pill\">${esc($('#summary').textContent)}</p>",
    "  modal(`<h2>Ghost</h2><p class=\"stat-pill\">${esc($('#summary').textContent)}</p>\n    <div class=\"wrow\" style=\"margin:10px 0 4px\"><span>Theme</span><button type=\"button\" data-motion-toggle>${UI.motion ? 'Motion on' : 'Motion off'}</button></div><div class=\"wpick\" style=\"margin-bottom:6px\">${worldButtons()}</div>")

open(p, 'w', encoding='utf-8').write(s)
print('patched')
