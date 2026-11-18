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
