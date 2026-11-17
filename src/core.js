// ===== Vault Sorter core (pure logic, no DOM) =====
const Core = (() => {
  // ---------- CSV ----------
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = []; let row = []; let f = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = [];
      } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    if (!rows.length) return [];
    const head = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => { const o = {}; head.forEach((h, i) => { o[h] = r[i] ?? ''; }); return o; });
  }
  // Spreadsheet formula injection guard: a cell starting with = + - @ (or tab / CR) gets a leading ',
  // the same rule DIM's own export uses (PapaParse escapeFormulae). `guard` lists the columns it applies to.
  const FORMULA_START = /^[=+\-@\t\r]/;
  function csvCell(v, guard) {
    v = v == null ? '' : String(v);
    if (guard && FORMULA_START.test(v)) v = "'" + v;
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function toCSV(headers, rows, guardCols = headers) {
    const g = new Set(guardCols);
    return [headers.map(h => csvCell(h, true)).join(','), ...rows.map(r => headers.map(h => csvCell(r[h], g.has(h))).join(','))].join('\r\n');
  }

  // ---------- untrusted input limits ----------
  const LIMITS = { csvBytes: 25 * 1024 * 1024, csvRows: 20000, csvCols: 600, cell: 20000 };
  const ID_RE = /^\d{1,20}$/;

  // ---------- HTML / CSS sanitizer for Clarity + Data Compendium text (strict allowlist) ----------
  // The reference text is rendered as markup to keep its colours and formatting. It is untrusted, so it is
  // re-serialised from scratch: only <div> <span> <br>, only the class names those sources use, and a plain
  // title on <span>. Every other tag is dropped (its text kept, except inside script/style-like elements),
  // every other attribute is dropped, and stray < > & become entities.
  const SAN_TAGS = new Set(['div', 'span', 'br']);
  const SAN_DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'textarea', 'title', 'xmp', 'svg', 'math', 'select', 'option', 'frameset', 'frame', 'noembed', 'plaintext']);
  const SAN_CLASS = /^(cl-[A-Za-z]{1,32}|d\d{1,4})$/;
  const escAmp = s => s.replace(/&(?!(?:[a-zA-Z]{2,10}|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/g, '&amp;');
  const escText = s => escAmp(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = s => s.replace(/&/g, '&amp;').replace(/[<>"']/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const decodeAttr = s => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/;
  const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
  const sanCache = new Map();
  function sanitizeHtml(html) {
    if (html == null) return '';
    html = String(html);
    const hit = sanCache.get(html); if (hit !== undefined) return hit;
    let out = '', i = 0, drop = null; const open = [];
    while (i < html.length) {
      const lt = html.indexOf('<', i);
      const text = html.slice(i, lt < 0 ? html.length : lt);
      if (!drop && text) out += escText(text);
      if (lt < 0) break;
      // comment markers written as \x3c / \x3e: this file is inlined into a script tag, and a literal comment
      // opener/closer there can be cut out by hosts that strip HTML comments (the artifact host did: "Core is not defined")
      if (html.startsWith('\x3c!--', lt)) { const e = html.indexOf('--\x3e', lt + 4); i = e < 0 ? html.length : e + 3; continue; }
      const m = TAG_RE.exec(html.slice(lt));
      if (!m) { if (!drop) out += '&lt;'; i = lt + 1; continue; }
      i = lt + m[0].length;
      const close = !!m[1], tag = m[2].toLowerCase();
      if (drop) { if (close && tag === drop) drop = null; continue; }
      if (SAN_DROP.has(tag)) { if (!close && !m[4]) drop = tag; continue; }
      if (!SAN_TAGS.has(tag)) continue;
      if (tag === 'br') { if (!close) out += '<br>'; continue; }
      if (close) { const k = open.lastIndexOf(tag); if (k < 0) continue; while (open.length > k) out += `</${open.pop()}>`; continue; }
      let attrs = '';
      for (const a of m[3].matchAll(ATTR_RE)) {
        const name = a[1].toLowerCase(); let val = a[2] ?? ''; if (/^["']/.test(val)) val = val.slice(1, -1);
        val = decodeAttr(val);
        if (name === 'class') { const cls = val.split(/\s+/).filter(c => SAN_CLASS.test(c)); if (cls.length) attrs += ` class="${cls.join(' ')}"`; }
        else if (name === 'title' && tag === 'span') attrs += ` title="${escAttr(val)}"`;
      }
      out += `<${tag}${attrs}>`; open.push(tag);
    }
    while (open.length) out += `</${open.pop()}>`;
    if (sanCache.size < 20000) sanCache.set(html, out);
    return out;
  }
  // Compendium cell styles become CSS classes; only these properties and plain values survive.
  const CSS_OK = {
    'color': /^#[0-9a-fA-F]{3,8}$/, 'background-color': /^#[0-9a-fA-F]{3,8}$/,
    'font-weight': /^(normal|bold|[1-9]00)$/, 'font-style': /^(normal|italic)$/,
    'text-decoration': /^(none|underline|line-through)( (underline|line-through))?$/,
  };
  function sanitizeCss(decls) {
    return String(decls ?? '').split(';').map(d => {
      const k = d.indexOf(':'); if (k < 0) return '';
      const p = d.slice(0, k).trim().toLowerCase(), v = d.slice(k + 1).trim();
      return CSS_OK[p]?.test(v) ? `${p}:${v}` : '';
    }).filter(Boolean).join(';');
  }

  // ---------- normalise ----------
  const META = new Set(['Name','Hash','Id','Tag','Rarity','Tier','Type','Source','Equippable','Category','Element','Ammo','Power','Light','Energy Capacity','Archetype','Tertiary Stat','Tuning Stat','Masterwork Type','Masterwork Tier','Owner','Locked','Equipped','Featured','Holofoil','Year','Season','Event','Crafted','Crafted Level','Kill Tracker','Foundry','Seasonal Mod','Loadouts','Notes','% Quality','% Leveled','DTR Rating','# of Reviews']);
  const unesc = v => (typeof v === 'string' && /^'[=+\-@\t\r]/.test(v)) ? v.slice(1) : (v ?? '');
  const num = v => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
  const bool = v => /^(true|yes|crafted|1)$/i.test(String(v).trim());
  const norm = s => String(s ?? '').toLowerCase().replace(/^enhanced\s+/, '').replace(/[^a-z0-9]/g, '');
  const JUNK_PERK = /(shader|ornament|combat flair|empty .*socket|tracker|memento|^default |deepsight|weapon level boost|change frame|^upgrade armor)/i;

  function rowToItem(r, kindHint) {
    r = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, unesc(v)]));
    const id = String(r.Id || '').replace(/["']/g, '').trim();
    if (!ID_RE.test(id)) return null;   // DIM instance ids are digit strings; anything else is not an item row
    const stats = {}, base = {}, perks = [];
    for (const [k, v] of Object.entries(r)) {
      if (/^Perks \d+$/.test(k)) {
        if (v) { const sel = v.endsWith('*'); const n = sel ? v.slice(0, -1) : v; perks.push({ n, s: sel ? 1 : 0, j: JUNK_PERK.test(n) ? 1 : 0 }); }
      } else if (!META.has(k) && v !== '') {
        const n = num(v); if (n === null) continue;
        const m = k.match(/^(.*) \(Base\)$/);
        if (m) base[m[1]] = n; else stats[k] = n;
      }
    }
    let kind = kindHint;
    if (!kind) kind = ('Impact' in r || 'ROF' in r || 'Ammo' in r || r.Element) ? 'weapon' : (('Health' in r || 'Total' in r) ? 'armor' : 'other');
    const tierN = num(r.Tier);
    return {
      id, hash: String(r.Hash || '').replace(/\D/g, ''), name: r.Name, kind,
      tag: (r.Tag || '').toLowerCase(), notes: r.Notes || '',
      rarity: r.Rarity || '', tier: tierN, type: r.Type || '', source: r.Source || '',
      equippable: r.Equippable || '', category: r.Category || '', element: r.Element || '',
      ammo: r.Ammo || '', power: num(r.Power ?? r.Light), energy: num(r['Energy Capacity']),
      frame: r.Archetype || '', tertiary: r['Tertiary Stat'] || '', tuning: r['Tuning Stat'] || '',
      mwType: r['Masterwork Type'] || '', mwTier: num(r['Masterwork Tier']), owner: r.Owner || '',
      locked: bool(r.Locked), equipped: bool(r.Equipped), featured: bool(r.Featured), holofoil: bool(r.Holofoil),
      year: num(r.Year), season: num(r.Season), event: r.Event || '', crafted: bool(r.Crafted),
      level: num(r['Crafted Level']), kills: num(r['Kill Tracker']), foundry: r.Foundry || '',
      loadouts: r.Loadouts || '', stats, base, perks,
    };
  }
  function detectKind(rows) {
    const h = rows[0] ? Object.keys(rows[0]) : [];
    if (h.includes('Impact') || h.includes('ROF') || h.includes('Element') || h.includes('Ammo')) return 'weapon';
    if (h.includes('Health') || h.includes('Grenade') || h.includes('Mobility') || h.includes('Energy Capacity')) return 'armor';
    return 'other';
  }
  function parseDimCsv(text) {
    if (typeof text !== 'string') throw new Error('Could not read this file as text.');
    if (text.length > LIMITS.csvBytes) throw new Error(`The file is larger than ${LIMITS.csvBytes / 1048576} MB, so it was not loaded.`);
    const rows = parseCSV(text);
    if (!rows.length) throw new Error('The file is empty.');
    if (rows.length > LIMITS.csvRows) throw new Error(`The file has more than ${LIMITS.csvRows} rows, so it was not loaded.`);
    const h = Object.keys(rows[0]);
    if (h.length > LIMITS.csvCols) throw new Error(`The file has more than ${LIMITS.csvCols} columns, so it was not loaded.`);
    if (rows.some(r => Object.values(r).some(v => v.length > LIMITS.cell))) throw new Error('A cell in this file is too long for a DIM export, so it was not loaded.');
    if (!h.includes('Id') || !h.includes('Hash') || !h.includes('Name')) throw new Error('This does not look like a DIM spreadsheet export (missing Name / Hash / Id columns).');
    const kind = detectKind(rows);
    return { kind, items: rows.map(r => rowToItem(r, kind)).filter(Boolean) };
  }

  // ---------- Bungie API profile -> the same item objects rowToItem builds (hosted build, GHOST_PLAN A5) ----------
  // resp: the Response of Destiny2/{type}/Profile/{id}/ with components 100,102,200,201,205,300,304,305,310.
  // ad: data/api-defs.json (tools/build-api-defs.mjs). Everything from the API is untrusted: ids must be digit
  // strings, hashes digits only, names come from our own defs table (never from the response), numbers are coerced.
  const API_ELEMENT = { 1: 'Kinetic', 2: 'Arc', 3: 'Solar', 4: 'Void', 6: 'Stasis', 7: 'Strand' };
  const API_AMMO = { 1: 'primary', 2: 'special', 3: 'heavy' };
  const API_SLOT = { 1498876634: 'KineticSlot', 2465295065: 'EnergySlot', 953998645: 'PowerSlot' };
  const API_CLASS = { 0: 'Titan', 1: 'Hunter', 2: 'Warlock' };
  const ARMOR_STATS = ['Weapons', 'Health', 'Class', 'Grenade', 'Super', 'Melee'];
  function apiToItems(resp, ad) {
    if (!resp || typeof resp !== 'object' || !ad?.i) throw new Error('Bungie returned an unexpected profile.');
    const comp = resp.itemComponents || {};
    const inst = comp.instances?.data || {}, st = comp.stats?.data || {}, so = comp.sockets?.data || {}, rp = comp.reusablePlugs?.data || {};
    const chars = resp.characters?.data || {};
    const clsOf = cid => API_CLASS[chars[cid]?.classType] || 'Character';
    const n = v => (typeof v === 'number' && isFinite(v) ? v : null);
    const plugName = h => ad.p?.[String(h)]?.[0] || '';
    const plugCat = h => ad.p?.[String(h)]?.[1] || '';
    const raw = [];
    for (const it of resp.profileInventory?.data?.items || []) raw.push([it, 'Vault', false]);
    for (const [cid, inv] of Object.entries(resp.characterInventories?.data || {})) for (const it of inv?.items || []) raw.push([it, clsOf(cid), false]);
    for (const [cid, inv] of Object.entries(resp.characterEquipment?.data || {})) for (const it of inv?.items || []) raw.push([it, clsOf(cid), true]);
    const weapons = [], armor = [];
    for (const [r, owner, equipped] of raw) {
      const id = String(r?.itemInstanceId ?? ''); if (!ID_RE.test(id)) continue;
      const hash = String(r.itemHash ?? '').replace(/\D/g, ''); const def = ad.i[hash]; if (!def) continue;
      const [name, k, type, rarity, ammoT, bucket, classType, perkSockets] = def;
      const rollIdx = new Set(Array.isArray(perkSockets) ? perkSockets : []);
      const kind = k === 'w' ? 'weapon' : 'armor';
      const ins = inst[id] || {}; const state = n(r.state) || 0;
      // perks: socket by socket, every option the item can switch to, the inserted one marked (like DIM's Perks N)
      const perks = []; let frame = '', mwType = '', mwTier = null;
      const sockets = Array.isArray(so[id]?.sockets) ? so[id].sockets : [];
      const opts = rp[id]?.plugs || {};
      sockets.forEach((s, i) => {
        if (!s || s.isVisible === false) return;
        // only perk sockets list the roll's other options; mods, masterwork and the rest show what's inserted
        const cur = String(s.plugHash ?? ''); const list = rollIdx.has(i) && Array.isArray(opts[i]) ? opts[i].map(o => String(o?.plugItemHash ?? '')) : [];
        if (cur && !list.includes(cur)) list.unshift(cur);
        for (const h of list) {
          const pn = plugName(h); if (!pn) continue;
          perks.push({ n: pn, s: h === cur ? 1 : 0, j: JUNK_PERK.test(pn) ? 1 : 0 });
        }
        const cat = plugCat(cur), cn = plugName(cur);
        if (!frame && cn && (cat === 'i' && kind === 'weapon' || cat === 'r' && kind === 'armor')) frame = cn;
        if (cat === 'm' && cn) {
          const m = cn.match(/^Tier (\d+): (.+)$/) || cn.match(/^Masterworked: (.+)$/);
          if (m) { mwType = m[2] || m[1]; mwTier = m[2] ? +m[1] : 10; }
        }
      });
      const stats = {};
      for (const [sh, sv] of Object.entries(st[id]?.stats || {})) { const sn = ad.s?.[sh]; const v = n(sv?.value); if (sn && v != null) stats[sn] = v; }
      let tertiary = '';
      if (kind === 'armor') {
        const vals = ARMOR_STATS.filter(s => s in stats);
        if (vals.length) stats.Total = vals.reduce((a, s) => a + stats[s], 0);
        // Armor 3.0: archetype sets the top two stats; the third-highest rolled stat is the tertiary
        const ranked = vals.filter(s => stats[s] > 0).sort((a, b) => stats[b] - stats[a]);
        tertiary = (ranked[2] || '').toLowerCase();
      }
      const item = {
        id, hash, name, kind, tag: '', notes: '', rarity, tier: n(ins.gearTier), type, source: '',
        equippable: kind === 'armor' ? (API_CLASS[classType] || '') : '', category: kind === 'weapon' ? (API_SLOT[bucket] || '') : '',
        element: kind === 'weapon' ? (API_ELEMENT[ins.damageType] || '') : '', ammo: kind === 'weapon' ? (API_AMMO[ammoT] || '') : '',
        power: n(ins.primaryStat?.value), energy: n(ins.energy?.energyCapacity), frame, tertiary, tuning: '',
        mwType, mwTier, owner, locked: !!(state & 1), equipped, featured: false, holofoil: false,
        year: null, season: null, event: '', crafted: !!(state & 8), level: null, kills: null, foundry: '', loadouts: '',
        stats, base: {}, perks, src: 'api',
      };
      (kind === 'weapon' ? weapons : armor).push(item);
    }
    return { weapons, armor };
  }

  // ---------- reference data (data/defs.json, built by tools/build-defs.mjs) ----------
  // Adds the intrinsic breaker (exotics only; from Bungie's manifest) and fills a missing ammo type.
  const AMMO_NAMES = { 1: 'Primary', 2: 'Special', 3: 'Heavy' };
  const AMMO_ORDER = { primary: 1, special: 2, heavy: 3 };
  const BREAKER_NAMES = { 1: 'Shield Piercing', 2: 'Disruption', 3: 'Stagger' };
  const BREAKER_ALIAS = { shieldpiercing: 1, piercing: 1, shield: 1, barrier: 1, antibarrier: 1, ab: 1, disruption: 2, disrupt: 2, overload: 2, ol: 2, stagger: 3, unstoppable: 3, us: 3 };
  // Update 9.7.0 ("Anti-Champion 2.0"): artifact anti-champion mods are gone; every weapon has an intrinsic
  // breaker from its archetype. Specific archetypes first (frame keyword + weapon type), then the base frames.
  // 1 Shield Piercing (Barrier), 2 Disruption (Overload), 3 Stagger (Unstoppable)
  const ARCH_EXC = [
    [/support/, /autorifle/, 2], [/adaptiveburst/, /linearfusion/, 1], [/areadenial/, /grenadelauncher/, 2],
    [/doublefire/, /grenadelauncher/, 3], [/micromissile/, /grenadelauncher/, 3], [/compressedwave/, /grenadelauncher/, 3],
    [/wave/, /grenadelauncher/, 3], [/heavyburst/, /handcannon/, 3], [/spreadshot/, /handcannon/, 2],
    [/aggressiveburst/, /submachinegun|pulserifle/, 3], [/heavyburst/, /pulserifle/, 3], [/legacypr55|pr55/, /pulserifle/, 1],
    [/rocketassisted/, /pulserifle|sidearm/, 3], [/disruption/, /sniperrifle/, 1], [/caster/, /sword/, 1],
    [/vortex/, /sword/, 2], [/wave/, /sword/, 3], [/dynamicheat|balancedheat/, /./, 2],
  ];
  const ARCH_BASE = [[/aggressive|highimpact/, 3], [/precision|adaptive/, 1], [/lightweight|rapidfire/, 2]];
  function archetypeBreaker(frame, type) {
    const f = norm(frame), t = norm(type); if (!f) return 0;
    for (const [fr, ty, b] of ARCH_EXC) if (fr.test(f) && ty.test(t)) return b;
    for (const [fr, b] of ARCH_BASE) if (fr.test(f)) return b;
    return 0;
  }
  // it.breaker    = intrinsic breaker: the exotic's own (Bungie breakerType / intrinsic perk text), else its archetype's
  // it.breakerSrc = 'exotic' | 'archetype'
  // it.set        = armor set name (Bungie equipable item set)
  function applyDefs(items, defs) {
    for (const it of items) {
      it.breaker = ''; it.breakerSrc = ''; it.abreaker = ''; it.abreakerSrc = ''; it.set = '';
      if (!defs) continue;
      // shaders, ornaments, trackers, mementos: never shown as sockets
      defs._cos ||= new Set(defs.cos || []);
      for (const p of it.perks) if (defs._cos.has(norm(p.n))) p.j = 1;
      if (it.kind === 'armor') { const s = defs.sets?.[defs.as?.[it.hash]]; if (s) it.set = s.n; continue; }
      if (it.kind !== 'weapon') continue;
      if (!it.ammo && defs.wa?.[it.hash]) it.ammo = AMMO_NAMES[defs.wa[it.hash]] || '';
      // Bungie's own per-weapon value (champion perk on the intrinsic plug) first; then the same intrinsic on other
      // weapons; only for weapons newer than this data snapshot fall back to the 9.7.0 archetype table
      let b = defs.wb?.[it.hash], src = 'bungie';
      if (!b) b = defs.fb?.[norm(it.frame)];
      if (!b) { b = archetypeBreaker(it.frame, it.type); src = 'rule'; }
      if (b) { it.breaker = (defs.breakers?.[b]) || BREAKER_NAMES[b] || ''; it.breakerSrc = src; it.breakerArch = it.frame; }
    }
  }
  const breakerId = name => BREAKER_ALIAS[norm(name)] ?? null;
  const anyBreaker = it => it.breaker || it.abreaker || '';
  // Plug definition for a name, respecting the item kind: armor-only plugs (archetypes, armor mods) never apply to
  // weapons and weapon-only plugs never to armor (e.g. "Demolitionist" is both a weapon trait and an armor archetype)
  const W_TYPES = new Set(['i', 'b', 'm', 't', 'o', 'w', 'k', 'c']), A_TYPES = new Set(['i', 'r', 'a', 'k']);
  function plugOf(name, defs, kind) {
    const k = norm(name);
    let p = (kind === 'armor' && defs?.pa?.[k]) || (kind === 'weapon' && defs?.pw?.[k]) || defs?.pi?.[k];
    if (p && kind && !(kind === 'armor' ? A_TYPES : W_TYPES).has(p[1])) p = null;
    return p || null;
  }
  // Everything known about one plug/perk name: Clarity, Data Compendium (formatted), Bungie text + socket type
  function perkInfo(name, defs, kind) {
    if (!defs) return null;
    const k = norm(name); const cl = defs.cl?.[k]; let dc = defs.dc?.[k];
    if (dc?.x) dc = { h: defs.dcx?.[dc.x] || '', s: dc.s };
    const p = plugOf(name, defs, kind);
    const bd = p?.[2] || '';
    return cl || dc || bd ? { cl, dc, bd, ty: p?.[1] || '', hash: p?.[3] || null } : null;
  }
  // ---------- description text (Bungie + Clarity + Data Compendium), for keyword search ----------
  const stripTags = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  function descText(name, defs) {
    defs._dt ||= new Map(); const k = norm(name);
    if (defs._dt.has(k)) return defs._dt.get(k);
    const i = perkInfo(name, defs);
    const t = i ? stripTags([i.bd, i.cl?.h, i.cl?.e, i.dc?.h].join(' ')).toLowerCase() : '';
    defs._dt.set(k, t); return t;
  }
  // Keyword -> regex that also catches the word's other forms (freeze/frozen, ignite/ignition, suppress/suppression…)
  const KW = { freeze: 'freez|frozen|froze', frozen: 'freez|frozen|froze', ignition: 'ignit', ignite: 'ignit', invisible: 'invisib', invis: 'invisib', invisibility: 'invisib', radiant: 'radian', restoration: 'restor', amplified: 'amplif', amplify: 'amplif', overshield: 'overshield', weaken: 'weaken', weakened: 'weaken', unravel: 'unravel', suspend: 'suspen', suspended: 'suspen', sever: 'sever', jolt: 'jolt', blind: 'blind', scorch: 'scorch', slow: 'slow', shatter: 'shatter', volatile: 'volatil', devour: 'devour', cure: 'cure|cured|curing', tangle: 'tangle', threadling: 'threadling' };
  const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function keywordRe(v) {
    v = String(v || '').toLowerCase().trim(); if (v.length < 3) return null;
    if (KW[v]) return new RegExp(KW[v], 'i');
    let stem = v;
    if (!v.includes(' ')) for (const suf of ['ation', 'ition', 'ions', 'ion', 'ing', 'ed', 'es', 's', 'e']) if (v.length - suf.length >= 4 && v.endsWith(suf)) { stem = v.slice(0, -suf.length); break; }
    return new RegExp(reEsc(stem), 'i');
  }
  // Which parts of an item have description text matching re: its perks/mods, armor set bonus, exotic weapon notes
  function descHits(it, re, defs) {
    if (!defs || !re) return [];
    const hits = it.perks.filter(p => !p.j && re.test(descText(p.n, defs))).map(p => 'perk:' + p.n);
    const set = defs.sets?.[defs.as?.[it.hash]];
    if (set) { const ds = defs.dset?.[norm(set.n)]; if (re.test(set.p.map(x => x.n + ' ' + x.d).join(' ') + ' ' + stripTags(Object.values(ds?.p || {}).map(x => x[1]).join(' ')))) hits.push('set'); }
    const ex = /exotic/i.test(it.rarity) && defs.dcx?.[norm(it.name)];
    if (ex && re.test(stripTags(ex))) hits.push('frame');
    return hits;
  }

  // ---------- triage: an item's defining identifiers as search terms ----------
  const q = v => /[\s"]/.test(v) ? '"' + String(v).replace(/"/g, '') + '"' : v;
  function identifiers(it, defs) {
    const out = [];
    const add = (id, group, label, term, def) => out.push({ id, group, label, term, def: !!def });
    out.push({ id: 'kind', group: 'Kind', label: it.kind === 'armor' ? 'Armor' : 'Weapon', term: 'is:' + it.kind, def: true, fixed: true });
    if (it.type) add('type', it.kind === 'armor' ? 'Armor type' : 'Weapon type', it.type, 'exacttype:' + q(it.type), true);
    if (it.kind === 'armor' && it.equippable && it.equippable !== 'Any') add('class', 'Class', it.equippable, 'class:' + q(it.equippable.toLowerCase()), true);
    if (it.frame) add('frame', 'Archetype', it.frame, 'exactframe:' + q(it.frame), it.kind === 'weapon');
    if (it.kind === 'weapon' && it.element) add('element', 'Element', it.element, 'element:' + norm(it.element));
    if (it.kind === 'weapon' && it.ammo) add('ammo', 'Ammo', it.ammo, 'ammo:' + norm(it.ammo));
    if (it.breaker) add('breaker', 'Breaker', it.breaker, 'breaker:' + norm(it.breaker));
    if (it.set) add('set', 'Armor set', it.set, 'exactset:' + q(it.set));
    if (it.kind === 'armor' && it.tertiary) add('tertiary', 'Tertiary stat', it.tertiary, 'tertiary:' + q(it.tertiary));
    if (it.rarity) add('rarity', 'Rarity', it.rarity, 'is:' + norm(it.rarity));
    // equipped perks / traits (not the intrinsic, mods or masterwork)
    const sk = sockets(it, defs);
    for (const c of sk.cols) for (const p of c.perks.filter(p => p.s)) add('perk:' + p.n, c.ty === 't' ? 'Trait' : c.ty === 'o' ? 'Origin trait' : 'Perk', p.n.replace(/^Enhanced\s+/i, ''), 'exactperk:' + q(p.n.replace(/^Enhanced\s+/i, '')));
    for (const p of sk.exotic) add('perk:' + p.n, 'Exotic perk', p.n, 'exactperk:' + q(p.n));
    if (it.name) add('name', 'Name', it.name, 'exactname:' + q(it.name));
    if (it.source) add('source', 'Source', it.source, 'exactsource:' + q(it.source));
    return out;
  }

  // Game-style socket layout from DIM's flat perk list: intrinsic, perk columns, mods.
  // Columns break when the socket type changes or a second equipped perk of the same type appears.
  const COL_TYPES = new Set(['b', 'm', 't', 'o']);
  function sockets(it, defs) {
    const out = { intrinsic: [], cols: [], mods: [], exotic: [], mw: [], catalyst: [] };
    let cur = null;
    for (const p of it.perks) {
      if (p.j) continue;
      const ty = plugOf(p.n, defs, it.kind)?.[1] || '';
      const isIntr = ty === 'i' || norm(p.n) === norm(it.frame);
      if (it.kind === 'armor') {
        // archetype (Bulwark, Paragon…) is the intrinsic; exotic perks and Solipsism's spirits go in "exotic"
        if (ty === 'r' || norm(p.n) === norm(it.frame)) out.intrinsic.push(p);
        else if (isIntr || /^spirit of/i.test(p.n) || norm(p.n) === norm(it.name) || (!ty && /exotic/i.test(it.rarity))) out.exotic.push(p);
        else if (ty === 'k' || /masterwork/i.test(p.n)) out.mw.push(p);
        else out.mods.push(p);
        continue;
      }
      if (isIntr && !out.cols.length) { out.intrinsic.push(p); continue; }
      if (ty === 'k' || /^masterwork|masterwork$|^tier \d+:/i.test(p.n)) { out.mw.push(p); continue; }
      if (ty === 'c' || /catalyst/i.test(p.n)) { out.catalyst.push(p); continue; }
      const colTy = COL_TYPES.has(ty) ? ty : (ty ? '' : '?');
      if (!colTy) { out.mods.push(p); continue; }
      if (!cur || (colTy !== '?' && cur.ty !== '?' && colTy !== cur.ty) || (p.s && cur.perks.some(x => x.s))) { cur = { ty: colTy, perks: [] }; out.cols.push(cur); }
      cur.perks.push(p);
    }
    for (const c of out.cols) c.perks.sort((a, b) => b.s - a.s);
    return out;
  }

  // ---------- ratings ----------
  // ratings: { [hash]: { n, pve, pvp, c: [[ [perkName, relPct, pct], ...], ...] } }
  const COL_W = [1, 1, 2, 2, 0.5, 0.5, 0.5];
  function prepRatings(raw) {
    const out = {};
    // ratings JSON is untrusted: keep only digit hashes, numbers in range and string perk names
    const fin = (v, lo, hi) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
    if (!raw || typeof raw !== 'object') return out;
    for (const [h, r] of Object.entries(raw)) {
      if (!/^\d{1,12}$/.test(h) || !r || typeof r !== 'object') continue;
      const cols = Array.isArray(r.c) ? r.c.slice(0, 12) : [];
      out[h] = {
        n: typeof r.n === 'string' ? r.n.slice(0, 200) : '', pve: fin(r.pve, 0, 5), pvp: fin(r.pvp, 0, 5),
        cols: cols.map(col => { const m = new Map(); (Array.isArray(col) ? col.slice(0, 40) : []).forEach(x => { if (!Array.isArray(x) || typeof x[0] !== 'string') return; const n = x[0].slice(0, 200); m.set(norm(n), { n, rel: fin(x[1], 0, 100) ?? 0, pct: fin(x[2], 0, 100) ?? 0 }); }); return m; }),
      };
    }
    return out;
  }
  function rateItem(it, R) {
    const r = R[it.hash];
    it.rating = null; it.pve = null; it.pvp = null; it.perkRel = {};
    if (!r) return;
    it.pve = r.pve ?? null; it.pvp = r.pvp ?? null;
    let sum = 0, w = 0;
    r.cols.forEach((m, ci) => {
      let best = null;
      for (const p of it.perks) {
        const hit = m.get(norm(p.n));
        if (hit) { it.perkRel[p.n] = hit; if (best === null || hit.rel > best) best = hit.rel; }
      }
      // light.gg lists only the top ~9 perks per column: a roll whose perk isn't listed
      // in a barrel/mag/trait column sits below the list, so score it at half the lowest listed.
      if (best === null && ci < 4 && m.size >= 5) best = Math.round(Math.min(...[...m.values()].map(x => x.rel)) / 2);
      if (best !== null) { const wt = COL_W[ci] ?? 0.5; sum += best * wt; w += wt; }
    });
    it.rating = w ? Math.round(sum / w) : null;
  }

  // ---------- query language ----------
  function tokenize(s) {
    const out = []; const re = /(-?)([a-z%]+[a-z0-9.%]*)?(:|>=|<=|>|<|=)?("[^"]*"|\S+)?/gi;
    // simpler manual scanner
    let i = 0; s = s.trim();
    while (i < s.length) {
      while (s[i] === ' ') i++;
      if (i >= s.length) break;
      let tok = '';
      while (i < s.length && s[i] !== ' ') {
        if (s[i] === '"') { const j = s.indexOf('"', i + 1); const end = j < 0 ? s.length : j; tok += s.slice(i, end + 1); i = end + 1; }
        else tok += s[i++];
      }
      if (tok) out.push(tok);
    }
    return out;
  }
  const unq = v => v.replace(/^"|"$/g, '');
  function parseTerm(tok) {
    let neg = false;
    if (tok.startsWith('-') && tok.length > 1) { neg = true; tok = tok.slice(1); }
    if (tok.startsWith('not:')) { neg = !neg; tok = tok.slice(4); }
    // key:op:val | key:opval | keyopval
    let m = tok.match(/^([a-z%][a-z0-9_%]*)(?::([a-z0-9_ "'\-.]+?))?(?::)?(>=|<=|>|<|=)(-?[\d.]+)$/i);
    if (m && /^(power|tier|stat|basestat|rating|pve|pvp|level|kills|season|year|energy|mwtier|total|count)$/i.test(m[1])) {
      return { neg, key: m[1].toLowerCase(), sub: m[2] ? unq(m[2]) : '', op: m[3], val: parseFloat(m[4]) };
    }
    m = tok.match(/^([a-z][a-z0-9_]*):(.*)$/i);
    if (m) {
      const key = m[1].toLowerCase(); let val = unq(m[2]);
      if (/^(power|tier|rating|pve|pvp|level|kills|season|year|energy|mwtier|total|count)$/.test(key) && /^-?[\d.]+$/.test(val)) return { neg, key, sub: '', op: '=', val: parseFloat(val) };
      if (/^(stat|basestat)$/.test(key)) { const s2 = val.match(/^([a-z0-9 ]+):?(>=|<=|>|<|=)?(-?[\d.]+)$/i); if (s2) return { neg, key, sub: s2[1], op: s2[2] || '>=', val: parseFloat(s2[3]) }; }
      return { neg, key, val };
    }
    return { neg, key: 'text', val: unq(tok) };
  }
  function parseQuery(q) {
    const toks = tokenize(q || '');
    const groups = [[]]; let sort = null;
    for (const t of toks) {
      if (/^or$/i.test(t) || t === '|') { groups.push([]); continue; }
      if (/^and$/i.test(t)) continue;
      const pt = parseTerm(t);
      if (pt.key === 'sort') { sort = pt.val; continue; }
      groups[groups.length - 1].push(pt);
    }
    return { groups: groups.filter(g => g.length), sort };
  }
  const cmp = (a, op, b) => a !== null && a !== undefined && (op === '>=' ? a >= b : op === '<=' ? a <= b : op === '>' ? a > b : op === '<' ? a < b : a === b);
  const has = (hay, needle) => norm(hay).includes(norm(needle));
  const ELEMENTS = ['kinetic', 'arc', 'solar', 'void', 'stasis', 'strand', 'prismatic'];
  const RARITIES = ['exotic', 'legendary', 'rare', 'uncommon', 'common'];
  function findStat(obj, name) {
    const n = norm(name); if (!n) return [null, null];
    const alias = { rpm: 'rof', rof: 'rof', mag: 'mag', magazine: 'mag', aa: 'aa', aimassist: 'aa', aimassistance: 'aa', reloadspeed: 'reload', mobility: 'weapons', resilience: 'health', recovery: 'class', discipline: 'grenade', intellect: 'super', strength: 'melee' }[n];
    for (const k of Object.keys(obj)) { const kn = norm(k); if (kn === n || kn === alias || (n.length >= 3 && kn.startsWith(n))) return [k, obj[k]]; }
    return [null, null];
  }
  // Evaluate one term -> array of hit field keys (truthy) or null
  function evalTerm(t, it, ctx) {
    const v = String(t.val ?? '').toLowerCase();
    switch (t.key) {
      case 'is': {
        if (v === 'weapon') return it.kind === 'weapon' ? ['kind'] : null;
        if (v === 'armor' || v === 'armour') return it.kind === 'armor' ? ['kind'] : null;
        if (RARITIES.includes(v)) return norm(it.rarity) === v ? ['rarity'] : null;
        if (ELEMENTS.includes(v)) return norm(it.element) === v ? ['element'] : null;
        if (['primary', 'special', 'heavy'].includes(v)) return has(it.ammo, v) ? ['ammo'] : null;
        if (['titan', 'hunter', 'warlock'].includes(v)) return has(it.equippable, v) ? ['equippable'] : null;
        if (v === 'crafted') return it.crafted ? ['crafted'] : null;
        if (['breaker', 'champion', 'antichampion'].includes(v)) return anyBreaker(it) ? ['breaker'] : null;
        if (v === 'intrinsicbreaker') return it.breaker ? ['breaker'] : null;
        if (v === 'artifactbreaker') return it.abreaker ? ['breaker'] : null;
        if (['shieldpiercing', 'antibarrier', 'disruption', 'overload', 'stagger', 'unstoppable'].includes(norm(v))) return [it.breaker, it.abreaker].some(b => b && breakerId(b) === BREAKER_ALIAS[norm(v)]) ? ['breaker'] : null;
        if (v === 'setbonus' || v === 'armorset') return it.set ? ['set'] : null;
        if (v === 'locked') return it.locked ? ['locked'] : null;
        if (v === 'unlocked') return !it.locked ? ['locked'] : null;
        if (v === 'equipped') return it.equipped ? ['owner'] : null;
        if (v === 'vault' || v === 'invault') return /vault/i.test(it.owner) ? ['owner'] : null;
        if (v === 'holofoil') return it.holofoil ? ['holofoil'] : null;
        if (v === 'featured' || v === 'new gear' || v === 'newgear') return it.featured ? ['featured'] : null;
        if (v === 'masterwork' || v === 'masterworked') return (it.mwTier ?? 0) >= 10 ? ['mw'] : null;
        if (v === 'tagged') return it.tag ? ['tag'] : null;
        if (v === 'untagged') return !it.tag ? ['tag'] : null;
        if (v === 'hasnotes' || v === 'notes') return it.notes ? ['notes'] : null;
        if (v === 'dupe' || v === 'dupes' || v === 'duplicate') return (ctx.dupeCount[it.name + '|' + it.kind] || 0) > 1 ? ['name'] : null;
        if (v === 'rated') return it.rating != null ? ['rating'] : null;
        if (v === 'unrated') return it.rating == null && it.kind === 'weapon' ? ['rating'] : null;
        if (v === 'edited' || v === 'pending') return ctx.edited.has(it.id) ? ['tag', 'notes'] : null;
        // fall through: type match e.g. is:handcannon / is:helmet
        return has(it.type, v) ? ['type'] : (has(it.category, v) ? ['type'] : null);
      }
      case 'tag': {
        if (v === 'none') return !it.tag ? ['tag'] : null;
        if (v === 'any') return it.tag ? ['tag'] : null;
        return it.tag === v ? ['tag'] : null;
      }
      case 'notes': case 'note':
        if (v === 'none') return !it.notes ? ['notes'] : null;
        return has(it.notes, v) || it.notes.toLowerCase().includes(v) ? ['notes'] : null;
      case 'name': return has(it.name, v) ? ['name'] : null;
      // exact-match variants (used by the triage buttons so "Fusion Rifle" doesn't also match "Linear Fusion Rifle")
      case 'exactname': return norm(it.name) === norm(v) ? ['name'] : null;
      case 'exacttype': return norm(it.type) === norm(v) ? ['type'] : null;
      case 'exactframe': case 'exactarchetype': return norm(it.frame) === norm(v) ? ['frame'] : null;
      case 'exactsource': return norm(it.source) === norm(v) ? ['source'] : null;
      case 'exactset': return norm(it.set) === norm(v) ? ['set'] : null;
      case 'rarity': return has(it.rarity, v) ? ['rarity'] : null;
      case 'element': case 'damage': case 'dmg': return has(it.element, v) ? ['element'] : null;
      case 'type': case 'weapontype': return has(it.type, v) ? ['type'] : null;
      case 'archetype': case 'frame': case 'intrinsic': return has(it.frame, v) ? ['frame'] : null;
      case 'source': return has(it.source, v) ? ['source'] : null;
      case 'ammo': return has(it.ammo, v) ? ['ammo'] : null;
      case 'breaker': case 'champion': {
        if (v === 'none') return !anyBreaker(it) && it.kind === 'weapon' ? ['breaker'] : null;
        if (v === 'any') return anyBreaker(it) ? ['breaker'] : null;
        const id = BREAKER_ALIAS[norm(v)];
        return [it.breaker, it.abreaker].some(b => b && (id ? breakerId(b) === id : has(b, v))) ? ['breaker'] : null;
      }
      case 'set': case 'armorset': {
        if (v === 'none') return it.kind === 'armor' && !it.set ? ['set'] : null;
        if (v === 'any') return it.set ? ['set'] : null;
        return it.set && has(it.set, v) ? ['set'] : null;
      }
      case 'desc': case 'perkdesc': case 'clarity': {
        // search the Clarity / Data Compendium text of the item's perks
        if (!ctx.defs || !v) return null;
        const hits = descHits(it, ctx.kw(v), ctx.defs);
        return hits.length ? hits : null;
      }
      case 'class': return has(it.equippable, v) ? ['equippable'] : null;
      case 'slot': case 'category': return has(it.category, v) ? ['type'] : null;
      case 'owner': case 'location': return has(it.owner, v) ? ['owner'] : null;
      case 'tertiary': case 'tertiarystat': return has(it.tertiary, v) ? ['tertiary'] : null;
      case 'tuning': case 'tunedstat': return has(it.tuning, v) ? ['tuning'] : null;
      case 'mw': case 'masterwork': return has(it.mwType, v) ? ['mw'] : null;
      case 'event': return has(it.event, v) ? ['event'] : null;
      case 'foundry': return has(it.foundry, v) ? ['foundry'] : null;
      case 'perk': case 'exactperk': case 'perksel': case 'perkname': {
        const exact = t.key === 'exactperk';
        const hits = it.perks.filter(p => (t.key !== 'perksel' || p.s) && (exact ? norm(p.n) === norm(v) : has(p.n, v))).map(p => 'perk:' + p.n);
        if (!hits.length && (exact ? norm(it.frame) === norm(v) : has(it.frame, v)) && v) return ['frame'];
        return hits.length ? hits : null;
      }
      case 'power': return cmp(it.power, t.op, t.val) ? ['power'] : null;
      case 'tier': return cmp(it.tier, t.op, t.val) ? ['tier'] : null;
      case 'level': return cmp(it.level, t.op, t.val) ? ['level'] : null;
      case 'kills': return cmp(it.kills, t.op, t.val) ? ['kills'] : null;
      case 'season': return cmp(it.season, t.op, t.val) ? ['season'] : null;
      case 'year': return cmp(it.year, t.op, t.val) ? ['season'] : null;
      case 'energy': return cmp(it.energy, t.op, t.val) ? ['energy'] : null;
      case 'mwtier': return cmp(it.mwTier, t.op, t.val) ? ['mw'] : null;
      case 'rating': return cmp(it.rating, t.op, t.val) ? ['rating'] : null;
      case 'pve': return cmp(it.pve, t.op, t.val) ? ['rating'] : null;
      case 'pvp': return cmp(it.pvp, t.op, t.val) ? ['rating'] : null;
      case 'count': return cmp(ctx.dupeCount[it.name + '|' + it.kind] || 0, t.op, t.val) ? ['name'] : null;
      case 'total': { const [k, val] = findStat(it.stats, 'total'); return cmp(val, t.op, t.val) ? ['stat:' + k] : null; }
      case 'stat': case 'basestat': {
        const src = t.key === 'basestat' && Object.keys(it.base).length ? it.base : it.stats;
        const [k, val] = findStat(src, t.sub); return cmp(val, t.op, t.val) ? ['stat:' + k] : null;
      }
      case 'text': default: {
        const needle = t.key === 'text' ? v : (t.key + ':' + v);
        if (has(it.name, needle)) return ['name'];
        if (has(it.type, needle)) return ['type'];
        if (has(it.frame, needle)) return ['frame'];
        const ph = it.perks.filter(p => has(p.n, needle)).map(p => 'perk:' + p.n);
        if (ph.length) return ph;
        if (it.notes.toLowerCase().includes(needle)) return ['notes'];
        if (has(it.source, needle)) return ['source'];
        if (has(it.set, needle)) return ['set'];
        if ([it.breaker, it.abreaker].some(b => b && has(b, needle))) return ['breaker'];
        // keywords inside perk / mod / set bonus / exotic descriptions (ignition, freeze, suppress…)
        const dh = descHits(it, ctx.kw(needle), ctx.defs);
        return dh.length ? dh : null;
      }
    }
  }
  // returns Map(id -> Set(hitKeys)) of matching items
  function runQuery(parsed, items, ctx) {
    const res = new Map();
    if (!parsed.groups.length) { items.forEach(it => res.set(it.id, new Set())); return res; }
    for (const it of items) {
      let matched = null;
      for (const g of parsed.groups) {
        const hits = new Set(); let ok = true;
        for (const t of g) {
          const h = evalTerm(t, it, ctx);
          if (t.neg ? h : !h) { ok = false; break; }
          if (!t.neg) h.forEach(x => hits.add(x));
        }
        if (ok) { matched = matched || new Set(); hits.forEach(x => matched.add(x)); }
      }
      if (matched) res.set(it.id, matched);
    }
    return res;
  }
  function buildCtx(items, edited, defs) {
    const dupeCount = {};
    items.forEach(it => { const k = it.name + '|' + it.kind; dupeCount[k] = (dupeCount[k] || 0) + 1; });
    const kwCache = new Map();
    const kw = v => { if (!kwCache.has(v)) kwCache.set(v, keywordRe(v)); return kwCache.get(v); };
    return { dupeCount, edited: edited || new Set(), defs: defs || null, kw };
  }

  // ---------- sorting / grouping ----------
  const RAR_ORDER = { exotic: 0, legendary: 1, rare: 2, uncommon: 3, common: 4 };
  const TAG_ORDER = { favorite: 0, keep: 1, infuse: 2, archive: 3, junk: 4, '': 5 };
  function sortVal(it, key) {
    if (key.startsWith('stat:')) { const [, v] = findStat(it.stats, key.slice(5)); return v; }
    switch (key) {
      case 'rating': return it.rating; case 'pve': return it.pve; case 'pvp': return it.pvp;
      case 'power': return it.power; case 'tier': return it.tier; case 'name': return it.name.toLowerCase();
      case 'rarity': return RAR_ORDER[norm(it.rarity)] ?? 9; case 'tag': return TAG_ORDER[it.tag] ?? 6;
      case 'type': return it.type; case 'frame': return it.frame; case 'element': return it.element;
      case 'season': return it.season; case 'source': return it.source; case 'kills': return it.kills;
      case 'total': return findStat(it.stats, 'total')[1];
      case 'ammo': return AMMO_ORDER[norm(it.ammo)] ?? null;
      case 'breaker': return breakerId(anyBreaker(it));
      case 'crafted': return it.crafted ? 1 : 0;
      case 'set': return it.set ? it.set.toLowerCase() : null;
      case 'class': return it.equippable || null;
      default: return null;
    }
  }
  function sortItems(arr, key, dir) {
    const d = dir === 'asc' ? 1 : -1;
    return arr.sort((a, b) => {
      const x = sortVal(a, key), y = sortVal(b, key);
      if (x == null && y == null) return a.name.localeCompare(b.name);
      if (x == null) return 1; if (y == null) return -1;
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return c ? c * d : a.name.localeCompare(b.name);
    });
  }
  function groupKey(it, g) {
    switch (g) {
      case 'type': return it.type || '—'; case 'frame': return it.frame || '—'; case 'element': return it.element || '—';
      case 'rarity': return it.rarity || '—'; case 'tier': return it.tier != null ? 'Tier ' + it.tier : 'No tier';
      case 'tag': return it.tag || 'untagged'; case 'source': return it.source || '—';
      case 'season': return it.season != null ? 'Season ' + it.season : '—'; case 'name': return it.name;
      case 'class': return it.equippable || '—'; case 'ammo': return it.ammo || '—';
      case 'breaker': return anyBreaker(it) || 'No breaker';
      case 'set': return it.set || 'No set bonus';
      case 'crafted': return it.crafted ? 'Crafted' : 'Not crafted';
      default: return '';
    }
  }
  // order for group headers where alphabetical is wrong
  function groupOrder(g, name) {
    if (g === 'ammo') return AMMO_ORDER[norm(name)] ?? 9;
    if (g === 'breaker') return breakerId(name) ?? 9;
    if (g === 'set') return name === 'No set bonus' ? 1 : 0;
    return null;
  }

  // ---------- build maker: element keyword synergies ----------
  // Every build piece (super, abilities, aspects, fragments, weapons, armor, mods) is read from its own description
  // text (Bungie + Clarity; the Data Compendium only where neither has text). For each keyword we decide, per
  // sentence, whether the piece PRODUCES it ("make you radiant", "targets are scorched"), USES it ("while radiant",
  // "defeating scorched targets") or only MENTIONS it. Sentences that negate ("does not", "cannot") are skipped.
  // A producer and a user of the same keyword form an interaction; the sentence is kept as evidence.
  const SYN = [
    ['scorch', 'Scorch', 'solar', 'scorch'], ['ignite', 'Ignition', 'solar', 'ignit'], ['radiant', 'Radiant', 'solar', 'radian'],
    ['restoration', 'Restoration', 'solar', '\\brestoration\\b'], ['cure', 'Cure', 'solar', '\\bcur(?:e|es|ed|ing)\\b'],
    ['firesprite', 'Firesprite', 'solar', 'firesprite'], ['sunspot', 'Sunspot', 'solar', 'sunspot'],
    ['jolt', 'Jolt', 'arc', 'jolt'], ['blind', 'Blind', 'arc', '\\bblind'], ['amplified', 'Amplified', 'arc', 'amplif'],
    ['ionictrace', 'Ionic Trace', 'arc', 'ionic trace'], ['boltcharge', 'Bolt Charge', 'arc', 'bolt charge'],
    ['volatile', 'Volatile', 'void', 'volatil'], ['weaken', 'Weaken', 'void', 'weaken'], ['suppress', 'Suppress', 'void', 'suppress'],
    ['devour', 'Devour', 'void', 'devour'], ['overshield', 'Overshield', 'void', 'overshield'], ['invisible', 'Invisibility', 'void', 'invisib'],
    ['voidbreach', 'Void Breach', 'void', 'void breach'],
    ['slow', 'Slow', 'stasis', '\\bslow(?:s|ed|ing)?\\b'], ['freeze', 'Freeze', 'stasis', 'freez|frozen'], ['shatter', 'Shatter', 'stasis', 'shatter'],
    ['crystal', 'Stasis crystal', 'stasis', 'crystal'], ['shard', 'Stasis shard', 'stasis', '\\bshards?\\b'], ['frostarmor', 'Frost Armor', 'stasis', 'frost armor'],
    ['sever', 'Sever', 'strand', '\\bsever'], ['suspend', 'Suspend', 'strand', 'suspen'], ['unravel', 'Unravel', 'strand', 'unravel'],
    ['wovenmail', 'Woven Mail', 'strand', 'woven mail'], ['threadling', 'Threadling', 'strand', 'threadling'], ['tangle', 'Tangle', 'strand', 'tangle'],
    ['transcend', 'Transcendence', 'prism', 'transcend'],
    ['orb', 'Orbs of Power', '', 'orbs? of (?:power|light)'], ['armorcharge', 'Armor Charge', '', 'armor charge'],
    ['finisher', 'Finisher', '', 'finisher'], ['healing', 'Healing', '', '\\bheal(?:s|ed|ing)?\\b'],
    ['grenadeenergy', 'Grenade energy', '', 'grenade energy'], ['meleeenergy', 'Melee energy', '', 'melee energy'],
    ['classenergy', 'Class ability energy', '', 'class ability energy'], ['superenergy', 'Super energy', '', 'super energy'],
  ].map(([k, l, el, re]) => ({ k, l, el, re: new RegExp(re, 'gi') }));
  const SYN_BY = Object.fromEntries(SYN.map(s => [s.k, s]));
  // ability energy is "used" by the build's own ability of that kind (super, grenade, melee, class ability)
  const ENERGY_OF = { grenadeenergy: 'grenade', meleeenergy: 'melee', classenergy: 'classAbility', superenergy: 'super' };
  const USE_W = /^(against|at|on|to|defeating|killing|damaging|while|whilst|when|whenever|if|pick|picking|picks|collect\w*|absorb\w*|consum\w*|from|affected|extend\w*|duration|destroy\w*|shooting|breaking|hitting|requires?|have|has|having)$/;
  const PROD_W = /^(make|makes|making|become|becomes|becoming|grant|grants|granting|gain|gains|gaining|apply|applies|applying|create|creates|creating|spawn|spawns|spawning|generate|generates|cause|causes|inflict|inflicts|emit|emits|summon|summons|are|is|be|get|gets|leave|leaves|release|releases|produce|produces|return|returns|restore|restores|refund|refunds|give|gives|into|cast|casts|spread|spreads|spreading|trigger|triggers)$/;
  const NEG = /\b(does not|doesn't|do not|don't|cannot|can't|no longer|will not|won't|unable)\b/i;
  const TARGETY = /^\s*(targets?|combatants?|enemies|enemy|foes?|them|nearby|the target|you|allies)\b/i;
  const sentences = t => String(t || '').split(/(?<=[.!?])\s+|\n+|•/).map(x => x.trim()).filter(x => x.length > 2);
  // role of one keyword occurrence: the nearest trigger word before it in the same clause decides
  function roleAt(clause, idx, tok) {
    const words = clause.slice(0, idx).toLowerCase().split(/[^a-z']+/).filter(Boolean).reverse();
    // nearest trigger wins; "use" words count only within 3 words ("defeating scorched", "while radiant"),
    // "produce" words within 6 ("make you and nearby allies radiant", "cause targets to become severed")
    for (let i = 0; i < Math.min(6, words.length); i++) { if (i < 3 && USE_W.test(words[i])) return 'u'; if (PROD_W.test(words[i])) return 'p'; }
    if (TARGETY.test(clause.slice(idx + tok.length)) && !/ed$/i.test(tok)) return 'p';   // "scorches targets", not "scorched targets"
    if (/ing$/i.test(tok)) return 'p';                                              // "a scorching explosion"
    return 'm';
  }
  // text -> { key: { p?: evidence, u?: evidence, m?: evidence } }; src labels where the text came from
  function synTags(parts) {
    const out = {};
    for (const [src, text] of parts) for (const sen of sentences(text)) {
      if (NEG.test(sen)) continue;
      for (const s of SYN) {
        s.re.lastIndex = 0; let m;
        while ((m = s.re.exec(sen))) {
          const cs = sen.lastIndexOf(',', m.index) + 1;                  // clause start
          const tok = m[0] + (sen.slice(m.index + m[0].length).match(/^[a-z]*/i)?.[0] || '');   // whole word: scorch -> scorches
          const role = roleAt(sen.slice(cs), m.index - cs, tok);
          const t = (out[s.k] ||= {});
          if (!t[role]) t[role] = { src, text: sen.length > 260 ? sen.slice(0, 257) + '…' : sen };
        }
      }
    }
    return out;
  }
  // description text of a plug / ability by name: [[source, plainText], …]
  function pieceText(name, defs, bungie, kind) {
    const i = perkInfo(name, defs, kind) || {};
    const out = [];
    const bd = bungie || i.bd; if (bd) out.push(['Bungie', bd]);
    if (i.cl) out.push(['Clarity', stripTags(String(i.cl.h || '').replace(/<\/div>|<br>/g, '\n'))]);
    if (!out.length && i.dc?.h) out.push(['Data Compendium', stripTags(String(i.dc.h).replace(/<\/div>|<br>/g, '\n'))]);
    return out;
  }
  // slots
  const W_SLOTS = ['kinetic', 'energy', 'power'], A_SLOTS = ['head', 'arms', 'chest', 'legs', 'class'];
  const weaponSlot = it => /kinetic/i.test(it.category) ? 'kinetic' : /energy/i.test(it.category) ? 'energy' : /power|heavy/i.test(it.category) ? 'power' : '';
  function armorSlot(it) {
    const t = `${it.category} ${it.type}`.toLowerCase();
    return /helmet|head/.test(t) ? 'head' : /gauntlet|arms|glove/.test(t) ? 'arms' : /chest/.test(t) ? 'chest' : /leg|boots|greaves|strides/.test(t) ? 'legs' : /class item|bond|mark|cloak/.test(t) ? 'class' : '';
  }
  const SUB_SINGLE = ['super', 'classAbility', 'movement', 'melee', 'grenade'];
  const subOf = (b, defs) => defs?.sub?.[b?.cls]?.[b?.el] || null;
  // choices a player makes; Prismatic's prism_grenade socket is the fixed transcendence grenade, shown with Transcendence
  const subList = (sc, sec) => sec === 'grenade' ? (sc?.s?.grenade || []).filter(a => !/prism_grenade$/.test(a.c || '')) : sec === 'transcendence' ? [...(sc?.s?.transcendence || []), ...(sc?.s?.grenade || []).filter(a => /prism_grenade$/.test(a.c || ''))] : (sc?.s?.[sec] || []);
  const findSub = (sc, sec, h) => subList(sc, sec).find(a => a.h === h) || null;
  // fragment slots: the chosen aspects' capacities (Bungie energyCapacity)
  const fragSlots = (b, defs) => (b?.sub?.aspects || []).reduce((n, h) => n + (findSub(subOf(b, defs), 'aspects', h)?.fc || 0), 0);
  // keep a build's choices inside the game's limits (2 aspects, fragments up to the aspects' slots, ≤3 mods a slot)
  function normBuild(b, defs) {
    const sc = subOf(b, defs);
    b.sub ||= {}; b.w ||= {}; b.a ||= {}; b.mods ||= {};
    for (const k of SUB_SINGLE) if (b.sub[k] != null && !findSub(sc, k, b.sub[k])) delete b.sub[k];
    b.sub.aspects = [...new Set((b.sub.aspects || []).filter(h => findSub(sc, 'aspects', h)))].slice(0, 2);
    b.sub.fragments = [...new Set((b.sub.fragments || []).filter(h => findSub(sc, 'fragments', h)))].slice(0, fragSlots(b, defs));
    for (const s of A_SLOTS) b.mods[s] = (b.mods[s] || []).filter(n => typeof n === 'string').slice(0, 3);
    return b;
  }
  // every piece of a build with its text: { g: group, slot, n: name, label, it?, parts }
  function buildPieces(b, defs, byId) {
    const out = []; const sc = subOf(b, defs);
    if (sc) {
      const SEC_L = { super: 'Super', classAbility: 'Class ability', movement: 'Movement', melee: 'Melee', grenade: 'Grenade', aspects: 'Aspect', fragments: 'Fragment' };
      for (const k of SUB_SINGLE) { const a = findSub(sc, k, b.sub?.[k]); if (a) out.push({ g: 'subclass', slot: k, n: a.n, label: SEC_L[k], parts: pieceText(a.n, defs, a.d) }); }
      for (const k of ['aspects', 'fragments']) for (const h of b.sub?.[k] || []) { const a = findSub(sc, k, h); if (a) out.push({ g: 'subclass', slot: k, n: a.n, label: SEC_L[k], st: a.st, parts: pieceText(a.n, defs, a.d) }); }
      for (const a of subList(sc, 'transcendence')) out.push({ g: 'subclass', slot: 'transcendence', n: a.n, label: 'Transcendence', parts: pieceText(a.n, defs, a.d) });
    }
    const itemPieces = (it, slot, g) => {
      const label = g === 'weapon' ? { kinetic: 'Kinetic', energy: 'Energy', power: 'Power' }[slot] : { head: 'Helmet', arms: 'Arms', chest: 'Chest', legs: 'Legs', class: 'Class item' }[slot];
      const sk = sockets(it, defs);
      const perks = g === 'weapon' ? [...sk.intrinsic, ...sk.exotic, ...sk.cols.flatMap(c => c.perks.filter(p => p.s && c.ty !== 'b' && c.ty !== 'm')), ...sk.catalyst.filter(p => p.s)] : [...sk.exotic];
      const parts = [];
      for (const p of perks) for (const [src, t] of pieceText(p.n, defs, null, it.kind)) parts.push([`${p.n} · ${src}`, t]);
      if (g === 'weapon' && /exotic/i.test(it.rarity) && !perks.length && defs?.dcx?.[norm(it.name)]) parts.push(['Data Compendium', stripTags(defs.dcx[norm(it.name)])]);
      out.push({ g, slot, n: it.name, label, it, parts });
    };
    for (const s of W_SLOTS) { const it = byId?.get(b.w?.[s]?.id); if (it) itemPieces(it, s, 'weapon'); }
    for (const s of A_SLOTS) { const it = byId?.get(b.a?.[s]?.id); if (it) itemPieces(it, s, 'armor'); }
    // armor set bonuses that the chosen pieces complete
    const setN = {};
    for (const s of A_SLOTS) { const it = byId?.get(b.a?.[s]?.id); const si = it && defs?.as?.[it.hash]; if (si != null) setN[si] = (setN[si] || 0) + 1; }
    for (const [si, n] of Object.entries(setN)) for (const p of defs.sets[si]?.p || []) if (n >= p.c) out.push({ g: 'armor', slot: 'set', n: p.n, label: `${defs.sets[si].n} · ${p.c}-piece bonus`, parts: [['Bungie', p.d]] });
    for (const s of A_SLOTS) for (const n of b.mods?.[s] || []) out.push({ g: 'mod', slot: s, n, label: 'Armor mod', parts: pieceText(n, defs, null, 'armor') });
    for (const p of out) p.tags = synTags(p.parts);
    return out;
  }
  const EL_WEAPON = /\b(solar|arc|void|stasis|strand|kinetic)\b(?:[\s/]+(?:solar|arc|void|stasis|strand|kinetic))*\s+weapons?\b/gi;
  // interactions between pieces: producer -> keyword -> user; matching weapon elements; ability energy feeding the
  // chosen ability. Returns { keys: [{k, l, el, p:[i], u:[i], m:[i]}], links: [{k, l, from, to, ef, et}] }
  function synergy(pieces) {
    const keys = [], links = [];
    for (const s of SYN) {
      const e = { k: s.k, l: s.l, el: s.el, p: [], u: [], m: [] };
      pieces.forEach((pc, i) => { const t = pc.tags[s.k]; if (!t) return; if (t.p) e.p.push(i); if (t.u) e.u.push(i); if (t.m && !t.p && !t.u) e.m.push(i); });
      const ab = ENERGY_OF[s.k] && pieces.findIndex(pc => pc.g === 'subclass' && pc.slot === ENERGY_OF[s.k]);
      if (ab != null && ab >= 0 && e.p.length) e.u.push(ab);
      if (!e.p.length && !e.u.length && !e.m.length) continue;
      keys.push(e);
      for (const a of e.p) for (const b of e.u) if (a !== b && !(pieces[a].g === pieces[b].g && pieces[a].g !== 'subclass' && pieces[a].slot === pieces[b].slot)) {
        links.push({ k: s.k, l: s.l, from: a, to: b, ef: pieces[a].tags[s.k].p, et: pieces[b].tags[s.k]?.u || { src: 'Build', text: `Your chosen ${pieces[b].label.toLowerCase()} uses this energy.` } });
      }
    }
    // "<Element> weapon" in a piece's text + a chosen weapon of that element
    pieces.forEach((pc, i) => {
      if (pc.g === 'weapon') return;
      for (const [src, text] of pc.parts) for (const sen of sentences(text)) {
        if (NEG.test(sen)) continue;
        EL_WEAPON.lastIndex = 0; let m;
        while ((m = EL_WEAPON.exec(sen))) {
          const els = m[0].toLowerCase().match(/solar|arc|void|stasis|strand|kinetic/g);
          pieces.forEach((w, j) => {
            if (w.g !== 'weapon' || !els.includes(String(w.it.element).toLowerCase())) return;
            if (links.some(x => x.k === 'el' && x.from === j && x.to === i)) return;
            links.push({ k: 'el', l: `${w.it.element} weapon`, from: j, to: i, ef: { src: 'Item', text: `${w.n} deals ${w.it.element} damage.` }, et: { src, text: sen } });
          });
        }
      }
    });
    return { keys, links };
  }
  // how well one candidate piece fits the build's other pieces (picker suggestions): score + reasons.
  // Each keyword counts once per role: element verbs 2, generic ones (orbs, healing, energy…) 1, mentions 0.5.
  function fitScore(mine, rest) {
    const all = [...rest, mine]; const me = all.length - 1;
    const { keys, links } = synergy(all);
    const why = []; let score = 0; const counted = new Set();
    const w = k => k === 'el' || SYN_BY[k]?.el ? 2 : 1;
    for (const l of links) if (l.from === me || l.to === me) {
      const role = l.from === me ? 'p' : 'u';
      if (!counted.has(l.k + role)) { counted.add(l.k + role); score += w(l.k); }
      why.push({ k: l.k, l: l.l, role, other: all[l.from === me ? l.to : l.from].n });
    }
    for (const e of keys) if (e.m.includes(me) && (e.p.length || e.u.length) && !counted.has(e.k + 'p') && !counted.has(e.k + 'u')) { score += 0.5; why.push({ k: e.k, l: e.l, role: 'm' }); }
    const seen = new Set();
    return { score, why: why.filter(x => { const id = x.k + x.role + (x.other || ''); if (seen.has(id)) return false; seen.add(id); return true; }) };
  }
  // a vault item as a candidate for a weapon / armor slot
  function synScore(it, pieces, defs, slot) {
    const g = it.kind === 'weapon' ? 'weapon' : 'armor';
    const mine = buildPieces({ w: g === 'weapon' ? { [slot]: { id: it.id } } : {}, a: g === 'armor' ? { [slot]: { id: it.id } } : {} }, defs, new Map([[it.id, it]]))[0];
    return mine ? fitScore(mine, pieces.filter(p => !(p.g === g && p.slot === slot))) : { score: 0, why: [] };
  }
  // a subclass choice (super, ability, aspect, fragment) as a candidate; replaces the current pick of a single slot
  function subScore(b, defs, sec, h, pieces) {
    const a = findSub(subOf(b, defs), sec, h); if (!a) return { score: 0, why: [] };
    const mine = { g: 'subclass', slot: sec, n: a.n, label: sec, parts: pieceText(a.n, defs, a.d) }; mine.tags = synTags(mine.parts);
    return fitScore(mine, pieces.filter(p => !(p.g === 'subclass' && (p.n === a.n || (SUB_SINGLE.includes(sec) && p.slot === sec)))));
  }
  // a mod as a candidate for an armor slot
  function modScore(n, slot, defs, pieces) {
    const mine = { g: 'mod', slot, n, label: 'Armor mod', parts: pieceText(n, defs, null, 'armor') }; mine.tags = synTags(mine.parts);
    return fitScore(mine, pieces.filter(p => !(p.g === 'mod' && p.n === n)));
  }
  // character stats: armor (base values when DIM gives them, else current) + fragment and mod bonuses
  const ARMOR3 = ['Weapons', 'Health', 'Class', 'Grenade', 'Super', 'Melee'];
  function buildStats(b, defs, byId) {
    const out = Object.fromEntries(ARMOR3.map(k => [k, { armor: 0, frag: 0, mods: 0, total: 0 }]));
    let src = '';
    for (const s of A_SLOTS) {
      const it = byId?.get(b.a?.[s]?.id); if (!it) continue;
      const useBase = ARMOR3.some(k => it.base?.[k] != null); src ||= useBase ? 'base' : 'current';
      for (const k of ARMOR3) out[k].armor += (useBase ? it.base[k] : it.stats[k]) || 0;
    }
    const sc = subOf(b, defs);
    for (const h of b.sub?.fragments || []) { const f = findSub(sc, 'fragments', h); for (const [k, v] of Object.entries(f?.st || {})) if (out[k]) out[k].frag += v; }
    const modSt = n => { for (const l of Object.values(defs?.am || {})) { const m = l.find(x => norm(x[0]) === norm(n)); if (m) return m[2] || {}; } return {}; };
    for (const s of A_SLOTS) for (const n of b.mods?.[s] || []) for (const [k, v] of Object.entries(modSt(n))) if (out[k]) out[k].mods += v;
    for (const k of ARMOR3) out[k].total = out[k].armor + out[k].frag + out[k].mods;
    return { stats: out, src, total: ARMOR3.reduce((a, k) => a + out[k].total, 0) };
  }
  // armor mods a slot can take (its own list + general) and their energy cost
  // ---------- DIM loadout share link ----------
  // DIM opens https://app.destinyitemmanager.com/loadouts?loadout=<JSON of its API Loadout> (DIM source:
  // loadout-share/loadout-import.ts decodeUrlLoadout; type: dim-api api/shapes/loadouts.ts). The subclass is an
  // equipped item with socketOverrides {socketIndex: plugHash}; weapons/armor are {id, hash}; mods go in
  // parameters.mods as hashes and DIM assigns them to armor pieces itself.
  const DIM_CLASS = { titan: 0, hunter: 1, warlock: 2 };
  function dimLoadout(b, defs, byId, id) {
    const equipped = []; const sc = subOf(b, defs);
    if (sc?.so) {
      const ov = {}; const used = new Set();
      const place = a => { if (!a?.c) return; const i = sc.so.findIndex((c, k) => !used.has(k) && c.split('|').includes(a.c)); if (i >= 0) { used.add(i); ov[i] = a.h; } };
      for (const k of SUB_SINGLE) place(findSub(sc, k, b.sub?.[k]));
      for (const k of ['aspects', 'fragments']) for (const h of b.sub?.[k] || []) place(findSub(sc, k, h));
      equipped.push(Object.keys(ov).length ? { hash: sc.h, socketOverrides: ov } : { hash: sc.h });
    }
    for (const [g, slots] of [['w', W_SLOTS], ['a', A_SLOTS]]) for (const s of slots) {
      const r = b[g]?.[s]; if (!r) continue;
      const hash = Number(byId?.get(r.id)?.hash || r.hash); if (!hash) continue;
      equipped.push(ID_RE.test(String(r.id)) ? { id: String(r.id), hash } : { hash });
    }
    const mods = [];
    for (const s of A_SLOTS) for (const n of b.mods?.[s] || []) { const m = modsFor(s, defs).find(x => norm(x[0]) === norm(n)); if (m?.[3]) mods.push(m[3]); }
    const lo = { id, name: String(b.name || 'Ghost build').slice(0, 60), classType: DIM_CLASS[b.cls] ?? 3, equipped, unequipped: [] };
    if (mods.length) lo.parameters = { mods };
    if (b.notes) lo.notes = String(b.notes).slice(0, 1024);
    return lo;
  }
  const dimLink = lo => 'https://app.destinyitemmanager.com/loadouts?loadout=' + encodeURIComponent(JSON.stringify(lo));
  const modsFor = (slot, defs) => [...(defs?.am?.[slot] || []), ...(defs?.am?.general || [])];
  const modCost = (n, slot, defs) => modsFor(slot, defs).find(x => norm(x[0]) === norm(n))?.[1] || 0;

  return { LIMITS, sanitizeHtml, sanitizeCss, parseCSV, toCSV, parseDimCsv, rowToItem, apiToItems, prepRatings, rateItem, parseQuery, runQuery, buildCtx, sortItems, groupKey, groupOrder, norm, findStat, applyDefs, perkInfo, breakerId, anyBreaker, sockets, descText, keywordRe, descHits, identifiers, plugOf, archetypeBreaker,
    SYN, SYN_BY, synTags, pieceText, buildPieces, synergy, synScore, subScore, modScore, fitScore, buildStats, normBuild, fragSlots, weaponSlot, armorSlot, W_SLOTS, A_SLOTS, ARMOR3, modsFor, modCost, subList, dimLoadout, dimLink };
})();
if (typeof module !== 'undefined') module.exports = Core;
