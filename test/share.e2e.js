// Share image (part of `npm run e2e`): make a build, open Share image, check the PNG (1080×1350) and that its QR code
// decodes (jsQR, dev-only) to a DIM loadout link for that build, with items by hash only (no instance ids).
const { chromium } = require('playwright');
const jsQR = require('jsqr');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const exe = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const fx = ['sample-weapons.csv', 'sample-armor.csv'].map(f => path.join(__dirname, 'fixtures', f));
const fails = []; const ok = m => console.log('  ok  ', m); const fail = m => { fails.push(m); console.log('  FAIL', m); };
const dir = path.join(root, 'dist-hosted');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(dir, p); if (!f.startsWith(dir) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f));
});
const B = 'http://localhost:8773/';
const pick = async (pg, sel, text) => { await pg.click(sel); await pg.waitForSelector('#plist'); const rows = await pg.$$('#plist .prow:not(.off)'); let row = rows[0];
  if (text) for (const r of rows) if ((await r.textContent()).includes(text)) { row = r; break; } if (!row) { await pg.click('#modal [data-close]'); return; } await row.click(); await pg.waitForTimeout(150); };
srv.listen(8773, async () => {
  const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
  try {
    for (const [name, vp] of [['desktop', { width: 1280, height: 860 }], ['phone', { width: 390, height: 844 }]]) {
      const pg = await (await b.newContext({ viewport: vp, hasTouch: name === 'phone' })).newPage();
      const errs = []; pg.on('pageerror', e => errs.push(e.message));
      await pg.goto(B); await pg.waitForTimeout(600); await pg.evaluate(() => { const i = document.getElementById('intro'); if (i) i.hidden = true; });
      await pg.setInputFiles('#file', fx); await pg.waitForTimeout(1200);
      await pg.evaluate(() => document.querySelector('#modal [data-close]')?.click());
      await pg.evaluate(() => document.querySelector('nav.views [data-view=builds]').click()); await pg.waitForTimeout(400);
      await pg.evaluate(() => (document.querySelector('#bNew2') || document.querySelector('#bNew')).click()); await pg.waitForTimeout(500);
      await pg.click('#builds [data-cls=hunter]'); await pg.click('#builds [data-el=solar]'); await pg.waitForTimeout(150);
      await pick(pg, '[data-sub=super]', 'Golden Gun'); await pick(pg, '[data-sub=melee]', 'Knife'); await pick(pg, '[data-a=head]');
      await pg.click('#bShare'); await pg.waitForSelector('.shareimg', { timeout: 15000 }); await pg.waitForTimeout(300);
      const img = await pg.evaluate(async () => {
        const im = document.querySelector('.shareimg'); await im.decode();
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
        const q = { x: c.width - 380, y: 500, w: 380, h: c.height - 500 };   // the QR sits right of the loop; its height depends on the build
        return { w: c.width, h: c.height, qw: q.w, qh: q.h, d: Array.from(x.getImageData(q.x, q.y, q.w, q.h).data) };
      });
      img.w === 1080 && img.h === 1350 ? ok(`${name}: the image is 1080×1350`) : fail(`${name}: image is ${img.w}×${img.h}`);
      const code = jsQR(Uint8ClampedArray.from(img.d), img.qw, img.qh); const url = code?.data || '';
      let lo = null; try { lo = JSON.parse(new URL(url).searchParams.get('loadout')); } catch {}
      url.startsWith('https://app.destinyitemmanager.com/loadouts?loadout=') && lo ? ok(`${name}: QR decodes to a DIM loadout link (version ${code.version}, ${url.length} chars)`) : fail(`${name}: QR did not decode to a DIM link: ${url.slice(0, 80)}`);
      lo && lo.classType === 1 && lo.equipped.every(e => e.socketOverrides || e.id === '0') ? ok(`${name}: the link is for this Hunter build, items by hash only`) : fail(`${name}: wrong loadout in the QR`);
      (await pg.$('#shDl')) ? ok(`${name}: Download PNG offered`) : fail(`${name}: no download button`);
      errs.length ? fail(`${name}: page errors ${errs.join(' | ')}`) : ok(`${name}: no page errors`);
    }
  } catch (e) { fail('crashed: ' + e.message); }
  await b.close(); srv.close();
  if (fails.length) { console.log(`${fails.length} share image check(s) failed`); process.exit(1); }
  console.log('share image e2e: all checks passed');
});
