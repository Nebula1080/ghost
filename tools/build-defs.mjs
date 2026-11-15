// Builds data/defs.json (inlined into the page by build.py).
// Usage: node --max-old-space-size=6000 tools/build-defs.mjs [--refresh]
//   --refresh  re-download everything (otherwise cached files in data/raw are reused)
// Sources:
//   Bungie manifest (no API key): items, breakers, damage types, armor sets, sandbox perks, artifact
//   Clarity live DB: github.com/Database-Clarity/Live-Clarity-Database (descriptions/clarity.json)
//   Destiny Data Compendium (Google Sheet by Pip1n): each tab's public "htmlview" page, so the
//   sheet's own text colors / bold / italics are kept (see tools/compendium-html.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSheetHtml, STYLES } from './compendium-html.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(root, 'data/raw');
const refresh = process.argv.includes('--refresh');
for (const d of ['compendium-html', 'icons']) fs.mkdirSync(path.join(RAW, d), { recursive: true });

const B = 'https://www.bungie.net';
const SHEET = '1WaxvbLx7UoSZaBqdFr1u32F2uWVLo-CJunJB4nlGUE4';
// tab -> gid, in lookup priority order (first tab that defines a name wins)
const TABS = {
  'weapon-perks': 1662574278, 'exotic-weapons': 441434520, 'exotic-class': 20898389, 'exotic-armors': 1500097863,
  'armor-perks': 1287885342, 'armor-mods': 1934379638, 'artifact-perks': 473308249,
  arc: 618967225, solar: 1186062409, void: 1907852650, stasis: 1088259962, strand: 1870531554, prismatic: 1918152785,
  'class-abilities': 527596209, 'game-mechanics': 1800463143,
};
const TAB_LABEL = { 'weapon-perks': 'Weapon Perks', 'exotic-weapons': 'Exotic Weapons', 'exotic-class': 'Exotic Class Items', 'exotic-armors': 'Exotic Armor', 'armor-perks': 'Armor Set Bonuses', 'armor-mods': 'Armor Mods', 'artifact-perks': 'Artifact Perks', arc: 'Arc', solar: 'Solar', void: 'Void', stasis: 'Stasis', strand: 'Strand', prismatic: 'Prismatic', 'class-abilities': 'Class Abilities', 'game-mechanics': 'Game Mechanics' };
const CLARITY = 'https://raw.githubusercontent.com/Database-Clarity/Live-Clarity-Database/live/descriptions/clarity.json';

async function cached(file, url, binary = false) {
  const p = path.join(RAW, file);
  if (!refresh && fs.existsSync(p) && fs.statSync(p).size > 0) return binary ? fs.readFileSync(p) : fs.readFileSync(p, 'utf8');
  const res = await fetch(url, { headers: { 'User-Agent': 'vault-sorter-defs/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(p, buf);
  console.log('downloaded', file, buf.length, 'bytes');
  return binary ? buf : buf.toString('utf8');
}
const norm = s => String(s ?? '').toLowerCase().replace(/^enhanced\s+/, '').replace(/[^a-z0-9]/g, '');
const dataUri = (buf, mime = 'image/png') => `data:${mime};base64,${buf.toString('base64')}`;
const iconTail = p => (p || '').match(/\/common\/destiny2_content\/icons\/(.+)$/)?.[1] || '';
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Bungie manifest ----------
const manifest = JSON.parse(await cached('manifest.json', B + '/Platform/Destiny2/Manifest/'));
const P = manifest.Response.jsonWorldComponentContentPaths.en;
const items = JSON.parse(await cached('items.json', B + P.DestinyInventoryItemDefinition));
const breakerDefs = JSON.parse(await cached('breakers.json', B + P.DestinyBreakerTypeDefinition));
const damageDefs = JSON.parse(await cached('damage.json', B + P.DestinyDamageTypeDefinition));
const setDefs = JSON.parse(await cached('sets.json', B + P.DestinyEquipableItemSetDefinition));
const perkDefs = JSON.parse(await cached('sandboxperks.json', B + P.DestinySandboxPerkDefinition));
const artifactDefs = JSON.parse(await cached('artifacts.json', B + P.DestinyArtifactDefinition));
const name = it => it?.displayProperties?.name || '';
// Bungie description, falling back to the item's first sandbox perk (aspects, set perks, many mods)
const bungieDesc = it => (it?.displayProperties?.description || '').trim() || (it?.perks || []).map(p => perkDefs[p.perkHash]?.displayProperties?.description).find(Boolean) || '';

const icons = {};
for (const v of Object.values(breakerDefs)) icons['breaker-' + v.enumValue] = dataUri(await cached(`icons/breaker-${v.enumValue}.png`, B + v.displayProperties.icon, true));
for (const v of Object.values(damageDefs)) {
  if (!v.displayProperties?.icon || !v.displayProperties.name) continue;
  const n = v.displayProperties.name.toLowerCase();
  icons['el-' + n] = dataUri(await cached(`icons/el-${n}.png`, B + v.displayProperties.icon, true));
}
for (const [k, n] of [[1, 'primary'], [2, 'special'], [3, 'heavy']]) icons['ammo-' + k] = dataUri(await cached(`icons/${n}.png`, `${B}/img/destiny_content/ammo_types/${n}.png`, true));
const breakers = Object.fromEntries(Object.values(breakerDefs).map(v => [v.enumValue, v.displayProperties.name]));

// ---------- breakers ----------
// 1 Shield Piercing (Barrier), 2 Disruption (Overload), 3 Stagger (Unstoppable).
// Since Update 9.7.0 every weapon has an intrinsic breaker. Bungie stores it as a sandbox perk named
// "[Shield-Piercing] Barrier" / "[Disruption] Overload" / "[Stagger] Unstoppable" on the weapon's intrinsic
// (frame) plug. Read it from there: the weapon's own perks, its initial intrinsic plug, or the first plug of the
// intrinsic socket's plug set; then Bungie's legacy breakerType; then another copy of the same weapon.
const plugSets = JSON.parse(await cached('plugsets.json', B + P.DestinyPlugSetDefinition));
const champPerk = {};
for (const p of Object.values(perkDefs)) { const m = name(p).match(/^\[(Shield-Piercing|Disruption|Stagger)\] (Barrier|Overload|Unstoppable)$/); if (m) champPerk[p.hash] = { 'Shield-Piercing': 1, Disruption: 2, Stagger: 3 }[m[1]]; }
const plugBreaker = pl => { const hit = (pl?.perks || []).find(x => champPerk[x.perkHash]); return hit ? champPerk[hit.perkHash] : 0; };
const wb = {}, wa = {}, fbAll = {};
for (const it of Object.values(items)) {
  if (it.itemType !== 3) continue;
  if (it.equippingBlock?.ammoType) wa[it.hash] = it.equippingBlock.ammoType;
  let b = plugBreaker(it);
  for (const se of it.sockets?.socketEntries || []) {
    if (b) break;
    const pl = items[se.singleInitialItemHash];
    b = plugBreaker(pl);
    if (b && pl?.plug?.plugCategoryIdentifier === 'intrinsics') (fbAll[norm(name(pl))] ||= new Set()).add(b);
    if (!b) { const set = plugSets[se.reusablePlugSetHash || se.randomizedPlugSetHash]; for (const q of set?.reusablePlugItems || []) { b = plugBreaker(items[q.plugItemHash]); if (b) break; } }
  }
  if (!b && it.breakerType > 0) b = it.breakerType;
  if (b) wb[it.hash] = b;
}
// fill copies of a weapon that lack the perk (e.g. an older Legend of Acrius) from another copy with the same name
const byName = {};
for (const [h, b] of Object.entries(wb)) (byName[norm(name(items[h]))] ||= new Set()).add(b);
for (const it of Object.values(items)) if (it.itemType === 3 && !wb[it.hash]) { const s = byName[norm(name(it))]; if (s?.size === 1) wb[it.hash] = [...s][0]; }
// intrinsic name -> breaker, only where every weapon with that intrinsic agrees (fallback for hashes not in this snapshot)
const fb = {};
for (const [k, s] of Object.entries(fbAll)) if (s.size === 1) fb[k] = [...s][0];
const artifact = Object.values(artifactDefs).sort((a, b) => b.index - a.index)[0];

// ---------- plugs: icon, socket type, Bungie description ----------
// socket type codes for the game-style layout: i intrinsic, b barrel-like, m magazine-like, t trait,
// o origin, w weapon mod, k masterwork, c catalyst, a armor mod, x exotic armor perk
function plugType(cat) {
  if (/confetti|kill_vfx|flair/i.test(cat)) return ''; // Combat Flair: cosmetic, hidden like shaders
  if (cat === 'intrinsics') return 'i';
  if (cat === 'armor_archetypes') return 'r';
  if (cat === 'frames') return 't';
  if (cat === 'origins') return 'o';
  if (/^(barrels|scopes|tubes|arrows|hafts|blades|bowstrings)$/.test(cat)) return 'b';
  if (/^(magazines.*|batteries|guards|grips|stocks)$/.test(cat)) return 'm';
  if (/weapon\.mod_|^v\d+\.weapon\.mod|weapon_tiering\.plugs\.mods|crafting\.plugs\.weapons\.mods/.test(cat)) return 'w';
  if (/masterworks?\.(stat|generic\.weapons)|exotic\.weapon\.masterwork|_masterwork$/.test(cat)) return 'k';
  if (cat === 'catalysts') return 'c';
  if (/^enhancements\./.test(cat)) return 'a';
  return '';
}
// pi: normName -> [iconTail, typeCode, bungieDescription, hash]. Names used by both sides (e.g. "Demolitionist" is a
// weapon trait and an armor archetype) also get a side-specific entry in pw (weapons) / pa (armor).
const pi = {}, pw = {}, pa = {};
const pref = it => (/^Enhanced/.test(it.itemTypeDisplayName || '') ? 1 : 0);
const sideOf = (cat, ty) => (ty === 'r' || ty === 'a' || /armor/.test(cat)) ? 'a' : (ty === 'i' ? 'both' : 'w');
for (const it of Object.values(items).filter(it => it.plug && name(it) && it.displayProperties?.hasIcon).sort((a, b) => pref(a) - pref(b))) {
  const cat = it.plug.plugCategoryIdentifier; const ty = plugType(cat); if (!ty) continue;
  const k = norm(name(it)); const entry = [iconTail(it.displayProperties.icon), ty, bungieDesc(it).slice(0, 600), it.hash];
  const side = sideOf(cat, ty);
  if ((side === 'w' || side === 'both') && !pw[k]) pw[k] = entry;
  if ((side === 'a' || side === 'both') && !pa[k]) pa[k] = entry;
}
for (const k of new Set([...Object.keys(pw), ...Object.keys(pa)])) pi[k] = pw[k] || pa[k];
// keep only the side entries that differ from pi (the rest would just duplicate it)
for (const m of [pw, pa]) for (const k of Object.keys(m)) if (m[k] === pi[k]) delete m[k];

// cosmetic sockets to hide (shaders, ornaments / "skins", trackers, mementos): normalized names
const cos = new Set();
for (const it of Object.values(items)) {
  if (!it.plug || !name(it)) continue;
  const cat = it.plug.plugCategoryIdentifier || '';
  if (/^shader$|skins|ornament|transmog|^v\d+\.weapon\.mementos|trackers|holofoil|kill_vfx|confetti|combat_flair/i.test(cat) || /^(Shader|.*Ornament|Combat Flair)$/i.test(it.itemTypeDisplayName || '')) {
    const k = norm(name(it)); if (!pi[k]) cos.add(k);
  }
}

// ---------- armor sets ----------
const sets = [], setIdx = {}, as = {};
for (const s of Object.values(setDefs)) {
  if (!name(s)) continue;
  setIdx[s.hash] = sets.length;
  sets.push({ n: name(s), p: (s.setPerks || []).map(p => { const d = perkDefs[p.sandboxPerkHash]?.displayProperties || {}; return { c: p.requiredSetCount, n: d.name || '', d: d.description || '', i: iconTail(d.icon) }; }) });
}
for (const it of Object.values(items)) {
  const sh = it.itemType === 2 && it.equippingBlock?.equipableItemSetHash;
  if (sh && setIdx[sh] !== undefined) as[it.hash] = setIdx[sh];
}

// ---------- subclasses ----------
const CLASSES = { 0: 'titan', 1: 'hunter', 2: 'warlock' };
const SUBCLASS_EL = { Dawnblade: 'solar', Stormcaller: 'arc', Voidwalker: 'void', Shadebinder: 'stasis', Broodweaver: 'strand', 'Prismatic Warlock': 'prism', Gunslinger: 'solar', Arcstrider: 'arc', Nightstalker: 'void', Revenant: 'stasis', Threadrunner: 'strand', 'Prismatic Hunter': 'prism', Sunbreaker: 'solar', Striker: 'arc', Sentinel: 'void', Behemoth: 'stasis', Berserker: 'strand', 'Prismatic Titan': 'prism' };
const plugsByCat = {};
for (const it of Object.values(items)) if (it.plug && name(it)) (plugsByCat[it.plug.plugCategoryIdentifier] ||= []).push(it);
function subPlugs(cats) {
  const seen = new Set(), out = [];
  for (const c of cats) for (const it of plugsByCat[c] || []) {
    const n = name(it); const k = norm(n);
    if (!n || /^(empty|locked|default)\b/i.test(n) || seen.has(k) || !it.displayProperties.hasIcon || it.redacted) continue;
    seen.add(k); out.push({ h: it.hash, n, i: iconTail(it.displayProperties.icon), d: bungieDesc(it) });
  }
  return out;
}
const sub = {};
for (const sc of Object.values(items).filter(x => x.itemType === 16 && x.sockets && SUBCLASS_EL[name(x)])) {
  const cls = CLASSES[sc.classType]; const el = SUBCLASS_EL[name(sc)]; if (!cls) continue;
  const S = (k) => `${cls}.${el}.${k}`, SH = (k) => `shared.${el}.${k}`;
  sub[cls] ||= {};
  sub[cls][el] = {
    n: name(sc), h: sc.hash, i: iconTail(sc.displayProperties.icon),
    s: {
      super: subPlugs([S('supers')]),
      classAbility: subPlugs([S('class_abilities')]),
      movement: subPlugs([S('movement')]),
      melee: subPlugs([S('melee')]),
      grenade: subPlugs([S('grenades'), SH('grenades'), S('prism_grenade')]),
      aspects: subPlugs([S('aspects'), S('totems')]),
      fragments: subPlugs([SH('fragments'), SH('trinkets')]),
      transcendence: subPlugs([S('transcendence')]),
    },
  };
}

// ---------- Clarity (rendered to HTML with Clarity's own color classes) ----------
const clarity = JSON.parse(await cached('clarity.json', CLARITY));
const CL_CLASS = /^(pve|pvp|enhancedArrow|primary|special|heavy|kinetic|arc|solar|void|stasis|strand|yellow|blue|green|purple|bold|barrier|overload|unstoppable|title|hunter|titan|warlock)$/;
function clarityHtml(e) {
  const out = [];
  for (const l of e.descriptions?.en || []) {
    const lc = (l.classNames || []).filter(c => CL_CLASS.test(c));
    if ((l.classNames || []).includes('spacer')) { out.push('<div class="cl-sp"></div>'); continue; }
    const body = (l.linesContent || []).map(c => {
      const cc = (c.classNames || []).filter(x => CL_CLASS.test(x)).map(x => 'cl-' + x);
      const t = escHtml(c.text || '');
      if (!t) return '';
      const tip = c.title ? ` title="${escHtml(typeof c.title === 'string' ? c.title : (c.title?.en || []).map(x => (x.linesContent || []).map(y => y.text).join('')).join('\n'))}"` : '';
      return cc.length || tip ? `<span class="${cc.join(' ')}"${tip}>${t}</span>` : t;
    }).join('');
    if (body.trim()) out.push(`<div${lc.length ? ` class="${lc.map(c => 'cl-' + c).join(' ')}"` : ''}>${body}</div>`);
  }
  return out.join('').replace(/^(<div class="cl-sp"><\/div>)+|(<div class="cl-sp"><\/div>)+$/g, '');
}
const cl = {}; // normName -> { h, ty, e?: enhanced html }
for (const e of Object.values(clarity).sort((a, b) => /Enhanced/.test(a.type) - /Enhanced/.test(b.type))) {
  const k = norm(e.name); const h = clarityHtml(e);
  if (!h) continue;
  if (!cl[k]) cl[k] = { h, ty: e.type };
  else if (/Enhanced/.test(e.type) && !cl[k].e) cl[k].e = h;
}

// ---------- Destiny Data Compendium (formatted) ----------
const dc = {};      // normName -> { h: html, s: tab label }
const dcx = {};     // exotic weapon name -> html
const dset = {};    // armor set name -> { src, p: { pieceCount: [perkName, html] } }
const cleanName = t => t.split('\n')[0].replace(/^↑\s*/, '').replace(/\s*\[[^\]]*energy[^\]]*\]\s*$/i, '').trim();
const isName = c => c.text && c.text.length <= 70 && !/[:.]$/.test(c.text.split('\n')[0]) && c.text.split('\n')[0].length <= 45;
const isDesc = c => c.text && (c.text.length > 25 || c.text.includes('\n'));
function add(k, h, s) { if (k && h && !dc[k]) dc[k] = { h, s }; }
for (const [tab, gid] of Object.entries(TABS)) {
  const html = await cached(`compendium-html/${tab}.html`, `https://docs.google.com/spreadsheets/d/${SHEET}/htmlview/sheet?headers=false&gid=${gid}`);
  const rows = parseSheetHtml(html);
  const label = TAB_LABEL[tab];
  if (tab === 'armor-perks') {
    let cur = null;
    for (const r of rows) {
      const t = r.filter(c => c.text);
      if (t.length >= 2 && isName(t[0]) && !/piece/i.test(t[0].text)) { const lines = t[0].text.split('\n').filter(Boolean); cur = { n: lines[0], src: lines.slice(1).join(' · ') }; dset[norm(cur.n)] = { n: cur.n, src: cur.src, p: {} }; }
      for (const c of t) {
        const m = c.text.match(/^(\d)\s*Piece\s*\|\s*([^\n]+)/i);
        if (m && cur) { const body = c.html.replace(/^[\s\S]*?<br>/, ''); dset[norm(cur.n)].p[m[1]] = [m[2].trim(), body]; add(norm(m[2]), body, `${label} · ${cur.n} (${m[1]}-piece)`); }
      }
    }
    continue;
  }
  if (tab === 'exotic-weapons') {
    for (const r of rows) for (let i = 0; i < r.length; i++) {
      const c = r[i]; if (!c.text.includes('\n') || c.text.length > 140) continue;
      const doc = r.slice(i + 1, i + 5).find(x => x.text.length > 60); if (!doc) continue;
      const lines = c.text.split('\n').map(s => s.trim()).filter(Boolean);
      dcx[norm(lines[0])] = doc.html;
      for (const p of lines.slice(1)) { const k = norm(p.replace(/^↑/, '')); if (k && !dc[k]) dc[k] = { x: norm(lines[0]), s: `${label} · ${lines[0]}` }; }
    }
    continue;
  }
  if (tab === 'exotic-armors') {
    // rows alternate: [armor, icon, notes] x3 classes, then a row with the 3 exotic perk names
    let prev = null;
    for (const r of rows) {
      const t = r.filter(c => c.text);
      const descs = [];
      for (let i = 0; i < r.length; i++) if (isName(r[i]) && r.slice(i + 1, i + 3).some(isDesc)) { const d = r.slice(i + 1, i + 3).find(isDesc); add(norm(cleanName(r[i].text)), d.html, label); descs.push([cleanName(r[i].text), d.html]); }
      if (descs.length) { prev = descs; continue; }
      if (prev && t.length && t.length <= prev.length && t.every(isName)) { t.forEach((c, i) => add(norm(cleanName(c.text)), prev[i][1], `${label} · ${prev[i][0]}`)); prev = null; }
    }
    continue;
  }
  let section = label;
  const nameRow = { cols: null };
  for (const r of rows) {
    // absolute column positions (colspan aware) for vertical name -> description layouts (artifact tab)
    let col = 0; const pos = r.map(c => { const p = [col, col + c.colspan - 1]; col += c.colspan; return p; });
    const t = r.filter(c => c.text);
    if (t.length === 1 && t[0].text.length < 60 && !t[0].text.includes('\n')) { if (/perks|traits|mods/i.test(label)) section = `${label} · ${t[0].text}`; continue; }
    let found = false;
    for (let i = 0; i < r.length; i++) {
      if (!isName(r[i])) continue;
      const d = r.slice(i + 1, i + 4).find(x => x.text);
      if (d && isDesc(d) && !isName(d)) { add(norm(cleanName(r[i].text)), d.html, section); found = true; }
    }
    if (!found && t.length && t.every(isName)) { nameRow.cols = r.map((c, i) => [c, pos[i]]).filter(([c]) => c.text); continue; }
    if (nameRow.cols && t.some(isDesc)) {
      for (const [c, [a]] of nameRow.cols) { const j = r.findIndex((x, i) => x.text && pos[i][0] <= a && pos[i][1] >= a); if (j >= 0 && isDesc(r[j])) add(norm(cleanName(c.text)), r[j].html, section); }
    }
    nameRow.cols = null;
  }
}

const out = {
  v: manifest.Response.version, built: new Date().toISOString().slice(0, 10), artifact: name(artifact),
  breakers, icons, wb, fb, wa, pi, pw, pa, sets, as, sub, cl, dc, dcx, dset, dcs: STYLES, cos: [...cos],
};
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data/defs.json'), JSON.stringify(out));
const sz = k => Math.round(JSON.stringify(out[k]).length / 1024) + 'KB';
console.log(`wrote data/defs.json (${Math.round(JSON.stringify(out).length / 1024)}KB): ${Object.keys(wb).length}/${Object.values(items).filter(x => x.itemType === 3).length} weapons with a breaker, ${Object.keys(fb).length} intrinsic names, ${Object.keys(pi).length} plugs (${sz('pi')}), ${sets.length} armor sets / ${Object.keys(as).length} pieces, subclasses ${Object.keys(sub).map(c => c + ':' + Object.keys(sub[c]).length).join(' ')} (${sz('sub')}), Clarity ${Object.keys(cl).length} (${sz('cl')}), Compendium ${Object.keys(dc).length} (${sz('dc')}) + ${Object.keys(dcx).length} exotics (${sz('dcx')}) + ${Object.keys(dset).length} sets (${sz('dset')})`);
