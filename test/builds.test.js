// Build maker: keyword roles, interactions, limits and stats (node test/builds.test.js)
const C = require('../src/core.js'), fs = require('fs'), assert = require('assert');
const D = JSON.parse(fs.readFileSync(__dirname + '/../data/defs.json', 'utf8'));
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const roles = text => Object.fromEntries(Object.entries(C.synTags([['Bungie', text]])).map(([k, v]) => [k, Object.keys(v).sort().join('')]));

t('keyword roles: produce / use / mention', () => {
  assert.deepStrictEqual(roles('Powered melee attacks against combatants make you and nearby allies radiant.'), { radiant: 'p' });
  assert.deepStrictEqual(roles('While radiant, your weapons deal more damage.'), { radiant: 'u' });
  assert.deepStrictEqual(roles('Defeating scorched targets grants melee energy.'), { scorch: 'u', meleeenergy: 'p' });
  assert.deepStrictEqual(roles('A grenade that continuously damages and scorches targets trapped inside.'), { scorch: 'p' });
  assert.deepStrictEqual(roles('Your class ability recharges faster when you scorch targets.'), { scorch: 'u' });
  assert.deepStrictEqual(roles('Defeating a target spreads scorch to those nearby.'), { scorch: 'p' });
  assert.deepStrictEqual(roles('Precision final blows cause nearby targets to become severed.'), { sever: 'p' });
  assert.deepStrictEqual(roles('Targets damaged by the mortar are scorched.'), { scorch: 'p' });
  assert.deepStrictEqual(roles('Damage against jolted targets is increased.'), { jolt: 'u' });
  assert.deepStrictEqual(roles('Rapid final blows create an Orb of Power.'), { orb: 'p' });
  assert.deepStrictEqual(roles('Picking up an Orb of Power grants Armor Charge.'), { orb: 'u', armorcharge: 'p' });
});
t('word forms and false friends', () => {
  assert.deepStrictEqual(roles('Freezing a target makes it frozen.'), { freeze: 'p' });
  assert.ok(!('restoration' in roles('Weapon kills restore 10 HP.')), 'restore is not Restoration');
  assert.ok(!('slow' in roles('Slowly regenerates.')), 'slowly is not slow');
});
t('negated sentences are never claimed', () => {
  assert.deepStrictEqual(roles('This does not apply scorch to targets.'), {});
  assert.deepStrictEqual(roles('Cannot jolt combatants.'), {});
});
t('every keyword is element-tagged or generic, with a label', () => {
  for (const s of C.SYN) { assert.ok(s.l && s.re instanceof RegExp); assert.ok(['solar', 'arc', 'void', 'stasis', 'strand', 'prism', ''].includes(s.el), s.k); }
});

const sc = D.sub.warlock.solar; const h = (k, nm) => sc.s[k].find(x => x.n === nm).h;
t('limits: 2 aspects, fragments up to aspect slots, 3 mods a slot, unknown hashes dropped', () => {
  const b = C.normBuild({ cls: 'warlock', el: 'solar', sub: { super: 123, aspects: [h('aspects', 'Hellion'), h('aspects', 'Touch of Flame'), h('aspects', 'Heat Rises')], fragments: sc.s.fragments.map(f => f.h) }, mods: { head: ['a', 'b', 'c', 'd'] } }, D);
  assert.strictEqual(b.sub.super, undefined);
  assert.strictEqual(b.sub.aspects.length, 2);
  assert.strictEqual(C.fragSlots(b, D), 4);   // Hellion 2 + Touch of Flame 2 (Bungie energyCapacity)
  assert.strictEqual(b.sub.fragments.length, 4);
  assert.strictEqual(b.mods.head.length, 3);
});
t('interactions: producer -> keyword -> user, with evidence from the source text', () => {
  const b = C.normBuild({ cls: 'warlock', el: 'solar', sub: { melee: h('melee', 'Incinerator Snap'), aspects: [h('aspects', 'Touch of Flame'), h('aspects', 'Heat Rises')], fragments: [h('fragments', 'Ember of Searing')] }, mods: { head: ['Solar Siphon'] } }, D);
  const P = C.buildPieces(b, D, new Map());
  const { links } = C.synergy(P);
  const l = links.find(x => x.k === 'scorch' && P[x.from].n === 'Incinerator Snap' && P[x.to].n === 'Ember of Searing');
  assert.ok(l, 'Incinerator Snap scorches, Ember of Searing pays off on scorched targets');
  assert.match(l.ef.text, /scorch/i); assert.match(l.et.text, /scorched/i);
  assert.ok(links.some(x => x.k === 'meleeenergy' && P[x.to].n === 'Incinerator Snap'), 'melee energy feeds the chosen melee');
  for (const x of links) assert.ok(x.from !== x.to);
});
t('weapon element links and suggestions rank synergy', () => {
  const { items } = C.parseDimCsv(fs.readFileSync(__dirname + '/fixtures/sample-weapons.csv', 'utf8')); C.applyDefs(items, D);
  const it = items.find(i => i.element === 'Stasis');
  const b = { cls: 'warlock', el: 'solar', sub: {}, w: { power: { id: it.id } }, mods: { legs: ['Stasis Weapon Surge'] } };
  const P = C.buildPieces(C.normBuild(b, D), D, new Map(items.map(i => [i.id, i])));
  assert.ok(C.synergy(P).links.some(x => x.k === 'el' && P[x.from].it === it), 'a Stasis weapon matches "Stasis weapons" in a mod');
  const r = C.synScore(it, C.buildPieces({ mods: { legs: ['Stasis Weapon Surge'] } }, D, new Map()), D, 'power');
  assert.ok(r.score >= 2 && r.why.some(w => w.k === 'el'));
  assert.strictEqual(C.weaponSlot({ category: 'KineticSlot' }), 'kinetic'); assert.strictEqual(C.weaponSlot({ category: 'Power' }), 'power');
  assert.strictEqual(C.armorSlot({ category: '', type: 'Warlock Bond' }), 'class'); assert.strictEqual(C.armorSlot({ category: '', type: 'Leg Armor' }), 'legs');
});
t('stats: armor + fragment + mod bonuses (Bungie investment stats)', () => {
  const arm = { id: '1', kind: 'armor', type: 'Helmet', category: 'Helmet', hash: '0', name: 'H', perks: [], stats: { Health: 30, Melee: 13 }, base: { Health: 25, Melee: 10 } };
  const b = C.normBuild({ cls: 'warlock', el: 'solar', sub: { aspects: [h('aspects', 'Hellion')], fragments: [h('fragments', 'Ember of Torches')] }, a: { head: { id: '1' } }, mods: { head: ['Grenade Mod'] } }, D);
  const s = C.buildStats(b, D, new Map([['1', arm]]));
  assert.strictEqual(s.src, 'base');
  assert.strictEqual(s.stats.Health.armor, 25);
  assert.strictEqual(s.stats.Grenade.frag, -10);      // Ember of Torches
  assert.strictEqual(s.stats.Grenade.mods, 10);       // Grenade Mod
  assert.strictEqual(s.stats.Grenade.total, 0);
  assert.ok(C.modCost('Grenade Mod', 'head', D) > 0);
});
console.log(n, 'build tests passed');
