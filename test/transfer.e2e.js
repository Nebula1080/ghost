// Send to another device, end to end (part of `npm run e2e`): on a "PC" (desktop context) make a build and a tag edit,
// open Send, decode the QR code it draws (jsQR, dev-only) back into the link, open that link on a "phone" (separate
// mobile context, so separate storage), check the preview and merge, and check that hostile or broken links are inert.
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
const B = 'http://localhost:8771/';
srv.listen(8771, async () => {
  const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
  try {
    // ---- PC ----
    const pc = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
    const errs = []; pc.on('pageerror', e => errs.push('pc: ' + e.message));
    await pc.goto(B); await pc.waitForTimeout(600); await pc.evaluate(() => document.getElementById('intro')?.remove());
    await pc.click('#bLoad'); await pc.setInputFiles('#file', fx); await pc.waitForTimeout(1200);
    await pc.evaluate(() => document.querySelector('#modal [data-close]')?.click());
    const card = await pc.$('#panes .card'); const itemId = await card.getAttribute('data-id');
    await card.click(); await pc.waitForTimeout(500);
    await pc.click('#drawer .tagsec [data-tag=infuse]'); await pc.fill('#drawer textarea', 'fuel for later'); await pc.dispatchEvent('#drawer textarea', 'change'); await pc.waitForTimeout(400);
    await pc.keyboard.press('Escape'); await pc.waitForTimeout(300);
    await pc.click('nav.views [data-view=builds]'); await pc.waitForTimeout(400);
    await pc.evaluate(() => (document.querySelector('#bNew2') || document.querySelector('#bNew')).click()); await pc.waitForTimeout(700);
    const bname = await pc.evaluate(() => document.querySelector('#builds h1')?.textContent.trim());
    await pc.click('#bProf'); await pc.waitForTimeout(300); await pc.click('#pSend'); await pc.waitForTimeout(1200);
    const qr = await pc.evaluate(async () => {
      const img = document.querySelector('#xQr img'); if (!img) return null; await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0);
      return { w: c.width, h: c.height, d: Array.from(x.getImageData(0, 0, c.width, c.height).data) };
    });
    const code = qr && jsQR(Uint8ClampedArray.from(qr.d), qr.w, qr.h);
    const url = code?.data || '';
    url.startsWith(B + '#xfer=') ? ok('Send draws a QR code that decodes to the transfer link') : fail('QR did not decode to a link: ' + url.slice(0, 80));
    (await pc.evaluate(() => /send it only to yourself/.test(document.querySelector('#modalBox').textContent))) ? ok('Send warns to send the link only to yourself') : fail('no warning on the Send sheet');

    // ---- phone ----
    const ph = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    ph.on('pageerror', e => errs.push('phone: ' + e.message));
    await ph.goto(url); await ph.waitForTimeout(1500);
    (!/xfer/.test(ph.url())) ? ok('transfer code removed from the address bar') : fail('address bar still has the code: ' + ph.url());
    const sheet = await ph.evaluate(() => document.querySelector('#modalBox')?.textContent || '');
    /Add from My vault/.test(sheet) && /1 build/.test(sheet) && /Tags & notes on 1 item/.test(sheet) ? ok('phone shows what will be added before saving') : fail('preview sheet: ' + sheet.slice(0, 200));
    (await ph.evaluate(() => localStorage.getItem('vs:builds'))) === null ? ok('nothing saved before Add') : fail('saved before Add');
    await ph.click('#xAdd'); await ph.waitForTimeout(800);
    const got = await ph.evaluate(id => ({ builds: (JSON.parse(localStorage.getItem('vs:builds') || '{}').list || []).map(x => x.name), edit: (JSON.parse(localStorage.getItem('vs:edits') || '{}'))[id] }), itemId);
    got.builds.includes(bname) ? ok('the build arrived on the phone') : fail('builds on phone: ' + JSON.stringify(got.builds) + ' want ' + bname);
    got.edit?.tag === 'infuse' && got.edit?.notes === 'fuel for later' ? ok('tag and notes arrived on the phone') : fail('edit on phone: ' + JSON.stringify(got.edit));
    await ph.click('nav.views [data-view=builds]'); await ph.waitForTimeout(500);
    (await ph.evaluate(n => document.querySelector('#builds h1')?.textContent.includes(n), bname)) ? ok('phone opens the build in Builds') : fail('build not shown in Builds on the phone');
    // same link again: nothing new, the build isn't duplicated
    await ph.goto(url); await ph.waitForTimeout(1200); await ph.click('#xAdd'); await ph.waitForTimeout(800);
    const n2 = await ph.evaluate(() => (JSON.parse(localStorage.getItem('vs:builds') || '{}').list || []).length);
    n2 === 1 ? ok('opening the same link twice does not duplicate the build') : fail('builds after second open: ' + n2);

    // ---- hostile and broken links ----
    const bad = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
    bad.on('pageerror', e => errs.push('bad: ' + e.message));
    const evil = '<img src=x onerror="window.__x=1">';
    const payload = { v: 1, from: { name: evil, at: 1 }, b: [{ id: 'evil1', name: evil, cls: '<script>', el: evil, notes: evil }], e: { '1': { t: 'keep', n: evil, m: evil } }, p: [{ id: 'p1', title: evil, q: evil }] };
    const j = 'j' + Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await bad.goto(B + '#xfer=' + j); await bad.waitForTimeout(1500);
    const st = await bad.evaluate(() => ({ x: window.__x, imgs: document.querySelectorAll('#modalBox img').length, txt: document.querySelector('#modalBox')?.textContent || '' }));
    st.x === undefined && st.imgs === 0 && /Add from <img/.test(st.txt) ? ok('hostile names show as text in the preview') : fail('hostile preview ' + JSON.stringify(st).slice(0, 200));
    await bad.click('#xAdd'); await bad.waitForTimeout(800); await bad.click('nav.views [data-view=builds]'); await bad.waitForTimeout(500);
    const st2 = await bad.evaluate(() => ({ x: window.__x, onx: [...document.querySelectorAll('*')].some(e => [...e.attributes].some(a => /^on/i.test(a.name))) }));
    st2.x === undefined && !st2.onx ? ok('a hostile link merges as plain text, nothing runs') : fail('hostile merge ' + JSON.stringify(st2));
    await bad.goto(B + '#xfer=zAAAA'); await bad.waitForTimeout(1200);
    (await bad.evaluate(() => /damaged/.test(document.querySelector('#toast')?.textContent || ''))) ? ok('a broken link explains itself and changes nothing') : fail('no message for a broken link');
    // a link that inflates past the cap is refused (a few KB of zeros -> > 4 MB)
    const zero = await bad.evaluate(async () => { const raw = new Uint8Array(5e6); const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); let s = ''; for (const c of z) s += String.fromCharCode(c); return 'z' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); });
    await bad.goto(B + '#xfer=' + zero); await bad.waitForTimeout(1500);
    { const r = await bad.evaluate(() => ({ t: document.querySelector('#toast')?.textContent || '', add: !!document.querySelector('#modal.open #xAdd') })); /damaged/.test(r.t) && !r.add ? ok('an oversized link is refused') : fail('oversized link was not refused ' + JSON.stringify(r) + ' len ' + zero.length); }
    errs.length ? fail('page errors: ' + errs.join(' | ')) : ok('no page errors');
  } catch (e) { fail('script: ' + e.message); }
  await b.close(); srv.close();
  console.log(fails.length ? `transfer e2e: ${fails.length} FAILED` : 'transfer e2e: all checks passed');
  process.exit(fails.length ? 1 : 0);
});
