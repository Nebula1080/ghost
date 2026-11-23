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
// Bungie's magenta "missing texture" placeholder (e.g. the Dual Siphon helmet mods) counts as no icon: the page shows a
// letter tile instead
const NO_ICON = new Set(['8b20acd1a243c966117e2e40a683b066.png']);
const iconTail = p => { const t = (p || '').match(/\/common\/destiny2_content\/icons\/(.+)$/)?.[1] || ''; return NO_ICON.has(t) ? '' : t; };
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
const statDefs = JSON.parse(await cached('stats.json', B + P.DestinyStatDefinition));
// Armor 3.0 character stats a fragment or armor mod can raise or lower (investmentStats), e.g. {Grenade: -10}
const ARMOR_STATS = new Set(['Weapons', 'Health', 'Class', 'Grenade', 'Super', 'Melee']);
const plugStats = it => { const o = {}; for (const x of it?.investmentStats || []) { const n = statDefs[x.statTypeHash]?.displayProperties?.name; if (ARMOR_STATS.has(n) && x.value) o[n] = x.value; } return Object.keys(o).length ? o : undefined; };
const name = it => it?.displayProperties?.name || '';
// Bungie description, falling back to the item's first sandbox perk (aspects, set perks, many mods)
const bungieDesc0 = it => (it?.displayProperties?.description || '').trim() || (it?.perks || []).map(p => perkDefs[p.perkHash]?.displayProperties?.description).find(Boolean) || '';
// armor mods: the item's own text is often only part of it. Font / Charged mods say how Armor Charge is gained and
// keep the effect on their perk; harmonic mods carry one perk per element ("…of Arc weapons", "…of Solar weapons")
// and work with whichever matches the subclass. So: the perk effects first (element copies merged into one line),
// then the item's own line when it adds something.
const EL_RE = /\b(Arc|Solar|Void|Stasis|Strand|Kinetic)\b/g;
const EL_ONE = /\b(Arc|Solar|Void|Stasis|Strand|Kinetic)\b/;
function harmonic(t) {
  return t.replace(/§ weapons\b/g, 'weapons matching your subclass element')
    .replace(/\b(Rapid )?§ weapon (final blows|damage|kills)/g, (m, r, x) => `${r || ''}${x} with weapons matching your subclass element`)
    .replace(/\ba § weapon\b/g, 'a weapon matching your subclass element').replace(/\bincoming § damage\b/g, 'incoming damage matching your subclass element')
    .replace(/§/g, 'subclass-element').replace(/^./, c => c.toUpperCase());
}
function modDesc(it) {
  const own = (it.displayProperties?.description || '').trim();
  const ps = [...new Set((it.perks || []).map(p => perkDefs[p.perkHash]).filter(d => d && d.isDisplayable !== false).map(d => (d.displayProperties?.description || '').trim()).filter(Boolean))];
  // copies of one line that differ only by element: harmonic (4+ elements) reads "matching your subclass element",
  // dual siphons read "Void or Strand"
  const tpl = t => t.replace(EL_RE, '§').replace(/\ban? §/g, 'a §').replace(/\bcreate Orbs of Power\b/g, 'create an Orb of Power');
  const groups = new Map();
  for (const t of ps) { const k = EL_ONE.test(t) ? tpl(t) : t; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const out = [...groups].map(([k, ts]) => {
    if (ts.length < 2) return ts[0];
    const els = [...new Set(ts.flatMap(t => t.match(EL_RE) || []))];
    return els.length >= 4 ? harmonic(k) : k.replace(/\ba §/g, () => (/^[AEIOU]/.test(els[0]) ? 'an ' : 'a ') + '§').replace(/§/g, els.join(' or '));
  });
  if (own && !out.some(t => t.includes(own) || own.includes(t))) out.push(own);
  return out.join(' ').trim();
}
const bungieDesc = it => /^enhancements\./.test(it?.plug?.plugCategoryIdentifier || '') ? (modDesc(it) || bungieDesc0(it)) : bungieDesc0(it);

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
function plugType(cat, it) {
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
  // newer weapons with their own plug families (Praxic Blade: v950.new.sword0.blades / guards / masterwork / forms…):
  // tang = barrel-like, grip = magazine-like, a 'masterwork'-family plug Bungie labels Trait is a trait (the same family
  // also holds exotic catalysts, which stay out), the rest are mods
  const nw = /^v\d+\.new\.[a-z0-9_]+\.([a-z_]+)$/.exec(cat);
  if (nw) return nw[1] === 'masterwork' ? (it?.itemTypeDisplayName === 'Trait' ? 't' : '') : ({ blades: 'b', guards: 'm', grips: 'm', forms: 'w', stat_upgrades: 'w', perk_upgrades: 'w', cosmetics: 'w' }[nw[1]] || '');
  if (/^enhancements\./.test(cat)) return 'a';
  return '';
}
// pi: normName -> [iconTail, typeCode, bungieDescription, hash]. Names used by both sides (e.g. "Demolitionist" is a
// weapon trait and an armor archetype) also get a side-specific entry in pw (weapons) / pa (armor).
const pi = {}, pw = {}, pa = {};
const pref = it => (/^Enhanced/.test(it.itemTypeDisplayName || '') ? 1 : 0);
const sideOf = (cat, ty) => (ty === 'r' || ty === 'a' || /armor/.test(cat)) ? 'a' : (ty === 'i' ? 'both' : 'w');
// a working plug wins over a retired one of the same name (Bungie keeps old "Weapons Mod" etc. as enhancements.universal
// with "This mod has been deprecated…", which made the picker hide the real stat mods)
const dead = it => /deprecated|no longer functions/i.test(bungieDesc(it)) ? 1 : 0;
for (const it of Object.values(items).filter(it => it.plug && name(it) && it.displayProperties?.hasIcon).sort((a, b) => pref(a) - pref(b) || dead(a) - dead(b) || (plugStats(b) ? 1 : 0) - (plugStats(a) ? 1 : 0))) {
  const cat = it.plug.plugCategoryIdentifier; const ty = plugType(cat, it); if (!ty) continue;
  const k = norm(name(it)); const entry = [iconTail(it.displayProperties.icon), ty, bungieDesc(it).slice(0, 600), it.hash];
  const side = sideOf(cat, ty);
  if ((side === 'w' || side === 'both') && !pw[k]) pw[k] = entry;
  if ((side === 'a' || side === 'both') && !pa[k]) pa[k] = entry;
}
for (const k of new Set([...Object.keys(pw), ...Object.keys(pa)])) pi[k] = pw[k] || pa[k];
// keep only the side entries that differ from pi (the rest would just duplicate it)
for (const m of [pw, pa]) for (const k of Object.keys(m)) if (m[k] === pi[k]) delete m[k];

// configurable exotics (2026-11-22): switchable sockets beyond the usual perk columns, e.g. Praxic Blade's Form (it sets
// tang + grip, the swappable intrinsic-like choice), Trait choice, Blade Focus, Power Core and Crystal, Cull's Shadow's
// Soulfire trait, Vexcalibur's Authorization mod. Only reusable (switchable) plug sets count: roll-time ones (Ergo Sum's
// intrinsic, Refit catalysts) are fixed per copy. xs[weaponHash] = [[label, [optionName…]]]
const xs = {};
{
  const STDCOL = /^(frames|scopes|origins|barrels|magazines.*|tubes|arrows|hafts|blades|bowstrings|batteries|guards|grips|stocks)$/;
  const SKIPX = /tracker|skins|ornament|transfusers|extractors|mementos|shader|holofoil|kill_vfx|confetti|flair|^v\d+\.weapon\.mod_|crafting\.recipes/i;
  for (const [h, d] of Object.entries(items)) {
    if (d.itemType !== 3 || d.inventory?.tierType !== 6 || !d.sockets || d.redacted) continue;
    const rows = [];
    for (const e of d.sockets.socketEntries || []) {
      const ps = plugSets[e.reusablePlugSetHash]; if (!ps) continue;
      const hs = [...new Set(ps.reusablePlugItems.map(p => p.plugItemHash))].filter(x => items[x] && name(items[x]) && !/^Empty |^Default |^Protocol Socket$/.test(name(items[x])) && !/ (II|III|IV|V)$/.test(name(items[x])));
      const names = [...new Set(hs.map(x => name(items[x])))];
      if (names.length < 2 || names.every(n => / Catalyst$/.test(n))) continue;
      const cats = [...new Set(hs.map(x => items[x].plug?.plugCategoryIdentifier || ''))];
      if (cats.every(c => SKIPX.test(c)) || cats.every(c => STDCOL.test(c))) continue;
      const label = (items[hs[0]].itemTypeDisplayName || 'Option').replace(name(d) + ' ', '');
      rows.push([label, names]);
      // every option gets an icon + description entry (Vexcalibur's Authorization mods have no regular plug type)
      for (const x of hs) { const k = norm(name(items[x])); if (!pi[k] && !pw[k] && items[x].displayProperties?.hasIcon) pi[k] = [iconTail(items[x].displayProperties.icon), 'w', bungieDesc(items[x]).slice(0, 600), items[x].hash]; }
    }
    // the Form-like choice first, then the rest in socket order
    if (rows.length) xs[h] = rows.sort((a, b) => /form/i.test(b[0]) - /form/i.test(a[0]));
  }
}
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
    seen.add(k);
    const e = { h: it.hash, n, i: iconTail(it.displayProperties.icon), d: bungieDesc(it) };
    const st = plugStats(it); if (st) e.st = st;                                   // fragment stat bonus / penalty
    const fc = it.plug?.energyCapacity?.capacityValue; if (fc) e.fc = fc;          // aspect: fragment slots it opens
    e.c = it.plug.plugCategoryIdentifier;                                         // which subclass socket takes it (DIM loadout link)
    out.push(e);
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
    // socket index -> plug categories it accepts, for DIM loadout socketOverrides
    so: (sc.sockets.socketEntries || []).map(e => [...new Set((plugSets[e.reusablePlugSetHash]?.reusablePlugItems || []).map(p => items[p.plugItemHash]?.plug?.plugCategoryIdentifier).filter(Boolean))].join('|') || items[e.singleInitialItemHash]?.plug?.plugCategoryIdentifier || ''),
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

// ---------- armor mods per slot (build maker): am[slot] = [[name, energyCost, stats|0, hash], ...] ----------
// Icons and descriptions come from pi/pa by name (Core.plugOf(name, defs, 'armor')).
const AM_CAT = { 'enhancements.v2_head': 'head', 'enhancements.v2_arms': 'arms', 'enhancements.v2_chest': 'chest', 'enhancements.v2_legs': 'legs', 'enhancements.v2_class_item': 'class', 'enhancements.v2_general': 'general' };
const am = { head: [], arms: [], chest: [], legs: [], class: [], general: [] }; const amSeen = new Set();
// same-named copies: the one that actually gives stats wins (Bungie also has stat-less "Minor Class Mod" variants)
for (const it of Object.values(items).sort((a, b) => (b.plug?.energyCost?.energyCost || 0) - (a.plug?.energyCost?.energyCost || 0) || (plugStats(b) ? 1 : 0) - (plugStats(a) ? 1 : 0))) {
  const slot = AM_CAT[it.plug?.plugCategoryIdentifier]; const n = name(it); if (!slot || !n || it.redacted || !it.displayProperties?.hasIcon) continue;
  if (/^(empty|locked|default)\b/i.test(n) || /deprecated|no longer functions/i.test(bungieDesc(it))) continue;
  const k = slot + ':' + norm(n); if (amSeen.has(k)) continue; amSeen.add(k);
  am[slot].push([n, it.plug.energyCost?.energyCost || 0, plugStats(it) || 0, it.hash]);   // [name, cost, stats|0, hash]
}
for (const l of Object.values(am)) l.sort((a, b) => a[0].localeCompare(b[0]));

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

// ---------- masterworks and exotic catalysts ----------
// mwp[normName]  = [[stat, value], …]: what a weapon masterwork plug adds (its non-conditional investment stats),
//                  e.g. "Tier 5: Reload Speed" -> [["Reload", 5]]. Stat names match DIM's spreadsheet columns.
// cata[normName] = { st: [[stat, value], …], d: description }: an exotic catalyst plug's stat bonus and text.
// wc[weaponHash] = the catalyst that weapon can take (its catalyst socket's plug), so a missing one can be named.
const STAT_SHORT = { 'Rounds Per Minute': 'ROF', 'Aim Assistance': 'AA', 'Recoil Direction': 'Recoil', 'Magazine': 'Mag', 'Reload Speed': 'Reload' };
const statName = h => { const n = statDefs[h]?.displayProperties?.name; return n ? (STAT_SHORT[n] || n) : ''; };
const mwStats = it => (it.investmentStats || []).filter(x => !x.isConditionallyActive && x.value && statName(x.statTypeHash) && statName(x.statTypeHash) !== 'Armor Energy Capacity').map(x => [statName(x.statTypeHash), x.value]);
// a catalyst's own displayed text is generic ("Upgrades this weapon to a Masterwork…"); its effect is in its perks
const catDesc = it => (it.perks || []).map(p => perkDefs[p.perkHash]).filter(p => p?.isDisplayable && p.displayProperties?.description).map(p => p.displayProperties.description.trim()).join('\n') || bungieDesc(it);
const mwp = {}, cata = {}, wc = {};
for (const it of Object.values(items)) {
  const cat = it.plug?.plugCategoryIdentifier || ''; const n = name(it); if (!n) continue;
  // catalysts: the "catalysts" category, or (most of them) a weapon's own *masterwork category with a "… Catalyst" name
  const isCat = cat === 'catalysts' || (/masterwork/.test(cat) && / Catalyst$/.test(n) && !/^Empty /.test(n));
  if (isCat) { if (!cata[norm(n)]) cata[norm(n)] = { st: mwStats(it), d: catDesc(it).slice(0, 600) }; continue; }
  if (/weapons\.masterworks\.stat|_masterwork$|\.masterwork$/.test(cat) && !/armor|empty/.test(cat)) { const st = mwStats(it); if (st.length && !mwp[norm(n)]) mwp[norm(n)] = st; }
}
for (const w of Object.values(items)) {
  if (w.itemType !== 3 || !/exotic/i.test(w.inventory?.tierTypeName || '')) continue;
  for (const se of w.sockets?.socketEntries || []) {
    const set = plugSets[se.reusablePlugSetHash || se.randomizedPlugSetHash];
    const c = [...(set?.reusablePlugItems || []).map(p => items[p.plugItemHash]), ...(se.reusablePlugItems || []).map(p => items[p.plugItemHash])].find(x => x && cata[norm(name(x))]);
    if (c) { wc[w.hash] = name(c); break; }
  }
  // most catalysts unlock through records, so the socket only lists "Empty Catalyst Socket": pair by name instead
  if (!wc[w.hash] && cata[norm(name(w) + ' Catalyst')]) wc[w.hash] = name(w) + ' Catalyst';
}
console.log('masterwork plugs:', Object.keys(mwp).length, '· catalysts:', Object.keys(cata).length, '· exotics with a catalyst:', Object.keys(wc).length);

// ---------- weapon intrinsics by plug hash ----------
// Intrinsic names repeat across weapon types with different effects ("Aggressive Frame" is 39 plugs with 6 different
// descriptions), so pi / cl / dc (keyed by name) can describe the wrong one. For names that are ambiguous, record each
// weapon's own intrinsic plug: wi[weaponHash] = plugHash, ih[plugHash] = [name, bungieDesc, clarityHtml, clarityType].
// Clarity text is used only when it's for that plug, or for a same-named plug with the very same Bungie description.
const intrDescs = {};
for (const it of Object.values(items)) if (it.plug?.plugCategoryIdentifier === 'intrinsics' && name(it)) (intrDescs[norm(name(it))] ||= new Set()).add(bungieDesc(it));
const ambiguous = new Set(Object.entries(intrDescs).filter(([, s]) => s.size > 1).map(([k]) => k));
const wi = {}, ih = {};
const clarityFor = p => {
  const own = clarity[p.hash]; if (own) { const h = clarityHtml(own); if (h) return [h, own.type]; }
  const d = bungieDesc(p);
  for (const q of Object.values(items)) {
    if (q.hash === p.hash || q.plug?.plugCategoryIdentifier !== 'intrinsics' || name(q) !== name(p) || bungieDesc(q) !== d) continue;
    const c = clarity[q.hash]; const h = c && clarityHtml(c); if (h) return [h, c.type];
  }
  return ['', ''];
};
for (const w of Object.values(items)) {
  if (w.itemType !== 3) continue;
  const cat = (w.sockets?.socketCategories || []).find(c => c.socketCategoryHash === 3956125808);
  const ph = cat && w.sockets.socketEntries[cat.socketIndexes?.[0]]?.singleInitialItemHash;
  const p = ph && items[ph];
  if (!p || !name(p) || !ambiguous.has(norm(name(p)))) continue;
  wi[w.hash] = ph;
  if (!ih[ph]) { const [h, ty] = clarityFor(p); ih[ph] = [name(p), bungieDesc(p).slice(0, 600), h, ty]; }
}
console.log('intrinsics by hash:', Object.keys(wi).length, 'weapons,', Object.keys(ih).length, 'plugs,', ambiguous.size, 'ambiguous names');

const out = {
  v: manifest.Response.version, built: new Date().toISOString().slice(0, 10), artifact: name(artifact),
  breakers, icons, wb, fb, wa, pi, pw, pa, sets, as, sub, am, cl, dc, dcx, dset, dcs: STYLES, cos: [...cos], wi, ih, mwp, cata, wc, xs,
};
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data/defs.json'), JSON.stringify(out));
const sz = k => Math.round(JSON.stringify(out[k]).length / 1024) + 'KB';
console.log(`wrote data/defs.json (${Math.round(JSON.stringify(out).length / 1024)}KB): ${Object.keys(wb).length}/${Object.values(items).filter(x => x.itemType === 3).length} weapons with a breaker, ${Object.keys(fb).length} intrinsic names, ${Object.keys(pi).length} plugs (${sz('pi')}), ${sets.length} armor sets / ${Object.keys(as).length} pieces, subclasses ${Object.keys(sub).map(c => c + ':' + Object.keys(sub[c]).length).join(' ')} (${sz('sub')}), Clarity ${Object.keys(cl).length} (${sz('cl')}), Compendium ${Object.keys(dc).length} (${sz('dc')}) + ${Object.keys(dcx).length} exotics (${sz('dcx')}) + ${Object.keys(dset).length} sets (${sz('dset')})`);
