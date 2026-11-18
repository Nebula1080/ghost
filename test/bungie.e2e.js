// Bungie sign-in, end to end, against a fake bungie.net (part of `npm run e2e`).
// Builds the hosted target with a made-up key/client_id (not secrets), serves it on localhost, intercepts every
// www.bungie.net request, and checks: sign-in round trip, state check, address bar cleaned, vault loaded from the
// profile, token only in sessionStorage, only allowed Bungie requests sent, zero CSP violations, sign-out.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const exe = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const fails = []; const ok = m => console.log('  ok  ', m); const fail = m => { fails.push(m); console.log('  FAIL', m); };
const FAKE_KEY = 'cd'.repeat(16) /* made-up test value */, FAKE_CLIENT = '424242', TOKEN = 'fake-access-token-XYZ';

const py = process.platform === 'win32' ? 'python' : 'python3';
execFileSync(py, ['build.py', '--target', 'hosted'], { cwd: root, env: { ...process.env, BUNGIE_API_KEY: FAKE_KEY, BUNGIE_CLIENT_ID: FAKE_CLIENT }, stdio: 'ignore' });
const dir = path.join(root, 'dist-hosted');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(dir, p); if (!f.startsWith(dir) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f));
});

const profile = {
  characters: { data: { '2305843009300000001': { classType: 1 } } },
  profileInventory: { data: { items: [
    { itemHash: 437854388, itemInstanceId: '6917529000000000001', state: 1, bucketHash: 1498876634 },
    { itemHash: 341892117, itemInstanceId: '6917529000000000002', state: 0 },
    { itemHash: 437854388, itemInstanceId: '"><img src=x onerror=window.__x=1>' },
  ] } },
  characterEquipment: { data: { '2305843009300000001': { items: [{ itemHash: 437854388, itemInstanceId: '6917529000000000003' }] } } },
  // a Hunter helmet on the character with Heavy Ammo Finder in a head mod socket (index 1)
  // + Gunslinger (not equipped): Golden Gun: Deadshot, no aspects or fragments
  characterInventories: { data: { '2305843009300000001': { items: [{ itemHash: 30472172, itemInstanceId: '6917529000000000004' }, { itemHash: 2240888816, itemInstanceId: '6917529000000000005' }] } } },
  itemComponents: { instances: { data: { '6917529000000000001': { damageType: 6, primaryStat: { value: 500 } } } },
    // Action Item: trait socket 3 holds Rimestealer and can switch to Rewind Rounds
    sockets: { data: { '6917529000000000001': { sockets: [{ plugHash: 1294026524, isVisible: true }, { plugHash: 839105230, isVisible: true }, { plugHash: 2680121939, isVisible: true }, { plugHash: 1955165503, isVisible: true }, { plugHash: 2922950962, isVisible: true }] },
      '6917529000000000004': { sockets: [{ plugHash: 0, isVisible: true }, { plugHash: 644105, isVisible: true }] },
      '6917529000000000005': { sockets: [3636300854, 1128768652, 375052469, 4016776972, 3199702642, 3875863236, 3875863236, 424005861, 424005861, 424005861, 424005861, 424005861, 424005861].map(plugHash => ({ plugHash, isVisible: true })) } } },
    reusablePlugs: { data: { '6917529000000000001': { plugs: { 3: [{ plugItemHash: 1955165503 }, { plugItemHash: 3418782618 }] } } } } },
};

srv.listen(8766, async () => {
  const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
  const bungieReqs = []; const writes = []; const WRITE_FAIL = { on: false };
  await ctx.route('https://www.bungie.net/**', async route => {
    const r = route.request(); const u = new URL(r.url());
    bungieReqs.push([r.method(), u.pathname, r.headers(), r.postData() || '']);
    if (u.pathname === '/en/OAuth/Authorize') return route.fulfill({ status: 302, headers: { Location: `http://localhost:8766/?code=fake-code_1&state=${u.searchParams.get('state')}` } });
    const cors = { 'Access-Control-Allow-Origin': 'http://localhost:8766', 'Access-Control-Allow-Headers': 'X-API-Key, Authorization, Content-Type', 'Content-Type': 'application/json' };
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (u.pathname === '/Platform/App/OAuth/token/') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ access_token: TOKEN, token_type: 'Bearer', expires_in: 3600, membership_id: '1' }) });
    if (u.pathname === '/Platform/User/GetMembershipsForCurrentUser/') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ErrorCode: 1, Response: { destinyMemberships: [{ membershipType: 3, membershipId: '4611686018400000001', bungieGlobalDisplayName: 'Tester<b>' }] } }) });
    if (/^\/Platform\/Destiny2\/3\/Profile\/4611686018400000001\/$/.test(u.pathname)) return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ErrorCode: 1, Response: profile }) });
    // the three approved write actions: record the exact JSON body; WRITE_FAIL makes the next one fail like Bungie does
    if (r.method() === 'POST' && /^\/Platform\/Destiny2\/Actions\/Items\/(InsertSocketPlugFree|EquipItem|TransferItem)\/$/.test(u.pathname)) {
      writes.push([u.pathname.split('/')[5], JSON.parse(r.postData() || 'null'), r.headers()]);
      if (WRITE_FAIL.on) { WRITE_FAIL.on = false; return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ErrorCode: 1634, ErrorStatus: 'DestinyCannotPerformActionAtThisLocation', Message: 'x' }) }); }
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ErrorCode: 1, Response: 0 }) });
    }
    return route.fulfill({ status: 404, body: '' });
  });

  await pg.goto('http://localhost:8766/'); await pg.waitForTimeout(800);
  await pg.evaluate(() => document.getElementById('intro')?.remove());
  const rail = await pg.evaluate(() => { const b = document.querySelector('#bBungie'); return b && !b.hidden && b.offsetParent ? b.textContent : ''; });
  rail === 'Sign in with Bungie' ? ok('desktop rail shows "Sign in with Bungie"') : fail('no Sign in button in the desktop rail: ' + JSON.stringify(rail));
  await pg.click('#bLoad'); await pg.waitForTimeout(200);
  const btn = await pg.$('#modal [data-bg=in]');
  btn ? ok('Load dialog offers "Sign in with Bungie"') : fail('no Sign in with Bungie button');
  await Promise.all([pg.waitForURL(/localhost:8766/, { timeout: 8000 }), btn?.click()]);
  await pg.waitForTimeout(2500);
  (await pg.evaluate(() => document.querySelector('#bBungie')?.textContent)) === 'Refresh from Bungie' ? ok('rail button becomes "Refresh from Bungie" after sign-in') : fail('rail button did not switch to Refresh');
  const st = await pg.evaluate(() => ({ url: location.href, items: document.querySelectorAll('#panes .card').length, ls: JSON.stringify(Object.assign({}, localStorage)), ss: JSON.stringify(Object.assign({}, sessionStorage)), x: window.__x, csp: window.__csp }));
  !/[?&](code|state)=/.test(st.url) ? ok('address bar cleaned after sign-in') : fail('code/state left in the URL: ' + st.url);
  const vault = await pg.evaluate(() => [...document.querySelectorAll('#panes .card')].map(c => c.textContent).join(' '));
  /Action Item/.test(vault) ? ok('vault loaded from the Bungie profile') : fail('items from Bungie not shown');
  !st.ls.includes(TOKEN) && st.ss.includes(TOKEN) ? ok('token only in sessionStorage') : fail('token storage wrong');
  st.x === undefined ? ok('hostile ids in the profile are inert') : fail('payload executed');
  st.csp.length === 0 ? ok('zero CSP violations') : fail('CSP violations: ' + st.csp.join(' | '));
  const api = bungieReqs.filter(([m, p]) => p.startsWith('/Platform/') && m !== 'OPTIONS');
  const allowedRe = [/^POST \/Platform\/App\/OAuth\/token\/$/, /^GET \/Platform\/User\/GetMembershipsForCurrentUser\/$/, /^GET \/Platform\/Destiny2\/[1-6]\/Profile\/\d+\/$/];
  !writes.length ? ok('loading the vault sends no write requests') : fail('writes sent while loading: ' + writes.map(w => w[0]).join(', '));
  const bad = api.filter(([m, p]) => !allowedRe.some(r => r.test(`${m} ${p}`)));
  !bad.length && api.length === 3 ? ok('only the token exchange + 2 read-only calls were sent') : fail('unexpected Bungie requests: ' + api.map(([m, p]) => m + ' ' + p).join(', '));
  const tok = api.find(([, p]) => p.endsWith('/token/'));
  tok && !/secret/i.test(tok[3]) && /client_id=424242/.test(tok[3]) ? ok('token exchange sends client_id, no secret') : fail('token request body wrong');
  const reads = api.filter(([m]) => m === 'GET');
  reads.every(([, , h]) => h['x-api-key'] === FAKE_KEY && h.authorization === 'Bearer ' + TOKEN) ? ok('reads send X-API-Key + bearer token') : fail('read headers wrong');
  // ---- Bungie actions (approved 2026-11-17): every write only after the confirmation sheet ----
  const cid = '2305843009300000001', W = '6917529000000000001', H = '6917529000000000004';
  await pg.evaluate(id => { document.querySelector('#drawer.open') && document.querySelector('#dClose')?.click(); document.querySelector(`#panes .card[data-id="${id}"]`).click(); }, W); await pg.waitForTimeout(500);
  const eq = await pg.$('#drawer [data-equip]');
  eq && /from vault/.test(await eq.textContent()) ? ok('vault weapon shows "Equip on Hunter (from vault)"') : fail('no equip button on the vault weapon');
  await eq.click(); await pg.waitForTimeout(300);
  const steps = await pg.$$eval('#modalBox .actsteps li', x => x.map(l => l.textContent));
  steps.length === 2 && /vault to your Hunter/.test(steps[0]) && /Equip/.test(steps[1]) && !writes.length ? ok('confirm sheet lists move + equip, nothing sent yet') : fail('confirm sheet ' + JSON.stringify(steps) + ' writes ' + writes.length);
  await pg.click('#actGo'); await pg.waitForTimeout(1500);
  const exp1 = [['TransferItem', { itemReferenceHash: 437854388, stackSize: 1, transferToVault: false, itemId: W, characterId: cid, membershipType: 3 }], ['EquipItem', { itemId: W, characterId: cid, membershipType: 3 }]];
  JSON.stringify(writes.map(w => [w[0], w[1]])) === JSON.stringify(exp1) && writes.every(w => w[2].authorization === 'Bearer ' + TOKEN && w[2]['x-api-key'] === FAKE_KEY && /json/.test(w[2]['content-type']))
    ? ok('equip from vault sends TransferItem then EquipItem with exact bodies') : fail('equip writes ' + JSON.stringify(writes.map(w => [w[0], w[1]])));
  const eqd = await pg.evaluate(() => document.querySelector('#drawer .eqrow')?.textContent || '');
  /Equipped on your Hunter/.test(eqd) ? ok('panel shows the weapon as equipped afterwards') : fail('equipped state not shown: ' + eqd);
  // perk switch: Rimestealer -> Rewind Rounds in socket 3
  writes.length = 0;
  await pg.evaluate(() => [...document.querySelectorAll('#drawer [data-pk]')].find(x => x.dataset.pk === 'Rewind Rounds')?.click()); await pg.waitForTimeout(300);
  const sw = await pg.$('#drawer [data-swap]');
  sw && /Switch Rimestealer to Rewind Rounds/.test(await sw.textContent()) ? ok('perk detail offers "Switch Rimestealer to Rewind Rounds"') : fail('no perk switch button');
  await sw?.click(); await pg.waitForTimeout(200); await pg.click('#actGo'); await pg.waitForTimeout(1200);
  JSON.stringify(writes.map(w => [w[0], w[1]])) === JSON.stringify([['InsertSocketPlugFree', { plug: { socketIndex: 3, socketArrayType: 0, plugItemHash: 3418782618 }, itemId: W, characterId: cid, membershipType: 3 }]])
    ? ok('perk switch sends one InsertSocketPlugFree with the exact body') : fail('perk writes ' + JSON.stringify(writes.map(w => [w[0], w[1]])));
  // armor mod swap: Heavy Ammo Finder -> Arc Targeting in head mod socket 1
  writes.length = 0;
  await pg.evaluate(() => document.querySelector('#dClose')?.click()); await pg.fill('#panes .pane .qin', 'is:armor'); await pg.waitForTimeout(900);
  await pg.evaluate(id => { document.querySelector('#dClose')?.click(); document.querySelector(`#panes .card[data-id="${id}"]`).click(); }, H); await pg.waitForTimeout(500);
  await pg.evaluate(() => [...document.querySelectorAll('#drawer [data-pk]')].find(x => x.dataset.pk === 'Heavy Ammo Finder')?.click()); await pg.waitForTimeout(300);
  const ms = await pg.$('#drawer [data-modswap]'); ms ? ok('mod detail offers "Change this mod"') : fail('no mod swap button');
  await ms?.click(); await pg.waitForSelector('#plist'); await pg.fill('#pkq', 'Arc Targeting'); await pg.waitForTimeout(300);
  await pg.evaluate(() => [...document.querySelectorAll('#plist .prow[data-s]')].find(r => !r.hidden && /Arc Targeting/.test(r.textContent))?.click()); await pg.waitForTimeout(300);
  await pg.click('#actGo'); await pg.waitForTimeout(1200);
  JSON.stringify(writes.map(w => [w[0], w[1]])) === JSON.stringify([['InsertSocketPlugFree', { plug: { socketIndex: 1, socketArrayType: 0, plugItemHash: 96682422 }, itemId: H, characterId: cid, membershipType: 3 }]])
    ? ok('mod swap sends one InsertSocketPlugFree with the exact body') : fail('mod writes ' + JSON.stringify(writes.map(w => [w[0], w[1]])));
  // Bungie refuses (not in orbit): message shown, the sequence stops at the first error
  writes.length = 0; WRITE_FAIL.on = true;
  await pg.evaluate(id => { document.querySelector('#dClose')?.click(); document.querySelector(`#panes .card[data-id="${id}"]`).click(); }, H); await pg.waitForTimeout(400);
  await pg.click('#drawer [data-equip]'); await pg.waitForTimeout(200); await pg.click('#actGo'); await pg.waitForTimeout(1200);
  const em = await pg.evaluate(() => document.querySelector('#actMsg')?.textContent || '');
  writes.length === 1 && /orbit/.test(em) ? ok('a refused action stops at the first error and explains it') : fail('error handling ' + JSON.stringify({ n: writes.length, em }));
  await pg.evaluate(() => document.querySelector('#actGo')?.click()); await pg.waitForTimeout(300);
  const st2 = await pg.evaluate(() => window.__csp.length);
  st2 === 0 ? ok('zero CSP violations after write actions') : fail('CSP violations after writes');
  await pg.evaluate(() => { document.querySelector('#dClose')?.click(); }); await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
  await pg.fill('#panes .pane .qin', ''); await pg.waitForTimeout(500);
  // Equip build: the whole build onto the Hunter (subclass equip + sockets, armor equip, armor mod), one confirm
  writes.length = 0;
  // a stored build, picked up after a reload (the Bungie session lives in sessionStorage and survives it)
  await pg.evaluate(([W, H]) => localStorage.setItem('vs:builds', JSON.stringify({ cur: 'beqtest', list: [{ id: 'beqtest', name: 'Eq test', cls: 'hunter', el: 'solar',
    sub: { super: 375052468, aspects: [3066103996], fragments: [362132288] }, w: { kinetic: { id: W } }, a: { head: { id: H } }, mods: { head: ['Heavy Ammo Finder'] } }] })), [W, H]);
  await pg.reload(); await pg.waitForTimeout(1200); await pg.evaluate(() => document.getElementById('intro')?.remove());
  await pg.click('nav.views [data-view=builds]'); await pg.waitForTimeout(600);
  const be = await pg.$('#bEquip'); be ? ok('Builds shows "Equip build" when signed in') : fail('no Equip build button');
  await be?.click(); await pg.waitForTimeout(300);
  const bsteps = await pg.$$eval('#modalBox .actsteps li', x => x.map(l => l.textContent));
  /Equip Gunslinger/.test(bsteps[0]) && bsteps.some(l => /Aspect: Gunpowder Gamble/.test(l)) && !writes.length ? ok('build confirm sheet lists ' + bsteps.length + ' steps, nothing sent yet') : fail('build steps ' + JSON.stringify(bsteps));
  await pg.click('#actGo'); await pg.waitForTimeout(5000);
  const SUBB = { itemId: '6917529000000000005', characterId: cid, membershipType: 3 };
  const pl = (si, h) => ['InsertSocketPlugFree', { plug: { socketIndex: si, socketArrayType: 0, plugItemHash: h }, ...SUBB }];
  const got = writes.map(w => [w[0], w[1]]);
  JSON.stringify(got.slice(0, 4)) === JSON.stringify([['EquipItem', SUBB], pl(5, 3066103996), pl(2, 375052468), pl(7, 362132288)])
    && JSON.stringify(got[4]) === JSON.stringify(['EquipItem', { itemId: H, characterId: cid, membershipType: 3 }]) && got[5]?.[0] === 'InsertSocketPlugFree' && got[5][1].itemId === H && got[5][1].plug.socketIndex === 1 && got.length === 6
    ? ok('equip build: subclass, sockets, armor, then mod, with exact bodies') : fail('equip build writes ' + JSON.stringify(got));
  await pg.waitForSelector('#modal.open', { state: 'detached', timeout: 5000 }).catch(() => {});
  writes.length = 0; await pg.evaluate(() => document.querySelector('#bEquip')?.click()); await pg.waitForTimeout(300);
  const again = await pg.evaluate(() => document.querySelector('#modal.open') ? [...document.querySelectorAll('#modalBox .actsteps li')].map(l => l.textContent) : []);
  !writes.length && !again.length ? ok('equipping the same build again has nothing to send') : fail('second equip still had steps ' + JSON.stringify(again));
  await pg.keyboard.press('Escape');
  await pg.evaluate(() => document.querySelector('nav.views [data-view=vault]').click()); await pg.waitForTimeout(300);
  // sign out clears the session but keeps the vault
  await pg.click('#bLoad'); await pg.waitForTimeout(200);
  await pg.click('[data-bg=out]'); await pg.waitForTimeout(300);
  const after = await pg.evaluate(() => ({ ss: JSON.stringify(Object.assign({}, sessionStorage)), n: document.querySelectorAll('#panes .card').length }));
  !after.ss.includes(TOKEN) && after.n > 0 ? ok('sign out clears the token, vault stays') : fail('sign out did not clear the token');
  // a forged callback (state never issued) is rejected without any token request
  const before = bungieReqs.length;
  await pg.goto('http://localhost:8766/?code=evil&state=' + 'a'.repeat(64)); await pg.waitForTimeout(1200);
  const forged = await pg.evaluate(() => ({ url: location.href, toast: document.querySelector('#toast')?.textContent || '' }));
  bungieReqs.slice(before).every(([, p]) => !p.startsWith('/Platform/')) && /security check/.test(forged.toast) && !/code=/.test(forged.url)
    ? ok('forged callback rejected, no token request, URL cleaned') : fail('forged callback not handled: ' + JSON.stringify(forged));
  errs.length ? fail('page errors: ' + errs.join(' | ')) : ok('no page errors');
  await b.close(); srv.close();
  // leave dist-hosted as a plain (unconfigured) build for the other tests and for anything that runs after
  execFileSync(py, ['build.py', '--target', 'hosted'], { cwd: root, env: { ...process.env, BUNGIE_API_KEY: '', BUNGIE_CLIENT_ID: '' }, stdio: 'ignore' });
  console.log(fails.length ? `\nbungie e2e: ${fails.length} failure(s)` : '\nbungie e2e: all checks passed');
  process.exit(fails.length ? 1 : 0);
});
