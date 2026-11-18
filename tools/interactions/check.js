// Validates curated interactions (data/interactions): glossary terms, piece records, conditions and quotes.
//   node tools/interactions/check.js                 all files
//   node tools/interactions/check.js subclass-void   one group (pieces/subclass-void.json)
// Exported for test/interactions.test.js.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '../../data/interactions');
const VERBS = new Set(['creates', 'applies', 'grants', 'uses', 'modifies', 'consumes', 'counts']);
const KINDS = new Set(['debuff', 'buff', 'object', 'energy', 'resource', 'ability', 'damage', 'state']);
const SLOTS = new Set(['super', 'classAbility', 'movement', 'melee', 'grenade']);
const ELS = new Set(['solar', 'arc', 'void', 'stasis', 'strand', 'kinetic', 'prismatic', '']);
const SRCS = new Set(['bungie', 'clarity', 'clarityEnhanced', 'compendium']);
const DR_VS = new Set(['all', 'combatants', 'players', 'melee', 'ranged', 'explosive', 'sniper', 'precision', 'solar', 'arc', 'void', 'stasis', 'strand', 'kinetic', 'elemental', 'blocked', 'subclass']);
const flat = s => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));

function load() {
  const src = {}; const groups = [];
  for (const f of fs.readdirSync(path.join(DIR, 'src')).filter(f => f.endsWith('.json') && f !== 'glossary-sources.json')) {
    const g = f.replace(/\.json$/, ''); groups.push(g);
    for (const r of readJson(path.join(DIR, 'src', f))) src[r.id] = { ...r, group: g };
  }
  const gsrc = readJson(path.join(DIR, 'src/glossary-sources.json'));
  const terms = {}; const termFiles = [path.join(DIR, 'glossary.json')];
  const gdir = path.join(DIR, 'glossary'); if (fs.existsSync(gdir)) for (const f of fs.readdirSync(gdir).filter(f => f.endsWith('.json'))) termFiles.push(path.join(gdir, f));
  const dupTerms = [];
  for (const f of termFiles) if (fs.existsSync(f)) for (const [id, t] of Object.entries(readJson(f).terms || {})) { if (terms[id]) dupTerms.push(id + ' (' + path.basename(f) + ')'); else terms[id] = { ...t, file: path.basename(f) }; }
  // every piece name a condition may name (subclass pieces, any class)
  const pieceNames = new Set(Object.values(src).filter(r => r.id.startsWith('sub:')).map(r => r.n));
  const itemNames = new Set(Object.values(src).filter(r => /^(xw|xa):/.test(r.id)).map(r => r.n));
  return { src, gsrc, terms, groups, pieceNames, itemNames, dupTerms };
}
// all text of one source of a piece (perk sources included for exotics)
function sourceText(rec, s, perk) {
  const parts = [];
  if (!perk) parts.push(rec.src?.[s]);
  for (const p of rec.perks || []) if (!perk || p.n === perk) parts.push(p.src?.[s]);
  return flat(parts.filter(Boolean).join(' \n '));
}
function check(only) {
  const L = load(); const errors = []; const warnings = L.dupTerms.map(d => 'duplicate term id ' + d);
  const err = (where, m) => errors.push(`${where}: ${m}`);
  for (const [id, t] of Object.entries(L.terms)) {
    const w = `term ${id}`;
    if (!/^[a-z0-9]+$/.test(id)) err(w, 'id must be lowercase letters/digits');
    if (!t.l) err(w, 'missing l (label)');
    if (!KINDS.has(t.kind)) err(w, 'bad kind ' + t.kind);
    if (t.el != null && !ELS.has(t.el)) err(w, 'bad el ' + t.el);
    if (!t.def) err(w, 'missing def');
    if (t.nat != null && t.nat !== true && !['solar', 'arc', 'void', 'stasis', 'strand', 'prism'].includes(t.nat)) err(w, 'nat must be true or a subclass element');
    for (const g of t.isa || []) if (!L.terms[g] && !String(g).match(/^[a-z0-9]+$/)) err(w, 'isa names unknown term ' + g);
    if (t.dr) { const d = t.dr; const tab = String(d.src || '').startsWith('compendium:') ? L.gsrc[d.src.slice(11)] : null;
      if (!(typeof d.amt === 'number' && d.amt > 0 && d.amt < 100)) err(w, 'dr.amt must be a percent');
      if (!tab || !flat(tab).includes(flat(d.q)) || !String(d.q).includes(String(d.amt))) err(w, 'dr.q must be a Compendium quote (dr.src compendium:<tab>) containing dr.amt'); }
    if (!t.q || !t.src) err(w, 'missing q/src');
    else {
      const hay = String(t.src).startsWith('compendium:') ? flat(L.gsrc[t.src.slice(11)]) : L.src[t.src] ? flat(Object.values(L.src[t.src].src || {}).join(' ') + ' ' + (L.src[t.src].perks || []).map(p => Object.values(p.src || {}).join(' ')).join(' ')) : null;
      if (hay == null) err(w, 'unknown src ' + t.src); else if (!hay.includes(flat(t.q))) err(w, 'quote not found in ' + t.src + ': "' + String(t.q).slice(0, 80) + '"');
    }
  }
  const files = fs.existsSync(path.join(DIR, 'pieces')) ? fs.readdirSync(path.join(DIR, 'pieces')).filter(f => f.endsWith('.json')) : [];
  const seen = new Set(); const covered = {};
  for (const f of files) {
    const g = f.replace(/\.json$/, '').split('.')[0]; if (only && only !== g && only !== f.replace(/\.json$/, '')) continue;  // <group>.json or <group>.<part>.json
    if (!L.groups.includes(g)) { err(f, 'no source packet src/' + f); continue; }
    let recs; try { recs = readJson(path.join(DIR, 'pieces', f)); } catch (e) { err(f, 'invalid JSON: ' + e.message); continue; }
    if (!Array.isArray(recs)) { err(f, 'must be an array'); continue; }
    covered[g] ||= 0;
    for (const r of recs) {
      if (r.id === '_skipped') { for (const id of r.ids || []) { if (!L.src[id]) err(f, 'skipped unknown id ' + id); seen.add(id); covered[g]++; } continue; }
      const w = `${f} ${r.id}`; const s = L.src[r.id];
      if (!s) { err(w, 'unknown piece id'); continue; }
      if (s.group !== g) err(w, 'belongs in pieces/' + s.group + '.json');
      if (seen.has(r.id)) err(w, 'duplicate record'); seen.add(r.id); covered[g]++;
      if (!Array.isArray(r.fx)) { err(w, 'fx must be an array'); continue; }
      r.fx.forEach((e, i) => {
        const we = `${w} fx[${i}]`;
        if (!VERBS.has(e.do)) err(we, 'bad verb ' + e.do);
        if (!L.terms[e.t]) err(we, 'unknown term ' + e.t);
        if (e.do === 'counts' && !L.terms[e.as]) err(we, 'counts needs a known "as" term');
        if (e.by && !L.terms[e.by]) err(we, 'unknown by-term ' + e.by);
        if (e.perk && !(s.perks || []).some(p => p.n === e.perk)) err(we, 'unknown perk ' + e.perk);
        // `from` = the damage source a debuff / damage / ability must come from; a buff or energy has no damage source
        if (e.from && e.do !== 'grants' && ['buff', 'energy'].includes(L.terms[e.t]?.kind)) err(we, `from on a ${L.terms[e.t].kind} (${e.t}) has no meaning; put the kill type in pay / note`);
        for (const k of ['dmg', 'from']) if (e[k] != null) { if (!Array.isArray(e[k]) || !e[k].length) err(we, k + ' must be a non-empty array'); else for (const x of e[k]) if (!L.terms[x]) err(we, `${k} names unknown term ${x}`); }
        if (e.t === 'damageresistance' && e.do === 'grants') {
          if (e.amt != null && !(typeof e.amt === 'number' && e.amt > 0 && e.amt < 100)) err(we, 'amt must be a number between 0 and 100 (percent)');
          if (e.amt != null && !String(e.q).includes(String(e.amt))) err(we, 'the quote must contain the amount ' + e.amt);
          for (const v of e.vs || []) if (!DR_VS.has(v)) err(we, 'bad vs ' + v);
          if (e.amts != null && (!Array.isArray(e.amts) || !e.amts.every(x => typeof x === 'number' && x > 0 && x < 100 && String(e.q).includes(String(x))))) err(we, 'amts must be percents that all appear in the quote');
        }
        const conds = (e.if || []).flatMap(c => c.any ? (Array.isArray(c.any) && c.any.length ? c.any : [{ bad: 1 }]) : [c]);
        for (const c of conds) {
          if (c.slot) { if (!SLOTS.has(c.slot)) err(we, 'bad slot ' + c.slot); for (const n of c.is || []) if (!L.pieceNames.has(n)) err(we, 'condition names unknown piece ' + n); if (!Array.isArray(c.is) || !c.is.length) err(we, 'slot condition needs "is"'); }
          else if (c.has) { if (!L.terms[c.has]) err(we, 'condition has unknown term ' + c.has); }
          else if (c.subclass) { if (!['solar', 'arc', 'void', 'stasis', 'strand', 'prismatic'].includes(c.subclass)) err(we, 'bad subclass ' + c.subclass); }
          else if (c.item) { if (!L.itemNames.has(c.item)) err(we, 'condition names unknown exotic ' + c.item); }
          else if (c.piece) { if (!L.pieceNames.has(c.piece)) err(we, 'condition names unknown piece ' + c.piece); }
          else if (c.weapon) { if (!(ELS.has(c.weapon) || ['super', 'grenade', 'melee'].includes(c.weapon)) || !c.weapon) err(we, 'bad weapon element ' + c.weapon); }
          else err(we, 'unknown condition ' + JSON.stringify(c));
        }
        if (['uses', 'modifies', 'consumes'].includes(e.do) && !(typeof e.pay === 'string' && e.pay.trim().length >= 4)) err(we, 'missing pay (what the payoff does)');
        if (e.pq != null) { const hay2 = sourceText(s, e.s, e.perk); if (!hay2.includes(flat(e.pq))) err(we, `pq not in ${e.s}: "${String(e.pq).slice(0, 90)}"`); }
        if (!SRCS.has(e.s)) err(we, 'bad s ' + e.s);
        else if (!e.q) err(we, 'missing quote');
        else { const hay = sourceText(s, e.s, e.perk); if (!hay.includes(flat(e.q))) err(we, `quote not in ${e.s}${e.perk ? ' of ' + e.perk : ''}: "${String(e.q).slice(0, 90)}"`); }
      });
    }
  }
  return { errors, warnings, covered, total: Object.fromEntries(L.groups.map(g => [g, Object.values(L.src).filter(r => r.group === g).length])) };
}
module.exports = { check, load, flat };
if (require.main === module) {
  const r = check(process.argv[2]);
  for (const w of r.warnings) console.log('warn ', w);
  for (const e of r.errors) console.log('ERROR', e);
  for (const [g, n] of Object.entries(r.covered)) console.log(`${g}: ${n}/${r.total[g]} pieces curated`);
  console.log(r.errors.length ? `${r.errors.length} error(s)` : 'interactions OK');
  process.exit(r.errors.length ? 1 : 0);
}
