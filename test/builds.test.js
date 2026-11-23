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
t('exotic catalyst effects only count when the catalyst is applied', () => {
  assert.ok(D.cata?.blacktaloncatalyst, 'defs.cata has Black Talon Catalyst');
  const ix = { t: { weaken: { l: 'Weaken', kind: 'debuff' } }, p: { 'mod:w': [{ do: 'applies', t: 'weaken' }], 'xw:blacktalon': [{ do: 'uses', t: 'weaken', perk: 'Black Talon Catalyst', pay: 'more damage' }] } };
  const bt = perks => ({ g: 'weapon', n: 'Black Talon', it: { kind: 'weapon', name: 'Black Talon', rarity: 'Exotic', hash: Object.keys(D.wc).find(h => D.wc[h] === 'Black Talon Catalyst') || '0', element: 'Void', type: 'Sword', ammo: 'Heavy', perks } });
  const run = perks => C.ixEval([{ g: 'mod', n: 'W' }, bt(perks)], ix, D, 'void');
  const on = run([{ n: 'Black Talon Catalyst', s: 1 }]); const off = run([]);
  assert.strictEqual(on.links.filter(l => l.t === 'weaken').length, 1);
  assert.strictEqual(off.links.filter(l => l.t === 'weaken').length, 0);
  assert.ok(off.inactive.some(f => f.why.some(w => /Black Talon Catalyst applied/.test(w))), 'listed as Not active: needs the catalyst');
});
t('Armor 3.0: archetypes, masterwork on the 3 lowest stats, legacy +2, Balanced Tuning, tuning on Tier 5 only, mods counted once', () => {
  const d = { ...D, sock: JSON.parse(fs.readFileSync(__dirname + '/../data/sockets.json', 'utf8')) };
  assert.deepStrictEqual(C.archetypeOf('Bulwark', d), { n: 'Bulwark', pri: 'Health', sec: 'Class' });
  assert.deepStrictEqual(C.archetypeOf('Skirmisher', d), { n: 'Skirmisher', pri: 'Melee', sec: 'Weapons' });
  const S6 = o => Object.fromEntries(C.ARMOR3.map(k => [k, o[k] || 0]));
  const hood = '2082858804';   // Techsec Hood: general + 3 helmet + tuning sockets
  // Tier 5, Gunner 30/25/20, masterwork 5 -> +5 on the three 0 stats; a +Weapons/-Health tuning mod on it
  const base = S6({ Weapons: 30, Grenade: 25, Super: 20 });
  const cur = S6({ Weapons: 35, Grenade: 25, Super: 20, Health: 0, Class: 5, Melee: 5 });
  const it = { kind: 'armor', name: 'T5', hash: hood, tier: 5, frame: 'Gunner', tertiary: 'Super', tuning: 'Weapons', base, stats: cur, perks: [{ n: '+Weapons / -Health', s: 1 }] };
  const pt = C.armorParts(it, d, 'head');
  assert.strictEqual(pt.gen3, true); assert.deepStrictEqual(pt.low, ['Health', 'Class', 'Melee']); assert.strictEqual(pt.mwLevel, 5);
  assert.deepStrictEqual(pt.mw, S6({ Health: 5, Class: 5, Melee: 5 }), 'masterwork credited to the 3 lowest only');
  const st = C.buildStats({ cls: 'warlock', el: 'solar', sub: {}, a: { head: { id: '1', hash: hood } }, mods: { head: [] } }, d, new Map([['1', it]]));
  assert.strictEqual(st.stats.Weapons.tune, 5); assert.strictEqual(st.stats.Health.tune, -5);
  assert.strictEqual(st.stats.Weapons.total, 35); assert.strictEqual(st.stats.Health.total, 0, 'the mod already on the piece is not counted twice');
  // Balanced Tuning: +1 to the three lowest base stats
  const st2 = C.buildStats({ cls: 'warlock', el: 'solar', sub: {}, a: { head: { id: '1', hash: hood } }, mods: { head: [null, null, null, null, 'Balanced Tuning'] } }, d, new Map([['1', it]]));
  assert.deepStrictEqual(C.ARMOR3.map(k => st2.stats[k].tune), C.ARMOR3.map(k => ['Health', 'Class', 'Melee'].includes(k) ? 1 : 0));
  // tuning socket only on Tier 5
  assert.ok(C.modLayout(hood, d, 5).some(x => x[1] === 't')); assert.ok(!C.modLayout(hood, d, 4).some(x => x[1] === 't'));
  // legacy armor (no tier, six stats): masterwork +2 to every stat
  const leg = { kind: 'armor', name: 'Old', hash: '0', tier: null, frame: 'Paragon', base: S6({ Weapons: 10, Health: 10, Class: 10, Grenade: 20, Super: 10, Melee: 5 }), stats: S6({ Weapons: 12, Health: 12, Class: 12, Grenade: 22, Super: 12, Melee: 7 }), perks: [] };
  const lp = C.armorParts(leg, d, 'head'); assert.strictEqual(lp.gen3, false); assert.deepStrictEqual(Object.values(lp.mw), [2, 2, 2, 2, 2, 2]);
});
t('engine: charged melee is powered melee, weapons stun Champions, "any of" payoffs are not missing once one links', () => {
  const ix = { t: { poweredmelee: { kind: 'ability' }, melee: { kind: 'ability' }, stun: { kind: 'debuff' }, radiant: { kind: 'buff' }, devour: { kind: 'buff' }, weapon: { kind: 'damage' } },
    p: { 'mod:hh': [{ do: 'uses', t: 'poweredmelee', q: 'powered melee' }], 'art:defib': [{ do: 'uses', t: 'stun', q: 'stun' }], 'mod:r': [{ do: 'grants', t: 'radiant' }],
      'art:sc': [{ do: 'uses', t: 'radiant', q: 'while radiant or devour' }, { do: 'uses', t: 'devour', q: 'while radiant or devour' }] } };
  const pcs = [{ g: 'subclass', slot: 'melee', n: 'Snap', el: 'solar' }, { g: 'mod', n: 'HH' }, { g: 'artifact', n: 'Defib' }, { g: 'mod', n: 'R' }, { g: 'artifact', n: 'SC' },
    { g: 'weapon', n: 'Gun', it: { kind: 'weapon', name: 'Gun', rarity: 'Legendary', type: 'Hand Cannon', element: 'Kinetic', ammo: 'Primary', perks: [] } }];
  const r = C.ixEval(pcs, ix, D, 'solar'); const L = r.links.map(l => `${pcs[l.from].n}>${pcs[l.to].n}:${l.t}`);
  assert.ok(L.includes('Snap>HH:poweredmelee'), L.join(', '));
  assert.ok(L.includes('Gun>Defib:stun'), L.join(', '));
  assert.ok(L.includes('R>SC:radiant'), L.join(', '));
  assert.ok(!r.gaps.some(g => g.e.t === 'devour'), 'devour is an alternative, not missing');
});
t('a weapon perk\'s element condition checks that weapon; artifact slots fill like the game', () => {
  const ix = { t: { restoration: { kind: 'buff' }, woven: { kind: 'buff' } }, p: { 'xw:testgun': [{ do: 'grants', t: 'restoration', if: [{ weapon: 'solar' }] }, { do: 'grants', t: 'woven', if: [{ weapon: 'strand' }] }] } };
  const gun = (n, el) => ({ g: 'weapon', n, it: { kind: 'weapon', name: n, rarity: 'Exotic', type: 'Sword', element: el, ammo: 'Heavy', perks: [] } });
  const r = C.ixEval([gun('Test Gun', 'Strand'), gun('Sun Gun', 'Solar')], ix, D, 'solar');
  assert.ok(r.inactive.some(f => f.e.t === 'restoration' && /only when this weapon is Solar \(it's Strand\)/.test(f.why[0])), 'a Strand weapon\'s Solar-only perk is not active because another weapon is Solar');
  assert.ok(!r.inactive.some(f => f.e.t === 'woven'), 'its Strand perk is active');
  const art = { h: 1, n: 'A', d: '', i: '', p: [[1, 'a', 1, '', ''], [2, 'b', 1, '', ''], [3, 'c', 1, '', ''], [4, 'd', 2, '', ''], [5, 'e', 3, '', '']] };
  const rows = C.artSlots([1, 2, 3, 4, 5], art).map(r => r.map(p => p && p[1]));
  assert.deepStrictEqual(rows, [['a', 'b'], ['d', 'c', null], ['e', null]]);
});
t('character stats: per-point effects and ability cooldowns (Clarity Character Stats v2)', () => {
  const d = { ...D, stats: JSON.parse(fs.readFileSync(__dirname + '/../data/stats.json', 'utf8')) };
  assert.strictEqual(C.statAt('Weapons', 50, d).ReloadSpeed, 5, '0-100: reload 10% at 100, linear');
  assert.strictEqual(C.statAt('Weapons', 150, d).SpecialDamageIncrease, 7.5, '100-200: enhanced boss damage, linear to 15%');
  assert.strictEqual(C.statAt('Weapons', 250, d).LargeAmmoBrickChance, 100, 'values clamp at 200');
  const sc = D.sub.warlock.solar; const g = sc.s.grenade.find(x => x.n === 'Solar Grenade');
  const b = { cls: 'warlock', el: 'solar', sub: { grenade: g.h, aspects: [], fragments: [] }, a: {}, w: {} };
  const c0 = C.abilityCooldown('grenade', g, 0, b, d), c70 = C.abilityCooldown('grenade', g, 70, b, d), c100 = C.abilityCooldown('grenade', g, 100, b, d);
  assert.strictEqual(c0.base, 219.5); assert.deepStrictEqual(c0.applied, ['Warlock']); assert.strictEqual(c0.cd, 199.5, 'Warlock grenades recharge 10% faster');
  assert.ok(c70.cd < c0.cd / 2 && c100.cd < c70.cd && c100.cd > c70.cd * 0.85, 'most of the gain comes by 70');
  const hb = { ...b, cls: 'hunter' }; assert.strictEqual(C.abilityCooldown('grenade', g, 0, hb, d).cd, 219.5, 'no Warlock bonus for a Hunter');
  const sup = sc.s.super.find(x => x.n === 'Well of Radiance'); assert.strictEqual(C.abilityCooldown('super', sup, 0, b, d).cd, C.abilityCooldown('super', sup, 100, b, d).cd, 'Super cooldown does not scale with the stat');
});
t('artifact score: each perk scored against the build, best set fits the 7 slots', () => {
  const ix = { t: { weaken: { l: 'Weaken', kind: 'debuff', el: 'void' }, scorch: { l: 'Scorch', kind: 'debuff', el: 'solar' } },
    p: { 'mod:w': [{ do: 'applies', t: 'weaken' }], 'art:usesweaken': [{ do: 'uses', t: 'weaken' }], 'art:usesscorch': [{ do: 'uses', t: 'scorch' }], 'art:t3a': [{ do: 'uses', t: 'weaken' }], 'art:t3b': [{ do: 'uses', t: 'weaken' }], 'art:t3c': [{ do: 'uses', t: 'weaken' }] } };
  const art = { h: 1, n: 'Test Artifact', p: [[11, 'Uses Weaken', 1, ''], [12, 'Uses Scorch', 1, ''], [13, 'T3 A', 3, ''], [14, 'T3 B', 3, ''], [15, 'T3 C', 3, '']] };
  const pieces = [{ g: 'mod', n: 'W' }, { g: 'artifact', n: 'Uses Scorch' }];
  assert.ok(C.artPerkScore(art.p[0], art, pieces, ix, D).score > 0, 'a perk that uses what the build makes scores');
  assert.strictEqual(C.artPerkScore(art.p[1], art, pieces, ix, D).score, 0, 'a perk with nothing to use scores 0 (other artifact perks are left out)');
  const best = C.artBest(art, pieces, ix, D);
  assert.deepStrictEqual(best.picks.map(x => x.p[1]).sort(), ['T3 A', 'T3 B', 'Uses Weaken'], 'only 2 tier-3 perks fit; 0-score perks are left out');
  assert.strictEqual(best.score, best.picks.reduce((n, x) => n + x.score, 0));
  assert.ok(C.artFits([[0, '', 3], [0, '', 3], [0, '', 2], [0, '', 2], [0, '', 2], [0, '', 1], [0, '', 1]]));
  assert.ok(!C.artFits([[0, '', 3], [0, '', 3], [0, '', 3]]), 'three tier-3 perks do not fit');
  assert.ok(!C.artFits([[0, '', 2], [0, '', 2], [0, '', 2], [0, '', 2], [0, '', 2], [0, '', 2]]), 'six tier 2-3 perks do not fit');
});
t('a mod socket planned empty stays empty: no stats, no piece, kept in place, not in the DIM link', () => {
  const lay = [[0, 'g'], [1, 's'], [2, 's']];
  assert.deepStrictEqual(C.placeMods(['Grenade Mod', C.MOD_NONE, null], lay, 'head', D), ['Grenade Mod', C.MOD_NONE, null]);
  const b = C.normBuild({ cls: 'warlock', el: 'solar', a: {}, mods: { head: [null, C.MOD_NONE] } }, D);
  assert.strictEqual(b.mods.head[1], C.MOD_NONE, 'normBuild keeps the empty plan');
  assert.ok(!C.buildPieces(b, D, new Map()).some(p => p.n === C.MOD_NONE), 'not an interaction piece');
  assert.ok(!(C.dimLoadout(b, D, new Map(), 'x').parameters?.mods || []).length, 'no mod hash for it');
  assert.strictEqual(C.modCost(C.MOD_NONE, 'head', D), 0);
});
const DD = D;
t('DIM loadout: mods left on the armor go too, Tier 4 tuning does not, artifact perks as socket overrides; stats in game order', () => { const D0 = DD;
  const D = { ...D0, sock: JSON.parse(fs.readFileSync(__dirname + '/../data/sockets.json', 'utf8')) }; const sk = D.sock; const hash = Object.keys(sk.a).find(h => sk.lay[sk.a[h]].some(x => x[1] === 't') && sk.lay[sk.a[h]][0][1] === 'g' && sk.lay[sk.a[h]].at(-1)[1] === 't');
  const lay = sk.lay[sk.a[hash]]; const ti = lay.findIndex(x => x[1] === 't');
  const arm = t => ({ id: '6917529000000000009', kind: 'armor', type: 'Helmet', category: 'Helmet', hash, tier: t, name: 'H', perks: [{ n: 'Grenade Mod', s: true }], stats: { Health: 30, Grenade: 20 }, base: { Health: 30, Grenade: 10 } });
  const mods = Array(lay.length).fill(null); mods[ti] = 'Balanced Tuning';
  const b = C.normBuild({ cls: 'warlock', el: 'solar', a: { head: { id: '6917529000000000009', hash } }, mods: { head: mods } }, D);
  const gm = D.am.general.find(x => x[0] === 'Grenade Mod')[3], bt = D.sock.m.t.find(x => x[0] === 'Balanced Tuning')[3];
  const lo5 = C.dimLoadout(b, D, new Map([['6917529000000000009', arm(5)]]), 'x');
  assert.ok(lo5.parameters.mods.includes(gm), 'the Grenade Mod on the armor is sent'); assert.ok(lo5.parameters.mods.includes(bt), 'tuning on Tier 5');
  const lo4 = C.dimLoadout(b, D, new Map([['6917529000000000009', arm(4)]]), 'x');
  assert.ok(!lo4.parameters.mods.includes(bt), 'no tuning socket below Tier 5');
  assert.strictEqual(C.buildStats(b, D, new Map([['6917529000000000009', arm(4)]])).stats.Health.tune, 0, 'hidden tuning is not counted');
  const art = D.artp ? D.artp[0] : JSON.parse(fs.readFileSync(__dirname + '/../data/interactions/artifacts.json', 'utf8'))[0];
  const D2 = { ...D, artp: [art] }; const t1 = art.p.filter(p => p[2] === 1).slice(0, 2), t3 = art.p.filter(p => p[2] === 3).slice(0, 1);
  const b2 = C.normBuild({ cls: 'warlock', el: 'solar', artA: art.h, art: [...t1, ...t3].map(p => p[0]) }, D2); b2.artA = art.h; b2.art = [...t1, ...t3].map(p => p[0]);
  const ae = C.dimLoadout(b2, D2, new Map(), 'x').equipped.find(e => e.hash === art.h);
  assert.ok(ae, 'artifact equipped'); const ov = ae.socketOverrides;
  for (const [si, ph] of Object.entries(ov)) { const tier = art.s.find(x => x[0] === +si)[1]; assert.ok(art.p.find(p => p[0] === ph)[2] <= tier, 'perk in a socket of its tier or higher'); }
  assert.deepStrictEqual(Object.values(ov).sort(), [...t1, ...t3].map(p => p[0]).sort());
  assert.deepStrictEqual(C.STAT_ORDER, ['Health', 'Melee', 'Grenade', 'Super', 'Class', 'Weapons']);
});
t('exotic armor takes any tuning mod at any tier; legendaries follow Tier 5', () => {
  assert.strictEqual(C.tuneTier({ rarity: 'Exotic', tier: 2 }), 5);
  assert.strictEqual(C.tuneTier({ rarity: 'Legendary', tier: 4 }), 4);
  const d = { ...D, sock: JSON.parse(fs.readFileSync(__dirname + '/../data/sockets.json', 'utf8')) };
  const hash = Object.keys(d.sock.a).find(h => d.sock.lay[d.sock.a[h]].some(x => x[1] === 't'));
  const piece = (rarity, tuning) => C.optPiece({ id: '1', kind: 'armor', type: 'Helmet', category: 'Helmet', hash, tier: 3, rarity, tuning, name: 'H', perks: [], stats: { Health: 30 }, base: { Health: 30, Melee: 10, Grenade: 10, Super: 10, Class: 10, Weapons: 10 } }, d, {});
  const ex = piece('Exotic', 'Weapons'); assert.ok(ex && ex.tune && ex.tune.flex, 'exotic: any pair even with a Tuned stat');
  const lg = piece('Legendary', 'Weapons'); assert.ok(lg && !lg.tune, 'Tier 3 legendary: no tuning');
});
t('stats tracker: every source listed; swapping the mod on a piece without base stats changes the total', () => {
  const arm = { id: '1', kind: 'armor', type: 'Helmet', category: 'Helmet', hash: '0', name: 'H', perks: [{ n: 'Grenade Mod', s: true }], stats: { Health: 30, Grenade: 25 } };
  const by = new Map([['1', arm]]);
  const keep = C.buildStats(C.normBuild({ cls: 'warlock', el: 'solar', a: { head: { id: '1' } } }, D), D, by);
  assert.strictEqual(keep.stats.Grenade.total, 25, 'kept mod: same as the armor shows');
  assert.strictEqual(keep.stats.Grenade.armor, 15, 'base = current minus the mod on it');
  assert.ok(keep.stats.Grenade.src.some(([p, n, sl, v]) => p === 'mods' && n === 'Grenade Mod' && sl === 'head' && v === 10));
  const swap = C.buildStats(C.normBuild({ cls: 'warlock', el: 'solar', a: { head: { id: '1' } }, mods: { head: ['Health Mod'] } }, D), D, by);
  assert.strictEqual(swap.stats.Grenade.total, 15); assert.strictEqual(swap.stats.Health.total, 40);
  const DS = { ...D, sock: JSON.parse(fs.readFileSync(__dirname + '/../data/sockets.json', 'utf8')) };
  const tb = C.normBuild({ cls: 'warlock', el: 'solar', a: {} }, DS); tb.mods.head = ['+Health / -Melee'];
  const tuned = C.buildStats(tb, DS, new Map());
  assert.strictEqual(tuned.stats.Health.tune, 5); assert.strictEqual(tuned.stats.Melee.tune, -5);
});
t('DIM import: our own DIM link comes back as the same build (subclass, items, mods, artifact)', () => {
  const DS = { ...D, sock: JSON.parse(fs.readFileSync(__dirname + '/../data/sockets.json', 'utf8')), artp: JSON.parse(fs.readFileSync(__dirname + '/../data/interactions/artifacts.json', 'utf8')) };
  const sc0 = DS.sub.warlock.solar; const hh = (k, nm) => sc0.s[k].find(x => x.n === nm).h;
  const helm = { id: '6917529000000000011', kind: 'armor', type: 'Helmet', category: 'Helmet', hash: '111', name: 'H', rarity: 'Legendary', equippable: 'Warlock', perks: [], stats: {}, base: { Health: 10 } };
  const gun = { id: '6917529000000000012', kind: 'weapon', category: 'Energy', hash: '1399243961', name: 'G', perks: [], stats: {} };
  const art = DS.artp[0]; const ap = art.p.filter(p => p[2] === 1).slice(0, 2).map(p => p[0]);
  const b = C.normBuild({ cls: 'warlock', el: 'solar', name: 'Sun', notes: 'hi', sub: { melee: hh('melee', 'Incinerator Snap'), aspects: [hh('aspects', 'Touch of Flame'), hh('aspects', 'Heat Rises')], fragments: [hh('fragments', 'Ember of Searing')] },
    w: { energy: { id: gun.id, hash: gun.hash } }, a: { head: { id: helm.id, hash: '111' } }, mods: { head: ['Grenade Mod', 'Ashes to Assets'] }, artA: art.h, art: ap }, DS);
  const by = new Map([[helm.id, helm], [gun.id, gun]]);
  const url = C.dimLink(C.dimLoadout(b, DS, by, 'x'));
  const p = C.parseDimLoadout(url); assert.ok(p.lo, 'URL parsed');
  const r = C.fromDimLoadout(p.lo, DS, [helm, gun]); const nb = C.normBuild(r.b, DS);
  assert.strictEqual(nb.cls, 'warlock'); assert.strictEqual(nb.el, 'solar'); assert.strictEqual(nb.name, 'Sun'); assert.strictEqual(nb.notes, 'hi');
  assert.strictEqual(nb.sub.melee, b.sub.melee); assert.deepStrictEqual(nb.sub.aspects.sort(), b.sub.aspects.sort()); assert.deepStrictEqual(nb.sub.fragments, b.sub.fragments);
  assert.strictEqual(nb.w.energy.id, gun.id); assert.strictEqual(nb.a.head.id, helm.id);
  assert.deepStrictEqual(nb.mods.head.filter(Boolean).sort(), ['Ashes to Assets', 'Grenade Mod']);
  assert.strictEqual(nb.artA, art.h); assert.deepStrictEqual(nb.art.sort(), ap.sort());
  assert.deepStrictEqual(r.missing, []); assert.deepStrictEqual(r.unplaced, []);
  assert.strictEqual(C.parseDimLoadout('https://dim.gg/abcdefg/Sun').err, 'dimgg');
  assert.strictEqual(C.parseDimLoadout('https://example.com/loadouts?loadout={}').err, 'url');
  assert.ok(C.parseDimLoadout(JSON.stringify(p.lo)).lo, 'raw JSON works');
  const r2 = C.fromDimLoadout({ ...p.lo, equipped: [...p.lo.equipped, { id: '6917529000000000099', hash: 123 }] }, DS, [helm, gun]);
  assert.deepStrictEqual(r2.missing, [123], 'items not in the vault are reported');
});
t('sockets: Praxic Blade columns + mods, no duplicate perks, a perk named like an exotic intrinsic stays in its column', () => {
  const W = (name, hash, frame, perks) => { const it = { kind: 'weapon', name, hash, frame, rarity: 'Exotic', perks: perks.map(x => ({ n: x.replace(/\*$/, ''), s: x.endsWith('*') })) }; C.applyDefs([it], D); return it; };
  // Praxic Blade from the DIM CSV: tang / grip / two traits + Echoing Blade in columns; form, blade focus, core, crystal = mods; the skin hidden
  const px = C.sockets(W('Praxic Blade', '3049715579', 'Ranged Weapon', ['Ranged Weapon*', 'Fencing Tang*', 'Offensive Grip*', 'Cormorant Reversal*', 'Kill Tracker', 'Cormorant Combo*', 'Royal Guard Hilt*', 'Echoing Blade*', 'Dark Matter Crystal: Taken*', 'Forceful Blade*', 'Offensive Form*', 'Impact Core*']), D);
  assert.deepStrictEqual(px.intrinsic.map(p => p.n), ['Ranged Weapon']);
  assert.deepStrictEqual(px.cols.map(c => c.perks.map(p => p.n + (p.s ? '*' : '')).join('/')), ['Fencing Tang*', 'Offensive Grip*', 'Cormorant Reversal*', 'Cormorant Combo*', 'Echoing Blade*/Upper Hand/Hyperblade/Energy Conduit']);
  // the switchable sockets: Form first, each with its equipped choice first and every other option after it
  assert.deepStrictEqual(px.cfg.map(c => c.label), ['Form', 'Crystal', 'Blade Focus', 'Power Core']);
  assert.deepStrictEqual(px.cfg[0].perks.map(p => p.n + (p.s ? '*' : '')), ['Offensive Form*', 'Balanced Form', 'Defensive Form']);
  assert.deepStrictEqual(px.cfg.find(c => c.label === 'Power Core').perks.map(p => p.n + (p.s ? '*' : '')), ['Impact Core*', 'Refraction Core', 'Gyro Core']);
  assert.deepStrictEqual(px.mods, [], 'the special mods are no longer plain mods');
  // Vexcalibur's Authorization mod and Cull's Shadow's Soulfire trait are switchable too
  const vx = C.sockets(W('Vexcalibur', '3118061005', 'M1R Distribution Matrix', ['M1R Distribution Matrix*', 'Ballistic Tuning*', 'Extended Mag*', 'Perpetual Loophole*', 'Hand-Laid Stock*', 'Authorization Override*']), D);
  assert.deepStrictEqual(vx.cfg.map(c => c.label + ':' + c.perks.map(p => p.n + (p.s ? '*' : '')).join('/')), ['Authorization Mod:Authorization Override*/Expert Authorization Override']);
  const cs = C.sockets(W("Cull's Shadow", '2200470033', 'Soulburn', ['Soulburn*', 'Blades of Unmaking*', 'Fluted Barrel*', 'High-Caliber Rounds*', 'Soulforge*', 'Short-Action Stock*', 'Soulfire Zeal*']), D);
  assert.ok(cs.cols.some(c => c.perks[0].n === 'Soulfire Zeal' && c.perks.length === 4), "Cull's Shadow's Soulfire column lists all four");
  for (const n of ['Fencing Tang', 'Offensive Grip', 'Echoing Blade', 'Impact Core']) assert.ok(C.plugOf(n, D, 'weapon')?.[0], n + ' has an icon');
  // The Slammer: Honed Edge is one of its blade options, not Izanagi's Burden's intrinsic
  const sl = C.sockets(W('The Slammer', '2466028274', 'Vortex Frame', ['Vortex Frame*', 'Hungry Edge*', 'Honed Edge', 'Jagged Edge', 'Balanced Guard*', 'Enduring Guard']), D);
  assert.deepStrictEqual(sl.intrinsic.map(p => p.n), ['Vortex Frame']);
  assert.ok(sl.cols[0].perks.some(p => p.n === 'Honed Edge'), 'Honed Edge sits in the blade column');
  // Bungie-loaded Blasphemer: the equipped trait listed again among its socket's options shows once
  const bl = { kind: 'weapon', name: 'Blasphemer', hash: '2782847179', frame: 'Pinpoint Slug Frame', perks: [
    { n: 'Pinpoint Slug Frame', s: 1, si: 0 }, { n: 'Hammer-Forged Rifling', s: 1, si: 1 }, { n: 'Arrowhead Brake', s: 0, si: 1 },
    { n: 'Quickdraw', s: 1, si: 3 }, { n: 'Quickdraw', s: 0, si: 3 }, { n: 'Opening Shot', s: 1, si: 4 }, { n: 'Enhanced Opening Shot', s: 0, si: 4 }] };
  C.applyDefs([bl], D);
  const bs = C.sockets(bl, D);
  assert.deepStrictEqual(bs.cols.map(c => c.perks.map(p => p.n + (p.s ? '*' : '')).join('/')), ['Hammer-Forged Rifling*/Arrowhead Brake', 'Quickdraw*', 'Opening Shot*']);
});
t('tuning mods follow the Tuned stat whatever its case (DIM writes "weapons"); exotics take any', () => {
  assert.ok(C.tuneFits('+Weapons / -Melee', { rarity: 'Legendary', tuning: 'weapons' }));
  assert.ok(!C.tuneFits('+Super / -Health', { rarity: 'Legendary', tuning: 'weapons' }));
  assert.ok(C.tuneFits('+Super / -Health', { rarity: 'Exotic', tuning: '' }));
  assert.ok(C.tuneFits('Balanced Tuning', { rarity: 'Legendary', tuning: 'class' }));
});
t('gameplay loops: closed cycles in the interactions, each once, central pieces first', () => {
  const pieces = [{ g: 'subclass', slot: 'grenade', n: 'G' }, { g: 'subclass', slot: 'fragments', n: 'F' }, { g: 'mod', n: 'M' }, { g: 'subclass', slot: 'aspects', n: 'A' }];
  const links = [{ from: 0, to: 1, l: 'cure' }, { from: 1, to: 0, l: 'grenade energy' }, { from: 2, to: 3, l: 'orb' }, { from: 0, to: 2, l: 'kill' }, { from: 3, to: 0, l: 'grenade energy' }];
  const L = C.buildLoops(links, pieces, 5);
  assert.strictEqual(L.length, 2, 'two loops: G→F→G and G→M→A→G');
  assert.deepStrictEqual(L.map(l => l.map(s => s.n).join('>')).sort(), ['G>F', 'G>M>A']);
  assert.ok(L.every(l => l.every(s => s.t)), 'every step says what it gives the next');
  assert.deepStrictEqual(C.buildLoops([{ from: 0, to: 1, l: 'x' }], pieces), [], 'no cycle, no loop');
});
t('artifact-only siphons: flagged, not part of the build, left out of the DIM link', () => {
  assert.ok(D.aml.includes('Arc/Stasis Dual Siphon') && D.aml.includes('Kinetic Charge Siphon'));
  assert.ok(!D.aml.includes('Harmonic Siphon') && !D.aml.includes('Super Mod'), 'normal mods are not flagged');
  const b = C.normBuild({ cls: 'warlock', el: 'solar', a: {}, mods: { head: [null, 'Arc/Stasis Dual Siphon', 'Harmonic Siphon'] } }, D);
  assert.ok(!C.buildPieces(b, D, new Map()).some(p => p.n === 'Arc/Stasis Dual Siphon'), 'not an interaction piece');
  const mods = C.dimLoadout(b, D, new Map(), 'x').parameters.mods; const h = n => D.am.head.find(x => x[0] === n)[3];
  assert.ok(mods.includes(h('Harmonic Siphon')) && !mods.includes(h('Arc/Stasis Dual Siphon')));
});
console.log(n, 'build tests passed');
