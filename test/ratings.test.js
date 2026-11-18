// Ratings unit tests (part of `npm test`): DIM wish-list parser, tags and notes, the committed-table validator,
// personal overrides, wish-list matching, perk / combo scoring, weights and rescaling, and the shipped table.
const assert = require('assert');
const fs = require('fs'), path = require('path');
const C = require('../src/core.js');
let n = 0, failed = 0;
const t = (name, fn) => { n++; try { fn(); console.log('  ok  ', name); } catch (e) { failed++; console.log('  FAIL', name, '\n      ', e.message); } };

// ---------- parser ----------
const LIST = [
  'title:Test list',
  'description:Thanks to @a, u/b for their contributions.',
  '',
  '//notes:Block note (PvE PvE-Minor M+KB Controller): good for adds',
  'dimwishlist:item=100&perks=1,2,3,4',
  'dimwishlist:item=100&perks=1,2,3,5',
  'dimwishlist:item=100&perks=6,2,3,4#notes:Inline wins|tags:pvp,mkb',
  '',
  'dimwishlist:item=100&perks=7',
  'dimwishlist:item=-100&perks=8,9',
  'dimwishlist:item=-69420&perks=10',
  'dimwishlist:item=200',
  'dimwishlist:item=abc&perks=1',
  'dimwishlist:item=300&perks=1,x,<script>,2',
  'not a wish list line',
  'title:Second list PvP picks',
  'dimwishlist:item=400&perks=1#notes:no tags here',
].join('\n');
const W = C.parseWishlist(LIST);
t('parser: header, rolls, malformed lines skipped', () => {
  assert.strictEqual(W.title, 'Test list');
  assert.match(W.description, /@a, u\/b/);
  assert.strictEqual(W.rolls.length, 9);
  assert.ok(!W.rolls.some(r => r.item === 'abc'));
});
t('parser: //notes apply to the block until a blank line; #notes override', () => {
  assert.match(W.rolls[0].notes, /Block note/); assert.match(W.rolls[1].notes, /Block note/);
  assert.strictEqual(W.rolls[2].notes, 'Inline wins|tags:pvp,mkb');
  assert.strictEqual(W.rolls[3].notes, '');
});
t('parser: trash (-hash) and every-item (-69420) rolls', () => {
  assert.deepStrictEqual([W.rolls[4].item, W.rolls[4].trash], ['100', true]);
  assert.deepStrictEqual([W.rolls[5].item, W.rolls[5].trash], ['*', false]);
  assert.deepStrictEqual(W.rolls[6].perks, []); // item=200 with no perks
});
t('parser: only digit perk hashes survive', () => {
  assert.deepStrictEqual(W.rolls[7].perks, ['1', '2']);
});
t('parser: caps line length and roll count', () => {
  const big = 'dimwishlist:item=1&perks=' + '1,'.repeat(15000);
  assert.strictEqual(C.parseWishlist(big).rolls.length, 0);
  assert.strictEqual(C.parseWishlist('dimwishlist:item=1&perks=1\n'.repeat(50), 10).rolls.length, 10);
  assert.ok(C.parseWishlist('dimwishlist:item=1&perks=' + Array.from({ length: 40 }, (_, i) => i + 1).join(',')).rolls[0].perks.length <= 20);
});
t('tags: |tags:, a tag group in parentheses, the title, then words', () => {
  const { PVE, PVP, MKB, CTRL } = C.WL;
  assert.strictEqual(W.rolls[0].tags, PVE | MKB | CTRL);
  assert.strictEqual(W.rolls[2].tags, PVP | MKB);
  assert.strictEqual(W.rolls[8].tags, PVP); // from the title "Second list PvP picks"
  assert.strictEqual(C.wlTags('x|tags:controller,god-pve'), PVE | CTRL);
  assert.strictEqual(C.wlTags('pandapaxxy (PvP / Controller): ok'), PVP | CTRL);
  assert.strictEqual(C.wlTags('A PvE roll, or a bit of PvP'), 0); // both words, no tag list: untagged
  assert.strictEqual(C.wlTags('Great in PvE.'), PVE);
});
t('wlNote: drops the tag list and tag group, collapses space, shortens', () => {
  assert.strictEqual(C.wlNote('By @x (PvE PvE-Minor M+KB):  good\n roll|tags:pve'), 'By @x: good roll');
  const long = C.wlNote('word '.repeat(100), 50); assert.ok(long.length <= 50 && long.endsWith('…'));
  assert.strictEqual(C.wlNote('keep (this part) here'), 'keep (this part) here');
});

// ---------- validators ----------
t('prepGhostRatings: hostile shapes are dropped or coerced', () => {
  const R = C.prepGhostRatings({
    wl: { p: ['A', 7, '<img onerror=x>'], n: ['n'], w: { '1': [[1, 0, [[0, 1, 99, -1, 'x']]], 'bad', [3]], 'x1': [[1, 0, [[0]]]], '__proto__': [[1, 0, [[0]]]], '*': [[2, 9, [[2]]]] } },
    ae: { tabs: ['Autos'], n: ['note'], w: { '5': ['S', 0, 0, [['A', 'Old'], ['Z', 'bad'], 'x']], '6': ['Q', 0, 0], '7': 'S' } },
    pk: { killclip: ['Kill Clip', 'w', 't', 'S', 'nope', 'src', 9, ['Auto Rifle', 5], 'Void'], wrong: ['Kill Clip', 'w'] },
    cb: [['A', 'B', 'S', 'A', 3], ['', 'B'], 'x'], meta: { credits: 42 },
  });
  assert.deepStrictEqual([...R.wl.w.keys()].sort(), ['*', '1']);
  assert.deepStrictEqual(R.wl.w.get('1')[0].sets, [[0, 1]]);
  assert.strictEqual(R.wl.p[1], '');
  assert.strictEqual(R.wl.w.get('*')[0].note, -1);
  assert.deepStrictEqual([...R.ae.w.keys()], ['5']);
  assert.deepStrictEqual(R.ae.w.get('5').alts, [['A', 'Old']]);
  assert.strictEqual(R.pk.size, 1);
  const kc = R.pk.get('killclip'); assert.strictEqual(kc.p, ''); assert.strictEqual(kc.sp, ''); assert.deepStrictEqual(kc.types, ['Auto Rifle']); assert.strictEqual(kc.el, 'Void');
  assert.strictEqual(R.cb.length, 1); assert.strictEqual(R.meta.credits, '');
  for (const bad of [null, 5, 'x', [], { wl: 'x', ae: [], pk: 3 }]) assert.doesNotThrow(() => C.prepGhostRatings(bad));
});
t('prepUserRatings: only known tiers, valid keys and weights in range', () => {
  const U = C.prepUserRatings({
    p: { killclip: { e: 'S', p: 'x' }, 'bad key': { e: 'S' }, rampage: { e: '<b>', p: 'Q' }, frenzy: 'S' },
    c: { 'killclip|rampage': { a: 'Kill Clip', b: 'Rampage', e: 'A' }, 'a|b': { a: 'X', b: 'Y', e: 'S' }, 'killclip|killclip': { a: 'Kill Clip', b: 'Kill Clip', e: 'S' } },
    w: { perks: 80, wish: -5, aegis: '30', extra: 9 },
  });
  assert.deepStrictEqual(U.p, { killclip: { e: 'S', p: 'x' } });
  assert.deepStrictEqual(Object.keys(U.c), ['killclip|rampage']);
  assert.deepStrictEqual(U.w, { perks: 80, wish: 25, aegis: 30 });
  for (const bad of [null, 'x', 7, { p: [], c: 'x', w: null }]) assert.deepStrictEqual(C.prepUserRatings(bad).w, C.DEFAULT_WEIGHTS);
});

// ---------- scoring ----------
// minimal defs: socket types for the perk names (b barrel, m magazine, t trait, o origin)
const defs = { pi: {} };
for (const [n, ty] of [['Arrowhead Brake', 'b'], ['Corkscrew Rifling', 'b'], ['Tactical Mag', 'm'], ['Flared Magwell', 'm'], ['Kill Clip', 't'], ['Outlaw', 't'], ['Rampage', 't'], ['Frenzy', 't'], ['Veist Stinger', 't'], ['Dealer\'s Choice', 'o']]) defs.pi[C.norm(n)] = [-1, ty, '', 1];
const weapon = (perks, hash = '100') => ({ kind: 'weapon', hash, name: 'Test Gun', frame: '', perks: perks.map(([n, s]) => ({ n, s: !!s })) });
// barrel (equipped Arrowhead), mag (equipped Tactical), trait 1 (Outlaw equipped, Kill Clip option), trait 2 (Rampage equipped)
const roll = () => weapon([['Arrowhead Brake', 1], ['Corkscrew Rifling'], ['Tactical Mag', 1], ['Outlaw', 1], ['Kill Clip'], ['Rampage', 1], ['Frenzy']]);
const P = ['Arrowhead Brake', 'Tactical Mag', 'Kill Clip', 'Outlaw', 'Rampage', 'Frenzy', 'Veist Stinger'];
const pi = n => P.indexOf(n);
const table = {
  wl: { p: P, n: ['PvE note', 'PvP note', 'trash'], w: {
    '100': [[C.WL.PVE, 0, [[pi('Arrowhead Brake')], [pi('Tactical Mag')], [pi('Outlaw')], [pi('Rampage')]]],
      [C.WL.PVP, 1, [[pi('Kill Clip')], [pi('Frenzy')]]]],
  } },
  ae: { tabs: ['Pulses'], n: ['his note'], w: { '100': ['A', 0, 0] } },
  pk: { arrowheadbrake: ['Arrowhead Brake', 'w', 'b', 'S', 'S'], tacticalmag: ['Tactical Mag', 'w', 'm', 'A', 'B'], outlaw: ['Outlaw', 'w', 't', 'B', 'C'],
    killclip: ['Kill Clip', 'w', 't', 'S', 'S'], rampage: ['Rampage', 'w', 't', 'A', 'A'], frenzy: ['Frenzy', 'w', 't', 'S', 'D'] },
  cb: [['Outlaw', 'Rampage', 'S', '']],
};
const R = C.prepGhostRatings(table);
t('wish list: equipped perks match fully, other options count 0.4, traits double', () => {
  const it = roll(); C.rateGhost(it, defs, R, C.prepUserRatings(null));
  assert.strictEqual(it.why.wish.e.score, 100); // every PvE set hit by an equipped perk
  // PvP roll: Kill Clip (option only, trait: 0.4×2) + Frenzy (option only, trait: 0.4×2) → 40
  assert.strictEqual(it.why.wish.p.score, 40);
  assert.strictEqual(it.why.wish.e.note, 'PvE note');
});
t('wish list: a fully matched trash roll sets that mode to 0; other items unaffected', () => {
  const T = C.prepGhostRatings({ ...table, wl: { ...table.wl, w: { '100': [...table.wl.w['100'], [C.WL.TRASH | C.WL.PVE, 2, [[pi('Outlaw')], [pi('Rampage')]]]] } } });
  const it = roll(); C.rateGhost(it, defs, T, null);
  assert.strictEqual(it.why.wish.e.score, 0); assert.ok(it.why.wish.e.trash);
  assert.strictEqual(it.why.wish.p.score, 40);
  const other = roll(); other.hash = '999'; C.rateGhost(other, defs, T, null); assert.strictEqual(other.why.wish, null);
});
t('wish list: every-item (*) rolls apply to any weapon', () => {
  const T = C.prepGhostRatings({ ...table, wl: { ...table.wl, w: { '*': [[0, 0, [[pi('Rampage')]]]] } } });
  const it = roll(); it.hash = '555'; C.rateGhost(it, defs, T, null);
  assert.strictEqual(it.why.wish.e.score, 100); assert.strictEqual(it.why.wish.p.score, 100); // untagged = both modes
});
t('perks: the best roll from every option counts, not just the equipped perks (traits ×2, best combo ×2)', () => {
  const it = roll(); C.rateGhost(it, defs, R, null);
  const e = it.why.perks.e;
  // equipped Outlaw (B) + Rampage (A) + their S combo: (100 + 85 + 70×2 + 85×2 + 100×2) / 8 = 86.9
  // unselected Kill Clip (S) + Frenzy (S), no combo:  (100 + 85 + 100×2 + 100×2) / 6 = 97.5  -> wins
  assert.deepStrictEqual(e.cols.map(c => c.pick), ['Arrowhead Brake', 'Tactical Mag', 'Kill Clip', 'Frenzy']);
  assert.deepStrictEqual(e.cols.map(c => c.switched), [false, false, true, true]);
  assert.deepStrictEqual(e.switched, ['Kill Clip', 'Frenzy']);
  assert.strictEqual(e.score, 98); assert.strictEqual(e.equipped, 87);
  assert.strictEqual(e.combos.length, 0);
  assert.strictEqual(it.why.perks.p.combos.length, 0); // the combo has no PvP tier
});
t('perks: a rated combo can make an unselected pair the best roll; ties keep the equipped perks', () => {
  // PvP: Kill Clip (S, option) + Rampage (A, equipped) scores 90; rating Kill Clip + Rampage S as a combo lifts it to 92.5
  const U = C.prepUserRatings({ c: { [C.comboKey('Kill Clip', 'Rampage')]: { a: 'Kill Clip', b: 'Rampage', p: 'S' } } });
  const it = roll(); C.rateGhost(it, defs, R, U); const p = it.why.perks.p;
  assert.deepStrictEqual(p.combos.map(c => [c.a, c.b, c.tier, c.equipped]), [['Kill Clip', 'Rampage', 'S', false]]);
  assert.strictEqual(p.score, 93); assert.deepStrictEqual(p.switched, ['Kill Clip']);
  // same tier on equipped and option: the equipped one is kept
  const T = C.prepUserRatings({ p: { outlaw: { e: 'S' }, rampage: { e: 'S' }, killclip: { e: 'S' }, frenzy: { e: 'S' } } });
  const t2 = roll(); C.rateGhost(t2, defs, R, T); assert.deepStrictEqual(t2.why.perks.e.switched, []);
  assert.deepStrictEqual(t2.why.perks.e.combos.map(c => c.a + '+' + c.b), ['Outlaw+Rampage']);
});
t('mix: weights 50/25/25, Aegis PvE only, rating = average of PvE and PvP', () => {
  const it = roll(); C.rateGhost(it, defs, R, null);
  const pe = it.why.perks.e.score, pp = it.why.perks.p.score;
  assert.strictEqual(it.pve, Math.round((pe * 50 + 100 * 25 + 85 * 25) / 100));
  assert.strictEqual(it.pvp, Math.round((pp * 50 + 40 * 25) / 75));
  assert.strictEqual(it.rating, Math.round((it.pve + it.pvp) / 2));
  assert.strictEqual(it.why.aegis.tier, 'A'); assert.strictEqual(it.why.aegis.tab, 'Pulses');
});
t('mix: missing parts are left out and the rest rescaled; nothing at all = unrated', () => {
  const it = roll(); it.hash = '777'; C.rateGhost(it, defs, R, null);
  assert.strictEqual(it.pve, it.why.perks.e.score); assert.strictEqual(it.pvp, it.why.perks.p.score);
  const bare = weapon([['Unknown Perk', 1]], '777'); C.rateGhost(bare, defs, R, null);
  assert.strictEqual(bare.rating, null); assert.strictEqual(bare.pve, null);
  const armor = { kind: 'armor', hash: '100', perks: [] }; C.rateGhost(armor, defs, R, null); assert.strictEqual(armor.rating, null);
});
t('overrides: a personal tier, "unrated", combos and weights change the score', () => {
  const base = roll(); C.rateGhost(base, defs, R, null);
  const U = C.prepUserRatings({ p: { killclip: { e: 'x' }, frenzy: { e: 'D' } } }); const it = roll(); C.rateGhost(it, defs, R, U);
  assert.ok(it.why.perks.e.score < base.why.perks.e.score);
  assert.deepStrictEqual(it.why.perks.e.cols.map(c => c.pick).slice(2), ['Outlaw', 'Rampage']); // back to the equipped pair + combo
  assert.strictEqual(C.perkTier('Kill Clip', 'e', R, U), ''); assert.strictEqual(C.perkTier('Kill Clip', 'p', R, U), 'S');
  const X = C.prepUserRatings({ p: { arrowheadbrake: { e: 'x', p: 'x' } } }); const x = roll(); C.rateGhost(x, defs, R, X);
  assert.strictEqual(x.why.perks.e.cols[0].score, null);
  const W0 = C.prepUserRatings({ w: { perks: 0, wish: 100, aegis: 0 } }); const w = roll(); C.rateGhost(w, defs, R, W0);
  assert.strictEqual(w.pve, 100); assert.strictEqual(w.pvp, 40);
  const none = C.prepUserRatings({ w: { perks: 0, wish: 0, aegis: 0 } }); const z = roll(); C.rateGhost(z, defs, R, none); assert.strictEqual(z.rating, null);
});
t('perkRel: perk tiers feed the perk chips', () => {
  const it = roll(); C.rateGhost(it, defs, R, null);
  assert.deepStrictEqual(it.perkRel['Kill Clip'], { e: 'S', p: 'S', rel: 100 });
  assert.strictEqual(it.perkRel['Corkscrew Rifling'], undefined);
});
t('query keys rating / pve / pvp and sort work on the new fields', () => {
  const a = roll(); a.id = '1'; C.rateGhost(a, defs, R, null);
  const b = roll(); b.id = '2'; b.hash = '777'; C.rateGhost(b, defs, R, null);
  const ctx = C.buildCtx([a, b], null, defs);
  const r = C.runQuery(C.parseQuery(`pve>=${a.pve}`), [a, b], ctx);
  assert.ok(r.has('1')); assert.ok([...r.get('1')].includes('rating'));
  assert.deepStrictEqual(C.sortItems([b, a], 'rating', 'desc').map(i => i.id)[0], a.rating >= b.rating ? '1' : '2');
});

// ---------- the shipped table ----------
t('data/ratings.json: validates without losses and has every part', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/ratings.json'), 'utf8'));
  const RR = C.prepGhostRatings(raw);
  assert.strictEqual(RR.wl.w.size, Object.keys(raw.wl.w).length);
  assert.strictEqual(RR.ae.w.size, Object.keys(raw.ae.w).length);
  assert.ok(RR.wl.w.size > 500 && RR.ae.w.size > 500 && RR.pk.size > 300 && RR.cb.length > 50);
  for (const [k, p] of RR.pk) assert.strictEqual(k, C.norm(p.n));
  // notes are plain text (rendered escaped); nothing in the table looks like markup
  assert.ok(!/<\s*(script|img|iframe|svg|a)\b/i.test(JSON.stringify(raw)));
  assert.ok(fs.statSync(path.join(__dirname, '../data/ratings.json')).size < 2.5 * 1048576);
});

console.log(`${n - failed}/${n} ratings tests passed`);
if (failed) process.exit(1);
