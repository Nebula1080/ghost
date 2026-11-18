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
  // unknown mod names fit no socket; a default piece has 1 general + 3 helmet sockets
  assert.deepStrictEqual(b.mods.head, [null, null, null, null]);
  const g = D.am.general[0][0], hm = D.am.head[0][0], am = D.am.arms[0][0];
  // mods land in sockets of their kind only (general -> socket 0, helmet mods -> 1-3, an arms mod is dropped); a mod that already fits its socket stays there
  assert.deepStrictEqual(C.normBuild({ cls: 'warlock', el: 'solar', mods: { head: [hm, g, am, hm] } }, D).mods.head, [g, hm, null, hm]);
  assert.ok(C.modsFor('head', D, 's').every(x => !D.am.arms.some(y => y[0] === x[0]) || D.am.head.some(y => y[0] === x[0])), 'helmet sockets list helmet mods only');
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
t('damage sources: payoffs that need weapon damage do not link to ability-applied effects; counts-as converts', () => {
  const ix = { t: { scorch: { l: 'Scorch', kind: 'debuff', el: 'solar' }, weapon: { l: 'Weapon damage', kind: 'damage' }, melee: { l: 'Melee', kind: 'ability' }, super: { l: 'Super', kind: 'ability' }, grenade: { l: 'Grenade', kind: 'ability' }, classability: { l: 'Class ability', kind: 'ability' }, movement: { l: 'Movement', kind: 'ability' }, damageresistance: { l: 'Damage resistance', kind: 'buff' } },
    p: { 'sub:incineratorsnap': [{ do: 'applies', t: 'scorch', q: 'x', s: 'bungie' }],
         'sub:emberofsearing': [{ do: 'uses', t: 'scorch', from: ['weapon'], q: 'x', s: 'bungie' }, { do: 'grants', t: 'damageresistance', amt: 20, vs: ['combatants'], q: '20', s: 'clarity' }],
         'sub:heatrises': [{ do: 'grants', t: 'damageresistance', amt: 25, vs: ['combatants'], on: 'while airborne', q: '25', s: 'clarity' }],
         'sub:emberofsingeing': [{ do: 'uses', t: 'scorch', from: ['melee'], q: 'x', s: 'bungie' }] } };
  const b = C.normBuild({ cls: 'warlock', el: 'solar', sub: { melee: h('melee', 'Incinerator Snap'), aspects: [h('aspects', 'Heat Rises'), h('aspects', 'Touch of Flame')], fragments: [h('fragments', 'Ember of Searing'), h('fragments', 'Ember of Singeing')] } }, D);
  const P = C.buildPieces(b, D, new Map()); const ev = C.ixEval(P, ix, D, 'solar');
  const nm = i => P[i].n;
  assert.ok(!ev.links.some(l => l.t === 'scorch' && nm(l.to) === 'Ember of Searing'), 'melee-applied scorch does not satisfy a weapon-only payoff');
  assert.ok(ev.unmatched.some(u => nm(u.c.i) === 'Ember of Searing'), 'listed as a source mismatch');
  assert.ok(ev.links.some(l => l.t === 'scorch' && nm(l.from) === 'Incinerator Snap' && nm(l.to) === 'Ember of Singeing'), 'melee scorch satisfies a melee payoff');
  // DR: 20% always, 25% situational -> 1 - 0.8 * 0.75 = 40% at most
  assert.strictEqual(ev.dr.combatants.always, 20); assert.strictEqual(ev.dr.combatants.all, 40);
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
t('equip build: subclass plan keeps what is in place, clears unwanted fragments first, then aspects, abilities, new fragments', () => {
  const AD = JSON.parse(fs.readFileSync(__dirname + '/../data/api-defs.json', 'utf8'));
  const sc = D.sub.warlock.solar, init = AD.c[sc.h];
  assert.ok(Array.isArray(init) && init.length === sc.so.length, 'api-defs has the Dawnblade empty plugs');
  // on the character: Daybreak, Healing Rift, Heat Rises + Hellion, fragments Torches / Char / Tempering / Combustion
  const plugs = init.slice(); plugs[5] = 83039194; plugs[6] = 83039192; plugs[7] = 362132288; plugs[8] = 362132291; plugs[9] = 362132290; plugs[10] = 362132289;
  const b = { cls: 'warlock', el: 'solar', sub: { super: 2274196884, classAbility: 2979486802, aspects: [83039192, 83039193], fragments: [362132289, 362132288, 362132291] }, w: {}, a: {}, mods: {} };
  const plan = C.subclassPlan(b, D, { plugs }, init);
  assert.deepStrictEqual(plan.map(x => [x.si, x.h]), [[9, init[9]], [5, 83039193], [2, 2274196884], [0, 2979486802]]);
  assert.match(plan[0].label, /Remove fragment Ember of Tempering/); assert.match(plan[1].label, /Aspect: Touch of Flame/);
  // nothing to do when it already matches; new fragments go into open sockets
  const after = plugs.slice(); for (const x of plan) after[x.si] = x.h;
  assert.deepStrictEqual(C.subclassPlan(b, D, { plugs: after }, init), []);
  const b2 = { ...b, sub: { ...b.sub, fragments: [...b.sub.fragments, 362132290] } };
  assert.deepStrictEqual(C.subclassPlan(b2, D, { plugs: after }, init).map(x => [x.si, x.h]), [[9, 362132290]]);
  // Bungie profile -> subclass instances with their plugs
  const resp = { characters: { data: { '2305843009300000001': { classType: 2 } } },
    characterEquipment: { data: { '2305843009300000001': { items: [{ itemHash: sc.h, itemInstanceId: '6917529000000000009' }] } } },
    itemComponents: { sockets: { data: { '6917529000000000009': { sockets: plugs.map(h => ({ plugHash: h })) } } } } };
  const r = C.apiToItems(resp, AD);
  assert.deepStrictEqual(r.subs, [{ id: '6917529000000000009', hash: sc.h, cid: '2305843009300000001', eq: true, plugs }]);
  assert.strictEqual(r.weapons.length + r.armor.length, 0);
});
t('artifact perks, set bonuses, natural states and damage-source rules', () => {
  // one artifact, 7 slots: 2 tier-1, 3 tier 1-2, 2 any tier
  const art = { h: 9, n: 'Art', d: '', i: '', p: [[1, 'A', 1, 'x', ''], [2, 'B', 1, '', ''], [3, 'C', 1, '', ''], [4, 'D', 2, '', ''], [5, 'E', 2, '', ''], [6, 'F', 2, '', ''], [7, 'G', 3, '', ''], [8, 'H', 3, '', ''], [10, 'I', 3, '', ''], [11, 'J', 1, '', '']] };
  const d = { ...D, artp: [art] };
  assert.deepStrictEqual(C.artValid([7, 8, 10, 99, 7], art), [7, 8], 'two tier-3 perks at most, unknown and duplicate hashes drop');
  assert.deepStrictEqual(C.artValid([4, 5, 6, 7, 8], art), [4, 5, 6, 7, 8], 'five slots take tier 2-3');
  assert.deepStrictEqual(C.artValid([4, 5, 6, 7, 8, 1, 2, 3], art), [4, 5, 6, 7, 8, 1, 2], 'seven perks at most');
  assert.deepStrictEqual(C.artValid([4, 5, 6, 7, 8, 9], art).length, 5);
  const b = { cls: 'warlock', el: 'arc', sub: { aspects: [], fragments: [] }, w: {}, a: {}, mods: {}, artA: 9, art: [1, 7] };
  const pcs = C.buildPieces(C.normBuild(b, d), d, new Map());
  assert.deepStrictEqual(pcs.filter(p => p.g === 'artifact').map(p => p.n), ['A', 'G']);
  assert.deepStrictEqual(C.normBuild({ ...b, artA: 5 }, d).art, [], 'perks of another artifact drop');
  assert.deepStrictEqual(C.ixIds({ g: 'artifact', n: 'Elemental Siphon' }), ['art:elementalsiphon']);
  assert.deepStrictEqual(C.ixIds({ g: 'armor', slot: 'set', n: "Stack 'Em Up" }), ['set:stackemup']);
  // natural states are never missing; Amplified is intrinsic to Arc only
  const ix = { t: { airborne: { kind: 'state', nat: true }, amplified: { kind: 'buff', nat: 'arc' } }, p: { 'mod:x': [{ do: 'uses', t: 'airborne' }, { do: 'uses', t: 'amplified' }] } };
  const gaps = el => C.ixEval([{ g: 'mod', n: 'X' }], ix, D, el).gaps.map(g => g.e.t);
  assert.deepStrictEqual(gaps('arc'), []);
  assert.deepStrictEqual(gaps('void'), ['amplified']);
  // a payoff on the damage term itself links to any piece that provides that term
  const ix2 = { t: { poweredmelee: { kind: 'ability' } }, p: { 'sub:howl': [{ do: 'creates', t: 'poweredmelee' }], 'mod:y': [{ do: 'uses', t: 'poweredmelee', from: ['poweredmelee'] }] } };
  const r = C.ixEval([{ g: 'subclass', slot: 'aspects', n: 'Howl' }, { g: 'mod', n: 'Y' }], ix2, D, 'stasis');
  assert.strictEqual(r.links.length, 1); assert.strictEqual(r.unmatched.length, 0);
});
t('healing yourself vs healing allies (real data): Devour does not feed Speaker\'s Sight, a Healing Grenade does', () => {
  const R = require('../tools/interactions/check.js'); const fs2 = require('fs'), path2 = require('path');
  const dir = path2.join(__dirname, '../data/interactions'); const ix = { t: {}, p: {} };
  for (const f of ['glossary.json', ...fs2.readdirSync(path2.join(dir, 'glossary')).map(f => 'glossary/' + f)]) Object.assign(ix.t, JSON.parse(fs2.readFileSync(path2.join(dir, f), 'utf8')).terms);
  for (const f of fs2.readdirSync(path2.join(dir, 'pieces'))) for (const r of JSON.parse(fs2.readFileSync(path2.join(dir, 'pieces', f), 'utf8'))) if (r.id !== '_skipped') ix.p[r.id] = r.fx;
  const links = pcs => C.ixEval(pcs, ix, D, 'void').links.map(l => `${pcs[l.from].n}>${pcs[l.to].n}:${l.t}`);
  const ss = { g: 'armor', n: "Speaker's Sight", it: { name: "Speaker's Sight", kind: 'armor', rarity: 'Exotic' } };
  const a = links([{ g: 'subclass', slot: 'aspects', n: 'Feed the Void' }, ss]);
  assert.ok(!a.some(l => /^Feed the Void>Speaker's Sight:heal/.test(l)), 'Devour (self heal) must not count as healing allies: ' + a.join(', '));
  const b = links([{ g: 'subclass', slot: 'grenade', n: 'Healing Grenade' }, ss]);
  assert.ok(b.some(l => /^Healing Grenade>Speaker's Sight:healallies$/.test(l)), 'Healing Grenade heals allies: ' + b.join(', '));
  assert.deepStrictEqual(ix.t.orbofpower.also, ['resource'], 'Orbs of Power also show under Resources');
});
t('weapon perk columns come from Bungie sockets (CSV flat list); armor sockets per piece', () => {
  const d = { ...D, sock: JSON.parse(fs.readFileSync(__dirname + '/../data/sockets.json', 'utf8')) };
  const r = C.parseDimCsv(fs.readFileSync(__dirname + '/fixtures/sample-weapons.csv', 'utf8'), 'weapon'); const items = r.items || r; C.applyDefs(items, d);
  const reed = items.find(i => i.name === "Reed's Regret" && i.perks.some(p => p.n === 'Clown Cartridge'));
  const cols = C.sockets(reed, d).cols.map(c => c.perks.map(p => p.n));
  // the DIM row lists Triple Tap*, Clown Cartridge, Firing Line*: Clown Cartridge is a Trait 1 option in Bungie's data
  assert.ok(cols.some(c => c.includes('Triple Tap') && c.includes('Clown Cartridge')), JSON.stringify(cols));
  assert.ok(cols.some(c => c.length === 1 && c[0] === 'Firing Line'), JSON.stringify(cols));
  // API items: grouped by socket index
  const api = { kind: 'weapon', name: 'X', hash: '0', perks: [{ n: 'Triple Tap', s: 1, si: 3 }, { n: 'Firing Line', s: 1, si: 4 }, { n: 'Clown Cartridge', s: 0, si: 3 }] };
  assert.deepStrictEqual(C.sockets(api, D).cols.map(c => c.perks.map(p => p.n)), [['Triple Tap', 'Clown Cartridge'], ['Firing Line']]);
  // a Techsec Hood has a general socket, 3 helmet sockets and a tuning socket
  const th = Object.entries(d.sock.a).find(([h]) => h === '2082858804');
  assert.deepStrictEqual(C.modLayout('2082858804', d).map(x => x[1]), ['g', 's', 's', 's', 't'], JSON.stringify(th));
});
console.log(n, 'build tests passed');
