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
// curated engine, on a fixed fixture (the user's case: Child of the Old Gods with Empowering Rift + Briarbinds)
const IXF = {
  t: { voidsoul: { l: 'Void Soul', kind: 'object', el: 'void' }, weaken: { l: 'Weaken', kind: 'debuff', el: 'void' }, grenadeenergy: { l: 'Grenade energy', kind: 'energy' }, meleeenergy: { l: 'Melee energy', kind: 'energy' }, healing: { l: 'Healing', kind: 'buff' }, rift: { l: 'Rift', kind: 'ability' }, grenade: { l: 'Grenade ability', kind: 'ability' }, classability: { l: 'Class ability', kind: 'ability' }, melee: { l: 'Melee', kind: 'ability' }, super: { l: 'Super', kind: 'ability' }, movement: { l: 'Movement', kind: 'ability' }, scorch: { l: 'Scorch', kind: 'debuff', el: 'solar' } },
  p: {
    'sub:childoftheoldgods': [
      { do: 'creates', t: 'voidsoul', q: 'Cast your rift to create a Void Soul.', s: 'bungie' },
      { do: 'uses', t: 'rift', q: 'Cast your rift to create a Void Soul.', s: 'bungie' },
      { do: 'applies', t: 'weaken', by: 'voidsoul', q: 'doing damage and weakening them', s: 'bungie' },
      { do: 'grants', t: 'grenadeenergy', by: 'voidsoul', if: [{ slot: 'classAbility', is: ['Healing Rift'] }], q: 'x', s: 'bungie' },
      { do: 'grants', t: 'meleeenergy', by: 'voidsoul', if: [{ slot: 'classAbility', is: ['Healing Rift'] }], q: 'x', s: 'bungie' },
      { do: 'grants', t: 'healing', by: 'voidsoul', if: [{ slot: 'classAbility', is: ['Empowering Rift'] }], q: 'or health (if running Empowering Rift)', s: 'bungie' },
      { do: 'counts', t: 'voidsoul', as: 'grenade', q: 'Void Soul counts as a Grenade Ability', s: 'clarity' }],
    'xa:briarbinds': [{ do: 'modifies', t: 'voidsoul', perk: 'One with the Void', q: 'Your Void Souls have a longer duration.', s: 'bungie' }],
    'sub:echoofremnants': [{ do: 'uses', t: 'grenade', q: 'grenade', s: 'bungie' }],
    'sub:echoofleeching': [{ do: 'uses', t: 'weaken', q: 'weakened', s: 'bungie' }],
  },
  pending: ['sub:echoofundermining'],
};
const vs = D.sub.warlock.void, vh = (k, nm) => vs.s[k].find(x => x.n === nm)?.h;
const voidBuild = rift => C.normBuild({ cls: 'warlock', el: 'void', sub: { classAbility: vh('classAbility', rift), grenade: vh('grenade', 'Vortex Grenade'), aspects: [vh('aspects', 'Child of the Old Gods'), vh('aspects', 'Feed the Void')], fragments: ['Echo of Leeching', 'Echo of Undermining'].map(n => vh('fragments', n)).filter(Boolean) } }, D);
const briar = { id: '6917529000000000099', kind: 'armor', type: 'Warlock Bond', category: '', hash: '1', name: 'Briarbinds', rarity: 'Exotic', perks: [], stats: {}, base: {} };
t('curated: conditions follow the build (Empowering Rift → healing, not energy)', () => {
  const b = voidBuild('Empowering Rift');
  const P = C.buildPieces(b, D, new Map()); const ev = C.ixEval(P, IXF, D);
  const child = P.findIndex(p => p.n === 'Child of the Old Gods');
  assert.ok(ev.fx.some(f => f.i === child && f.e.t === 'healing' && f.ok), 'health with Empowering Rift');
  const off = ev.inactive.filter(f => f.i === child).map(f => f.e.t).sort();
  assert.deepStrictEqual(off, ['grenadeenergy', 'meleeenergy'], 'energy only with Healing Rift');
  assert.match(ev.inactive.find(f => f.e.t === 'grenadeenergy').why[0], /needs Healing Rift \(you have Empowering Rift\)/);
  assert.ok(!ev.links.some(l => l.t === 'grenadeenergy' || l.t === 'meleeenergy'), 'no energy interaction is claimed');
  assert.ok(ev.links.some(l => l.t === 'rift' && l.to === child), 'Child of the Old Gods uses your rift');
  const hb = C.buildPieces(voidBuild('Healing Rift'), D, new Map()); const ev2 = C.ixEval(hb, IXF, D);
  assert.ok(ev2.links.some(l => l.t === 'grenadeenergy' && hb[l.to].slot === 'grenade'), 'with Healing Rift the energy feeds your grenade');
});
t('curated: objects, counts-as and modifies link pieces (Void Soul → Briarbinds, Void Soul as a grenade)', () => {
  const b = voidBuild('Empowering Rift'); b.a = { class: { id: briar.id } };
  const P = C.buildPieces(b, D, new Map([[briar.id, briar]])); const ev = C.ixEval(P, IXF, D);
  const child = P.findIndex(p => p.n === 'Child of the Old Gods'), bb = P.findIndex(p => p.n === 'Briarbinds'), rem = P.findIndex(p => p.n === 'Echo of Remnants');
  assert.ok(ev.links.some(l => l.t === 'voidsoul' && l.from === child && l.to === bb), 'Briarbinds changes the Void Soul from Child of the Old Gods');
  if (rem >= 0) assert.ok(ev.links.some(l => l.t === 'grenade' && l.from === child && l.via), 'the Void Soul counts as a grenade for grenade effects');
  const leech = P.findIndex(p => p.n === 'Echo of Leeching');
  assert.ok(ev.links.some(l => l.t === 'weaken' && l.from === child && l.to === leech), 'Void Soul weakens; Echo of Leeching pays off on weakened targets');
  assert.ok(ev.pending.some(i => P[i].n === 'Echo of Undermining'), 'uncurated pieces are listed as pending');
  for (const l of ev.links) assert.ok(l.from !== l.to);
});
t('curated: suggestions count switched-on effects (Healing Rift turns on the energy)', () => {
  const b = voidBuild('Empowering Rift'); const P = C.buildPieces(b, D, new Map());
  const r = C.subScore(b, D, 'classAbility', vh('classAbility', 'Healing Rift'), P, IXF);
  assert.ok(r.why.some(w => w.role === 'on' && w.k === 'grenadeenergy' && w.other === 'Child of the Old Gods'));
  assert.strictEqual(C.weaponSlot({ category: 'KineticSlot' }), 'kinetic'); assert.strictEqual(C.armorSlot({ category: '', type: 'Leg Armor' }), 'legs');
});
t('curated: no data means no claims', () => {
  const P = C.buildPieces(voidBuild('Healing Rift'), D, new Map()); const ev = C.ixEval(P, null, D);
  assert.strictEqual(ev.links.length, 0); assert.strictEqual(ev.keys.length, 0);
});
t('real curated data is valid (schema, terms, conditions, quotes)', () => {
  const r = require('../tools/interactions/check.js').check();
  assert.deepStrictEqual(r.errors, [], r.errors.slice(0, 10).join('\n'));
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
t('DIM loadout link: subclass socket overrides, items, mods, class', () => {
  const pr = D.sub.warlock.prism, ph = (k, nm) => pr.s[k].find(x => x.n === nm).h;
  assert.ok(!C.subList(pr, 'grenade').some(g => /prism_grenade$/.test(g.c)), 'transcendence grenade is not a grenade choice');
  assert.ok(C.subList(pr, 'transcendence').some(g => /prism_grenade$/.test(g.c)), 'it shows with Transcendence');
  const b = C.normBuild({ cls: 'warlock', el: 'solar', name: 'Sun', notes: 'n', sub: { super: sc.s.super[0].h, melee: h('melee', 'Incinerator Snap'), aspects: [h('aspects', 'Touch of Flame'), h('aspects', 'Heat Rises')], fragments: [h('fragments', 'Ember of Searing'), h('fragments', 'Ember of Torches')] }, w: { energy: { id: '6917529000000000001', hash: '1399243961', name: 'x' } }, mods: { head: ['Solar Siphon'] } }, D);
  const lo = C.dimLoadout(b, D, new Map(), 'u1');
  assert.strictEqual(lo.classType, 2); assert.strictEqual(lo.name, 'Sun'); assert.strictEqual(lo.notes, 'n');
  const sub = lo.equipped[0]; assert.strictEqual(sub.hash, sc.h); assert.ok(!('id' in sub));
  const ov = sub.socketOverrides, at = i => sc.so[i];
  for (const [i, ph2] of Object.entries(ov)) { const a = Object.values(sc.s).flat().find(x => x.h === ph2); assert.ok(at(+i).split('|').includes(a.c), `${a.n} placed in a socket that takes ${a.c}`); }
  assert.strictEqual(Object.keys(ov).length, 6);
  assert.deepStrictEqual(lo.equipped[1], { id: '6917529000000000001', hash: 1399243961 });
  assert.strictEqual(lo.parameters.mods.length, 1); assert.ok(Number.isInteger(lo.parameters.mods[0]));
  const url = C.dimLink(lo); assert.ok(url.startsWith('https://app.destinyitemmanager.com/loadouts?loadout='));
  assert.deepStrictEqual(JSON.parse(new URL(url).searchParams.get('loadout')), lo);
});
console.log(n, 'build tests passed');
