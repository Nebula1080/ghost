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
  await b.close();
  // art resolution (backdrops must be high resolution)
  const sizeOf = f => { const b = fs.readFileSync(f); if (b.toString('ascii', 12, 16) === 'VP8X') return 1 + b.readUIntLE(24, 3); if (b.toString('ascii', 12, 16) === 'VP8 ') return b.readUInt16LE(26) & 0x3fff; if (b.toString('ascii', 12, 16) === 'VP8L') return 1 + (b.readUInt32LE(21) & 0x3fff); return 0; };
  const small = fs.readdirSync(path.join(root, 'data/art')).filter(f => f.endsWith('.webp')).map(f => [f, sizeOf(path.join(root, 'data/art', f))]).filter(([, w]) => w < 1920);
  small.length ? fail('low-resolution art: ' + small.map(x => x.join(' ')).join(', ')) : ok('all backdrop and subclass art is at least 1920px wide');
  errs.length ? fail('page errors: ' + errs.join(' | ')) : ok('no page errors');
  console.log(fails.length ? `\nui e2e: ${fails.length} failure(s)` : '\nui e2e: all checks passed');
  process.exit(fails.length ? 1 : 0);
})();
