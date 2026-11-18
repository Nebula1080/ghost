// Security unit tests (GHOST_PLAN → Security). Run: node test/security.test.js  (part of `npm test`)
// Pure Node, no browser: sanitizer, CSV limits, id validation, ratings validation, export formula guard,
// and static checks of the source for forbidden patterns.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../src/core.js');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n   ', e.message); } };
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

// ---------- sanitizeHtml: strict allowlist ----------
const PAYLOADS = [
  '<img src=x onerror=alert(1)>', '<svg onload=alert(1)>', '<svg><script>alert(1)</script></svg>',
  '<script>alert(1)</script>', '<SCRIPT SRC=//evil/x.js></SCRIPT>', '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="javascript:alert(1)">x</a>', '<div onclick="alert(1)">x</div>', '<span class="cl-pve" onmouseover=alert(1)>x</span>',
  '<div style="background:url(javascript:alert(1))">x</div>', '<span title="&quot; onmouseover=alert(1) x=&quot;">x</span>',
  '<span title=\'" onmouseover=alert(1) "\'>x</span>', '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<object data="data:text/html,<script>alert(1)</script>"></object>', '<embed src=x>', '<form action=x><button>x</button></form>',
  '<input autofocus onfocus=alert(1)>', '<details open ontoggle=alert(1)>', '<body onload=alert(1)>', '<style>*{x:url(//evil)}</style>',
  '<template><img src=x onerror=alert(1)></template>', '<!--<img src=x onerror=alert(1)>-->', '<<img src=x onerror=alert(1)>',
  '<img/src=x/onerror=alert(1)>', '<div class="d1 x" data-x="1" id="a" name="b">x</div>', '"><img src=x onerror=alert(1)>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">', '<textarea><img src=x onerror=alert(1)></textarea>',
  '<base href="//evil/">', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">', '<link rel=stylesheet href=//evil>',
  '<span class="d1">ok</span><div class="cl-sp"></div><br/>', '<DIV CLASS="cl-yellow">x</DIV>',
];
const SAFE_TAG = /^<\/?(div|span|br)( class="[A-Za-z0-9 -]*")?( title="[^"<>]*")?>$/;
t('sanitizeHtml: only div/span/br with class/title survive', () => {
  for (const p of PAYLOADS) {
    const out = C.sanitizeHtml(p);
    for (const tag of out.match(/<[^>]*>/g) || []) assert.ok(SAFE_TAG.test(tag), `unsafe tag ${tag} from ${p}`);
    assert.ok(!/javascript:|on[a-z]+\s*=|<script|<img|<svg|<iframe|<style|<a |<base|<meta|<link/i.test(out.replace(/&lt;[^]*?&gt;/g, '').replace(/ (title|class)="[^"]*"/g, '')), `dangerous text survived: ${out} from ${p}`);
  }
});
t('sanitizeHtml: class allowlist', () => {
  assert.strictEqual(C.sanitizeHtml('<div class="d1 x cl-pve" data-x="1" id="a">x</div>'), '<div class="d1 cl-pve">x</div>');
  assert.strictEqual(C.sanitizeHtml('<span class="evil">x</span>'), '<span>x</span>');
});
t('sanitizeHtml: text is escaped, entities kept, tags balanced', () => {
  assert.strictEqual(C.sanitizeHtml('a < b & c > d &amp; &#39;'), 'a &lt; b &amp; c &gt; d &amp; &#39;');
  assert.strictEqual(C.sanitizeHtml('<span>x<div>y'), '<span>x<div>y</div></span>');
  assert.strictEqual(C.sanitizeHtml('</span>x'), 'x');
  assert.strictEqual(C.sanitizeHtml('<script>alert(1)</script>ok'), 'ok');
  assert.strictEqual(C.sanitizeHtml(null), '');
});
t('sanitizeHtml: title attribute is re-escaped', () => {
  const out = C.sanitizeHtml('<span title="a&quot;b<c>">x</span>');
  assert.strictEqual(out, '<span title="a&quot;b&lt;c&gt;">x</span>');
});
t('sanitizeHtml: real Clarity + Data Compendium text keeps its markup', () => {
  let defs; try { defs = JSON.parse(read('data/defs.json')); } catch { return; }
  const nz = h => h.replace(/class=(d\d+)/g, 'class="$1"');
  let n = 0, changed = 0;
  const chk = h => { if (typeof h !== 'string') return; n++; const s = C.sanitizeHtml(h); if (s.replace(/<\/?[a-z]+[^>]*>/g, '') !== nz(h).replace(/<\/?[a-z]+[^>]*>/g, '')) changed++; };
  for (const v of Object.values(defs.cl || {})) { chk(v.h); chk(v.e); }
  for (const v of Object.values(defs.dc || {})) chk(v.h);
  for (const v of Object.values(defs.dcx || {})) chk(v);
  assert.ok(n > 1000, 'expected reference text');
  assert.strictEqual(changed, 0, `${changed} entries lost text`);
});

// ---------- sanitizeCss ----------
t('sanitizeCss: only plain colour / weight / style / decoration values', () => {
  assert.strictEqual(C.sanitizeCss('color:#ccc;font-weight:700;text-decoration:underline'), 'color:#ccc;font-weight:700;text-decoration:underline');
  assert.strictEqual(C.sanitizeCss('background:url(javascript:alert(1));color:red;color:#fff}body{x:y'), '');
  assert.strictEqual(C.sanitizeCss('background-image:url(//evil);font-style:italic'), 'font-style:italic');
  assert.strictEqual(C.sanitizeCss('color:#fff;x:expression(alert(1))'), 'color:#fff');
});

// ---------- CSV import: limits and malformed input ----------
const HEAD = 'Name,Hash,Id,Tag,Type,Notes,Perks 0';
t('CSV: rejects files over the size limit', () => {
  assert.throws(() => C.parseDimCsv(HEAD + '\n' + 'x'.repeat(C.LIMITS.csvBytes + 1)), /larger than/);
});
t('CSV: rejects too many rows', () => {
  const rows = Array.from({ length: C.LIMITS.csvRows + 1 }, (_, i) => `a,1,${i + 1},,,,`).join('\n');
  assert.throws(() => C.parseDimCsv(HEAD + '\n' + rows), /more than/);
});
t('CSV: rejects too many columns and huge cells', () => {
  assert.throws(() => C.parseDimCsv(HEAD + ',' + Array.from({ length: C.LIMITS.csvCols }, (_, i) => 'c' + i).join(',') + '\na,1,2'), /columns/);
  assert.throws(() => C.parseDimCsv(HEAD + '\na,1,2,,,' + 'n'.repeat(C.LIMITS.cell + 1)), /too long/);
});
t('CSV: rejects non-DIM files and empty files cleanly', () => {
  assert.throws(() => C.parseDimCsv(''), /empty/);
  assert.throws(() => C.parseDimCsv('a,b\n1,2'), /DIM spreadsheet/);
  assert.throws(() => C.parseDimCsv(null), /text/);
});
t('CSV: rows whose Id is not a digit string are dropped', () => {
  const { items } = C.parseDimCsv(HEAD + '\nok,1,6917529999000001,,,,\nbad,1,"12""><img src=x>",,,,\nbad2,1,abc,,,,\nbad3,1,,,,,');
  assert.deepStrictEqual(items.map(i => i.id), ['6917529999000001']);
});
t('CSV: hash keeps digits only', () => {
  const { items } = C.parseDimCsv(HEAD + '\nx,"12<b>3",1,,,,');
  assert.strictEqual(items[0].hash, '123');
});

// ---------- ratings JSON (untrusted import) ----------
t('ratings: values coerced to bounded numbers, junk dropped', () => {
  const R = C.prepRatings({ '123': { n: '<b>x</b>', pve: '<img src=x>', pvp: 99, c: [[['Perk', '<i>', 500], [{}, 1, 1], 'x']] }, 'abc': { c: [] }, '9': null });
  assert.deepStrictEqual(Object.keys(R), ['123']);
  assert.strictEqual(R['123'].pve, null); assert.strictEqual(R['123'].pvp, 5);
  const p = [...R['123'].cols[0].values()];
  assert.strictEqual(p.length, 1); assert.strictEqual(p[0].rel, 0); assert.strictEqual(p[0].pct, 100);
  assert.deepStrictEqual(C.prepRatings('nope'), {});
});

// ---------- CSV export: formula injection guard ----------
t('export: = + - @ tab CR cells are prefixed with a quote', () => {
  const csv = C.toCSV(['Name', 'Hash', 'Id', 'Tag', 'Notes'], [
    { Name: '=HYPERLINK("http://evil","x")', Hash: '1', Id: '2', Tag: 'keep', Notes: '+cmd|calc' },
    { Name: '@SUM(A1)', Hash: '1', Id: '3', Tag: '', Notes: '-2+3' },
    { Name: '\t=1', Hash: '1', Id: '4', Tag: '', Notes: 'plain' },
  ]);
  const rows = C.parseCSV(csv);
  for (const r of rows) for (const v of Object.values(r)) assert.ok(!/^[=+\-@\t\r]/.test(v), `unguarded cell ${JSON.stringify(v)}`);
  assert.strictEqual(rows[0].Notes, "'+cmd|calc");
});
t('export: app uses Core.toCSV with every column guarded', () => {
  const app = read('src/app.html');
  assert.ok(/Core\.toCSV\(\['Name', 'Hash', 'Id', 'Tag', 'Notes'\], rows\)/.test(app), 'exportCsv must call Core.toCSV(headers, rows) so the default guards all columns');
});

// ---------- static checks of the source ----------
const app = read('src/app.html'), core = read('src/core.js');
t('source: no eval / new Function / string timers / dynamic scripts / document.write', () => {
  for (const [name, src] of [['app.html', app], ['core.js', core]]) {
    assert.ok(!/\beval\s*\(/.test(src), name + ': eval');
    assert.ok(!/new\s+Function\s*\(/.test(src), name + ': new Function');
    assert.ok(!/set(Timeout|Interval)\s*\(\s*['"`]/.test(src), name + ': string timer');
    assert.ok(!/createElement\(\s*['"]script/.test(src), name + ': dynamic script');
    assert.ok(!/document\.write/.test(src), name + ': document.write');
  }
});
t('source: no inline event handler attributes', () => {
  assert.ok(!/<[a-z][^<>]*\son[a-z]+\s*=\s*["']/i.test(app.replace(/<script>[^]*?<\/script>/g, m => m.replace(/`[^`]*`/g, ''))), 'markup has an on*= handler');
  assert.ok(!/\son(click|load|error|mouseover|focus|input|change)="/i.test(app), 'template has an on*="…" handler');
});
t('source: reference HTML always goes through the sanitizer', () => {
  for (const m of app.matchAll(/class="(cltx|dctx)">\$\{([^}]*)\}/g)) assert.ok(/^SH\(/.test(m[2]), `${m[1]} inserted without SH(): ${m[2]}`);
  assert.ok(/D\.dcs\.map\(\(x, i\) => `\.dctx \.d\$\{i\}\{\$\{Core\.sanitizeCss\(x\)\}\}`\)/.test(app), 'Compendium styles must pass Core.sanitizeCss');
});
t('source: no tokens or secrets in persistent storage code paths', () => {
  assert.ok(!/localStorage\.setItem\([^)]*(token|access_token|apikey|api_key)/i.test(app), 'token written to localStorage');
  assert.ok(!/(X-API-Key|BUNGIE_API_KEY)['"]?\s*[:=]\s*['"][0-9a-f]{32}['"]/i.test(app + core), 'hard-coded API key');
});
t('built pages: no HTML comment markers inside inline scripts (hosts that strip comments would break them)', () => {
  for (const f of ['dist/index.html', 'dist-hosted/index.html']) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) throw new Error(f + ' missing: run both builds first');
    for (const [, js] of fs.readFileSync(p, 'utf8').matchAll(/<script\b[^>]*>([^]*?)<\/script\b[^>]*>/gi))
      assert.ok(!js.includes('<!--') && !js.includes('-->'), f + ': an inline script contains <!-- or -->');
  }
});

// ---------- hosted build: CSP and service worker ----------
t('hosted build: strict CSP meta, hashes match, no third-party hosts', () => {
  const p = path.join(root, 'dist-hosted/index.html');
  if (!fs.existsSync(p)) throw new Error('dist-hosted/index.html missing: run python build.py --target hosted');
  const html = fs.readFileSync(p, 'utf8');
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m, 'CSP meta missing');
  const csp = Object.fromEntries(m[1].split(';').map(x => x.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepStrictEqual(csp['default-src'], ["'none'"]);
  for (const k of ['base-uri', 'form-action', 'object-src']) assert.deepStrictEqual(csp[k], ["'none'"], k);
  assert.deepStrictEqual(csp['connect-src'], ["'self'", 'https://www.bungie.net']);
  assert.deepStrictEqual(csp['img-src'], ["'self'", 'data:', 'https://www.bungie.net']);
  assert.ok(!csp['script-src'].some(x => /unsafe|\*|https?:|data:/.test(x)), 'script-src must be hashes only');
  const crypto = require('crypto');
  const scripts = [...html.matchAll(/<script>([^]*?)<\/script>/g)].map(x => "'sha256-" + crypto.createHash('sha256').update(x[1], 'utf8').digest('base64') + "'");
  assert.deepStrictEqual(csp['script-src'].slice().sort(), scripts.slice().sort(), 'script hashes do not match the inline scripts');
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'CSP must come before the first script');
  assert.ok(/<meta name="referrer" content="no-referrer">/.test(html), 'referrer meta missing');
  assert.ok(!/fonts\.googleapis|fonts\.gstatic|<script[^>]+src=|<link[^>]+href="https?:/.test(html), 'third-party resource in hosted build');
});
t('hosted build: service worker caches only its own static files', () => {
  const sw = fs.readFileSync(path.join(root, 'dist-hosted/sw.js'), 'utf8');
  assert.ok(/!PATHS\.has\(u\.pathname\)/.test(sw) && /headers\.has\('Authorization'\)/.test(sw) && /u\.origin !== location\.origin/.test(sw), 'sw fetch guard missing');
  assert.ok(/caches\.delete/.test(sw), 'old caches must be deleted');
  assert.ok(!/bungie/i.test(sw), 'sw must not mention bungie.net');
  assert.ok(/cache: 'reload'/.test(sw) && /cache: 'no-cache'/.test(sw), 'sw must install past the HTTP cache and fetch the page network-first');
});

// ---------- repo hygiene ----------
t('.gitignore covers secrets and real exports', () => {
  const gi = read('.gitignore').split(/\r?\n/);
  for (const k of ['private/', '*.csv', 'config/local.json', '.env*']) assert.ok(gi.includes(k), '.gitignore missing ' + k);
});

// ---------- Bungie sign-in (src/bungie.js) and the API item adapter (Core.apiToItems) ----------
const BG = require('../src/bungie.js');
const bsrc = read('src/bungie.js');
t('bungie: the token exchange, read-only lookups and exactly the three approved write actions are allowed', () => {
  assert.ok(BG.allowed('POST', '/Platform/App/OAuth/token/'));
  assert.ok(BG.allowed('GET', '/Platform/User/GetMembershipsForCurrentUser/'));
  assert.ok(BG.allowed('GET', '/Platform/Destiny2/3/Profile/4611686018400000000/'));
  // approved 2026-11-17 (GHOST_PLAN -> Security): weapon perks / armor mods, equip, vault moves. Nothing else.
  assert.deepStrictEqual(BG.WRITE_PATHS.slice().sort(), ['/Platform/Destiny2/Actions/Items/EquipItem/', '/Platform/Destiny2/Actions/Items/InsertSocketPlugFree/', '/Platform/Destiny2/Actions/Items/TransferItem/']);
  for (const p of BG.WRITE_PATHS) assert.ok(BG.allowed('POST', p), p);
  for (const [m, p] of [['POST', '/Platform/Destiny2/Actions/Items/SetLockState/'], ['POST', '/Platform/Destiny2/Actions/Items/PullFromPostmaster/'],
    ['POST', '/Platform/Destiny2/Actions/Items/InsertSocketPlug/'], ['POST', '/Platform/Destiny2/Actions/Items/EquipItems/'], ['POST', '/Platform/Destiny2/Actions/Items/SetTrackedState/'],
    ['POST', '/Platform/Destiny2/Actions/Loadouts/EquipLoadout/'], ['GET', '/Platform/Destiny2/Actions/Items/TransferItem/'], ['PUT', '/Platform/Destiny2/Actions/Items/EquipItem/'],
    ['POST', '/Platform/Destiny2/Actions/Items/EquipItem/../SetLockState/'], ['POST', '/Platform/Destiny2/Actions/Items/EquipItem'], ['POST', '/platform/destiny2/actions/items/equipitem/'],
    ['PUT', '/Platform/App/OAuth/token/'], ['DELETE', '/Platform/User/GetMembershipsForCurrentUser/'], ['GET', '/Platform/User/GetMembershipsForCurrentUser/../Destiny2/Actions/'],
    ['GET', '/Platform/Destiny2/3/Profile/123/../../Actions/Items/EquipItem/'], ['POST', '/Platform/User/GetMembershipsForCurrentUser/']])
    assert.ok(!BG.allowed(m, p), `${m} ${p} must be refused`);
  const code = bsrc.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/SetLockState|PullFromPostmaster|InsertSocketPlug\/|EquipItems|SetQuestTracked|SetTrackedState|Loadout|AdvancedWriteActions/i.test(code), 'no other write endpoint or scope in bungie.js');
  assert.ok(!/localStorage|indexedDB|document\.cookie|console\./.test(code), 'bungie.js must not use persistent storage or log anything');
});
t('bungie: write bodies must have exactly the approved shape', () => {
  const ok = { plug: { plug: { socketIndex: 3, socketArrayType: 0, plugItemHash: 2420895100 }, itemId: '6917529000000000001', characterId: '2305843009300000001', membershipType: 3 },
    equip: { itemId: '6917529000000000001', characterId: '2305843009300000001', membershipType: 3 },
    transfer: { itemReferenceHash: 1399243961, stackSize: 1, transferToVault: false, itemId: '6917529000000000001', characterId: '2305843009300000001', membershipType: 3 } };
  for (const [a, b] of Object.entries(ok)) assert.ok(BG.writeBody(a, b), a);
  const bad = [['equip', { ...ok.equip, extra: 1 }], ['equip', { ...ok.equip, itemId: 6917529000000000001 }], ['equip', { ...ok.equip, itemId: '12a' }], ['equip', { ...ok.equip, membershipType: 254 }],
    ['plug', { ...ok.plug, plug: { ...ok.plug.plug, socketArrayType: 1 } }], ['plug', { ...ok.plug, plug: { ...ok.plug.plug, plugItemHash: -5 } }], ['plug', { ...ok.plug, plug: { ...ok.plug.plug, extra: 1 } }],
    ['transfer', { ...ok.transfer, stackSize: 2 }], ['transfer', { ...ok.transfer, transferToVault: 'yes' }], ['transfer', { ...ok.equip }], ['lock', ok.equip], ['equip', null], ['equip', [1]]];
  for (const [a, b] of bad) assert.ok(!BG.writeBody(a, b), `${a} ${JSON.stringify(b)} must be refused`);
});
t('app: Bungie writes only run from the confirmation sheet', () => {
  const app = read('src/app.html');
  const calls = app.match(/BG\.act\(/g) || [];
  assert.strictEqual(calls.length, 1, 'exactly one BG.act call site');
  const fn = app.slice(app.indexOf('function runActions('), app.indexOf('function runActions(') + 2000);
  assert.ok(/BG\.act\(/.test(fn) && /id="actGo"/.test(fn) && /go\.onclick = async/.test(fn), 'BG.act lives inside the Confirm button handler of runActions');
  assert.ok(!/setInterval|setTimeout\([^)]*runActions/.test(app.slice(app.indexOf('// ---------- Bungie actions'), app.indexOf('// picker sheet'))), 'no timers start actions');
});
const mkStore = () => { const m = new Map(); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const KEY = 'ab'.repeat(16) /* made-up test value */, CLIENT = '12345', TOKEN = 'tok_SECRET_value_123';
const mkRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const asyncTests = [];
const at = (name, fn) => asyncTests.push([name, fn]);
at('bungie: act() sends one guarded JSON POST, waits the Bungie gap, explains errors, refuses bad bodies offline', async () => {
  const store = mkStore(); store.setItem(BG.K_TOKEN, JSON.stringify({ t: TOKEN, exp: Date.now() + 3600e3, mid: '1' }));
  const calls = []; let clock = 1000; const slept = [];
  let reply = mkRes(200, { ErrorCode: 1, Response: 0 });
  const b = BG.create({ key: KEY, client: CLIENT, store, now: () => clock, sleep: async ms => { slept.push(ms); clock += ms; }, random: n => new Uint8Array(n), fetch: async (url, o) => { calls.push([url, o]); return reply; } });
  const body = { plug: { socketIndex: 3, socketArrayType: 0, plugItemHash: 2420895100 }, itemId: '6917529000000000001', characterId: '2305843009300000001', membershipType: 3 };
  await b.act('plug', body);
  const [url, o] = calls[0];
  assert.strictEqual(url, 'https://www.bungie.net/Platform/Destiny2/Actions/Items/InsertSocketPlugFree/');
  assert.strictEqual(o.method, 'POST'); assert.strictEqual(o.credentials, 'omit'); assert.strictEqual(o.headers.Authorization, 'Bearer ' + TOKEN);
  assert.deepStrictEqual(JSON.parse(o.body), body, 'body sent exactly as validated');
  await b.act('plug', body); assert.ok(slept.some(ms => ms >= 499), 'second plug action waits 0.5 s');
  await assert.rejects(b.act('plug', { ...body, extra: 1 }), /Blocked/); await assert.rejects(b.act('lock', body), /Blocked/);
  assert.strictEqual(calls.length, 2, 'refused bodies never reach the network');
  reply = mkRes(200, { ErrorCode: 1634, ErrorStatus: 'DestinyCannotPerformActionAtThisLocation' });
  await assert.rejects(b.act('equip', { itemId: '1', characterId: '2', membershipType: 3 }), /orbit/);
  reply = mkRes(200, { ErrorCode: 9, ErrorStatus: '<img src=x onerror=alert(1)>' });
  await assert.rejects(b.act('equip', { itemId: '1', characterId: '2', membershipType: 3 }), e => !/</.test(e.message), 'unknown statuses are not echoed raw');
  assert.ok(calls.every(([, o2]) => !/SECRET/.test(o2.body || '')), 'token never in a body');
});
at('bungie: a mismatched, missing or reused state is rejected and no token is requested', async () => {
  let calls = 0; const store = mkStore();
  const b = BG.create({ key: KEY, client: CLIENT, store, fetch: async () => { calls++; return mkRes(200, {}); }, random: n => new Uint8Array(n).fill(7) });
  const url = b.authorizeUrl(); const st = new URL(url).searchParams.get('state');
  assert.strictEqual(st.length, 64, 'state is 32 random bytes as hex');
  assert.ok(url.startsWith('https://www.bungie.net/en/OAuth/Authorize?') && !/scope=/.test(url));
  await assert.rejects(b.handleCallback(`?code=abc&state=${'0'.repeat(64)}`), e => e.code === 'state');
  await assert.rejects(b.handleCallback(`?code=abc&state=${st}`), e => e.code === 'state', 'state is single use (cleared after the first callback)');
  await assert.rejects(b.handleCallback('?code=abc'), e => e.code === 'state');
  assert.strictEqual(calls, 0);
  assert.strictEqual(await b.handleCallback('?foo=1'), null);
});
at('bungie: token exchange sends no secret, token lives only in the session store and never in messages', async () => {
  const store = mkStore(); const sent = [];
  const fetch = async (u, o) => {
    sent.push([u, o]);
    if (u.endsWith('/Platform/App/OAuth/token/')) return mkRes(200, { access_token: TOKEN, token_type: 'Bearer', expires_in: 3600, membership_id: '987' });
    if (/GetMembershipsForCurrentUser/.test(u)) return mkRes(401, null);
    return mkRes(500, { ErrorCode: 5, Message: 'x ' + TOKEN });
  };
  const b = BG.create({ key: KEY, client: CLIENT, store, fetch, random: n => new Uint8Array(n).fill(9), sleep: async () => {} });
  const st = new URL(b.authorizeUrl()).searchParams.get('state');
  assert.strictEqual(await b.handleCallback(`?code=good-code_1&state=${st}`), true);
  const [u, o] = sent[0];
  assert.strictEqual(u, 'https://www.bungie.net/Platform/App/OAuth/token/');
  assert.strictEqual(o.method, 'POST'); assert.strictEqual(o.credentials, 'omit');
  assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(o.body)), { grant_type: 'authorization_code', code: 'good-code_1', client_id: CLIENT });
  assert.ok(!/secret/i.test(o.body));
  assert.ok([...store.m.values()].some(v => v.includes(TOKEN)) && b.signedIn());
  const err = await b.memberships().catch(e => e);
  assert.strictEqual(err.code, 'auth'); assert.ok(!err.message.includes(TOKEN));
  assert.ok(!b.signedIn() && ![...store.m.values()].some(v => v.includes(TOKEN)), 'a 401 clears the token');
  assert.ok(!/localStorage/.test(read('src/app.html').match(/const BG = \(\(\) => \{[^]*?\n\}\)\(\);/)[0]), 'the app hands Bungie sessionStorage only');
});
at('bungie: Bungie error messages are not echoed (they could carry a token or markup)', async () => {
  const store = mkStore(); store.setItem(BG.K_TOKEN, JSON.stringify({ t: TOKEN, exp: Date.now() + 60000 }));
  const b = BG.create({ key: KEY, client: CLIENT, store, fetch: async () => mkRes(500, { ErrorCode: 5, Message: '<img src=x onerror=alert(1)> ' + TOKEN }), random: n => new Uint8Array(n), sleep: async () => {} });
  const e = await b.memberships().catch(x => x);
  assert.ok(e instanceof Error && !e.message.includes(TOKEN) && !/onerror|<img/.test(e.message));
});
t('apiToItems: maps a Bungie profile to the CSV item shape; hostile values are dropped or coerced', () => {
  const ad = require('../data/api-defs.json');
  const byName = n => Object.keys(ad.p).find(h => ad.p[h][0] === n);
  const MOD_A = byName('Backup Mag'), MOD_B = byName('Counterbalance Stock');
  const resp = {
    characters: { data: { '2305843009300000001': { classType: 2 } } },
    profileInventory: { data: { items: [
      { itemHash: 437854388, itemInstanceId: '6917529000000000001', state: 9 },
      { itemHash: 341892117, itemInstanceId: '6917529000000000002', state: 0 },
      { itemHash: 437854388, itemInstanceId: '<img src=x onerror=alert(1)>' },
      { itemHash: '999999999999', itemInstanceId: '6917529000000000003' },
    ] } },
    characterEquipment: { data: { '2305843009300000001': { items: [{ itemHash: 437854388, itemInstanceId: '6917529000000000004' }] } } },
    itemComponents: {
      instances: { data: { '6917529000000000001': { damageType: 6, primaryStat: { value: 493 }, gearTier: 4 }, '6917529000000000002': { primaryStat: { value: '<b>' }, energy: { energyCapacity: 11 } } } },
      stats: { data: { '6917529000000000002': { stats: { 2996146975: { value: 30 }, 392767087: { value: 25 }, 3493869314: { value: 20 }, 144602215: { value: 5 } } } } },
      sockets: { data: { '6917529000000000001': { sockets: [{ plugHash: 1294026524, isVisible: true }, { plugHash: 1015611457, isVisible: true }, { plugHash: 150943600, isVisible: true }, {}, {}, {}, { plugHash: Number(MOD_A), isVisible: true }] },
        '6917529000000000002': { sockets: [{ plugHash: 351770835, isVisible: true }] } } },
      reusablePlugs: { data: { '6917529000000000001': { plugs: { 1: [{ plugItemHash: 1015611457 }, { plugItemHash: 1294026524 }], 6: [{ plugItemHash: Number(MOD_A) }, { plugItemHash: Number(MOD_B) }] } } } },
    },
  };
  const { weapons, armor } = C.apiToItems(resp, ad);
  assert.strictEqual(weapons.length, 2); assert.strictEqual(armor.length, 1);
  const w = weapons.find(x => x.id === '6917529000000000001');
  assert.strictEqual(w.name, 'Action Item'); assert.strictEqual(w.type, 'Trace Rifle'); assert.strictEqual(w.element, 'Stasis');
  assert.strictEqual(w.ammo, 'special'); assert.strictEqual(w.power, 493); assert.strictEqual(w.tier, 4); assert.strictEqual(w.frame, 'Adaptive Frame');
  assert.ok(w.locked && w.crafted && w.owner === 'Vault' && w.src === 'api');
  assert.strictEqual(w.mwType, 'Range'); assert.strictEqual(w.mwTier, 6);
  assert.deepStrictEqual(w.perks.filter(p => p.s).map(p => p.n), ['Adaptive Frame', 'Kill Clip', 'Tier 6: Range', 'Backup Mag']);
  assert.ok(w.perks.some(p => p.n === 'Adaptive Frame' && !p.s), 'perk socket options listed, only the inserted one marked');
  assert.ok(w.perks.some(p => p.n === 'Backup Mag' && p.s) && !w.perks.some(p => p.n === 'Counterbalance Stock'), 'mod and masterwork sockets show only the inserted plug');
  const e = weapons.find(x => x.id === '6917529000000000004'); assert.ok(e.equipped && e.owner === 'Warlock');
  const a = armor[0]; assert.strictEqual(a.frame, 'Reaver'); assert.strictEqual(a.power, null); assert.strictEqual(a.energy, 11);
  assert.strictEqual(a.stats.Total, 80); assert.strictEqual(a.tertiary, 'melee'); assert.strictEqual(a.equippable, 'Warlock');
  assert.throws(() => C.apiToItems(null, ad)); assert.throws(() => C.apiToItems({}, null));
});
t('intrinsics: a weapon gets its own intrinsic text, not another weapon type\'s with the same name', () => {
  const D = require('../data/defs.json');
  const tahoma = { kind: 'weapon', hash: '1225851434', frame: 'Aggressive Frame' }; // TAHOMA 01, a fusion rifle
  const ph = C.intrinsicHash(tahoma, 'Aggressive Frame', D);
  assert.ok(ph, 'ambiguous intrinsic resolves to the weapon\'s own plug');
  const i = C.perkInfo('Aggressive Frame', D, 'weapon', ph);
  assert.ok(/horizontal volley/i.test(i.bd) && !/heavy attack/i.test(i.bd), 'fusion rifle text, not the sword\'s');
  assert.strictEqual(String(i.hash), ph, 'light.gg link points at the weapon\'s own plug');
  assert.strictEqual(C.intrinsicHash(tahoma, 'Some Other Perk', D), null, 'only the intrinsic itself is remapped');
});
t('hosted build: Bungie config only in the hosted build; artifact build has no sign-in code', () => {
  const art = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  assert.ok(/window\.VS_BUNGIE_CFG = null;/.test(art) && !/OAuth\/Authorize|X-API-Key/.test(art), 'artifact build must not carry Bungie sign-in');
  const bp = read('build.py');
  assert.ok(/os\.environ\.get\('BUNGIE_API_KEY'\)/.test(bp) && !/print\([^)]*\bkey\b[^)]*\)/.test(bp.replace(/'[^']*'/g, "''")), 'build.py must not print the key');
});

(async () => {
  for (const [name, fn] of asyncTests) { try { await fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n   ', e.message); } }
  console.log(`security unit tests: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
