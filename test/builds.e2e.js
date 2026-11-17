// Build maker UI (part of `npm run e2e`): create a build, pick subclass pieces / weapons / armor / mods, see
// interactions and stats, reload and find it again. Desktop, phone portrait (no sideways overflow, 44px targets)
// and landscape phone (the view scrolls as one page).
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const exe = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const fx = ['sample-weapons.csv', 'sample-armor.csv'].map(f => path.join(__dirname, 'fixtures', f));
const url = 'file://' + path.join(root, 'dist/index.html').split(path.sep).join('/');
const fails = []; const ok = m => console.log('  ok  ', m); const fail = m => { fails.push(m); console.log('  FAIL', m); };
// open a picker and choose the first allowed row (best synergy first)
const pick = async (pg, sel, text) => {
  await pg.click(sel); await pg.waitForSelector('#plist');
  const rows = await pg.$$('#plist .prow[data-s]:not(.off)');
  let row = rows[0];
  if (text) for (const r of rows) if ((await r.textContent()).includes(text)) { row = r; break; }
  if (!row) { await pg.click('#modal [data-close]'); return false; }
  await row.click(); await pg.waitForTimeout(150); return true;
};
(async () => {
  const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
  // desktop
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(url); await pg.waitForTimeout(400); await pg.evaluate(() => document.getElementById('intro')?.remove());
  await pg.setInputFiles('#file', fx); await pg.waitForTimeout(900);
  await pg.click('nav.views [data-view=builds]'); await pg.waitForTimeout(300);
  (await pg.$('#builds.open #bNew2')) ? ok('Builds view opens with an empty state') : fail('Builds view empty state missing');
  await pg.click('#bNew2'); await pg.waitForTimeout(200);
  await pg.click('#builds [data-cls=warlock]'); await pg.click('#builds [data-el=solar]'); await pg.waitForTimeout(150);
  await pick(pg, '[data-sub=melee]', 'Incinerator Snap');
  await pick(pg, '[data-sub=aspects][data-i="0"]', 'Touch of Flame');
  await pick(pg, '[data-sub=aspects][data-i="1"]', 'Heat Rises');
  const nFrag = await pg.$$eval('[data-sub=fragments]', x => x.length);
  nFrag === 4 ? ok('two aspects open 4 fragment slots (Bungie capacities)') : fail('fragment slots: ' + nFrag);
  await pick(pg, '[data-sub=fragments][data-i="0"]', 'Ember of Searing');
  // the same fragment can't be picked twice
  await pg.click('[data-sub=fragments][data-i="1"]'); await pg.waitForSelector('#plist');
  const dup = await pg.$$eval('#plist .prow.off', r => r.map(x => x.textContent).join('|'));
  /Ember of Searing/.test(dup) ? ok('a chosen fragment is marked "in build" in the other slots') : fail('duplicate fragment not blocked');
  await pg.click('#modal [data-close]');
  const w = await pick(pg, '[data-w=energy]'); const a = await pick(pg, '[data-a=class]'); await pick(pg, '[data-mod=class][data-mi="0"]');
  w && a ? ok('weapon and armor pickers list vault items') : fail('weapon/armor picker empty');
  const syn = await pg.$$eval('#bSyn .skey', x => x.map(k => k.querySelector('.skh b').textContent));
  syn.includes('Scorch') ? ok('interactions show Scorch: Incinerator Snap -> Ember of Searing') : fail('no Scorch interaction: ' + syn.join(','));
  await pg.evaluate(() => [...document.querySelectorAll('#bSyn .skey')].find(k => k.querySelector('.skh b').textContent === 'Scorch').querySelector('.schip').click()); await pg.waitForTimeout(100);
  const ev = await pg.evaluate(() => [...document.querySelectorAll('#bSyn .skey')].find(k => k.querySelector('.skh b').textContent === 'Scorch').querySelector('.sev').textContent);
  /scorch/i.test(ev) ? ok('tapping a piece shows the curated quote behind it') : fail('evidence missing: ' + ev);
  const stats = await pg.$$eval('.bstat', x => x.length); stats === 6 ? ok('six Armor 3.0 stats shown') : fail('stats rows ' + stats);
  // DIM loadout link
  await pg.click('#bDim'); await pg.waitForSelector('#dimUrl');
  const dl = await pg.evaluate(() => { const u = new URL(document.querySelector('#dimUrl').value); const lo = JSON.parse(u.searchParams.get('loadout')); const a = document.querySelector('#dimOpen');
    return { host: u.host, path: u.pathname, cls: lo.classType, sub: Object.keys(lo.equipped[0].socketOverrides || {}).length, items: lo.equipped.length, rel: a.rel, target: a.target, same: a.href === u.href }; });
  dl.host === 'app.destinyitemmanager.com' && dl.path === '/loadouts' && dl.cls === 2 && dl.sub === 4 && dl.items === 3 && /noopener/.test(dl.rel) && dl.target === '_blank' && dl.same
    ? ok('Send to DIM builds a DIM loadout link (subclass choices, weapon, armor)') : fail('DIM link ' + JSON.stringify(dl));
  await pg.click('#modal [data-close]');
  // rename, reload, reopen
  await pg.click('#bRen'); await pg.fill('#bNameIn', 'Scorch test'); await pg.click('#bNameOk'); await pg.waitForTimeout(500);
  await pg.reload(); await pg.waitForTimeout(700); await pg.evaluate(() => document.getElementById('intro')?.remove());
  await pg.click('nav.views [data-view=builds]'); await pg.waitForTimeout(300);
  const back = await pg.evaluate(() => ({ name: document.querySelector('#bName')?.textContent, frag: document.querySelector('[data-sub=fragments][data-i="0"] .bn')?.textContent, weapon: !!document.querySelector('[data-w=energy] .iwrap') }));
  back.name === 'Scorch test' && back.frag === 'Ember of Searing' && back.weapon ? ok('build saved and reopened after reload') : fail('reopen ' + JSON.stringify(back));
  // a hostile stored build is dropped / cleaned, never rendered as markup
  await pg.evaluate(() => { const v = JSON.parse(localStorage.getItem('vs:builds')); v.list.push({ id: '<img src=x onerror=alert(1)>', name: 'x' }, { id: 'evil1', name: '<img src=x onerror=window.__x=1>', w: { kinetic: { id: '"><script>', name: 'y' } } }); localStorage.setItem('vs:builds', JSON.stringify(v)); });
  await pg.reload(); await pg.waitForTimeout(600); await pg.evaluate(() => document.getElementById('intro')?.remove());
  await pg.click('nav.views [data-view=builds]'); await pg.click('#builds [data-bid=evil1]'); await pg.waitForTimeout(300);
  const safe = await pg.evaluate(() => !window.__x && !document.querySelector('#builds img[src=x]') && document.querySelectorAll('#builds [data-bid]').length === 2);
  safe ? ok('stored builds are validated and escaped') : fail('hostile stored build was rendered');
  errs.length ? fail('desktop page errors: ' + errs.join(' | ')) : ok('desktop: no page errors');
  const state = await pg.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))));
  const seed = s => { for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); };
  // phone portrait
  const ph = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p2 = await ph.newPage(); const e2 = []; p2.on('pageerror', e => e2.push(e.message));
  await p2.addInitScript(seed, state); await p2.goto(url); await p2.waitForTimeout(700); await p2.evaluate(() => document.getElementById('intro')?.remove());
  await p2.click('nav.views [data-view=builds]'); await p2.click('#builds [data-bid]'); await p2.waitForTimeout(400);
  const m = await p2.evaluate(() => {
    const v = document.querySelector('#builds');
    const small = [...v.querySelectorAll('.bslot,.bmod,.bpick,.bels .tab,.bclass .seg button,.blist .tab')].filter(e => e.getBoundingClientRect().height && e.getBoundingClientRect().height < 44).map(e => e.className);
    return { over: v.scrollWidth - v.clientWidth, small };
  });
  m.over <= 1 ? ok('phone: no sideways overflow') : fail('phone: view is ' + m.over + 'px too wide');
  m.small.length ? fail('phone: targets under 44px: ' + m.small.slice(0, 5).join(', ')) : ok('phone: build controls are at least 44px tall');
  await p2.click('#bJump'); await p2.waitForTimeout(700);
  const jt = await p2.evaluate(() => document.querySelector('#bSyn').getBoundingClientRect().top < innerHeight);
  jt ? ok('phone: "interactions" jumps to the panel') : fail('phone: jump to interactions failed');
  await p2.click('[data-sub=fragments][data-i="1"]'); await p2.waitForTimeout(300);
  const sheet = await p2.evaluate(() => { const r = document.querySelector('#modal .box').getBoundingClientRect(); return r.bottom >= innerHeight - 2 && r.left <= 1; });
  sheet ? ok('phone: pickers open as bottom sheets') : fail('phone: picker is not a bottom sheet');
  e2.length ? fail('phone page errors: ' + e2.join(' | ')) : ok('phone: no page errors');
  // landscape phone
  const ls = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
  const p3 = await ls.newPage(); const e3 = []; p3.on('pageerror', e => e3.push(e.message));
  await p3.addInitScript(seed, state); await p3.goto(url); await p3.waitForTimeout(700); await p3.evaluate(() => document.getElementById('intro')?.remove());
  await p3.click('nav.views [data-view=builds]'); await p3.waitForTimeout(400);
  const sc = await p3.evaluate(() => { const v = document.querySelector('#builds'); v.scrollTop = 400; return { top: v.scrollTop, over: v.scrollWidth - v.clientWidth }; });
  sc.top > 300 && sc.over <= 1 ? ok('landscape: Builds scrolls as one page, no sideways overflow') : fail('landscape ' + JSON.stringify(sc));
  e3.length ? fail('landscape page errors: ' + e3.join(' | ')) : ok('landscape: no page errors');
  await b.close();
  console.log(fails.length ? `\nbuilds e2e: ${fails.length} failure(s)` : '\nbuilds e2e: all checks passed');
  process.exit(fails.length ? 1 : 0);
})();
