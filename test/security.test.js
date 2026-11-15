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
});

// ---------- repo hygiene ----------
t('.gitignore covers secrets and real exports', () => {
  const gi = read('.gitignore').split(/\r?\n/);
  for (const k of ['private/', '*.csv', 'config/local.json', '.env*']) assert.ok(gi.includes(k), '.gitignore missing ' + k);
});

console.log(`security unit tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
