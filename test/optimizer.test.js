// Armor optimizer (Core.armorSearch, after D2ArmorPicker): node test/optimizer.test.js
const C = require('../src/core.js'), assert = require('assert');
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const K = C.ARMOR3; // Weapons Health Class Grenade Super Melee
// synthetic game data: hash 1 = Tier 5 legendary (general, slot, tuning, artifice sockets), hash 2 = plain legacy piece
const tuneMods = [['Balanced Tuning', 0, {}, 1], ...K.flatMap(u => K.filter(d => d !== u).map(d => [`+${u} / -${d}`, 0, { [u]: 5, [d]: -5 }, 2]))];
const D = { sock: { a: { 1: 0, 2: 1, 3: 2, 4: 2 }, lay: [[[0, 'g'], [1, 's'], [2, 't'], [3, 'a']], [[0, 'g'], [1, 's']], [[0, 'g'], [1, 's'], [2, 't']]], m: { t: tuneMods, a: K.map(k => [`${k} Forged`, 0, { [k]: 3 }, 3]) } } };
const SLOT = { head: 'Helmet', arms: 'Gauntlets', chest: 'Chest Armor', legs: 'Leg Armor', class: 'Warlock Bond' };
let id = 1000;
const piece = (slot, st, o = {}) => { const base = Object.fromEntries(K.map((k, i) => [k, st[i]])); return { id: String(id++), hash: String(o.hash || 2), kind: 'armor', name: o.name || `${slot} ${id}`, rarity: o.exotic ? 'Exotic' : 'Legendary', tier: o.tier ?? 5, category: SLOT[slot], type: SLOT[slot], equippable: o.cls || 'Warlock', frame: '', tuning: o.tuning || '', base, stats: { ...base }, perks: [], set: o.set || '' }; };
const sum = a => a.reduce((x, y) => x + y, 0);
// what a result really adds up to: base stats (with masterwork) + tunings + mods
function check(r, res, target) {
  const st = [0, 0, 0, 0, 0, 0];
  r.ids.forEach(i => res.pieces.get(i).st.forEach((v, k) => st[k] += v));
  for (const [, name] of r.tunes) {
    const m = name.match(/^\+(\w+) \/ -(\w+)$/);
    if (m) { st[K.indexOf(m[1])] += 5; st[K.indexOf(m[2])] -= 5; }
  }
  r.mods.forEach(([a, mi, ma], i) => st[i] += a * 3 + mi * 5 + ma * 10);
  const bal = r.tunes.filter(x => x[1] === 'Balanced Tuning').map(([s]) => res.pieces.get(r.ids[C.A_SLOTS.indexOf(s)]));
  for (const p of bal) for (const k of p.low) st[k] += 1;
  assert.deepStrictEqual(r.stats, st.map(v => Math.max(0, v)), 'stats add up');
  r.stats.forEach((v, i) => assert.ok(v >= target[i], `stat ${K[i]} ${v} reaches ${target[i]}`));
  assert.ok(sum(r.mods.map(m => m[1] + m[2])) <= 5, 'at most 5 stat mods');
  assert.ok(sum(r.mods.map(m => m[0])) <= r.ids.filter(i => res.pieces.get(i).art).length, 'artifice only on artifice pieces');
  assert.strictEqual(r.ids.filter(i => res.pieces.get(i).exotic).length <= 1, true, 'one exotic at most');
}

t('mod table: every way listed reaches the distance, cheapest first', () => {
  for (let d = 0; d <= 65; d++) for (const [a, mi, ma, pts] of C.OPT_TABLE[d]) { assert.strictEqual(pts, a * 3 + mi * 5 + ma * 10); assert.ok(pts >= d); assert.ok(mi + ma <= 5 && a <= 5); }
  assert.deepStrictEqual(C.OPT_TABLE[10][0], [4, 0, 0, 12], 'four artifice use no mod socket');
  assert.ok(C.OPT_TABLE[10].some(e => e.join() === '0,0,1,10'), 'one major');
  assert.strictEqual(C.OPT_TABLE[66].length, 0, 'beyond 5 majors + 5 artifice');
});
t('solver: fewest mods, then the cheaper ones, then fewest artifice', () => {
  const lim = { art: 1, mods: 5, major: 5 };
  assert.deepStrictEqual(C.optSolve([7, 0, 0, 0, 0, 0], lim).pick[0], [1, 1, 0, 8], 'minor + artifice beats a major');
  assert.deepStrictEqual(C.optSolve([3, 0, 0, 0, 0, 0], lim).pick[0], [1, 0, 0, 3], 'artifice alone costs no mod');
  assert.strictEqual(C.optSolve([60, 0, 0, 0, 0, 0], { art: 0, mods: 5, major: 5 }), null, 'over 50 needs more than 5 mods');
  assert.strictEqual(C.optSolve([20, 0, 0, 0, 0, 0], { art: 0, mods: 5, major: 1 }).pick[0].join(), '0,2,1,20', 'major limit');
  assert.strictEqual(C.optSolve([0, 0, 0, 0, 0, 0], lim).score, 0);
});

// a small vault: 3 pieces per slot, one exotic helmet, one exotic chest
const V = [];
const rolls = [[30, 25, 20, 5, 5, 5], [5, 30, 5, 25, 20, 5], [5, 5, 30, 5, 25, 20], [20, 5, 5, 30, 5, 25], [25, 20, 5, 5, 30, 5], [5, 20, 25, 5, 5, 30]];
const tunedName = ['Weapons', 'Health', 'Class', 'Grenade', 'Super', 'Melee'];
C.A_SLOTS.forEach((s, si) => { for (let j = 0; j < 3; j++) V.push(piece(s, rolls[(si + j * 2) % 6], { hash: j === 0 ? 1 : 2, tuning: j === 0 ? tunedName[(si + j) % 6] : '' })); });
V.push(piece('head', [5, 30, 20, 25, 5, 5], { exotic: true, hash: 3, name: 'Exotic Hood' }));
V.push(piece('chest', [5, 25, 5, 30, 20, 5], { exotic: true, hash: 4, name: 'Exotic Robes' }));
V.push(piece('arms', [30, 30, 30, 30, 30, 30], { cls: 'Titan' }));

t('results reach every target and add up, with one exotic at most', () => {
  const target = [0, 90, 0, 90, 0, 60];
  const res = C.armorOptimize(V, D, { cls: 'warlock', target, tuning: true });
  assert.ok(res.results.length > 0);
  for (const r of res.results) check(r, res, target);
  assert.ok(!res.results.some(r => r.ids.some(i => res.pieces.get(i).cls === 'titan')), 'other classes are left out');
});
t('reachable max: a target at the max has results, one point more has none', () => {
  const target = [0, 0, 0, 0, 0, 60];
  const res = C.armorOptimize(V, D, { cls: 'warlock', target, tuning: true });
  const m = res.max[5]; assert.ok(m >= 60 && m < 200, String(m));
  assert.deepStrictEqual(res.exact, [5], 'only stats with a target have an exact max');
  assert.ok(C.armorOptimize(V, D, { cls: 'warlock', target: [0, 0, 0, 0, 0, m], tuning: true }).results.length > 0, 'max is reachable');
  assert.strictEqual(C.armorOptimize(V, D, { cls: 'warlock', target: [0, 0, 0, 0, 0, m + 1], tuning: true }).results.length, 0, 'max + 1 is not');
});
t('exotic choice: none, any, a specific one', () => {
  const target = [0, 50, 0, 0, 0, 0];
  const none = C.armorOptimize(V, D, { cls: 'warlock', target, exotic: 'none' });
  assert.ok(none.results.length && none.results.every(r => !r.exotic));
  const any = C.armorOptimize(V, D, { cls: 'warlock', target, exotic: 'any' });
  assert.ok(any.results.length && any.results.every(r => r.exotic));
  const ex = V.find(i => i.name === 'Exotic Robes');
  const one = C.armorOptimize(V, D, { cls: 'warlock', target, exotic: ex.hash });
  assert.ok(one.results.length && one.results.every(r => one.pieces.get(r.ids[2]).hash === ex.hash && r.ids.filter(i => one.pieces.get(i).exotic).length === 1));
});
t('locks, exclusions and set requirements', () => {
  const head = V.find(i => i.category === 'Helmet' && !/exotic/i.test(i.rarity));
  const res = C.armorOptimize(V, D, { cls: 'warlock', target: [0, 40, 0, 0, 0, 0], lock: { head: head.id } });
  assert.ok(res.results.length && res.results.every(r => r.ids[0] === head.id));
  const ex = C.armorOptimize(V, D, { cls: 'warlock', target: [0, 40, 0, 0, 0, 0], exclude: [head.id] });
  assert.ok(ex.results.every(r => r.ids[0] !== head.id));
  const sv = V.map(i => ({ ...i, set: ['Helmet', 'Gauntlets'].includes(i.category) ? 'Twin Set' : '' }));
  const set = C.armorOptimize(sv, D, { cls: 'warlock', target: [0, 30, 0, 0, 0, 0], sets: [{ n: 'Twin Set', c: 2 }] });
  assert.ok(set.results.length && set.results.every(r => r.ids.filter(i => set.pieces.get(i).set === 'Twin Set').length >= 2));
  assert.strictEqual(C.armorOptimize(sv, D, { cls: 'warlock', target: [0, 30, 0, 0, 0, 0], sets: [{ n: 'Twin Set', c: 4 }] }).results.length, 0);
});
t('tuning: a Tier 5 piece tuned into the short stat saves a mod', () => {
  // five pieces only; Health 5 short of the target, the helmet is tuned to Health, Weapons has room to give
  const P = ['head', 'arms', 'chest', 'legs', 'class'].map((s, i) => piece(s, [30, 15, 5, 5, 5, 5], { hash: i ? 2 : 1, tuning: i ? '' : 'Health' }));
  const target = [0, 80, 0, 0, 0, 0]; // armor gives 75 Health (masterwork goes to the 3 lowest stats, not Health)
  const off = C.armorOptimize(P, D, { target, tuning: false }).results[0];
  const on = C.armorOptimize(P, D, { target, tuning: true });
  assert.strictEqual(off.nMods, 1);
  assert.strictEqual(on.results[0].nMods, 0);
  assert.deepStrictEqual(on.results[0].tunes, [['head', '+Health / -Weapons']]);
  check(on.results[0], on, target);
  const where = C.optMods(off, on.pieces);
  assert.strictEqual(where.head.g, 'Minor Health Mod');
});
t('masterwork: assumed level 5 on the 3 lowest base stats, or the piece’s own', () => {
  const it = piece('head', [30, 25, 20, 5, 5, 5], { hash: 2 });
  assert.deepStrictEqual(C.optPiece(it, D, {}).st, [30, 25, 20, 10, 10, 10]);
  assert.deepStrictEqual(C.optPiece(it, D, { assumeLegendaryMw: false }).st, [30, 25, 20, 5, 5, 5]);
  const mw = { ...it, stats: { ...it.stats, Grenade: 7, Super: 7, Melee: 7 } };
  assert.deepStrictEqual(C.optPiece(mw, D, { assumeLegendaryMw: false }).st, [30, 25, 20, 7, 7, 7]);
});
t('no tuning: same answer as trying every combination by hand', () => {
  let seed = 7; const rnd = k => (seed = (seed * 16807) % 2147483647) % k;
  for (let round = 0; round < 6; round++) {
    const P = C.A_SLOTS.flatMap(s => Array.from({ length: 3 }, () => piece(s, rolls[rnd(6)], { hash: rnd(2) ? 1 : 2, tier: 3 })));
    const target = K.map(() => [0, 0, 40, 60, 80][rnd(5)]);
    const res = C.armorOptimize(P, D, { target, tuning: false });
    const ps = P.map(i => C.optPiece(i, D, {})); let best = null;
    const by = C.A_SLOTS.map(s => ps.filter(p => p.slot === s));
    for (const a of by[0]) for (const b of by[1]) for (const c of by[2]) for (const d of by[3]) for (const e of by[4]) {
      const five = [a, b, c, d, e]; const st = K.map((_, i) => sum(five.map(p => p.st[i])));
      const sol = C.optSolve(st.map((v, i) => Math.max(0, target[i] - v)), { art: sum(five.map(p => p.art)), mods: 5, major: 5 });
      if (sol && (best === null || sol.score < best)) best = sol.score;
    }
    const got = res.results.length ? Math.min(...res.results.map(r => r.nMods * 1000 + r.cost * 10 + r.art)) : null;
    assert.strictEqual(got, best, `round ${round}: best mod use`);
    for (const r of res.results) check(r, res, target);
  }
});
console.log(`${n} optimizer tests passed`);
