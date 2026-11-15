// Browser security test (GHOST_PLAN → Security gates). Run: node test/security.e2e.js  (part of `npm run e2e`)
// Builds are expected in dist/ (artifact) and dist-hosted/ (hosted). For each build it:
//  - loads DIM CSVs whose every text field (and a stat column name) carries XSS payloads, plus hostile
//    ratings and profile data in localStorage
//  - opens every view: vault panes, item drawer, perk details, triage, compare, clean up, subclasses,
//    profiles, help, export
//  - fails if any payload ran (window.__xss), if any element carries an on* attribute or javascript: URL,
//    or (hosted) if the CSP reported a single violation
//  - hosted: checks the service worker caches only the build's own files and nothing token-like is stored
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');

const root = path.join(__dirname, '..');
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
const X = n => `<img src=x onerror="window.__xss=(window.__xss||[]).concat('${n}')">`;
const S = n => `"><svg onload="window.__xss=(window.__xss||[]).concat('${n}s')"></svg>`;
const J = n => `javascript:window.__xss=['${n}j']`;
const csvq = v => '"' + String(v).replace(/"/g, '""') + '"';

// hostile copies of the synthetic fixtures (written to test/out, which is gitignored)
function hostile(file, kind) {
  const lines = fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8').split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  const rows = require('../src/core.js').parseCSV(lines.join('\n'));
  const evilStat = `<img src=x onerror=window.__xss=['stathead']>`;
  head.push(evilStat);
  const body = rows.map((r, i) => {
    const o = { ...r };
    o.Name = (i % 2 ? X('name' + i) : S('name' + i)) + r.Name;
    o.Notes = X('notes' + i) + ' ' + J('notes' + i);
    o.Type = r.Type + X('type' + i);
    o.Source = S('source' + i);
    o.Archetype = r.Archetype + X('arch' + i);
    o.Tag = i === 0 ? X('tag') : r.Tag;
    o.Owner = X('owner');
    if ('Masterwork Type' in o) o['Masterwork Type'] = X('mw');
    if ('Element' in o && i === 1) o.Element = X('element');
    if ('Tertiary Stat' in o) o['Tertiary Stat'] = X('tert');
    for (const k of Object.keys(o)) if (/^Perks \d+$/.test(k) && o[k] && i % 3 === 0) o[k] = o[k].replace(/^/, k.endsWith('1') ? X('perk' + i) : '');
    o[evilStat] = String(40 + i);
    return head.map(h => csvq(o[h] ?? '')).join(',');
  });
  const p = path.join(out, `xss-${kind}.csv`);
  fs.writeFileSync(p, [head.map(csvq).join(','), ...body].join('\n'));
  return p;
}
const files = [hostile('sample-weapons.csv', 'weapons'), hostile('sample-armor.csv', 'armor')];

function serve(dir) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(dir, u.endsWith('/') ? u + 'index.html' : u);
    if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}
function browserPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const p of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) if (fs.existsSync(p)) return p;
  return undefined;   // Playwright's own Chromium (npx playwright install chromium)
}

let failures = 0;
const fail = (m) => { failures++; console.log('  FAIL', m); };
const ok = (m) => console.log('  ok  ', m);

async function run(label, url, hosted) {
  console.log(`\n[${label}] ${url}`);
  const b = await chromium.launch({ executablePath: browserPath() });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: hosted ? 'allow' : 'block' });
  const pg = await ctx.newPage();
  const errors = [], csp = [];
  pg.on('pageerror', e => errors.push(e.message));
  pg.on('crash', () => console.log('  !! renderer crashed'));
  if (process.env.SEC_DEBUG) pg.on('console', m => console.log('     console.' + m.type(), m.text().slice(0, 160)));
  pg.on('console', m => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(t); else if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|404/.test(t)) errors.push(t); });
  await pg.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile || ''}:${e.lineNumber || ''}`));
    try {
      if (!localStorage.getItem('xss-seeded')) {
        localStorage.setItem('xss-seeded', '1');
        localStorage.setItem('vs:ratings', JSON.stringify({ '1399243961': { n: '<img src=x onerror=window.__xss=["rn"]>', pve: '<img src=x onerror=window.__xss=["pve"]>', pvp: 3, c: [[['Arrowhead Brake', '"><img src=x onerror=window.__xss=["rel"]>', 20], ['<img src=x onerror=window.__xss=["rperk"]>', 50, 10]]] } }));
        // group weapons by type only and don't protect anything, so the tiny fixture set yields groups to review
        localStorage.setItem('vs:clean', JSON.stringify({ setup: { kind: 'weapon', keys: { weapon: ['type'] }, keep: 1, protectTags: false, protectLocked: false, onlyNeeded: false }, step: 'setup' }));
        localStorage.setItem('vs:profiles', JSON.stringify({ list: [{ id: 'main', name: '<img src=x onerror=window.__xss=["prof"]>', color: 'red;background:url(javascript:alert(1))' }, { id: '../../x', name: 'bad id' }], active: 'main' }));
      }
    } catch {}
  });
  await pg.goto(url, { waitUntil: 'load' });
  await pg.waitForTimeout(600);
  await pg.click('#bLoad');
  await pg.setInputFiles('#file', files);
  await pg.waitForTimeout(1200);
  const summary = (await pg.textContent('#summary').catch(() => '')) || '';
  summary.trim() ? ok('loaded: ' + summary.trim().replace(/\s+/g, ' ')) : fail('CSV did not load');
  // exercise every surface that renders item text
  const step = async (name, fn) => { if (process.env.SEC_DEBUG) console.log('  ..', name); try { await fn(); await pg.waitForTimeout(250); } catch (e) { fail(`${name}: ${e.message.split('\n')[0]}`); } };
  await step('search', async () => { const q = await pg.$$('.qin'); await q[0].fill('img onerror'); await pg.waitForTimeout(300); await q[0].fill('is:weapon'); if (q[1]) await q[1].fill('notes:img or source:svg or is:armor'); });
  await step('sort/group menus', async () => { await pg.selectOption('.pane select[data-k=group]', { index: 2 }).catch(() => {}); });
  for (const sel of ['.pane .card', '.pane:nth-child(2) .card']) {
    await step('drawer ' + sel, async () => {
      await pg.click(sel); await pg.waitForTimeout(300);
      for (const pk of (await pg.$$('#drawer [data-pk], #drawer [data-setp]')).slice(0, 8)) { await pk.click().catch(() => {}); await pg.waitForTimeout(80); }
      const tri = await pg.$('#drawer details.tri summary'); if (tri) { await tri.click(); await pg.waitForTimeout(150); const bt = await pg.$$('#drawer .tri [data-term], #drawer .tri button'); for (const x of bt.slice(0, 4)) await x.click().catch(() => {}); }
      await pg.fill('#drawer textarea', '<img src=x onerror=window.__xss=["typed"]>'); await pg.waitForTimeout(700);
      await pg.click('#dClose');
    });
  }
  const view = async v => { const b2 = await pg.$(`nav.views [data-view=${v}]`); if (b2) { await b2.click(); await pg.waitForTimeout(400); } };
  await step('compare', async () => {
    for (const n of [1, 2, 3]) {
      await pg.click(`.pane:first-child .card:nth-of-type(${n})`, { timeout: 3000 }).catch(() => pg.click('.pane .card'));
      await pg.waitForTimeout(200);
      const tri = await pg.$('#drawer details.tri:not([open]) summary'); if (tri) await tri.click();
      const add = await pg.$('#drawer .tri button:has-text("Add this item to compare"):not([disabled])'); if (add) await add.click({ timeout: 3000 }).catch(() => {});
      await pg.waitForTimeout(150); if (await pg.$('#drawer.open')) await pg.click('#dClose').catch(() => {});
    }
    await view('compare');
    const cells = await pg.$$('#compare .cc'); if (!cells.length) throw new Error('compare view is empty');
    for (const pk of (await pg.$$('#compare [data-pk]')).slice(0, 3)) { await pk.click().catch(() => {}); await pg.waitForTimeout(80); }
    await pg.keyboard.press('Escape');
  });
  await step('clean up', async () => {
    await view('clean');
    await pg.locator('#clStart:visible').click({ timeout: 5000 }); await pg.waitForTimeout(400);
    for (const id of ['#clNext', '#clNext', '#clReview']) await pg.locator(id + ':visible').click({ timeout: 2000 }).catch(() => {});
    await pg.waitForTimeout(300);
    if (!(await pg.$('#clean .tile, #clean .rev'))) throw new Error('clean up rendered no items');
  });
  await step('subclasses', async () => { await view('sub'); const tile = await pg.$('.sv-tile'); if (tile) await tile.click(); });
  await step('help + export', async () => {
    await view('vault');
    await pg.locator('#bHelp:visible').click({ timeout: 5000 }); await pg.waitForTimeout(200); await pg.keyboard.press('Escape');
    await pg.locator('#bExport:visible').click({ timeout: 5000 }); await pg.waitForTimeout(300);
    const csv = await pg.$eval('#modal textarea', t => t.value);
    for (const line of csv.split(/\r?\n/).slice(1)) if (/(^|,)"?[=+\-@]/.test(line)) throw new Error('unguarded export cell: ' + line.slice(0, 80));
    await pg.keyboard.press('Escape'); await pg.evaluate(() => document.querySelector('#modal')?.classList.remove('open'));
  });
  await step('profiles', async () => { await view('vault'); const pb = await pg.$('#bProf'); if (pb) { await pb.click(); await pg.waitForTimeout(200); await pg.fill('#newProf', '<img src=x onerror=window.__xss=["newprof"]>'); await pg.click('#addProf'); await pg.waitForTimeout(800); } });

  await pg.waitForTimeout(500);

  const res = await pg.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('*')) {
      for (const a of el.attributes) {
        if (/^on/i.test(a.name)) bad.push(`${el.tagName} ${a.name}`);
        if (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) bad.push(`${el.tagName} ${a.name}=${a.value.slice(0, 40)}`);
      }
    }
    const scripts = document.querySelectorAll('script').length;
    const imgs = [...document.querySelectorAll('img')].filter(i => !/^data:image\//.test(i.getAttribute('src') || '')).map(i => i.getAttribute('src'));
    const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
    return { xss: window.__xss || null, bad, scripts, imgs, csp: window.__csp, lsKeys: Object.keys(ls), lsTokeny: Object.entries(ls).filter(([k, v]) => /token|access_token|refresh_token|authorization|bearer|api[-_]?key/i.test(k + ' ' + v)).map(([k]) => k), profColors: (JSON.parse(ls['vs:profiles'] || '{}').list || []).map(p => p.color) };
  });
  res.xss ? fail('payload executed: ' + JSON.stringify(res.xss)) : ok('no payload executed');
  res.bad.length ? fail('dangerous attributes in DOM: ' + res.bad.slice(0, 5).join(' | ')) : ok('no on* attributes or javascript: URLs in the DOM');
  res.scripts === 3 ? ok('script count unchanged (3)') : fail('script elements: ' + res.scripts);
  res.imgs.length ? fail('non-data images: ' + res.imgs.slice(0, 3).join(', ')) : ok('only data: images');
  res.profColors.every(c => /^#[0-9a-f]{6}$/i.test(c)) ? ok('profile colours sanitised') : fail('profile colour: ' + res.profColors);
  res.lsTokeny.length ? fail('token-like data in localStorage: ' + res.lsTokeny) : ok('no token-like data in localStorage');
  errors.length ? fail('page errors: ' + errors.slice(0, 3).join(' | ')) : ok('no page errors');
  if (hosted) {
    const all = [...new Set([...csp, ...(res.csp || [])])];
    all.length ? fail(`${all.length} CSP violation(s): ` + all.slice(0, 4).join(' | ')) : ok('zero CSP violations');
    const cached = await pg.evaluate(async () => { const o = []; for (const k of await caches.keys()) { const c = await caches.open(k); for (const r of await c.keys()) o.push(new URL(r.url).pathname); } return o; }).catch(() => null);
    if (cached == null) fail('could not read the SW cache');
    else {
      const allowed = new Set(['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icons.webp', '/icons.png']);
      const extra = cached.filter(p => !allowed.has(p));
      extra.length ? fail('SW cached non-build files: ' + extra.join(', ')) : ok(`SW cache holds only build files (${cached.length})`);
    }
  }
  await pg.screenshot({ path: path.join(out, `security-${label}.png`) });
  await b.close();
}

(async () => {
  for (const [d, t] of [['dist', 'artifact'], ['dist-hosted', 'hosted']]) if (!fs.existsSync(path.join(root, d, 'index.html'))) { console.log(`missing ${d}/index.html: run python build.py --target ${t}`); process.exit(1); }
  if (process.env.SEC_ONLY !== 'hosted') await run('artifact', 'file://' + path.join(root, 'dist/index.html').replace(/\\/g, '/'), false);
  const srv = await serve(path.join(root, 'dist-hosted'));
  try { await run('hosted', `http://localhost:${srv.address().port}/`, true); } finally { srv.close(); }
  console.log('\nNot covered yet (no sign-in code until step 4): OAuth state mismatch, token storage after sign-in.');
  console.log(failures ? `\nsecurity e2e: ${failures} failure(s)` : '\nsecurity e2e: all checks passed');
  process.exit(failures ? 1 : 0);
})();
