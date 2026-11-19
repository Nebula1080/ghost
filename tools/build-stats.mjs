// Builds data/stats.json: what each Armor 3.0 character stat does, per point, and every ability's cooldown, from
// Clarity's Character Stats database v2 (Edge of Fate rework, github.com/Database-Clarity/Character-Stats). Clarity
// marks the v2 stat curves as placeholders until tested; the page says so next to every number.
//   node tools/build-stats.mjs            (downloads once into data/raw/clarity-stats/, then reuses the cache)
//   node tools/build-stats.mjs --refresh  (downloads again)
// Output (inlined by build.py as window.VS_STATS):
//   src:   { repo, commit, date, note }
//   stats: { Weapons|Health|Class|Grenade|Super|Melee: {
//            hash, f: { field: number | [from, [value at from, from+1, ...]] },   (curves sampled per stat point)
//            t: { o: overview, b: 0-100 tooltip, e: 100-200 tooltip },            ({{Field}} placeholders)
//            ab: { abilityHash: [name, baseCooldown, chunkScalar|null, chargeScaling|null] },
//            sup: { superHash: [name, baseCooldown, activeRegenScalar|null, baseDuration|null] },
//            ov: [[reasonHash, name, requirements, cooldownOverride|null, scalars|null, chunkOverrides|null]] } }
//   charge: the multi-charge tooltip
import fs from 'node:fs';
import path from 'node:path';

const REPO = 'Database-Clarity/Character-Stats';
const RAW = path.join(import.meta.dirname, '..', 'data', 'raw', 'clarity-stats');
const OUT = path.join(import.meta.dirname, '..', 'data', 'stats.json');
const refresh = process.argv.includes('--refresh');
const FILES = ['sources/stats/weapons.json', 'sources/stats/health.json', 'sources/stats/class.json', 'sources/stats/grenade.json', 'sources/stats/super.json', 'sources/stats/melee.json', 'locale/en.json'];
fs.mkdirSync(RAW, { recursive: true });

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'ghost-defs/1.0' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
// pin the commit so a build is reproducible
const metaFile = path.join(RAW, 'commit.json');
let meta = fs.existsSync(metaFile) && !refresh ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : null;
if (!meta) {
  const c = JSON.parse(await get(`https://api.github.com/repos/${REPO}/commits?per_page=1`))[0];
  meta = { commit: c.sha, date: c.commit.committer.date };
  fs.writeFileSync(metaFile, JSON.stringify(meta));
}
const read = async f => {
  const p = path.join(RAW, f.replace(/\//g, '_'));
  if (!fs.existsSync(p) || refresh) fs.writeFileSync(p, await get(`https://raw.githubusercontent.com/${REPO}/${meta.commit}/${f}`));
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};

// a small arithmetic evaluator for Clarity's curve expressions: numbers, x, + - * / ^ and parentheses only
function evalExpr(src, x) {
  const t = src.replace(/\s+/g, ''); let i = 0;
  const peek = () => t[i];
  const num = () => { const m = t.slice(i).match(/^(\d+(\.\d+)?|\.\d+)/); if (!m) throw new Error(`bad expression ${src} at ${i}`); i += m[0].length; return +m[0]; };
  const atom = () => {
    if (peek() === '(') { i++; const v = sum(); if (t[i++] !== ')') throw new Error('missing ) in ' + src); return v; }
    if (peek() === '-') { i++; return -atom(); }
    if (peek() === 'x') { i++; return x; }
    return num();
  };
  const pow = () => { let v = atom(); while (peek() === '^') { i++; v = v ** atom(); } return v; };
  const prod = () => { let v = pow(); while (peek() === '*' || peek() === '/') { const o = t[i++]; const r = pow(); v = o === '*' ? v * r : v / r; } return v; };
  const sum = () => { let v = prod(); while (peek() === '+' || peek() === '-') { const o = t[i++]; const r = prod(); v = o === '+' ? v + r : v - r; } return v; };
  const v = sum(); if (i !== t.length) throw new Error(`unparsed ${src.slice(i)}`); return v;
}
const lin = (pts, x) => { for (let k = 1; k < pts.length; k++) if (x <= pts[k][0]) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return pts.at(-1)[1]; };
const r4 = v => Math.round(v * 1e4) / 1e4;
// a field: a constant, or a curve sampled at every whole stat point of its domain
function field(def) {
  if (typeof def === 'number') return def;
  const [from, to] = def.Domain; const vals = [];
  for (let x = from; x <= to; x++) {
    const seg = def.Segments.find(s => x >= (s.From ?? s.Points?.[0][0] ?? from) && x <= (s.To ?? s.Points?.at(-1)[0] ?? to)) || def.Segments.at(-1);
    vals.push(r4(seg.Type === 'Constant' ? seg.Value : seg.Type === 'Linear' ? lin(seg.Points, x) : evalExpr(seg.Expression, x)));
  }
  return vals.every(v => v === vals[0]) ? vals[0] : [from, vals];
}

const loc = await read('locale/en.json');
const out = { src: { repo: REPO, commit: meta.commit, date: meta.date, note: 'Clarity Character Stats v2 (Edge of Fate). Clarity marks these stat values as placeholders until tested.' }, stats: {}, charge: loc.ChargeBasedScaling };
for (const f of FILES.slice(0, 6)) {
  const d = await read(f);
  const name = d.Name; const L = loc[name] || {};
  const s = { hash: d.Hash, f: Object.fromEntries(Object.entries(d.Fields).map(([k, v]) => [k, field(v)])), t: { o: L.Overview || '', b: L.BaseStatTooltip || '', e: L.EnhancedStatTooltip || '' } };
  if (d.Abilities) s.ab = Object.fromEntries(d.Abilities.map(a => [a.Hash, [a.Name, a.BaseCooldown, a.ChunkEnergyScalar ?? null, a.ChargeBasedScaling ?? null]]));
  if (d.SuperAbilities) s.sup = Object.fromEntries(d.SuperAbilities.map(a => [a.Hash, [a.Name, a.BaseCooldown, a.ActiveRegenScalar ?? null, a.BaseDuration ?? null]]));
  if (d.Overrides?.length) s.ov = d.Overrides.map(o => [o.Hash, o.Name, o.Requirements, o.CooldownOverride ?? null, o.Scalar ?? null, o.ChunkEnergyOverride ?? null]);
  if (L.SuperAbilities) s.supTip = Object.fromEntries(Object.entries(L.SuperAbilities).map(([h, v]) => [h, v.EnhancedDurationTooltip || '']));
  out.stats[name] = s;
}
// fallback base cooldowns from the Destiny Data Compendium's element and class-ability tabs, for abilities Clarity
// hasn't added yet (Slicewire, Shatter Grenade, Phantom Surge…): { normalized name: [base cooldown s, chunk scalar] }
const SHEET = '1WaxvbLx7UoSZaBqdFr1u32F2uWVLo-CJunJB4nlGUE4';
const TABS = { arc: 618967225, solar: 1186062409, void: 1907852650, stasis: 1088259962, strand: 1870531554, prismatic: 1918152785, classabilities: 527596209 };
const norm = n => String(n).toLowerCase().replace(/[^a-z0-9]/g, '');
out.ddc = {};
for (const [tab, gid] of Object.entries(TABS)) {
  const p = path.join(RAW, `ddc-${tab}.csv`);
  if (!fs.existsSync(p) || refresh) fs.writeFileSync(p, await get(`https://docs.google.com/spreadsheets/d/${SHEET}/gviz/tq?tqx=out:csv&gid=${gid}`));
  // a row starts with "","Name": the base cooldown and chunk scalar sit in a later cell of the same row
  for (const row of fs.readFileSync(p, 'utf8').split(/\n(?="",")/)) {
    const n = row.match(/^"","([^"]+)"/)?.[1]; const c = row.match(/Base Cooldown: ([0-9.]+)/); if (!n || !c) continue;
    out.ddc[norm(n)] ??= [+c[1], +(row.match(/Chunk Scalar:\s*([0-9.]+)/)?.[1]) || null];
  }
}
out.src.ddc = 'Destiny Data Compendium (Pip1n), element and Class Abilities tabs: base cooldowns for abilities Clarity has not added yet';
fs.writeFileSync(OUT, JSON.stringify(out));
const st = out.stats;
console.log(`stats.json: ${Object.keys(out.ddc).length} Compendium fallbacks, ${Object.keys(st).length} stats, ${['Class', 'Grenade', 'Melee'].reduce((n, k) => n + Object.keys(st[k].ab || {}).length, 0)} abilities, ${Object.keys(st.Super.sup || {}).length} supers, commit ${meta.commit.slice(0, 7)} (${meta.date}), ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
