// Builds data/api-defs.json: the compact item table the hosted build uses to turn a Bungie profile response into
// the same item objects a DIM CSV produces (Core.apiToItems). Reads the manifest tables build-defs.mjs caches in
// data/raw (no API key needed; the stat table is downloaded once if missing).
//   node tools/build-api-defs.mjs
// Output shape (all keys are item / plug / stat hashes as strings):
//   i: weapons + armor  -> [name, kind 'w'|'a', type, rarity, ammo 0-3, bucket hash, classType, perk socket indexes]
//   p: plugs            -> [name, cat]  cat: i intrinsic, r armor archetype, m masterwork, u tuning, k tracker,
//                          ah/aa/ac/al/ax/ag armor mod (head/arms/chest/legs/class item/general), '' other
//   s: stats            -> short name as DIM's spreadsheet uses it (only stats DIM exports)
//   c: subclasses       -> each socket's empty / default plug hash (so Ghost can clear aspects and fragments)
import fs from 'node:fs';
import path from 'node:path';

const RAW = path.join(import.meta.dirname, '..', 'data', 'raw');
const OUT = path.join(import.meta.dirname, '..', 'data', 'api-defs.json');
const B = 'https://www.bungie.net';
const read = f => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));

const manifest = read('manifest.json');
const items = read('items.json');
const statFile = path.join(RAW, 'stats.json');
if (!fs.existsSync(statFile)) {
  const url = B + manifest.Response.jsonWorldComponentContentPaths.en.DestinyStatDefinition;
  const res = await fetch(url, { headers: { 'User-Agent': 'ghost-defs/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  fs.writeFileSync(statFile, Buffer.from(await res.arrayBuffer()));
  console.log('downloaded stats.json');
}
const stats = read('stats.json');

// Bungie stat name -> DIM spreadsheet column name
const STAT_ALIAS = { 'Rounds Per Minute': 'ROF', 'Aim Assistance': 'AA', 'Recoil Direction': 'Recoil', 'Magazine': 'Mag', 'Reload Speed': 'Reload' };
const STAT_KEEP = new Set(['ROF', 'AA', 'Recoil', 'Mag', 'Reload', 'Impact', 'Range', 'Zoom', 'Stability', 'Handling', 'Blast Radius', 'Velocity',
  'Charge Time', 'Draw Time', 'Accuracy', 'Persistence', 'Swing Speed', 'Guard Resistance', 'Guard Endurance', 'Charge Rate', 'Shield Duration',
  'Airborne Effectiveness', 'Ammo Generation', 'Heat Generated', 'Cooling Efficiency', 'Weapons', 'Health', 'Class', 'Grenade', 'Super', 'Melee']);

const PERK_CATS = new Set([4241085061, 3154740035]); // WEAPON PERKS, ARMOR PERKS
// armor mod sockets by slot (ah head, aa arms, ac chest, al legs, ax class item, ag general) so Ghost can offer mod swaps
const AMOD = { 'enhancements.v2_head': 'ah', 'enhancements.v2_arms': 'aa', 'enhancements.v2_chest': 'ac', 'enhancements.v2_legs': 'al', 'enhancements.v2_class_item': 'ax', 'enhancements.v2_general': 'ag' };
const plugCat = c => !c ? '' : AMOD[c] ? AMOD[c] : c === 'intrinsics' ? 'i' : /armor_archetypes/.test(c) ? 'r' : /trackers/.test(c) ? 'k'
  : /tuning/.test(c) ? 'u' : /masterwork/.test(c) ? 'm' : '';

const out = { v: manifest.Response.version, i: {}, p: {}, s: {}, c: {} };
for (const [h, d] of Object.entries(items)) {
  const n = d.displayProperties?.name; if (!n) continue;
  if (d.itemType === 3 || d.itemType === 2) {
    out.i[h] = [n, d.itemType === 3 ? 'w' : 'a', d.itemTypeDisplayName || '', d.inventory?.tierTypeName || '',
      d.equippingBlock?.ammoType || 0, d.inventory?.bucketTypeHash || 0, d.classType ?? 3,
      // socket indexes whose options belong to the roll (weapon perks: barrel, magazine, traits, origin; armor perks).
      // Mods, masterworks, intrinsics, cosmetics show only the inserted plug.
      (d.sockets?.socketCategories || []).filter(c => PERK_CATS.has(c.socketCategoryHash)).flatMap(c => c.socketIndexes || [])];
  }
  if (d.inventory?.bucketTypeHash === 3284755031 && d.sockets) out.c[h] = d.sockets.socketEntries.map(e => e.singleInitialItemHash || 0);
  if (d.plug) out.p[h] = [n, plugCat(d.plug.plugCategoryIdentifier)];
}
for (const [h, d] of Object.entries(stats)) {
  const n = d.displayProperties?.name; if (!n) continue;
  const short = STAT_ALIAS[n] || n;
  if (STAT_KEEP.has(short)) out.s[h] = short;
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`api-defs.json: ${Object.keys(out.i).length} items, ${Object.keys(out.p).length} plugs, ${Object.keys(out.s).length} stats, ${(fs.statSync(OUT).size / 1048576).toFixed(2)} MB`);

// ---------- data/sockets.json (both builds, window.VS_SOCK): weapon perk columns + armor mod sockets ----------
// DIM's CSV lists perks flat, so Ghost needs Bungie's own sockets to know which column a perk belongs to, and which
// mod sockets each armor piece has.
//   n:   perk / mod names (index table)
//   ps:  plug set hash -> [name index]           (each random perk column's possible perks)
//   w:   weapon hash  -> [plug set hash, ...]    (perk columns in socket order: barrel, magazine, traits, origin)
//   lay: armor socket layouts, each [[socketIndex, code], ...]; code g general, s slot (head / arms / ...),
//        t tuning, a artifice, x:<name> activity / raid / seasonal
//   a:   armor hash -> layout index
//   m:   code -> [[name, energy cost, {stat: value} | 0, plug hash]] for t / a / x:* sockets
const plugSets = read('plugsets.json');
const SOUT = path.join(import.meta.dirname, '..', 'data', 'sockets.json');
const so = { n: [], ps: {}, w: {}, lay: [], a: {}, m: {} };
const nIdx = new Map(); const nameId = n => { if (!nIdx.has(n)) { nIdx.set(n, so.n.length); so.n.push(n); } return nIdx.get(n); };
const psItems = h => plugSets[h]?.reusablePlugItems || [];
for (const [h, d] of Object.entries(items)) {
  if (d.itemType !== 3 || !d.sockets || d.redacted) continue;
  const cat = (d.sockets.socketCategories || []).find(c => c.socketCategoryHash === 4241085061); if (!cat) continue;
  const cols = [];
  for (const i of cat.socketIndexes || []) {
    const e = d.sockets.socketEntries[i]; const ph = e.randomizedPlugSetHash || e.reusablePlugSetHash; if (!ph) continue;
    const plugs = psItems(ph).map(p => items[p.plugItemHash]).filter(Boolean);
    if (!plugs.length || plugs.every(p => /tracker/.test(p.plug?.plugCategoryIdentifier || ''))) continue;
    if (!so.ps[ph]) so.ps[ph] = [...new Set(plugs.map(p => p.displayProperties?.name).filter(Boolean).map(n => n.replace(/^Enhanced\s+/, '')))].map(nameId);
    cols.push(+ph);
  }
  if (cols.length) so.w[h] = cols;
}
const modCode = c => !c ? '' : /v2_general|^enhancements\.universal$|rivens_curse/.test(c) ? 'g' : /v2_(head|arms|chest|legs|class_item)/.test(c) ? 's'
  : /armor_tiering\.plugs\.tuning/.test(c) ? 't' : /^enhancements\.artifice/.test(c) ? 'a' : /^enhancements\./.test(c) ? 'x:' + c.slice(13) : '';
const layIdx = new Map(); const statsOf = d => { const o = {}; for (const s of d.investmentStats || []) { const n = out.s[s.statTypeHash]; if (n && s.value) o[n] = s.value; } return Object.keys(o).length ? o : 0; };
for (const [h, d] of Object.entries(items)) {
  if (d.itemType !== 2 || !d.sockets || d.redacted) continue;
  const cat = (d.sockets.socketCategories || []).find(c => c.socketCategoryHash === 590099826); if (!cat) continue;
  const lay = [];
  for (const i of cat.socketIndexes || []) {
    const e = d.sockets.socketEntries[i]; const c = modCode(items[e.singleInitialItemHash]?.plug?.plugCategoryIdentifier); if (!c) continue;
    lay.push([i, c]);
    if (c === 't' || c === 'a' || c.startsWith('x:')) {
      const list = so.m[c] ||= []; const seen = new Set(list.map(x => x[3]));
      for (const p of psItems(e.reusablePlugSetHash || e.randomizedPlugSetHash)) {
        const pd = items[p.plugItemHash]; const n = pd?.displayProperties?.name; if (!n || /^empty|^default/i.test(n) || seen.has(p.plugItemHash)) continue;
        seen.add(p.plugItemHash); list.push([n, pd.plug?.energyCost?.energyCost || 0, statsOf(pd), p.plugItemHash]);
      }
    }
  }
  if (!lay.length) continue;
  const key = JSON.stringify(lay); if (!layIdx.has(key)) { layIdx.set(key, so.lay.length); so.lay.push(lay); }
  so.a[h] = layIdx.get(key);
}
fs.writeFileSync(SOUT, JSON.stringify(so));
console.log(`sockets.json: ${Object.keys(so.w).length} weapons, ${Object.keys(so.ps).length} perk sets, ${Object.keys(so.a).length} armor, ${so.lay.length} layouts, ${(fs.statSync(SOUT).size / 1048576).toFixed(2)} MB`);
