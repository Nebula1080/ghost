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
    const chars = resp.characters?.data || {}; const chars0 = () => chars;
    const clsOf = cid => API_CLASS[chars[cid]?.classType] || 'Character';
    const n = v => (typeof v === 'number' && isFinite(v) ? v : null);
    const plugName = h => ad.p?.[String(h)]?.[0] || '';
    const plugCat = h => ad.p?.[String(h)]?.[1] || '';
    const raw = [];
    for (const it of resp.profileInventory?.data?.items || []) raw.push([it, 'Vault', false, '']);
    for (const [cid, inv] of Object.entries(resp.characterInventories?.data || {})) for (const it of inv?.items || []) raw.push([it, clsOf(cid), false, cid]);
    for (const [cid, inv] of Object.entries(resp.characterEquipment?.data || {})) for (const it of inv?.items || []) raw.push([it, clsOf(cid), true, cid]);
    const weapons = [], armor = [], subs = [];
    for (const [r, owner, equipped, cid0] of raw) {
      const id = String(r?.itemInstanceId ?? ''); if (!ID_RE.test(id)) continue;
      const hash = String(r.itemHash ?? '').replace(/\D/g, '');
      // subclasses on a character: their inserted plugs per socket, so Ghost can equip a build's subclass setup
      if (ad.c?.[hash]) {
        const sk = so[id]?.sockets;
        if (ID_RE.test(String(cid0)) && Array.isArray(sk)) subs.push({ id, hash: +hash, cid: String(cid0), eq: !!equipped, plugs: sk.map(x => /^\d{1,10}$/.test(String(x?.plugHash ?? '')) ? +x.plugHash : 0) });
        continue;
      }
      const def = ad.i[hash]; if (!def) continue;
      const [name, k, type, rarity, ammoT, bucket, classType, perkSockets] = def;
      const rollIdx = new Set(Array.isArray(perkSockets) ? perkSockets : []);
      const kind = k === 'w' ? 'weapon' : 'armor';
      const ins = inst[id] || {}; const state = n(r.state) || 0;
      // perks: socket by socket, every option the item can switch to, the inserted one marked (like DIM's Perks N)
      const perks = []; let frame = '', mwType = '', mwTier = null; const aBase = {}; let tuned = '';
      const sockets = Array.isArray(so[id]?.sockets) ? so[id].sockets : [];
      const opts = rp[id]?.plugs || {};
      sockets.forEach((s, i) => {
        if (!s || s.isVisible === false) return;
        // only perk sockets list the roll's other options; mods, masterwork and the rest show what's inserted
        const cur = String(s.plugHash ?? ''); const list = rollIdx.has(i) && Array.isArray(opts[i]) ? opts[i].map(o => String(o?.plugItemHash ?? '')) : [];
        if (cur && !list.includes(cur)) list.unshift(cur);
        for (const h of list) {
          const pn = plugName(h); if (!pn) continue;
          // si / h: the socket index and plug hash, so Ghost can switch perks and mods through Bungie (src: 'api' only)
          const pc = plugCat(h);
          perks.push({ n: pn, s: h === cur ? 1 : 0, j: JUNK_PERK.test(pn) ? 1 : 0, si: i, h: /^\d{1,10}$/.test(h) ? +h : 0, ...(/^a[hacglx]$/.test(pc) ? { ac: pc } : {}), ...(rollIdx.has(i) ? { roll: 1 } : {}) });
        }
        const cat = plugCat(cur), cn = plugName(cur);
        // Armor 3.0: the stat-roll plugs give the piece's base stats; the tuning socket's options name its Tuned stat
        if (kind === 'armor') for (const [sn, v] of Object.entries(ad.as?.[cur] || {})) aBase[sn] = (aBase[sn] || 0) + v;
        if (kind === 'armor' && cat === 'u' && Array.isArray(opts[i])) for (const o of opts[i]) { const m = plugName(String(o?.plugItemHash ?? '')).match(/^\+(\w+) \//); if (m) { tuned = m[1]; break; } }
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
        power: n(ins.primaryStat?.value), energy: n(ins.energy?.energyCapacity), frame, tertiary, tuning: tuned,
        mwType, mwTier, owner, locked: !!(state & 1), equipped, featured: false, holofoil: false,
        year: null, season: null, event: '', crafted: !!(state & 8), level: null, kills: null, foundry: '', loadouts: '',
        stats, base: Object.keys(aBase).length ? Object.fromEntries(ARMOR_STATS.map(k => [k, aBase[k] || 0])) : {}, perks, src: 'api', cid: ID_RE.test(String(cid0)) ? String(cid0) : '', bucket: Number(bucket) || 0,
      };
      (kind === 'weapon' ? weapons : armor).push(item);
    }
    // the account's characters (id + class), for equip / transfer actions
    const charList = Object.entries(chars0()).map(([id, c]) => ({ id, cls: API_CLASS[c?.classType] || '' })).filter(c => ID_RE.test(c.id) && c.cls);
    return { weapons, armor, chars: charList, subs };
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
  // Masterwork: the inserted masterwork plug and the exact stat bonus it adds (defs.mwp, from Bungie's investment
  // stats: "Tier 5: Reload Speed" = Reload +5). Armor 3.0 masterwork bonuses are computed by the game and aren't in
  // Bungie's plug data, so armor reports the tier only (bonus {} unless the plug itself lists stats).
  function masterwork(it, defs) {
    const p = sockets(it, defs).mw.find(x => x.s !== 0);
    if (!p && it.mwTier == null) return null;
    const st = p && defs?.mwp?.[norm(p.n)];
    return { name: p?.n || (it.mwType ? `${it.mwType} ${it.mwTier ?? ''}`.trim() : ''), tier: it.mwTier ?? null, bonus: st ? Object.fromEntries(st) : {} };
  }
  // Exotic catalyst: 'has' (inserted, with its stat bonus and effect), 'missing' (the weapon has one but it isn't
  // inserted / unlocked yet) or 'none' (no catalyst exists for this weapon). defs.cata / defs.wc, tools/build-defs.mjs.
  function catalyst(it, defs) {
    if (it?.kind !== 'weapon' || !/exotic/i.test(it.rarity || '')) return null;
    const ins = it.perks.find(p => p.s !== 0 && defs?.cata?.[norm(p.n)]);
    if (ins) { const c = defs.cata[norm(ins.n)]; return { state: 'has', name: ins.n, bonus: Object.fromEntries(c.st || []), d: c.d || '' }; }
    const avail = defs?.wc?.[it.hash];
    if (avail || it.perks.some(p => /^empty catalyst socket$/i.test(p.n))) {
      const c = avail && defs.cata?.[norm(avail)];
      return { state: 'missing', name: avail || 'Catalyst', bonus: Object.fromEntries(c?.st || []), d: c?.d || '' };
    }
    return { state: 'none', name: '', bonus: {}, d: '' };
  }
  // Intrinsics repeat names across weapon types with different effects ("Aggressive Frame" on swords, fusion
  // rifles, pulse rifles…), so a weapon's own intrinsic is looked up by its plug hash (defs.wi / defs.ih,
  // tools/build-defs.mjs). Returns the hash when `name` is that weapon's intrinsic and the name is ambiguous.
  function intrinsicHash(it, name, defs) {
    if (!it || it.kind !== 'weapon' || !defs?.wi) return null;
    const h = defs.wi[it.hash]; const e = h && defs.ih?.[h];
    return e && norm(name) === norm(e[0]) ? String(h) : null;
  }
  function perkInfo(name, defs, kind, ph) {
    if (!defs) return null;
    const ih = ph && defs.ih?.[ph];
    if (ih) return { cl: ih[2] ? { h: ih[2], ty: ih[3] || 'Intrinsic' } : null, dc: null, bd: ih[1] || '', ty: 'i', hash: Number(ph) };
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
    if (it.source) add('source', 'Source', sourceName(it.source), 'exactsource:' + q(it.source));
    return out;
  }

  // Game-style socket layout from DIM's flat perk list: intrinsic, perk columns, mods.
  // Columns break when the socket type changes or a second equipped perk of the same type appears.
  const COL_TYPES = new Set(['b', 'm', 't', 'o']);
  function sockets(it, defs) {
    const out = { intrinsic: [], cols: [], mods: [], exotic: [], mw: [], catalyst: [] };
    let cur = null; const colPerks = [];
    // the old guess: a new column when the type changes or a second equipped perk appears
    const guess = (p, colTy) => {
      if (!cur || (colTy !== '?' && cur.ty !== '?' && colTy !== cur.ty) || (p.s && cur.perks.some(x => x.s))) { cur = { ty: colTy, perks: [] }; out.cols.push(cur); }
      cur.perks.push(p);
    };
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
      colPerks.push([p, colTy]);
    }
    // perk columns: Bungie's own sockets. API items carry the socket index (si); CSV items are matched against the
    // weapon's per-column perk lists (defs.sock); only unknown weapons fall back to guessing from the flat order.
    const known = it.kind === 'weapon' && defs?.sock?.w?.[it.hash];
    if (colPerks.length && colPerks.every(([p]) => Number.isInteger(p.si))) {
      const by = new Map(); for (const [p, ty] of colPerks) { if (!by.has(p.si)) by.set(p.si, { ty, perks: [] }); const c = by.get(p.si); c.perks.push(p); if (c.ty === '?' && ty !== '?') c.ty = ty; }
      out.cols = [...by.entries()].sort((a, b) => a[0] - b[0]).map(x => x[1]);
    } else if (known) {
      const sets = known.map(ph => new Set((defs.sock.ps[ph] || []).map(i => norm(defs.sock.n[i]))));
      const cols = known.map(() => ({ ty: '?', perks: [] })); const loose = [];
      for (const [p, ty] of colPerks) {
        const k = norm(p.n.replace(/^Enhanced\s+/i, ''));
        const cand = sets.map((s, i) => s.has(k) ? i : -1).filter(i => i >= 0);
        // a perk two columns share (some traits) goes to the first of them that has no equipped perk yet
        const i = cand.find(c => !(p.s && cols[c].perks.some(x => x.s))) ?? cand[0];
        if (i == null) { loose.push([p, ty]); continue; }
        cols[i].perks.push(p); if (cols[i].ty === '?' && ty !== '?') cols[i].ty = ty;
      }
      out.cols = cols.filter(c => c.perks.length);
      for (const [p, ty] of loose) guess(p, ty);
    } else for (const [p, ty] of colPerks) guess(p, ty);
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

  // ---------- Ghost ratings: DIM wish lists + Aegis's Endgame Analysis + perk ratings ----------
  // Each weapon gets a PvE and a PvP score (0–100) from three parts, mixed by user-adjustable weights:
  //   perks – Ghost's perk / combo ratings (defaults shipped in data/ratings.json, personal overrides per profile)
  //   wish  – best match against the DIM community wish list (voltron.txt) rolls tagged for that mode
  //   aegis – Aegis's Endgame Analysis weapon tier (PvE only)
  // A missing part is left out and the others rescaled. rating = mean of PvE and PvP.
  const WL = { PVE: 1, PVP: 2, MKB: 4, CTRL: 8, TRASH: 16 };
  const WL_ANY = '69420'; // DIM: item=-69420 applies the roll to every item
  const TAG_TOKEN = /^(pve|pvp|m\+kb|mkb|kbm|controller)(-[\w+-]*)?$/i;
  const tagGroup = g => {
    const toks = g.split(/[\s/\\,]+/).filter(Boolean);
    return toks.length && toks.every(t => TAG_TOKEN.test(t) || /^[\w+]+-[\w+-]+$/.test(t)) && toks.some(t => TAG_TOKEN.test(t)) ? toks : null;
  };
  // Tags from "|tags:pve,mkb", a tag group in parentheses "(PvE PvE-Minor M+KB Controller)", the list title,
  // or (last) the words PvE / PvP in the note.
  function wlTags(notes, title) {
    const s = String(notes || '');
    const flag = words => {
      let f = 0;
      for (const w of words) {
        const x = w.toLowerCase();
        if (/^pve($|-)|-pve$/.test(x)) f |= WL.PVE;
        if (/^pvp($|-)|-pvp$/.test(x)) f |= WL.PVP;
        if (/^(m\+kb|mkb|kbm)$/.test(x)) f |= WL.MKB;
        if (x === 'controller') f |= WL.CTRL;
      }
      return f;
    };
    const tm = s.match(/\|tags:([^|]*)$/i);
    if (tm) return flag(tm[1].split(/[\s,]+/).filter(Boolean));
    for (const g of s.matchAll(/\(([^()]{2,200})\)/g)) { const toks = tagGroup(g[1]); if (toks) return flag(toks); }
    let f = 0;
    for (const src of [title, s]) {
      const t = String(src || '').toLowerCase(); const e = /\bpve\b/.test(t), p = /\bpvp\b/.test(t);
      if (e !== p) { f |= e ? WL.PVE : WL.PVP; break; }
    }
    if (/(^|[^\w+])(m\+kb|mkb)\b/i.test(s)) f |= WL.MKB;
    if (/\bcontroller\b/i.test(s)) f |= WL.CTRL;
    return f;
  }
  // Parses DIM's wish list format (DIM docs/COMMUNITY_CURATIONS.md):
  //   title:… / description:…                   list header
  //   //notes:…                                 notes for the following rolls (until a blank line or a new title)
  //   dimwishlist:item=H&perks=a,b,c#notes:…    H = item hash; -H = trash roll; -69420 = every item
  // Returns rolls { item: 'H' | '*', trash, perks: ['hash'…], notes, tags }. Text is untrusted: lengths capped,
  // hashes must be digits, malformed lines are skipped.
  function parseWishlist(text, max = 2000000) {
    const out = { title: '', description: '', rolls: [] };
    let title = '', block = '';
    const lines = String(text || '').split(/\r?\n/);
    for (let i = 0; i < lines.length && out.rolls.length < max; i++) {
      const raw = lines[i]; if (raw.length > 20000) continue;
      const ln = raw.trim();
      if (!ln) { block = ''; continue; }
      if (/^@?title:/i.test(ln)) { title = ln.replace(/^@?title:/i, '').trim().slice(0, 300); if (!out.title) out.title = title; block = ''; continue; }
      if (/^@?description:/i.test(ln)) { if (!out.description) out.description = ln.replace(/^@?description:/i, '').trim().slice(0, 2000); continue; }
      if (/^\/\/\s*notes:/i.test(ln)) { block = ln.replace(/^\/\/\s*notes:/i, '').trim().slice(0, 4000); continue; }
      const m = ln.match(/^dimwishlist:item=(-?)(\d{1,10})(?:&perks=([^#]*))?(?:#notes:(.*))?$/i);
      if (!m) continue;
      const perks = (m[3] || '').split(',').map(x => x.trim()).filter(x => /^\d{1,10}$/.test(x)).slice(0, 20);
      const notes = (m[4] != null ? m[4].trim() : block).slice(0, 4000);
      const any = m[1] === '-' && m[2] === WL_ANY;
      out.rolls.push({ item: any ? '*' : m[2], trash: m[1] === '-' && !any, perks, notes, tags: wlTags(notes, title), title });
    }
    return out;
  }
  // Note text without the tag list, shortened for the item panel.
  function wlNote(notes, max = 180) {
    let s = String(notes || '').replace(/\|tags:[^|]*$/i, '').replace(/\s*\(([^()]{2,200})\)/g, (m, g) => tagGroup(g) ? '' : m).replace(/\s+/g, ' ').trim();
    if (s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
    return s;
  }

  // The committed table is build output from untrusted sources: coerce shapes and sizes once at load.
  // data/ratings.json = { wl: { p: [perkName], n: [note], w: { hash: [[flags, noteIdx, [[perkIdx…]…]]…] } },
  //   ae: { tabs: [tab], n: [note], w: { hash: [tier, tabIdx, noteIdx, [[tier, label]…]?] } },
  //   pk: { normName: [name, kind 'w'|'a', col b|m|t|o|r, pveTier|'', pvpTier|'', srcPve, srcPvp, [weapon types], onlyElement|''] },
  //   cb: [[a, b, pveTier|'', pvpTier|'', weapons]], meta: {wl, ae, credits} }
  const TIERS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];
  const TIER_SCORE = { S: 100, A: 85, B: 70, C: 55, D: 40, E: 25, F: 10 };
  const isTier = t => typeof t === 'string' && Object.prototype.hasOwnProperty.call(TIER_SCORE, t);
  const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi ? v : -1;
  function prepGhostRatings(raw) {
    const R = { wl: { p: [], n: [], w: new Map() }, ae: { tabs: [], n: [], w: new Map() }, pk: new Map(), cb: [], meta: { wl: '', ae: '', credits: '' } };
    if (!raw || typeof raw !== 'object') return R;
    const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const wl = obj(raw.wl);
    R.wl.p = (Array.isArray(wl.p) ? wl.p : []).slice(0, 20000).map(x => str(x, 120));
    R.wl.n = (Array.isArray(wl.n) ? wl.n : []).slice(0, 50000).map(x => str(x, 400));
    for (const [h, rolls] of Object.entries(obj(wl.w))) {
      if (!/^(\d{1,10}|\*)$/.test(h) || !Array.isArray(rolls)) continue;
      const list = [];
      for (const r of rolls.slice(0, 400)) {
        if (!Array.isArray(r) || !Array.isArray(r[2])) continue;
        const sets = r[2].slice(0, 8).map(s => (Array.isArray(s) ? s : []).slice(0, 40).filter(i => int(i, 0, R.wl.p.length - 1) >= 0)).filter(s => s.length);
        list.push({ f: int(r[0], 0, 31) < 0 ? 0 : r[0], note: int(r[1], 0, R.wl.n.length - 1), sets });
      }
      if (list.length) R.wl.w.set(h, list);
    }
    const ae = obj(raw.ae);
    R.ae.tabs = (Array.isArray(ae.tabs) ? ae.tabs : []).slice(0, 60).map(x => str(x, 60));
    R.ae.n = (Array.isArray(ae.n) ? ae.n : []).slice(0, 20000).map(x => str(x, 400));
    for (const [h, a] of Object.entries(obj(ae.w))) {
      if (!/^\d{1,10}$/.test(h) || !Array.isArray(a) || !isTier(a[0])) continue;
      const alts = (Array.isArray(a[3]) ? a[3] : []).slice(0, 6).filter(x => Array.isArray(x) && isTier(x[0])).map(x => [x[0], str(x[1], 80)]);
      R.ae.w.set(h, { tier: a[0], tab: R.ae.tabs[int(a[1], 0, R.ae.tabs.length - 1)] || '', note: R.ae.n[int(a[2], 0, R.ae.n.length - 1)] || '', alts });
    }
    for (const [k, v] of Object.entries(obj(raw.pk))) {
      if (!Array.isArray(v) || typeof v[0] !== 'string' || !k || k !== norm(v[0])) continue;
      R.pk.set(k, { n: str(v[0], 120), kind: v[1] === 'a' ? 'a' : 'w', col: str(v[2], 2), e: isTier(v[3]) ? v[3] : '', p: isTier(v[4]) ? v[4] : '', se: str(v[5], 200), sp: str(v[6], 200),
        types: (Array.isArray(v[7]) ? v[7] : []).slice(0, 30).map(x => str(x, 40)).filter(Boolean), el: str(v[8], 20) });
    }
    for (const c of (Array.isArray(raw.cb) ? raw.cb : []).slice(0, 2000)) {
      if (!Array.isArray(c) || typeof c[0] !== 'string' || typeof c[1] !== 'string' || !norm(c[0]) || !norm(c[1])) continue;
      R.cb.push({ a: str(c[0], 120), b: str(c[1], 120), e: isTier(c[2]) ? c[2] : '', p: isTier(c[3]) ? c[3] : '', w: int(c[4], 0, 1e5) < 0 ? 0 : c[4] });
    }
    const m = obj(raw.meta);
    R.meta = { wl: str(m.wl, 40), ae: str(m.ae, 40), credits: str(m.credits, 2000) };
    return R;
  }
  const comboKey = (a, b) => [norm(a), norm(b)].sort().join('|');
  // Personal overrides (per profile): { p: {normName: {e, p}}, c: {comboKey: {a, b, e, p}}, w: {perks, wish, aegis} }
  // A tier ('S'…'F'), 'x' = unrated on purpose; missing = use Ghost's default.
  const DEFAULT_WEIGHTS = { perks: 50, wish: 25, aegis: 25 };
  function prepUserRatings(raw) {
    const U = { p: {}, c: {}, w: { ...DEFAULT_WEIGHTS } };
    if (!raw || typeof raw !== 'object') return U;
    const ok = v => v === 'x' || isTier(v);
    const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    let n = 0;
    for (const [k, v] of Object.entries(obj(raw.p))) {
      if (++n > 5000) break;
      if (!/^[a-z0-9]{1,80}$/.test(k) || !v || typeof v !== 'object') continue;
      const o = {}; if (ok(v.e)) o.e = v.e; if (ok(v.p)) o.p = v.p;
      if (o.e || o.p) U.p[k] = o;
    }
    n = 0;
    for (const [k, v] of Object.entries(obj(raw.c))) {
      if (++n > 2000) break;
      if (!/^[a-z0-9]{1,80}\|[a-z0-9]{1,80}$/.test(k) || !v || typeof v !== 'object') continue;
      const a = str(v.a, 120), b = str(v.b, 120); if (!a || !b || comboKey(a, b) !== k || norm(a) === norm(b)) continue;
      const o = { a, b }; if (ok(v.e)) o.e = v.e; if (ok(v.p)) o.p = v.p; if (v.add === 1) o.add = 1;
      U.c[k] = o;
    }
    const w = obj(raw.w);
    for (const k of Object.keys(DEFAULT_WEIGHTS)) { const x = Number(w[k]); if (w[k] != null && w[k] !== '' && Number.isFinite(x) && x >= 0 && x <= 100) U.w[k] = Math.round(x); }
    return U;
  }
  // Effective tier of a perk for a mode ('e' PvE, 'p' PvP): personal override, else Ghost's default.
  function perkTier(name, mode, R, U) {
    const k = norm(name); const o = U?.p?.[k]?.[mode];
    if (o === 'x') return ''; if (o) return o;
    return R?.pk?.get(k)?.[mode] || '';
  }
  // Defaults merged with personal combos / overrides: Map comboKey -> {a, b, e, p, def, user}
  function combos(R, U) {
    const m = new Map();
    for (const c of R?.cb || []) m.set(comboKey(c.a, c.b), { a: c.a, b: c.b, e: c.e, p: c.p, def: c, user: null });
    for (const [k, c] of Object.entries(U?.c || {})) {
      const d = m.get(k)?.def || null;
      const pick = mode => c[mode] === 'x' ? '' : c[mode] || d?.[mode] || '';
      m.set(k, { a: d?.a || c.a, b: d?.b || c.b, e: pick('e'), p: pick('p'), def: d, user: c });
    }
    return m;
  }
  const RATE_COL_W = { b: 1, m: 1, t: 2, o: 0.5, '?': 1 };
  const equippedOf = c => c.perks.find(p => p.s) || (c.perks.length === 1 ? c.perks[0] : null);
  // Perk part = the best roll this weapon can have: one perk per column chosen from every option it rolled
  // (equipped or not), so a better trait combo sitting unselected counts. Each column scores its chosen perk's
  // tier (barrel/mag ×1, traits ×2, origin ×0.5) and the best rated combo among the chosen perks counts ×2.
  // Ties prefer the equipped perks. The result lists the chosen perks and which ones differ from equipped.
  const BEST_MAX = 20000; // selections tried per weapon and mode; past this each column keeps its top 4 options
  function perkPart(cols, mode, R, U, cmap) {
    const cand = cols.map(c => {
      const eq = equippedOf(c);
      const rated = c.perks.map(p => ({ p, t: perkTier(p.n, mode, R, U) })).filter(x => x.t);
      return { c, eq, list: rated.length ? rated : [{ p: eq || c.perks[0], t: '' }] };
    });
    let n = cand.reduce((a, x) => a * x.list.length, 1);
    if (n > BEST_MAX) {
      for (const x of cand) x.list = x.list.sort((a, b) => TIER_SCORE[b.t] - TIER_SCORE[a.t] || (b.p === x.eq) - (a.p === x.eq)).slice(0, 4);
      n = cand.reduce((a, x) => a * x.list.length, 1);
    }
    const evalSel = sel => {
      let sum = 0, w = 0, eqN = 0, combo = null;
      sel.forEach((x, i) => { if (x.p === cand[i].eq) eqN++; if (!x.t) return; const wt = RATE_COL_W[cand[i].c.ty] ?? 1; sum += TIER_SCORE[x.t] * wt; w += wt; });
      for (let i = 0; i < sel.length; i++) for (let j = i + 1; j < sel.length; j++) {
        const c = cmap.get(comboKey(sel[i].p.n, sel[j].p.n)); const t = c?.[mode];
        if (t && (!combo || TIER_SCORE[t] > TIER_SCORE[combo.tier])) combo = { a: sel[i].p.n, b: sel[j].p.n, tier: t, score: TIER_SCORE[t], equipped: sel[i].p === cand[i].eq && sel[j].p === cand[j].eq };
      }
      if (combo) { sum += combo.score * 2; w += 2; }
      return { score: w ? sum / w : null, eqN, combo };
    };
    let best = null, bestSel = null;
    const idx = new Array(cand.length).fill(0);
    for (let k = 0; k < n; k++) {
      const sel = cand.map((x, i) => x.list[idx[i]]);
      const r = evalSel(sel);
      if (r.score != null && (!best || r.score > best.score + 1e-9 || (Math.abs(r.score - best.score) < 1e-9 && r.eqN > best.eqN))) { best = r; bestSel = sel; }
      for (let i = 0; i < idx.length; i++) { if (++idx[i] < cand[i].list.length) break; idx[i] = 0; }
    }
    // the equipped roll's own score, for "equipped vs best" in the item panel
    const eqSel = cand.map(x => ({ p: x.eq || x.c.perks[0], t: x.eq ? perkTier(x.eq.n, mode, R, U) : '' }));
    const eqR = evalSel(eqSel);
    const why = cand.map((x, i) => {
      const s = bestSel?.[i]; const pick = s?.t ? s.p : null;
      return { ty: x.c.ty, pick: pick?.n || '', tier: pick ? s.t : '', eq: x.eq?.n || '', eqTier: x.eq ? perkTier(x.eq.n, mode, R, U) : '',
        switched: !!(pick && x.eq && pick !== x.eq), score: pick ? TIER_SCORE[s.t] : null };
    });
    return { score: best ? Math.round(best.score) : null, cols: why, combos: best?.combo ? [best.combo] : [],
      equipped: eqR.score != null ? Math.round(eqR.score) : null, switched: why.filter(c => c.switched).map(c => c.pick) };
  }
  // Wish-list match: per listed roll, each perk set scores 1 if the equipped perk is in it, 0.4 if only another
  // option is, else 0; trait sets count double. The best roll per mode wins. A trash roll fully matched by
  // equipped perks sets that mode to 0.
  function wishPart(it, cols, R) {
    const rolls = [...(R?.wl?.w.get(String(it.hash)) || []), ...(R?.wl?.w.get('*') || [])];
    if (!rolls.length) return null;
    const where = new Map(); // normName -> {s: equipped, ty}
    for (const c of cols) { const eq = equippedOf(c); for (const p of c.perks) { const k = norm(p.n); const s = p === eq; const cur = where.get(k); if (!cur || s) where.set(k, { s, ty: c.ty }); } }
    const res = { e: null, p: null };
    const trash = { e: false, p: false };
    for (const r of rolls) {
      if (!r.sets.length) continue;
      let sum = 0, w = 0, full = true; const hit = [];
      for (const set of r.sets) {
        let best = 0, ty = '?', name = '';
        for (const i of set) { const n = R.wl.p[i]; const at = where.get(norm(n)); if (!at) continue; const v = at.s ? 1 : 0.4; if (v > best) { best = v; ty = at.ty; name = n; } }
        const wt = ty === 't' ? 2 : 1; sum += best * wt; w += wt; if (best < 1) full = false;
        hit.push({ perks: set.map(i => R.wl.p[i]), got: name, s: best === 1 });
      }
      const score = Math.round(100 * sum / w);
      for (const mode of ['e', 'p']) {
        const bit = mode === 'e' ? WL.PVE : WL.PVP;
        if ((r.f & (WL.PVE | WL.PVP)) && !(r.f & bit)) continue;
        if (r.f & WL.TRASH) { if (full) trash[mode] = true; continue; }
        if (!res[mode] || score > res[mode].score) res[mode] = { score, note: R.wl.n[r.note] || '', sets: hit, f: r.f };
      }
    }
    for (const mode of ['e', 'p']) if (trash[mode]) res[mode] = { score: 0, note: '', sets: [], f: WL.TRASH, trash: true };
    return res.e || res.p ? res : null;
  }
  // Letter grade for a 0–100 rating: the nearest tier score (S 100, A 85, B 70 … F 10). Used as a stamp next to the
  // number in Compare, where colour alone would read like the green "best stat" highlight.
  function ratingGrade(r) {
    if (r == null || !Number.isFinite(Number(r))) return '';
    let best = 'F', d = Infinity;
    for (const t of TIERS) { const x = Math.abs(TIER_SCORE[t] - Number(r)); if (x < d) { d = x; best = t; } }
    return best;
  }
  function mixParts(parts, W) {
    let s = 0, w = 0;
    for (const [k, v] of Object.entries(parts)) if (v != null && W[k] > 0) { s += v * W[k]; w += W[k]; }
    return w ? Math.round(s / w) : null;
  }
  // Sets it.rating / it.pve / it.pvp (0–100), it.why (each part, for the item panel) and it.perkRel (perk tiers).
  function rateGhost(it, defs, R, U, cmap) {
    it.rating = null; it.pve = null; it.pvp = null; it.perkRel = {}; it.why = null;
    if (it.kind !== 'weapon' || !R) return;
    const W = U?.w || DEFAULT_WEIGHTS; cmap = cmap || combos(R, U);
    const cols = sockets(it, defs).cols.filter(c => c.perks.length);
    const pe = perkPart(cols, 'e', R, U, cmap), pp = perkPart(cols, 'p', R, U, cmap);
    const wl = wishPart(it, cols, R);
    const ae = R.ae.w.get(String(it.hash)) || null;
    it.pve = mixParts({ perks: pe.score, wish: wl?.e?.score ?? null, aegis: ae ? TIER_SCORE[ae.tier] : null }, W);
    it.pvp = mixParts({ perks: pp.score, wish: wl?.p?.score ?? null }, W);
    it.rating = it.pve != null && it.pvp != null ? Math.round((it.pve + it.pvp) / 2) : it.pve ?? it.pvp;
    for (const c of cols) for (const p of c.perks) {
      const e = perkTier(p.n, 'e', R, U), v = perkTier(p.n, 'p', R, U);
      if (e || v) it.perkRel[p.n] = { e, p: v, rel: Math.max(e ? TIER_SCORE[e] : 0, v ? TIER_SCORE[v] : 0) };
    }
    it.why = { perks: { e: pe, p: pp }, wish: wl, aegis: ae, w: W };
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
        if (v === 'catalyst' || v === 'catalyzed') return ctx.defs && catalyst(it, ctx.defs)?.state === 'has' ? ['catalyst'] : null;
        if (v === 'nocatalyst' || v === 'catalystmissing') return ctx.defs && catalyst(it, ctx.defs)?.state === 'missing' ? ['catalyst'] : null;
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
      case 'tag': return it.tag || 'untagged'; case 'source': return sourceName(it.source) || '—';
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
  function pieceText(name, defs, bungie, kind, ph) {
    const i = perkInfo(name, defs, kind, ph) || {};
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
    // armor mods follow the chosen piece's own sockets (general, slot, tuning, artifice, raid…): b.mods[slot][i] is
    // the mod in socket i of modLayout (null = empty); stored names that don't fit a socket move to one that fits
    for (const s of A_SLOTS) b.mods[s] = placeMods(b.mods[s], modLayout(b.a?.[s]?.hash, defs), s, defs);
    b.art = artValid(b.art, artOf(b, defs));
    return b;
  }
  // artifacts (Monument of Triumph): defs.artp = [{h, n, d, i, p: [[hash, name, tier, text, icon]]}]. One artifact per
  // build, 7 perk slots: 2 take tier-1 perks, 3 take tier 1-2, 2 take any tier (Bungie socket categories).
  const ART_MAX = 7, ART_SLOTS = [2, 3, 2];
  const artOf = (b, defs) => (defs?.artp || []).find(a => a.h === b?.artA) || null;
  function artValid(list, art) {
    const out = []; const n = [0, 0, 0];
    for (const h of Array.isArray(list) ? list : []) {
      const p = art?.p.find(x => x[0] === h); if (!p || out.includes(h)) continue;
      const t = p[2]; const fits = out.length < ART_MAX && (t < 3 || n[2] < ART_SLOTS[2]) && (t < 2 || n[1] + n[2] < ART_SLOTS[1] + ART_SLOTS[2]);
      if (fits) { out.push(h); n[t - 1]++; }
    }
    return out;
  }
  // every piece of a build with its text: { g: group, slot, n: name, label, it?, parts }
  function buildPieces(b, defs, byId) {
    const out = []; const sc = subOf(b, defs);
    out.subEl = b.el;
    if (sc) {
      const SEC_L = { super: 'Super', classAbility: 'Class ability', movement: 'Movement', melee: 'Melee', grenade: 'Grenade', aspects: 'Aspect', fragments: 'Fragment' };
      // an ability's own element (Prismatic borrows abilities from the other subclasses)
      const elOf = (k, n) => b.el !== 'prism' ? b.el : Object.entries(defs.sub[b.cls] || {}).find(([e, s]) => e !== 'prism' && (s.s[k] || []).some(x => x.n === n))?.[0] || '';
      for (const k of SUB_SINGLE) { const a = findSub(sc, k, b.sub?.[k]); if (a) out.push({ g: 'subclass', slot: k, n: a.n, label: SEC_L[k], el: elOf(k, a.n), parts: pieceText(a.n, defs, a.d) }); }
      for (const k of ['aspects', 'fragments']) for (const h of b.sub?.[k] || []) { const a = findSub(sc, k, h); if (a) out.push({ g: 'subclass', slot: k, n: a.n, label: SEC_L[k], st: a.st, parts: pieceText(a.n, defs, a.d) }); }
      for (const a of subList(sc, 'transcendence')) out.push({ g: 'subclass', slot: 'transcendence', n: a.n, label: 'Transcendence', parts: pieceText(a.n, defs, a.d) });
    }
    const itemPieces = (it, slot, g) => {
      const label = g === 'weapon' ? { kinetic: 'Kinetic', energy: 'Energy', power: 'Power' }[slot] : { head: 'Helmet', arms: 'Arms', chest: 'Chest', legs: 'Legs', class: 'Class item' }[slot];
      const sk = sockets(it, defs);
      const perks = g === 'weapon' ? [...sk.intrinsic, ...sk.exotic, ...sk.cols.flatMap(c => c.perks.filter(p => p.s && c.ty !== 'b' && c.ty !== 'm')), ...sk.catalyst.filter(p => p.s)] : [...sk.exotic];
      const parts = [];
      for (const p of perks) for (const [src, t] of pieceText(p.n, defs, null, it.kind, intrinsicHash(it, p.n, defs))) parts.push([`${p.n} · ${src}`, t]);
      if (g === 'weapon' && /exotic/i.test(it.rarity) && !perks.length && defs?.dcx?.[norm(it.name)]) parts.push(['Data Compendium', stripTags(defs.dcx[norm(it.name)])]);
      out.push({ g, slot, n: it.name, label, it, parts });
    };
    for (const s of W_SLOTS) { const it = byId?.get(b.w?.[s]?.id); if (it) itemPieces(it, s, 'weapon'); }
    for (const s of A_SLOTS) { const it = byId?.get(b.a?.[s]?.id); if (it) itemPieces(it, s, 'armor'); }
    // armor set bonuses that the chosen pieces complete
    const setN = {};
    for (const s of A_SLOTS) { const it = byId?.get(b.a?.[s]?.id); const si = it && defs?.as?.[it.hash]; if (si != null) setN[si] = (setN[si] || 0) + 1; }
    for (const [si, n] of Object.entries(setN)) for (const p of defs.sets[si]?.p || []) if (n >= p.c) out.push({ g: 'armor', slot: 'set', n: p.n, label: `${defs.sets[si].n} · ${p.c}-piece bonus`, parts: [['Bungie', p.d]] });
    for (const s of A_SLOTS) for (const n of (b.mods?.[s] || []).filter(Boolean)) out.push({ g: 'mod', slot: s, n, label: 'Armor mod', parts: pieceText(n, defs, null, 'armor') });
    // artifact perks (one artifact per build)
    const art = artOf(b, defs);
    for (const h of b.art || []) { const p = art?.p.find(x => x[0] === h); if (p) out.push({ g: 'artifact', slot: 'artifact', n: p[1], label: `${art.n} · tier ${p[2]}`, parts: p[3] ? [['Bungie', p[3]]] : [] }); }
    for (const p of out) p.subEl = b.el;
    return out;
  }
  // ---------- curated interactions (data/interactions → window.VS_IX; see data/interactions/README.md) ----------
  // ix = { t: {term: {l, kind, el, def}}, p: {pieceId: [effect…]}, pending: [pieceId…] }. Every effect was written by
  // reading the piece's Bungie / Clarity / Compendium text and carries an exact quote. Conditions are checked against
  // the build; effects whose conditions fail are listed as inactive with the reason, never shown as interactions.
  const ABIL_TERM = { super: 'super', classAbility: 'classability', movement: 'movement', melee: 'melee', grenade: 'grenade' };
  const FAMILY = [[/\brift\b/i, 'rift'], [/barricade/i, 'barricade'], [/dodge/i, 'dodge']];
  const PROVIDE = new Set(['creates', 'applies', 'grants']), CONSUME = new Set(['uses', 'modifies', 'consumes']);
  const ENERGY_ABIL = { grenadeenergy: 'grenade', meleeenergy: 'melee', classenergy: 'classAbility', superenergy: 'super' };
  const SLOT_L = { super: 'Super', classAbility: 'class ability', movement: 'movement', melee: 'melee', grenade: 'grenade' };
  // the curated record ids a build piece can have
  function ixIds(pc, defs) {
    if (pc.g === 'subclass') return ['sub:' + norm(pc.n)];
    if (pc.g === 'mod') return ['mod:' + norm(pc.n)];
    if (pc.g === 'weapon' && pc.it) {
      if (/exotic/i.test(pc.it.rarity)) return ['xw:' + norm(pc.it.name)];
      const sk = sockets(pc.it, defs);
      return [...new Set(sk.cols.flatMap(c => c.perks.filter(p => p.s)).map(p => 'wp:' + norm(p.n)))];
    }
    if (pc.g === 'armor' && pc.slot === 'set') return ['set:' + norm(pc.n)];
    if (pc.g === 'artifact') return ['art:' + norm(pc.n)];
    if (pc.g === 'armor' && pc.it) return /exotic/i.test(pc.it.rarity) ? ['xa:' + norm(pc.it.name)] : [];
    return [];
  }
  const tLabel = (ix, t) => ix?.t?.[t]?.l || t;
  function ixEval(pieces, ix, defs, subEl) {
    const slotName = {}; for (const pc of pieces) if (pc.g === 'subclass' && ABIL_TERM[pc.slot]) slotName[pc.slot] = pc.n;
    const wEls = new Set(pieces.filter(p => p.g === 'weapon' && p.it).map(p => norm(p.it.element)));
    const fx = [];
    // Arc / Solar / Void deal Light damage, Stasis / Strand deal Darkness damage (Facet of Balance and friends)
    const lightDark = (i, el) => { const t = /^(arc|solar|void)$/.test(el) ? 'lightdamage' : /^(stasis|strand)$/.test(el) ? 'darknessdamage' : ''; if (t && ix?.t?.[t]) fx.push({ i, e: { do: 'creates', t }, implicit: 1 }); };
    pieces.forEach((pc, i) => {
      if (pc.g === 'weapon' && pc.it) {
        lightDark(i, norm(pc.it.element));
        // a weapon is weapon damage, its type (handcannon, glaive…), its element (solarweapon…) and its ammo (primaryweapon)
        const ty = norm(pc.it.type).replace(/^combat/, '');
        for (const t of ['weapon', ty, norm(pc.it.element) + 'weapon', /primary/i.test(pc.it.ammo) ? 'primaryweapon' : '']) if (t && ix?.t?.[t]) fx.push({ i, e: { do: 'creates', t }, implicit: 1 });
      }
      pc.ixIds = ixIds(pc, defs);
      const recs = pc.ixIds.map(id => [id, ix?.p?.[id]]).filter(x => x[1]);
      pc.ixState = recs.length ? 'curated' : pc.ixIds.some(id => ix?.pending?.includes(id)) ? 'pending' : 'none';
      for (const [id, list] of recs) list.forEach((e, k) => fx.push({ i, e, key: `${id}#${k}` }));
      // the chosen abilities are themselves things other pieces use, and they spend their own energy
      if (pc.g === 'subclass' && ABIL_TERM[pc.slot]) {
        fx.push({ i, e: { do: 'creates', t: ABIL_TERM[pc.slot] }, implicit: 1 });
        // a Void grenade / melee / Super is Void ability damage (terms solarability, arcability, voidability…)
        if (pc.el && ['super', 'melee', 'grenade'].includes(pc.slot) && ix?.t?.[pc.el + 'ability']) fx.push({ i, e: { do: 'creates', t: pc.el + 'ability' }, implicit: 1 });
        if (pc.el && ['super', 'melee', 'grenade'].includes(pc.slot)) lightDark(i, pc.el);
        if (pc.slot === 'classAbility') for (const [re, t] of FAMILY) if (re.test(pc.n)) fx.push({ i, e: { do: 'creates', t }, implicit: 1 });
        for (const [t, sl] of Object.entries(ENERGY_ABIL)) if (sl === pc.slot) fx.push({ i, e: { do: 'uses', t }, implicit: 1 });
      }
    });
    const abilEl = Object.fromEntries(pieces.filter(p => p.g === 'subclass' && p.el && ABIL_TERM[p.slot]).map(p => [p.slot, p.el]));
    const wOk = w => ['super', 'grenade', 'melee'].includes(w) ? !!abilEl[w] && wEls.has(abilEl[w]) : wEls.has(w);
    const names = new Set(pieces.filter(p => p.g === 'subclass').map(p => p.n)), items = new Set(pieces.filter(p => p.it).map(p => p.it.name));
    const fails = (c, provided) => c.any ? c.any.every(x => fails(x, provided)) : c.subclass ? (c.subclass === 'prismatic' ? 'prism' : c.subclass) !== subEl : c.piece ? !names.has(c.piece) : c.item ? !items.has(c.item) : c.slot ? !(c.is || []).includes(slotName[c.slot]) : c.weapon ? !wOk(c.weapon) : c.has ? !provided.has(c.has) : true;
    // an exotic's catalyst effects only count when that weapon has its catalyst applied (Core.catalyst)
    const catOf = new Map();
    const catGate = f => { const pc = pieces[f.i]; if (!f.e.perk || !defs?.cata?.[norm(f.e.perk)] || pc?.g !== 'weapon' || !pc.it) return [];
      if (!catOf.has(f.i)) catOf.set(f.i, catalyst(pc.it, defs)); const c = catOf.get(f.i);
      return c?.state === 'has' && norm(c.name) === norm(f.e.perk) ? [] : [{ catalyst: f.e.perk }]; };
    const unmetOf = (f, provided) => [...catGate(f), ...(f.e.if || []).filter(c => fails(c, provided))];
    let provided = new Set();
    for (let pass = 0; pass < 3; pass++) {           // `has` conditions can depend on other conditional effects
      const next = new Set();
      for (const f of fx) { f.unmet = unmetOf(f, provided); f.ok = !f.unmet.length; if (f.ok && PROVIDE.has(f.e.do)) next.add(f.e.t); }
      for (const f of fx) if (f.ok && f.e.do === 'counts' && next.has(f.e.t)) next.add(f.e.as);
      provided = next;
    }
    // providers per term, including "counts as" (a Void Soul counts as a grenade)
    const prov = new Map(); const addP = (t, p) => { if (!prov.has(t)) prov.set(t, []); prov.get(t).push(p); };
    for (const f of fx) if (f.ok && PROVIDE.has(f.e.do)) addP(f.e.t, { f });
    for (const c of fx) if (c.ok && c.e.do === 'counts') for (const p of [...(prov.get(c.e.t) || [])]) if (!p.via) addP(c.e.as, { f: p.f, via: c });
    // glossary "is a": a more specific term also provides the general one (a Void Overshield is an overshield)
    for (const [t, list] of [...prov.entries()]) for (const g of ix?.t?.[t]?.isa || []) for (const p of list) addP(g, { f: p.f, via: p.via, isa: t });
    // damage sources: what an effect's damage counts as (weapon, grenade, melee, classability, super…). Curated `dmg`
    // wins; otherwise the piece's own kind (a weapon deals weapon damage, your grenade grenade damage). Active
    // "counts" rules extend it (Well of Radiance: weapon → super; a Void Soul counts as a grenade).
    const counts = fx.filter(c => c.ok && c.e.do === 'counts');
    const LD = el => /^(arc|solar|void)$/.test(el) ? 'lightdamage' : /^(stasis|strand)$/.test(el) ? 'darknessdamage' : '';
    const natSrc = pc => {
      if (pc.g === 'weapon' && pc.it) { const el = norm(pc.it.element); return ['weapon', norm(pc.it.type).replace(/^combat/, ''), el + 'weapon', /primary/i.test(pc.it.ammo) ? 'primaryweapon' : '', LD(el)].filter(Boolean); }
      if (pc.g === 'subclass' && ABIL_TERM[pc.slot]) return [ABIL_TERM[pc.slot], pc.slot === 'melee' ? 'poweredmelee' : '', pc.el && ['super', 'melee', 'grenade'].includes(pc.slot) ? pc.el + 'ability' : '', LD(pc.el)].filter(Boolean);
      return [];
    };
    const srcOf = f => {
      const out = new Set(Array.isArray(f.e.dmg) ? f.e.dmg : f.e.by ? [] : natSrc(pieces[f.i]));
      if (f.e.by) out.add(f.e.by);
      for (let n = 0; n < 3; n++) for (const c of counts) if (out.has(c.e.t)) out.add(c.e.as);
      return out;
    };
    // nat: true = any build can enter it; nat: '<element>' = that subclass grants it intrinsically (Arc → Amplified)
    const natHas = t => { const n = ix?.t?.[t]?.nat; return n === true || (!!n && n === subEl); };
    const links = [], gaps = [], unmatched = [];
    const abil = new Set(Object.values(ABIL_TERM));
    for (const c of fx) {
      if (!c.ok || !CONSUME.has(c.e.do)) continue;
      let ps = (prov.get(c.e.t) || []).filter(p => p.f.i !== c.i);
      // a payoff that needs a specific damage source (e.g. "weapon-applied scorch") only links to matching providers
      if (Array.isArray(c.e.from) && c.e.from.length && ps.length) {
        // a piece that provides the term itself is that kind of damage (an aspect that "creates" powered melee damage)
        const ok = ps.filter(p => { const s = srcOf(p.f); return c.e.from.includes(c.e.t) || c.e.from.some(x => s.has(x)); });
        if (!ok.length) { unmatched.push({ c, ps }); continue; }
        ps = ok;
      }
      // states you can always enter (jumping, sprinting, sliding, finishers, low health) are never missing
      if (!ps.length) { if (!c.implicit && c.e.do === 'uses' && !(prov.get(c.e.t) || []).length && !abil.has(c.e.t) && !natHas(c.e.t)) gaps.push(c); continue; }
      const seen = new Set();
      for (const p of ps) { const id = p.f.i + '>' + c.i; if (seen.has(id)) continue; seen.add(id); links.push({ t: c.e.t, l: tLabel(ix, c.e.t), from: p.f.i, to: c.i, pf: p.f, cf: c, via: p.via }); }
    }
    // a meaningful interaction has at least one curated side (not just "your grenade spends grenade energy")
    const real = links.filter(l => !(l.pf.implicit && l.cf.implicit));
    const keys = [];
    for (const l of real) {
      let k = keys.find(x => x.t === l.t);
      if (!k) keys.push(k = { t: l.t, l: l.l, el: ix?.t?.[l.t]?.el || '', kind: ix?.t?.[l.t]?.kind || '', p: [], u: [], links: [] });
      if (!k.p.includes(l.from)) k.p.push(l.from); if (!k.u.includes(l.to)) k.u.push(l.to); k.links.push(l);
    }
    const inactive = fx.filter(f => !f.ok && !f.implicit && f.e.do !== 'counts').map(f => ({ ...f, why: f.unmet.map(function say(c) { return c.any ? c.any.map(say).join(' or ') : c.catalyst ? `needs ${c.catalyst} applied` : c.subclass ? `needs a ${c.subclass[0].toUpperCase() + c.subclass.slice(1)} subclass` : c.piece ? `needs ${c.piece}` : c.item ? `needs ${c.item}` : c.slot ? `needs ${c.is.join(' or ')} (${slotName[c.slot] ? 'you have ' + slotName[c.slot] : 'no ' + SLOT_L[c.slot] + ' chosen'})` : c.weapon ? (['super', 'grenade', 'melee'].includes(c.weapon) ? `needs a weapon matching your ${c.weapon}'s element` : `needs a ${c.weapon[0].toUpperCase() + c.weapon.slice(1)} weapon`) : `needs ${tLabel(ix, c.has)}`; }) }));
    // damage resistance: active curated amounts per kind of incoming damage, stacked multiplicatively (each source
    // multiplies the damage you take by 1 - amount); the same `cat` counts once (highest). Situational sources (with a
    // trigger `on`) are totalled separately from always-on ones.
    const drFx = fx.filter(f => f.ok && f.e.do === 'grants' && f.e.t === 'damageresistance' && f.e.who !== 'allies' && typeof f.e.amt === 'number' && f.e.amt > 0 && f.e.amt < 100);
    // buffs whose glossary entry carries a resistance (Woven Mail 45%, Frost Armor…): granting the buff adds it, once
    for (const f of fx) { const d = f.ok && f.e.do === 'grants' && ix?.t?.[f.e.t]?.dr; if (d && typeof d.amt === 'number') drFx.push({ i: f.i, ok: true, key: 'term:' + f.e.t + '@' + f.i, e: { do: 'grants', t: 'damageresistance', amt: d.amt, vs: d.vs, cat: 'term:' + f.e.t, on: d.on || `while you have ${ix.t[f.e.t].l}`, q: d.q, s: 'compendium', note: d.note } }); }
    const dr = {};
    const subV = subEl && subEl !== 'prism' ? subEl : 'subclass';   // "matching your subclass element"
    for (const f of drFx) for (const v0 of (Array.isArray(f.e.vs) && f.e.vs.length ? f.e.vs : ['all'])) { const v = v0 === 'subclass' ? subV : v0; (dr[v] ||= { items: [] }).items.push(f); }
    // a `cat` counts once: the highest amount, or with `amts` the amount for the number of copies (15|25|30% for 1|2|3 mods)
    const amtOf = (f, n) => Array.isArray(f.e.amts) && f.e.amts.length ? f.e.amts[Math.min(n, f.e.amts.length) - 1] : f.e.amt;
    const stack = list => { const g = new Map(); for (const f of list) { const k = f.e.cat || f.key; const x = g.get(k) || { f, n: 0, best: 0 }; x.n++; x.best = Math.max(x.best, f.e.amt); x.f = f; g.set(k, x); } return Math.round((1 - [...g.values()].reduce((m, x) => m * (1 - (Array.isArray(x.f.e.amts) ? amtOf(x.f, x.n) : x.best) / 100), 1)) * 1000) / 10; };
    // a hit of one kind is also reduced by "all damage" resistance, and PvE kinds by "combatants" resistance
    for (const [v, b] of Object.entries(dr)) {
      const extra = v === 'all' ? [] : [...(dr.all?.items || []), ...(v !== 'players' && v !== 'combatants' ? dr.combatants?.items || [] : [])];
      const list = [...b.items, ...extra.filter(f => !b.items.includes(f))];
      b.always = stack(list.filter(f => !f.e.on)); b.all = stack(list); b.incl = extra.length ? [...new Set(extra.map(f => (f.e.vs || ['all']).includes('all') ? 'all' : 'combatants'))] : [];
    }
    return { fx, links: real, keys, gaps, inactive, unmatched, dr, srcOf, pending: pieces.map((pc, i) => pc.ixState === 'pending' ? i : -1).filter(i => i >= 0) };
  }
  const synergy = (pieces, ix, defs, subEl) => ixEval(pieces, ix, defs, subEl);
  const DR_VS = { all: 'All incoming damage', combatants: 'Combatants (PvE)', players: 'Players (PvP)', melee: 'Melee', ranged: 'Ranged', explosive: 'Explosive', sniper: 'Sniper', precision: 'Precision', solar: 'Solar', arc: 'Arc', void: 'Void', stasis: 'Stasis', strand: 'Strand', kinetic: 'Kinetic', elemental: 'Elemental', blocked: 'Blocked attacks', subclass: 'Your subclass element' };
  // how well one candidate piece fits the rest of the build (picker suggestions): its links (element terms 2,
  // others 1, once per term and role) plus effects of other pieces it switches on (e.g. Healing Rift turns on Child
  // of the Old Gods' grenade and melee energy).
  function fitScore(mine, rest, ix, defs) {
    const all = [...rest, mine]; const me = all.length - 1;
    const subEl = all.find(p => p.subEl)?.subEl; const ev = ixEval(all, ix, defs, subEl); const base = ixEval(rest, ix, defs, subEl);
    const why = []; let score = 0; const counted = new Set();
    const w = t => ix?.t?.[t]?.el ? 2 : 1;
    for (const l of ev.links) if (l.from === me || l.to === me) {
      const role = l.from === me ? 'p' : 'u';
      if (!counted.has(l.t + role)) { counted.add(l.t + role); score += w(l.t); }
      why.push({ k: l.t, l: l.l, role, other: all[l.from === me ? l.to : l.from].n });
    }
    const was = new Map(base.fx.filter(f => f.key).map(f => [f.key + '@' + f.i, f.ok]));
    for (const f of ev.fx) if (f.key && f.i !== me && f.ok && was.get(f.key + '@' + f.i) === false) { score += 2; why.push({ k: f.e.t, l: tLabel(ix, f.e.t), role: 'on', other: all[f.i].n }); }
    const seen = new Set();
    return { score, why: why.filter(x => { const id = x.k + x.role + (x.other || ''); if (seen.has(id)) return false; seen.add(id); return true; }) };
  }
  // a vault item as a candidate for a weapon / armor slot
  function synScore(it, pieces, defs, slot, ix) {
    const g = it.kind === 'weapon' ? 'weapon' : 'armor';
    const mine = buildPieces({ w: g === 'weapon' ? { [slot]: { id: it.id } } : {}, a: g === 'armor' ? { [slot]: { id: it.id } } : {} }, defs, new Map([[it.id, it]]))[0];
    return mine ? fitScore(mine, pieces.filter(p => !(p.g === g && p.slot === slot)), ix, defs) : { score: 0, why: [] };
  }
  // a subclass choice (super, ability, aspect, fragment) as a candidate; replaces the current pick of a single slot
  function subScore(b, defs, sec, h, pieces, ix) {
    const a = findSub(subOf(b, defs), sec, h); if (!a) return { score: 0, why: [] };
    const mine = { g: 'subclass', slot: sec, n: a.n, label: sec };
    return fitScore(mine, pieces.filter(p => !(p.g === 'subclass' && (p.n === a.n || (SUB_SINGLE.includes(sec) && p.slot === sec)))), ix, defs);
  }
  // a mod as a candidate for an armor slot
  function modScore(n, slot, defs, pieces, ix) {
    const mine = { g: 'mod', slot, n, label: 'Armor mod' };
    return fitScore(mine, pieces.filter(p => !(p.g === 'mod' && p.n === n)), ix, defs);
  }
  // character stats: armor (base values when DIM gives them, else current) + fragment and mod bonuses
  const ARMOR3 = ['Weapons', 'Health', 'Class', 'Grenade', 'Super', 'Melee'];
  function buildStats(b, defs, byId) {
    const out = Object.fromEntries(ARMOR3.map(k => [k, { armor: 0, mw: 0, tune: 0, frag: 0, mods: 0, total: 0 }]));
    let src = ''; const pieces = {};
    for (const s of A_SLOTS) {
      const it = byId?.get(b.a?.[s]?.id); const pt = armorParts(it, defs, s); if (!pt) continue;
      pieces[s] = pt; src ||= pt.hasBase ? (it.src === 'api' ? 'api' : 'base') : 'current';
      for (const k of ARMOR3) { out[k].armor += pt.base[k]; out[k].mw += pt.mw[k]; }
      // each mod socket: the build's mod, else the one on the piece now (Equip build leaves those in place)
      pt.lay.forEach(([, c], i) => {
        const n = b.mods?.[s]?.[i] || pt.inserted[i]; if (!n || !pt.hasBase) return;
        for (const [k, v] of Object.entries(modStatsOn(n, s, pt.base, defs))) if (out[k]) out[k][c === 't' ? 'tune' : 'mods'] += v;
      });
    }
    // mods chosen for slots without a piece still count
    for (const s of A_SLOTS) if (!pieces[s]) for (const n of (b.mods?.[s] || []).filter(Boolean)) for (const [k, v] of Object.entries(modStatsOn(n, s, {}, defs))) if (out[k]) out[k].mods += v;
    const sc = subOf(b, defs);
    for (const h of b.sub?.fragments || []) { const f = findSub(sc, 'fragments', h); for (const [k, v] of Object.entries(f?.st || {})) if (out[k]) out[k].frag += v; }
    for (const k of ARMOR3) out[k].total = out[k].armor + out[k].mw + out[k].tune + out[k].frag + out[k].mods;
    return { stats: out, src, pieces, total: ARMOR3.reduce((a, k) => a + out[k].total, 0) };
  }

  // ---------- Armor 3.0 (Edge of Fate) ----------
  // Bungie's rules, from the manifest: an archetype names the piece's primary and secondary stat (plus a random
  // tertiary); a Masterwork raises the piece's 3 lowest stats by 1 per level, up to +5 each ("Upgrade this armor to
  // improve its 3 lowest stats by 1, up to a maximum of 5"); legacy armor's Masterwork gives +2 to all stats; Tier 5
  // armor has a tuning socket whose mods follow its Tuned stat (+5 tuned / -5 another) or Balanced Tuning ("slightly
  // increases the three lowest stats", +1 each). Stats run 0-200; above 100 each stat gives an enhanced benefit.
  const ARCH_RE = /Primary Stat:\s*(\w+)\s*Secondary Stat:\s*(\w+)/i;
  function archetypeOf(name, defs) { const d = plugOf(name, defs, 'armor')?.[2] || ''; const m = d.match(ARCH_RE); return m ? { n: name, pri: m[1], sec: m[2] } : null; }
  const lowest3 = base => ARMOR3.slice().sort((a, b) => (base[a] || 0) - (base[b] || 0) || ARMOR3.indexOf(a) - ARMOR3.indexOf(b)).slice(0, 3);
  // a mod's stats: {stat: n}; Balanced Tuning: +1 to the piece's three lowest base stats
  function modStatsOn(n, slot, base, defs) {
    if (/^balanced tuning$/i.test(n)) return Object.fromEntries(lowest3(base).map(k => [k, 1]));
    const m = modsFor(slot, defs).find(x => norm(x[0]) === norm(n)); return m?.[2] || {};
  }
  // one armor piece split into what it's made of: base roll, masterwork, the mods on it now (by socket)
  function armorParts(it, defs, slot) {
    if (!it || it.kind !== 'armor') return null;
    const lay = modLayout(it.hash, defs);
    const gen3 = (Number(it.tier) || 0) >= 1 || lay.some(([, c]) => c === 't');
    const hasBase = ARMOR3.some(k => it.base?.[k] != null);
    const base = Object.fromEntries(ARMOR3.map(k => [k, (hasBase ? it.base[k] : it.stats?.[k]) || 0]));
    // mods on the piece right now: every equipped plug that is a mod some socket of this piece takes
    const on = (it.perks || []).filter(p => p.s && !/^empty|^default/i.test(p.n) && lay.some(([, c]) => modFits(p.n, c, slot, defs))).map(p => p.n);
    const inserted = placeMods(on, lay, slot, defs);
    const insSt = {}; for (const n of inserted.filter(Boolean)) for (const [k, v] of Object.entries(modStatsOn(n, slot, base, defs))) insSt[k] = (insSt[k] || 0) + v;
    // the masterwork is what's left between the current stats and base + mods on it
    // (Armor 3.0: only the 3 lowest stats, at most +5; legacy: at most +2 each), anything else unexplained is ignored
    const low = lowest3(base);
    const mw = Object.fromEntries(ARMOR3.map(k => [k, !hasBase || (gen3 && !low.includes(k)) ? 0 : Math.min(gen3 ? 5 : 2, Math.max(0, (it.stats?.[k] || 0) - base[k] - (insSt[k] || 0)))])); const mwLevel = gen3 ? Math.min(5, Math.max(0, ...low.map(k => mw[k]))) : null;
    return { gen3, hasBase, base, mw, mwLevel, low, inserted, lay, arch: archetypeOf(it.frame, defs), tertiary: it.tertiary || '', tuned: it.tuning || '' };
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
    for (const s of A_SLOTS) for (const n of (b.mods?.[s] || []).filter(Boolean)) { const m = modsFor(s, defs).find(x => norm(x[0]) === norm(n)); if (m?.[3]) mods.push(m[3]); }
    const lo = { id, name: String(b.name || 'Ghost build').slice(0, 60), classType: DIM_CLASS[b.cls] ?? 3, equipped, unequipped: [] };
    if (mods.length) lo.parameters = { mods };
    if (b.notes) lo.notes = String(b.notes).slice(0, 1024);
    return lo;
  }
  const dimLink = lo => 'https://app.destinyitemmanager.com/loadouts?loadout=' + encodeURIComponent(JSON.stringify(lo));
  // the subclass socket changes that turn a character's subclass (inst.plugs, init = each socket's empty plug) into
  // the build's choices. Order matters to Bungie: unwanted fragments come out first (aspects set how many fragment
  // sockets are open, and a fragment can't sit in two sockets), then aspects, abilities, and the new fragments.
  const SUB_RE = { super: /\.supers$/, classAbility: /\.class_abilities$/, movement: /\.movement$/, melee: /\.melee$/, grenade: /\.grenades$/, aspects: /\.aspects$/, fragments: /\.fragments$/ };
  function subclassPlan(b, defs, inst, init) {
    const sc = subOf(b, defs); if (!sc || !inst || !Array.isArray(inst.plugs)) return null;
    const so = sc.so || [], cur = inst.plugs.slice(), ini = Array.isArray(init) ? init : [];
    const socks = k => so.map((c, i) => String(c).split('|').some(x => SUB_RE[k].test(x)) ? i : -1).filter(i => i >= 0);
    const nameOf = h => { for (const k of Object.keys(SUB_RE)) { const a = findSub(sc, k, h); if (a) return a.n; } return ''; };
    const L = { super: 'Super', classAbility: 'class ability', movement: 'jump', melee: 'melee', grenade: 'grenade' };
    const removes = [], aspects = [], abil = [], frags = [];
    // place the wanted plugs: keep those already in one of the target sockets, fill free targets with the rest,
    // empty the other sockets that hold something unwanted
    const place = (idx, targets, want, out, rmOut, what) => {
      const kept = new Set(), used = new Set();
      for (const i of targets) if (want.includes(cur[i]) && !kept.has(cur[i])) { kept.add(cur[i]); used.add(i); }
      const free = targets.filter(i => !used.has(i));
      for (const h of want) if (!kept.has(h)) { const i = free.shift(); if (i == null) break; used.add(i); out.push({ si: i, h, label: `${what}: ${nameOf(h)}` }); }
      for (const i of idx) if (!used.has(i) && ini[i] && cur[i] && cur[i] !== ini[i]) rmOut.push({ si: i, h: ini[i], label: `Remove ${what.toLowerCase()} ${nameOf(cur[i]) || ''}`.trim() });
    };
    const fi = socks('fragments'), ai = socks('aspects');
    place(fi, fi.slice(0, fragSlots(b, defs)), b.sub?.fragments || [], frags, removes, 'Fragment');
    place(ai, ai, b.sub?.aspects || [], aspects, aspects, 'Aspect');
    for (const k of SUB_SINGLE) {
      const a = findSub(sc, k, b.sub?.[k]); const i = socks(k)[0];
      if (a && i != null && cur[i] !== a.h) abil.push({ si: i, h: a.h, label: `${k === 'super' ? 'Super' : L[k][0].toUpperCase() + L[k].slice(1)}: ${a.n}` });
    }
    return [...removes, ...aspects, ...abil, ...frags];
  }
  // armor mod sockets of one armor piece (Bungie, defs.sock): [[socketIndex, code]], code g general, s slot-specific,
  // t tuning, a artifice, x:<name> raid / seasonal. Without a known piece: 1 general + 3 slot sockets (Armor 3.0).
  const MOD_DEFAULT = [[-1, 'g'], [-1, 's'], [-1, 's'], [-1, 's']];
  // tier: the piece's gear tier when known; the tuning socket only works on Tier 5 armor
  function modLayout(hash, defs, tier) {
    const sk = defs?.sock; const i = sk?.a?.[String(hash || '')]; const lay = i != null ? sk.lay[i] : MOD_DEFAULT;
    return lay.filter(([, c]) => c === 'g' || c === 's' || ((c === 't' || c === 'a' || c.startsWith('x:')) && (sk?.m?.[c] || []).length && !(c === 't' && tier != null && tier !== '' && Number(tier) < 5)));
  }
  const MOD_SOCK_L = { g: 'General', t: 'Tuning', a: 'Artifice' };
  const modSockLabel = (c, slotLabel) => c === 's' ? slotLabel : MOD_SOCK_L[c] || (/^x:raid/.test(c) ? 'Raid' : /^x:season/.test(c) ? 'Seasonal' : 'Activity');
  // the mods one socket takes (code given), or every mod an armor slot can hold (lookups: costs, stats, hashes)
  // DIM's source keys are lowercase words run together; show them spaced and capitalised. Unknown keys fall back to
  // the key with its first letter capitalised. Search still matches the raw key (norm drops spaces).
  const SOURCE_NAMES = {"monumentoftriumph": "Monument of Triumph", "dungeon": "Dungeon", "ironbanner": "Iron Banner", "crucible": "Crucible", "engram": "Engram", "seasonpass": "Season Pass", "events": "Events", "lastwish": "Last Wish", "rahool": "Rahool", "paleheart": "Pale Heart", "duality": "Duality", "renegades": "Renegades", "campaign": "Campaign", "exoticquest": "Exotic Quest", "brave": "BRAVE", "30th": "30th Anniversary", "pantheon": "Pantheon", "rootofnightmares": "Root of Nightmares", "blackarmory": "Black Armory", "desertperpetual": "Desert Perpetual", "edgeoffate": "Edge of Fate", "moon": "Moon", "nightfall": "Nightfall", "europa": "Europa", "deluxe": "Deluxe", "sonar": "Sonar", "kepler": "Kepler", "battlegrounds": "Battlegrounds", "deepstonecrypt": "Deep Stone Crypt", "dreaming": "Dreaming", "sparrowracingleague": "Sparrow Racing League", "rivenslair": "Riven's Lair", "strikes": "Strikes", "contact": "Contact", "reclaim": "Reclaim", "rasputin": "Rasputin", "throneworld": "Throne World", "pinnacleops": "Pinnacle Ops", "echoes": "Echoes", "edz": "EDZ", "heresy": "Heresy", "wellspring": "Wellspring", "crotasend": "Crota's End", "neomuna": "Neomuna", "revenant": "Revenant", "gardenofsalvation": "Garden of Salvation", "trials": "Trials", "dcv": "DCV", "gambit": "Gambit", "nessus": "Nessus", "evidenceboard": "Evidence Board", "haunted": "Haunted", "mercury": "Mercury", "ritual-weapon": "Ritual Weapon", "cosmodrome": "Cosmodrome", "avalon": "Avalon", "lost": "Lost", "lostsectors": "Lost Sectors", "vaultofglass": "Vault of Glass", "kingsfall": "King's Fall", "vowofthedisciple": "Vow of the Disciple", "salvationsedge": "Salvation's Edge", "ghostsofthedeep": "Ghosts of the Deep", "prophecy": "Prophecy", "pitofheresy": "Pit of Heresy", "shatteredthrone": "Shattered Throne", "spireofthewatcher": "Spire of the Watcher", "warlordsruin": "Warlord's Ruin", "vespershost": "Vesper's Host", "sundereddoctrine": "Sundered Doctrine", "dreamingcity": "Dreaming City", "tangledshore": "Tangled Shore", "zerohour": "Zero Hour", "presage": "Presage", "raid": "Raid", "gunsmith": "Gunsmith", "xur": "Xûr", "eververse": "Eververse", "vanguard": "Vanguard"};
  const sourceName = k => !k ? '' : SOURCE_NAMES[String(k).toLowerCase()] || (String(k)[0].toUpperCase() + String(k).slice(1));
  const modsFor = (slot, defs, code) => code === 'g' ? (defs?.am?.general || []) : code === 's' ? (defs?.am?.[slot] || []) : code ? (defs?.sock?.m?.[code] || [])
    : [...(defs?.am?.[slot] || []), ...(defs?.am?.general || []), ...Object.values(defs?.sock?.m || {}).flat()];
  const modFits = (n, code, slot, defs) => modsFor(slot, defs, code).some(x => norm(x[0]) === norm(n));
  function placeMods(list, lay, slot, defs) {
    const out = lay.map(() => null); const rest = [];
    (Array.isArray(list) ? list : []).forEach((n, i) => { if (typeof n !== 'string' || !n) return; if (i < lay.length && out[i] == null && modFits(n, lay[i][1], slot, defs)) out[i] = n; else rest.push(n); });
    for (const n of rest) { const j = out.findIndex((x, k) => x == null && modFits(n, lay[k][1], slot, defs)); if (j >= 0) out[j] = n; }
    return out;
  }
  const modCost = (n, slot, defs) => modsFor(slot, defs).find(x => norm(x[0]) === norm(n))?.[1] || 0;

  return { LIMITS, sourceName, sanitizeHtml, sanitizeCss, parseCSV, toCSV, parseDimCsv, rowToItem, apiToItems, intrinsicHash, masterwork, catalyst, prepRatings, rateItem, WL, wlTags, parseWishlist, wlNote, TIERS, TIER_SCORE, prepGhostRatings, prepUserRatings, DEFAULT_WEIGHTS, comboKey, perkTier, combos, rateGhost, ratingGrade, parseQuery, runQuery, buildCtx, sortItems, groupKey, groupOrder, norm, findStat, applyDefs, perkInfo, breakerId, anyBreaker, sockets, descText, keywordRe, descHits, identifiers, plugOf, archetypeBreaker,
    SYN, SYN_BY, synTags, pieceText, buildPieces, synergy, ixEval, ixIds, DR_VS, synScore, subScore, modScore, fitScore, buildStats, normBuild, fragSlots, weaponSlot, armorSlot, W_SLOTS, A_SLOTS, ARMOR3, modsFor, modCost, modLayout, armorParts, archetypeOf, lowest3, modSockLabel, modFits, placeMods, subList, subclassPlan, artValid, artOf, ART_MAX, ART_SLOTS, dimLoadout, dimLink };
})();
if (typeof module !== 'undefined') module.exports = Core;
