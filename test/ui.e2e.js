// UI regression tests for the Ghost design (part of `npm run e2e`):
//  - a perk description opens under the clicked perk and closes on a second click (also after switching perks
//    and after rapid clicks), leaving nothing visible behind
//  - Clean up cards open the item panel
//  - every view's backdrop and every subclass art file is at least 1920px wide
//  - the theme picker switches and remembers the theme; the motion toggle is remembered
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const exe = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const fx = ['sample-weapons.csv', 'sample-armor.csv'].map(f => path.join(__dirname, 'fixtures', f));
const fails = []; const ok = m => console.log('  ok  ', m); const fail = m => { fails.push(m); console.log('  FAIL', m); };
(async () => {
  const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
  const pg = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + path.join(root, 'dist/index.html').split(path.sep).join('/'));
  await pg.waitForTimeout(400);
  await pg.click('#bLoad'); await pg.setInputFiles('#file', fx); await pg.waitForTimeout(1000);
  // perk toggle
  await (await pg.$$('#panes .card'))[0].click(); await pg.waitForTimeout(700);
  const st = () => pg.evaluate(() => { const d = document.querySelector('#pdet'); return { hidden: !d || d.hidden, on: document.querySelectorAll('#drawer .dsk.on,#drawer .dintr.on').length, h: d ? Math.round(d.getBoundingClientRect().height) : 0 }; });
  const cells = await pg.$$('#drawer .dcol .dsk');
  if (cells.length < 2) fail('perk cells missing'); else {
    await cells[0].click(); await pg.waitForTimeout(300); let s = await st(); s.hidden ? fail('first click did not open') : ok('perk opens');
    await cells[0].click(); await pg.waitForTimeout(300); s = await st(); (s.hidden && !s.on && !s.h) ? ok('second click closes it completely') : fail('close ' + JSON.stringify(s));
    await cells[1].click(); await cells[0].click(); await cells[0].click(); await pg.waitForTimeout(300); s = await st(); s.hidden ? ok('switch then close') : fail('switch then close ' + JSON.stringify(s));
    for (let i = 0; i < 6; i++) await cells[1].click({ delay: 5 }); await pg.waitForTimeout(300); s = await st(); (s.hidden && !s.on) ? ok('rapid clicks settle closed') : fail('rapid ' + JSON.stringify(s));
  }
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
  // clean up card -> item panel
  await pg.click('nav.views [data-view=clean]'); await pg.waitForTimeout(600);
  const start = await pg.$('#clStart:not([disabled])'); if (start) { await start.click(); await pg.waitForTimeout(500); }
  const tile = await pg.$('#clean .tile .tn');
  if (!tile) fail('no clean up tiles'); else { await tile.click(); await pg.waitForTimeout(700); (await pg.$('#drawer.open')) ? ok('clean up card opens the item panel') : fail('clean up card did not open the item panel'); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); }
  // themes + motion persist
  await pg.click('nav.views [data-view=vault]'); await pg.waitForTimeout(300);
  await pg.click('.rail-foot [data-world=gilded]'); await pg.click('#bMotion'); await pg.reload(); await pg.waitForTimeout(600);
  const ui = await pg.evaluate(() => ({ t: document.documentElement.dataset.theme, m: document.documentElement.dataset.motion }));
  (ui.t === 'gilded' && ui.m === 'off') ? ok('theme and motion remembered') : fail('theme/motion ' + JSON.stringify(ui));
  // item rows: armor shows slot, archetype, total and tertiary; item icon is Bungie's (sprite), not a perk icon
  await pg.evaluate(() => { const q = document.querySelector('#panes .qin'); q.value = 'is:armor'; q.dispatchEvent(new Event('input')); }); await pg.waitForTimeout(600);
  const armor = await pg.evaluate(() => { const c = document.querySelector('#panes .pane .card'); return c ? c.querySelector('.sub').textContent : ''; });
  (/Total/.test(armor) && /Tertiary/.test(armor)) ? ok('armor row shows total and tertiary') : fail('armor row: ' + armor);
  const sprite = await pg.evaluate(() => !!document.querySelector('#panes .card .itm .ispr'));
  sprite ? ok('item icon comes from the bundled Bungie item sprites') : fail('item icon is not the Bungie item icon');
  // pane menu: clicking the drawn dots opens it
  await pg.click('#panes .pane .menu [data-act=menu] svg', { force: true }); await pg.waitForTimeout(150);
  (await pg.$('#panes .pane .menu.open')) ? ok('pane menu opens from its icon') : fail('pane menu did not open');
  await b.close();
  // item panel with reduced motion (animations off): it must still be visible
  for (const rm of ['reduce', 'no-preference']) {
    const b2 = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
    const p2 = await b2.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: rm });
    await p2.goto('file://' + path.join(root, 'dist/index.html').split(path.sep).join('/')); await p2.waitForTimeout(400);
    await p2.click('#bLoad'); await p2.setInputFiles('#file', fx); await p2.waitForTimeout(900);
    await (await p2.$$('#panes .card'))[0].click(); await p2.waitForTimeout(800);
    const v = await p2.evaluate(() => { const d = document.querySelector('#drawer'); const r = d.getBoundingClientRect(); const cs = getComputedStyle(d); return cs.visibility === 'visible' && cs.clipPath.startsWith('inset(0') && r.width > 300; });
    v ? ok(`item panel visible (${rm} motion)`) : fail(`item panel invisible (${rm} motion)`);
    await b2.close();
  }
  // phone: scrolling a list down collapses the header chrome, scrolling up restores it; the pane menu fits on screen
  {
    const b3 = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
    const p3 = await b3.newPage({ viewport: { width: 390, height: 667 }, isMobile: true, hasTouch: true });
    const e3 = []; p3.on('pageerror', e => e3.push(e.message));
    await p3.goto('file://' + path.join(root, 'dist/index.html').split(path.sep).join('/')); await p3.waitForTimeout(400);
    await p3.evaluate(() => document.getElementById('intro')?.remove());
    await p3.setInputFiles('#file', fx); await p3.waitForTimeout(900);
    const pb = () => p3.evaluate(() => { const p = [...document.querySelectorAll('.pane')].find(p => p.getBoundingClientRect().left < 50 && p.getBoundingClientRect().left > -5); window.__pb = p.querySelector('.pane-body'); return window.__pb.clientHeight; });
    const h0 = await pb();
    await p3.evaluate(() => { const f = document.createElement('div'); f.style.height = '3000px'; window.__pb.appendChild(f); });
    for (let i = 0; i < 5; i++) { await p3.evaluate(() => window.__pb.scrollBy(0, 120)); await p3.waitForTimeout(50); }
    await p3.waitForTimeout(400);
    const c1 = await p3.evaluate(() => document.body.classList.contains('compact')), h1 = await pb();
    c1 && h1 > h0 + 150 ? ok(`phone: scrolling down collapses the header chrome (list ${h0}px → ${h1}px)`) : fail(`phone: no collapse on scroll (compact ${c1}, ${h0} → ${h1})`);
    for (let i = 0; i < 3; i++) { await p3.evaluate(() => window.__pb.scrollBy(0, -40)); await p3.waitForTimeout(50); }
    await p3.waitForTimeout(300);
    (await p3.evaluate(() => !document.body.classList.contains('compact'))) ? ok('phone: scrolling up restores it') : fail('phone: header chrome stays collapsed after scrolling up');
    await p3.evaluate(() => window.__pb.closest('.pane').querySelector('[data-act=menu]').click()); await p3.waitForTimeout(200);
    const m = await p3.evaluate(() => {
      const pane = window.__pb.closest('.pane'), l = pane.querySelector('.menu-list'), r = l.getBoundingClientRect();
      const limit = Math.min(document.querySelector('nav.views').getBoundingClientRect().top, pane.getBoundingClientRect().bottom);
      l.scrollTop = l.scrollHeight; const last = [...l.querySelectorAll('button')].pop().getBoundingClientRect();
      return { fits: r.top >= 0 && r.bottom <= limit + 1 && r.height > 0, lastVisible: last.bottom <= r.bottom + 1 && last.top >= r.top - 1 };
    });
    m.fits && m.lastVisible ? ok('phone: pane menu stays inside the pane and scrolls to its last option') : fail('phone: pane menu runs off screen or cannot reach its last option ' + JSON.stringify(m));
    e3.length ? fail('phone page errors: ' + e3.join(' | ')) : ok('phone: no page errors');
    await b3.close();
  }
  // art resolution (backdrops must be high resolution)
  const sizeOf = f => { const b = fs.readFileSync(f); if (b.toString('ascii', 12, 16) === 'VP8X') return 1 + b.readUIntLE(24, 3); if (b.toString('ascii', 12, 16) === 'VP8 ') return b.readUInt16LE(26) & 0x3fff; if (b.toString('ascii', 12, 16) === 'VP8L') return 1 + (b.readUInt32LE(21) & 0x3fff); return 0; };
  const small = fs.readdirSync(path.join(root, 'data/art')).filter(f => f.endsWith('.webp')).map(f => [f, sizeOf(path.join(root, 'data/art', f))]).filter(([, w]) => w < 1920);
  small.length ? fail('low-resolution art: ' + small.map(x => x.join(' ')).join(', ')) : ok('all backdrop and subclass art is at least 1920px wide');
  errs.length ? fail('page errors: ' + errs.join(' | ')) : ok('no page errors');
  console.log(fails.length ? `\nui e2e: ${fails.length} failure(s)` : '\nui e2e: all checks passed');
  process.exit(fails.length ? 1 : 0);
})();
