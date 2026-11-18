// Builds data/ratings.json: the compact tables behind Ghost's weapon ratings (CLAUDE.md -> Ratings).
//   node tools/build-ratings.mjs            reuse the cached downloads in data/raw/
//   node tools/build-ratings.mjs --refresh  download the wish list and Aegis's sheet again
// Sources (all untrusted input: parsed as text, validated, nothing executed, notes escaped on output by the page):
//   - DIM community wish list voltron.txt, github.com/48klocs/dim-wish-list-sources (MIT)
//   - Aegis's "Destiny 2: Endgame Analysis" Google Sheet (public gviz CSV per tab), used with his approval
//   - Bungie manifest tables cached by tools/build-defs.mjs (items.json, plugsets.json) for which weapons can
//     roll which perks; data/defs.json for each perk's column; data/api-defs.json for plug hash -> name
// Output shape: see the comment above prepGhostRatings in src/core.js.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../src/core.js');
const root = path.join(import.meta.dirname, '..');
const RAW = path.join(root, 'data/raw');
const OUT = path.join(root, 'data/ratings.json');
const refresh = process.argv.includes('--refresh');
fs.mkdirSync(path.join(RAW, 'wishlist'), { recursive: true });
fs.mkdirSync(path.join(RAW, 'aegis'), { recursive: true });

const WISHLIST_URL = 'https://raw.githubusercontent.com/48klocs/dim-wish-list-sources/master/voltron.txt';
const AEGIS_ID = '1JM-0SlxVDAi-C6rGVlLxa-J1WGewEeL8Qvq4htWZHhY'; // "Destiny 2: Endgame Analysis" by Aegis
const MAX_DOWNLOAD = 80 * 1024 * 1024;

async function cached(file, url) {
  const p = path.join(RAW, file);
  if (!refresh && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  const res = await fetch(url, { headers: { 'User-Agent': 'ghost-ratings/1.0' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD) throw new Error(`too large: ${url}`);
  fs.writeFileSync(p, buf);
  console.log('downloaded', file, buf.length, 'bytes');
  await new Promise(r => setTimeout(r, 400));
  return buf.toString('utf8');
}
const readJson = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const norm = Core.norm;

const api = readJson('data/api-defs.json');
const defs = readJson('data/defs.json');
const items = JSON.parse(fs.readFileSync(path.join(RAW, 'items.json'), 'utf8'));
const plugSets = JSON.parse(fs.readFileSync(path.join(RAW, 'plugsets.json'), 'utf8'));
const colOf = name => { const t = Core.plugOf(name, defs, 'weapon')?.[1]; return ['b', 'm', 't', 'o'].includes(t) ? t : ''; };
const ELEM = { 1: 'Kinetic', 2: 'Arc', 3: 'Solar', 4: 'Void', 6: 'Stasis', 7: 'Strand' };

// ---------- which weapons can roll which perks (manifest) ----------
const weapons = new Map(); // hash -> {name, type, el, perks:Set(normName)}
const perkInfo = new Map(); // normName -> {n, col, types:Set, els:Set, names:Set(weapon names)}
const PERK_CAT = 4241085061;
for (const [h, d] of Object.entries(items)) {
  if (d.itemType !== 3 || !api.i[h] || !d.displayProperties?.name) continue;
  const w = { name: d.displayProperties.name, type: d.itemTypeDisplayName || '', el: ELEM[d.defaultDamageType] || '', perks: new Set() };
  const idx = (d.sockets?.socketCategories || []).filter(c => c.socketCategoryHash === PERK_CAT).flatMap(c => c.socketIndexes || []);
  for (const i of idx) {
    const se = d.sockets.socketEntries[i]; if (!se) continue;
    const set = plugSets[se.randomizedPlugSetHash || se.reusablePlugSetHash];
    const plugs = [...(set?.reusablePlugItems || []).map(x => x.plugItemHash), ...(se.reusablePlugItems || []).map(x => x.plugItemHash)];
    for (const ph of plugs) {
      const n = api.p[ph]?.[0] || items[ph]?.displayProperties?.name; if (!n) continue;
      const col = colOf(n); if (!col) continue;
      const k = norm(n); w.perks.add(k);
      let pi = perkInfo.get(k); if (!pi) perkInfo.set(k, pi = { n: n.replace(/^Enhanced\s+/i, ''), col, types: new Set(), els: new Set(), names: new Set() });
      pi.types.add(w.type); if (w.el) pi.els.add(w.el); pi.names.add(w.name);
    }
  }
  weapons.set(h, w);
}
console.log('weapons', weapons.size, 'weapon perks', perkInfo.size);

// ---------- DIM wish list ----------
const wlText = await cached('wishlist/voltron.txt', WISHLIST_URL);
const parsed = Core.parseWishlist(wlText);
console.log('wish list rolls', parsed.rolls.length);
const P = [], Pidx = new Map(); const N = [], Nidx = new Map();
const pid = n => { const k = norm(n); if (!Pidx.has(k)) { Pidx.set(k, P.length); P.push(n.replace(/^Enhanced\s+/i, '')); } return Pidx.get(k); };
const nid = s => { if (!s) return -1; if (!Nidx.has(s)) { Nidx.set(s, N.length); N.push(s); } return Nidx.get(s); };
const perkName = h => { const n = api.p[h]?.[0] || items[h]?.displayProperties?.name; return n && colOf(n) ? n : ''; };

// consecutive lines with the same item, notes, flags and perk count form one block (generators expand
// "(A,B) x (C,D)" into every combination); a block collapses into per-position sets when that is exact
const blocks = [];
let cur = null;
for (const r of parsed.rolls) {
  if (r.item !== '*' && !weapons.has(r.item)) continue;
  const f = (r.tags & (Core.WL.PVE | Core.WL.PVP | Core.WL.MKB | Core.WL.CTRL)) | (r.trash ? Core.WL.TRASH : 0);
  const names = r.perks.map(perkName);
  const key = `${r.item}|${f}|${r.notes}|${names.length}`;
  if (!cur || cur.key !== key) blocks.push(cur = { key, item: r.item, f, notes: r.notes, lines: [] });
  cur.lines.push(names);
}
let exact = 0, split = 0;
const W = {}; const seen = new Set();
for (const b of blocks) {
  const width = b.lines[0].length;
  const pos = Array.from({ length: width }, (_, i) => [...new Set(b.lines.map(l => l[i]).filter(Boolean).map(norm))]);
  const combos = new Set(b.lines.map(l => l.map(x => norm(x)).join('|')));
  const product = pos.reduce((a, s) => a * Math.max(1, s.length), 1);
  const groups = product === combos.size ? (exact++, [pos]) : (split++, b.lines.map(l => l.map(x => x ? [norm(x)] : [])));
  for (const g of groups) {
    const sets = g.filter(s => s.length).map(s => s.map(k => pid(b.lines.flat().find(x => norm(x) === k))).sort((x, y) => x - y));
    if (!sets.length) continue;
    const sig = b.item + '|' + b.f + '|' + JSON.stringify(sets);
    if (seen.has(sig)) continue; seen.add(sig);
    (W[b.item] ||= []).push([b.f, nid(Core.wlNote(b.notes)), sets]);
  }
}
for (const h of Object.keys(W)) if (W[h].length > 400) W[h] = W[h].slice(0, 400);
console.log('wish list blocks', blocks.length, 'exact', exact, 'split', split, 'weapons', Object.keys(W).length, 'rolls', Object.values(W).reduce((a, x) => a + x.length, 0));

// ---------- Aegis's Endgame Analysis ----------
const AEGIS_TABS = { Autos: 'Auto Rifle', Bows: 'Combat Bow', HCs: 'Hand Cannon', Pulses: 'Pulse Rifle', Scouts: 'Scout Rifle', Sidearms: 'Sidearm', SMGs: 'Submachine Gun',
  BGLs: 'Grenade Launcher', Fusions: 'Fusion Rifle', Glaives: 'Glaive', Shotguns: 'Shotgun', Snipers: 'Sniper Rifle', 'Rocket Sidearms': 'Sidearm', Traces: 'Trace Rifle',
  HGLs: 'Grenade Launcher', LFRs: 'Linear Fusion Rifle', LMGs: 'Machine Gun', Rockets: 'Rocket Launcher', Swords: 'Sword', Other: '', 'Exotic Weapons': '' };
const AEGIS_PERK_TABS = ['Perks', 'Origin Traits'];
const view = await cached('aegis/htmlview.html', `https://docs.google.com/spreadsheets/d/${AEGIS_ID}/htmlview`);
const tabs = [...view.matchAll(/\{name: "([^"]{1,80})", pageUrl: "[^"]*", gid: "(\d{1,12})"/g)].map(m => ({ name: m[1].replace(/\\u0026/g, '&'), gid: m[2] }));
if (!tabs.length) throw new Error('no tabs found in the Endgame Analysis htmlview');
const sheet = async t => Core.parseCSV(await cached(`aegis/${t.gid}.csv`, `https://docs.google.com/spreadsheets/d/${AEGIS_ID}/gviz/tq?tqx=out:csv&gid=${t.gid}`));
const tierOf = v => { const t = String(v || '').trim().toUpperCase(); return Core.TIER_SCORE[t] != null ? t : ''; };
const byName = new Map(); // norm(name) -> [hash]
for (const [h, w] of weapons) { const k = norm(w.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(h); }
const AE = {}; const AN = [], ANidx = new Map(); const tabList = [];
const anid = s => { s = Core.wlNote(s, 300); if (!s) return -1; if (!ANidx.has(s)) { ANidx.set(s, AN.length); AN.push(s); } return ANidx.get(s); };
let aeRows = 0, aeMiss = [];
for (const t of tabs) {
  if (!(t.name in AEGIS_TABS)) continue;
  const rows = await sheet(t); const type = AEGIS_TABS[t.name]; const ti = tabList.push(t.name) - 1;
  const noteCol = Object.keys(rows[0] || {}).find(k => /notes|usage/i.test(k));
  const perName = new Map();
  for (const r of rows) {
    const tier = tierOf(r.Tier); const [first, ...rest] = String(r.Name || '').split('\n'); const name = first.trim();
    if (!tier || !name || name.length > 80) continue;
    aeRows++;
    const k = norm(name); if (!perName.has(k)) perName.set(k, []);
    perName.get(k).push({ tier, label: rest.join(' ').trim().slice(0, 80), note: noteCol ? r[noteCol] : '' });
  }
  for (const [k, list] of perName) {
    let hashes = byName.get(k) || byName.get(norm(k.replace(/\(.*\)/, ''))) || [];
    if (type) { const typed = hashes.filter(h => weapons.get(h).type === type); if (typed.length) hashes = typed; }
    if (t.name === 'Exotic Weapons') hashes = hashes.filter(h => /exotic/i.test(api.i[h][3]));
    if (!hashes.length) { aeMiss.push(list[0] && k); continue; }
    const main = list.find(x => !x.label) || list[0];
    const alts = list.filter(x => x !== main).map(x => [x.tier, x.label || 'Other version']);
    for (const h of hashes) if (!AE[h]) AE[h] = alts.length ? [main.tier, ti, anid(main.note), alts] : [main.tier, ti, anid(main.note)];
  }
}
console.log('aegis rows', aeRows, 'weapon hashes', Object.keys(AE).length, 'unmatched names', aeMiss.length, aeMiss.slice(0, 12).join(', '));
const aegisPerk = new Map(); // norm -> tier
for (const t of tabs) {
  if (!AEGIS_PERK_TABS.includes(t.name)) continue;
  for (const r of await sheet(t)) { const tier = tierOf(r.Tier); const n = String(r.Name || '').split('\n')[0].trim(); if (tier && n) aegisPerk.set(norm(n), tier); }
}
console.log('aegis perk tiers', aegisPerk.size);

// ---------- default perk + combo tiers (data-derived, never invented) ----------
// PvE: Aegis's tier from his Perks / Origin Traits tabs when he lists the perk. Otherwise (and for PvP):
// how often curators pick the perk, among the weapons that can roll it and have curated rolls for that mode.
const MODE = { e: Core.WL.PVE, p: Core.WL.PVP };
const listed = { e: new Map(), p: new Map() }; // norm perk -> Set(weapon names whose mode rolls list it)
const pairs = { e: new Map(), p: new Map() }; // comboKey -> Set(weapon names)
const covered = { e: new Set(), p: new Set() }; // weapon names with curated rolls for the mode
for (const [h, rolls] of Object.entries(W)) {
  if (h === '*') continue; const wn = weapons.get(h).name;
  for (const [f, , sets] of rolls) {
    if (f & Core.WL.TRASH) continue;
    for (const m of ['e', 'p']) {
      if ((f & (Core.WL.PVE | Core.WL.PVP)) && !(f & MODE[m])) continue;
      covered[m].add(wn);
      for (const s of sets) for (const i of s) { const k = norm(P[i]); if (!listed[m].has(k)) listed[m].set(k, new Set()); listed[m].get(k).add(wn); }
      const traitSets = sets.filter(s => colOf(P[s[0]]) === 't');
      for (let a = 0; a < traitSets.length; a++) for (let b = a + 1; b < traitSets.length; b++) for (const x of traitSets[a]) for (const y of traitSets[b]) {
        if (norm(P[x]) === norm(P[y])) continue;
        const ck = Core.comboKey(P[x], P[y]); if (!pairs[m].has(ck)) pairs[m].set(ck, { a: P[x], b: P[y], w: new Set() }); pairs[m].get(ck).w.add(wn);
      }
    }
  }
}
const shareTier = s => s >= 0.5 ? 'S' : s >= 0.3 ? 'A' : s >= 0.18 ? 'B' : s >= 0.08 ? 'C' : s > 0 ? 'D' : 'E';
const MODE_LABEL = { e: 'PvE', p: 'PvP' };
const PK = {};
for (const [k, pi] of perkInfo) {
  const row = [pi.n, 'w', pi.col, '', '', '', ''];
  for (const m of ['e', 'p']) {
    const ai = m === 'e' ? 4 : 5;
    if (m === 'e' && aegisPerk.has(k)) { row[3] = aegisPerk.get(k); row[5] = `Aegis's Endgame Analysis: Tier ${aegisPerk.get(k)}`; continue; }
    const avail = [...pi.names].filter(n => covered[m].has(n)).length;
    if (avail < 4) continue; // too few curated weapons to say anything
    const got = [...(listed[m].get(k) || [])].filter(n => pi.names.has(n)).length;
    row[m === 'e' ? 3 : 4] = shareTier(got / avail);
    row[ai + 1] = `Picked in ${got} of ${avail} curated ${MODE_LABEL[m]} wish lists for weapons that can roll it`;
  }
  // frame / element scope for the filters: weapon types and elements that can roll it
  row.push([...pi.types].sort().slice(0, 20), pi.els.size === 1 ? [...pi.els][0] : '');
  PK[k] = row;
}
// armor archetypes (rated for reference; they don't change weapon scores)
for (const [k, v] of Object.entries(defs.pa || {})) if (v[1] === 'r' && !PK[k]) PK[k] = [Object.values(api.p).find(x => norm(x[0]) === k)?.[0] || k, 'a', 'r', '', '', '', '', [], ''];
for (const [h, p] of Object.entries(api.p)) if (p[1] === 'r' && !PK[norm(p[0])]) PK[norm(p[0])] = [p[0], 'a', 'r', '', '', '', '', [], ''];
for (const k of Object.keys(PK)) if (PK[k][1] === 'a' && !/[a-z]/i.test(PK[k][0])) delete PK[k];

const CB = [];
const both = new Map();
for (const m of ['e', 'p']) for (const [ck, c] of pairs[m]) {
  const ia = perkInfo.get(norm(c.a)), ib = perkInfo.get(norm(c.b)); if (!ia || !ib) continue;
  const avail = [...ia.names].filter(n => ib.names.has(n) && covered[m].has(n)).length;
  if (c.w.size < 4 || avail < 4) continue;
  const share = c.w.size / avail; if (share < 0.25) continue;
  if (!both.has(ck)) both.set(ck, { a: c.a, b: c.b, e: '', p: '', w: 0 });
  const o = both.get(ck); o[m] = shareTier(share); o.w = Math.max(o.w, c.w.size);
}
for (const o of [...both.values()].sort((x, y) => y.w - x.w).slice(0, 400)) CB.push([o.a, o.b, o.e, o.p, o.w]);
console.log('perk defaults', Object.keys(PK).length, 'with PvE', Object.values(PK).filter(x => x[3]).length, 'with PvP', Object.values(PK).filter(x => x[4]).length, 'combos', CB.length);

const credits = String(parsed.description || '').replace(/\s+/g, ' ').slice(0, 1500);
const out = {
  meta: { wl: new Date().toISOString().slice(0, 10), ae: new Date().toISOString().slice(0, 10), credits },
  wl: { p: P, n: N, w: W }, ae: { tabs: tabList, n: AN, w: AE }, pk: PK, cb: CB,
};
// round-trip through the page's own validator so nothing the page would drop is shipped
const check = Core.prepGhostRatings(out);
if (check.wl.w.size !== Object.keys(W).length || check.ae.w.size !== Object.keys(AE).length) throw new Error('validator dropped entries');
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`ratings.json ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
