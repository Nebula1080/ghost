// Source packets for curating build interactions (data/interactions/src/*.json).
// Every piece a build can hold gets its full description text from all three sources:
//   Bungie (manifest), Clarity (community-tested numbers), Destiny Data Compendium (Pip1n's sheet).
// Curators (Claude + subagents) read these packets and write data/interactions/pieces/*.json; the tests check that
// every quoted claim appears in the packet text. Packets are committed so CI can check quotes without data/raw.
//   node tools/interactions/sources.mjs          (needs data/raw from tools/build-defs.mjs and data/defs.json)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const Core = require(path.join(root, 'src/core.js'));
const D = JSON.parse(fs.readFileSync(path.join(root, 'data/defs.json'), 'utf8'));
const items = JSON.parse(fs.readFileSync(path.join(root, 'data/raw/items.json'), 'utf8'));
const norm = Core.norm;
const plain = h => String(h || '').replace(/<div class="cl-sp"><\/div>/g, '\n').replace(/<br\s*\/?>|<\/div>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
// all three sources for a plug / ability name (Compendium kept even when the others exist)
function texts(name, bungie, kind) {
  const i = Core.perkInfo(name, D, kind) || {};
  const o = {};
  const bd = bungie || i.bd; if (bd) o.bungie = String(bd).trim();
  if (i.cl) { o.clarity = plain(i.cl.h); if (i.cl.e) o.clarityEnhanced = plain(i.cl.e); }
  if (i.dc?.h) o.compendium = plain(i.dc.h);
  return o;
}
const out = {};
const add = (group, rec) => { (out[group] ||= {})[rec.id] = rec; };

// ---------- subclass pieces (merged across classes by name: fragments, grenades, many keywords are shared) ----------
const EL_GROUP = { solar: 'subclass-solar', arc: 'subclass-arc', void: 'subclass-void', stasis: 'subclass-stasis', strand: 'subclass-strand', prism: 'subclass-prismatic' };
const subSeen = new Map();
const EL_ORDER = ['solar', 'arc', 'void', 'stasis', 'strand', 'prism'];
for (const [cls, els] of Object.entries(D.sub)) for (const [el, sc] of Object.entries(els).sort((x, y) => EL_ORDER.indexOf(x[0]) - EL_ORDER.indexOf(y[0]))) for (const [sec, list] of Object.entries(sc.s)) for (const a of list) {
  // one record per name: Prismatic reuses other elements' grenades and abilities; the element's own packet keeps it
  const id = 'sub:' + norm(a.n);
  const prev = subSeen.get(id);
  if (prev) { if (!prev.cls.includes(cls)) prev.cls.push(cls); if (!prev.hashes.includes(a.h)) prev.hashes.push(a.h); if (!prev.subclasses.includes(el)) prev.subclasses.push(el); continue; }
  const rec = { id, n: a.n, kind: sec, el, subclasses: [el], cls: [cls], hashes: [a.h], ...(a.st ? { stats: a.st } : {}), ...(a.fc ? { fragmentSlots: a.fc } : {}), src: texts(a.n, a.d) };
  subSeen.set(id, rec); add(EL_GROUP[el], rec);
}

// ---------- exotic weapons: intrinsic, exotic trait(s), catalyst + the Compendium's exotic notes ----------
const plugOfEntry = e => items[e.singleInitialItemHash];
const seenXW = new Set();
for (const w of Object.values(items)) {
  if (w.itemType !== 3 || w.inventory?.tierType !== 6 || w.redacted || !w.displayProperties?.name || !w.sockets) continue;
  const id = 'xw:' + norm(w.displayProperties.name); if (seenXW.has(id)) continue; seenXW.add(id);
  const perks = [];
  for (const e of w.sockets.socketEntries || []) {
    const p = plugOfEntry(e); const cat = p?.plug?.plugCategoryIdentifier || ''; const n = p?.displayProperties?.name;
    if (!n || /^(empty|default)/i.test(n)) continue;
    if (cat === 'intrinsics' || cat === 'frames' || /masterwork/.test(cat) && /catalyst/i.test(n)) perks.push({ n, role: cat === 'intrinsics' ? 'intrinsic' : cat === 'frames' ? 'trait' : 'catalyst', src: texts(n, (p.displayProperties.description || '').trim() || null, 'weapon') });
  }
  const dcx = D.dcx?.[norm(w.displayProperties.name)];
  const dmg = { 1: 'kinetic', 2: 'arc', 3: 'solar', 4: 'void', 6: 'stasis', 7: 'strand' }[w.defaultDamageType] || '';
  add('exotic-weapons', { id, n: w.displayProperties.name, kind: 'exoticWeapon', type: w.itemTypeDisplayName || '', el: dmg, hashes: [w.hash], perks, src: dcx ? { compendium: plain(dcx) } : {} });
}

// ---------- weapon perks (traits, origins) whose text names a subclass keyword or an element ----------
const KEY = new RegExp(Core.SYN.map(s => s.re.source).join('|') + '|\\b(solar|arc|void|stasis|strand|prismatic|light|darkness) (weapon|abilit|damage|debuff|buff|subclass)'
  // perks that pay off or feed abilities (grenade / melee / class ability / Super kills or energy)
  + '|\\b(grenade|melee|class ability|super)s? (final blow|kill|energy|damage)|\\babilit(y|ies) (final blow|kill|energy)', 'i');
// pi keys are normalized; recover display names from the manifest
const plugName = new Map();
for (const it of Object.values(items)) { const n = it.displayProperties?.name; const c = it.plug?.plugCategoryIdentifier; if (n && (c === 'frames' || c === 'origins')) { const k = norm(n); if (!plugName.has(k) || /^Enhanced/.test(plugName.get(k))) plugName.set(k, n.replace(/^Enhanced\s+/, '')); } }
for (const [k, n] of plugName) {
  const p = Core.plugOf(n, D, 'weapon'); if (!p || (p[1] !== 't' && p[1] !== 'o')) continue;
  const src = texts(n, null, 'weapon'); const all = Object.values(src).join('\n');
  if (!KEY.test(all)) continue;
  add('weapon-perks', { id: 'wp:' + k, n, kind: p[1] === 'o' ? 'originTrait' : 'weaponTrait', hashes: [p[3]], src });
}

// ---------- exotic armor (per class): the exotic perk(s) ----------
const CLS = { 0: 'titan', 1: 'hunter', 2: 'warlock' };
const seenXA = new Set();
for (const a of Object.values(items)) {
  if (a.itemType !== 2 || a.inventory?.tierType !== 6 || a.redacted || !a.displayProperties?.name || !a.sockets || !CLS[a.classType]) continue;
  const id = 'xa:' + norm(a.displayProperties.name); if (seenXA.has(id)) continue;
  const perks = [];
  for (const e of a.sockets.socketEntries || []) {
    const p = plugOfEntry(e); const n = p?.displayProperties?.name;
    if (n && p.plug?.plugCategoryIdentifier === 'intrinsics' && !/^(empty|default)/i.test(n)) perks.push({ n, role: 'exoticPerk', src: texts(n, (p.displayProperties.description || '').trim() || null, 'armor') });
  }
  if (!perks.length) continue; // exotic class items with random spirits are curated by their spirit perks later
  seenXA.add(id);
  add('exotic-armor-' + CLS[a.classType], { id, n: a.displayProperties.name, kind: 'exoticArmor', cls: [CLS[a.classType]], slot: Core.armorSlot({ type: a.itemTypeDisplayName || '' }), hashes: [a.hash], perks });
}

// ---------- armor mods ----------
for (const [slot, list] of Object.entries(D.am || {})) for (const [n, cost, st, h] of list) {
  add('armor-mods', { id: 'mod:' + norm(n), n, kind: 'armorMod', slot, cost, hashes: [h], ...(st ? { stats: st } : {}), src: texts(n, null, 'armor') });
}

// ---------- armor set bonuses (2- and 4-piece): one record per bonus perk ----------
for (const set of Object.values(D.sets || {})) for (const p of set.p || []) {
  add('armor-sets', { id: 'set:' + norm(p.n), n: p.n, kind: 'setBonus', set: set.n, pieces: p.c, src: texts(p.n, p.d, 'armor') });
}

// ---------- artifacts (Monument of Triumph system): every Artifact item, 7 perk slots over 3 tiers ----------
// Sockets 0-1 take tier-1 perks, 2-4 tier 1-2, 5-6 any tier (socket categories 2631166533/4/5). A perk's tier is the
// first socket group whose plug set lists it. Records merge by name across artifacts (Horde Shuttle is in several).
const plugsets = JSON.parse(fs.readFileSync(path.join(root, 'data/raw/plugsets.json'), 'utf8'));
const sbx = JSON.parse(fs.readFileSync(path.join(root, 'data/raw/sandboxperks.json'), 'utf8'));
const ART_TIER = { 2631166533: 1, 2631166534: 2, 2631166535: 3 };
const artRecs = new Map(); const artifactList = [];
for (const [ah, a] of Object.entries(items)) {
  if (a.itemTypeDisplayName !== 'Artifact' || !a.sockets || a.redacted) continue;
  const perks = []; const seen = new Set();
  for (const cat of a.sockets.socketCategories || []) {
    const tier = ART_TIER[cat.socketCategoryHash]; if (!tier) continue;
    for (const si of cat.socketIndexes || []) {
      const e = a.sockets.socketEntries[si]; const list = plugsets[e.reusablePlugSetHash || e.randomizedPlugSetHash]?.reusablePlugItems || [];
      for (const pl of list) {
        const d = items[pl.plugItemHash]; const n = d?.displayProperties?.name;
        if (!n || /^empty|^reset/i.test(n) || seen.has(n)) continue; seen.add(n);
        // the perk's text lives on its sandbox perk (the item description is often empty)
        const bd = (d.displayProperties.description || '').trim() || (d.perks || []).map(x => sbx[x.perkHash]?.displayProperties?.description || '').filter(Boolean).join('\n').trim() || '';
        perks.push([pl.plugItemHash, n, tier, bd, d.displayProperties.icon || '']);
        const id = 'art:' + norm(n); const r = artRecs.get(id);
        if (r) { if (!r.hashes.includes(pl.plugItemHash)) r.hashes.push(pl.plugItemHash); r.artifacts.push(a.displayProperties.name); }
        else artRecs.set(id, { id, n, kind: 'artifactPerk', artifacts: [a.displayProperties.name], hashes: [pl.plugItemHash], src: texts(n, bd || null, 'armor') });
      }
    }
  }
  artifactList.push({ h: +ah, n: a.displayProperties.name, d: (a.displayProperties.description || '').trim(), i: a.displayProperties.icon || '', p: perks });
}
for (const r of artRecs.values()) add('artifact', r);
// the page's artifact table (bundled by build.py): artifacts with their perks [hash, name, tier, Bungie text, icon]
fs.writeFileSync(path.join(root, 'data/interactions/artifacts.json'), JSON.stringify(artifactList.sort((x, y) => x.n.localeCompare(y.n))) + '\n');

const dir = path.join(root, 'data/interactions/src'); fs.mkdirSync(dir, { recursive: true });
for (const [g, recs] of Object.entries(out)) {
  const list = Object.values(recs).sort((a, b) => a.n.localeCompare(b.n));
  fs.writeFileSync(path.join(dir, g + '.json'), JSON.stringify(list, null, 1) + '\n');
  console.log(g.padEnd(24), list.length);
}
