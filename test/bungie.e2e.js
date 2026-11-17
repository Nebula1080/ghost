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
    { itemHash: 437854388, itemInstanceId: '6917529000000000001', state: 1 },
    { itemHash: 341892117, itemInstanceId: '6917529000000000002', state: 0 },
    { itemHash: 437854388, itemInstanceId: '"><img src=x onerror=window.__x=1>' },
  ] } },
  characterEquipment: { data: { '2305843009300000001': { items: [{ itemHash: 437854388, itemInstanceId: '6917529000000000003' }] } } },
  itemComponents: { instances: { data: { '6917529000000000001': { damageType: 6, primaryStat: { value: 500 } } } },
    sockets: { data: { '6917529000000000001': { sockets: [{ plugHash: 1294026524, isVisible: true }] } } } },
};

srv.listen(8766, async () => {
  const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
  const bungieReqs = [];
  await ctx.route('https://www.bungie.net/**', async route => {
    const r = route.request(); const u = new URL(r.url());
    bungieReqs.push([r.method(), u.pathname, r.headers(), r.postData() || '']);
    if (u.pathname === '/en/OAuth/Authorize') return route.fulfill({ status: 302, headers: { Location: `http://localhost:8766/?code=fake-code_1&state=${u.searchParams.get('state')}` } });
    const cors = { 'Access-Control-Allow-Origin': 'http://localhost:8766', 'Access-Control-Allow-Headers': 'X-API-Key, Authorization, Content-Type', 'Content-Type': 'application/json' };
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (u.pathname === '/Platform/App/OAuth/token/') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ access_token: TOKEN, token_type: 'Bearer', expires_in: 3600, membership_id: '1' }) });
    if (u.pathname === '/Platform/User/GetMembershipsForCurrentUser/') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ErrorCode: 1, Response: { destinyMemberships: [{ membershipType: 3, membershipId: '4611686018400000001', bungieGlobalDisplayName: 'Tester<b>' }] } }) });
    if (/^\/Platform\/Destiny2\/3\/Profile\/4611686018400000001\/$/.test(u.pathname)) return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ErrorCode: 1, Response: profile }) });
    return route.fulfill({ status: 404, body: '' });
  });

  await pg.goto('http://localhost:8766/'); await pg.waitForTimeout(800);
  await pg.evaluate(() => document.getElementById('intro')?.remove());
  await pg.click('#bLoad'); await pg.waitForTimeout(200);
  const btn = await pg.$('[data-bg=in]');
  btn ? ok('Load dialog offers "Sign in with Bungie"') : fail('no Sign in with Bungie button');
  await Promise.all([pg.waitForURL(/localhost:8766/, { timeout: 8000 }), btn?.click()]);
  await pg.waitForTimeout(2500);
  const st = await pg.evaluate(() => ({ url: location.href, items: document.querySelectorAll('#panes .card').length, ls: JSON.stringify(Object.assign({}, localStorage)), ss: JSON.stringify(Object.assign({}, sessionStorage)), x: window.__x, csp: window.__csp }));
  !/[?&](code|state)=/.test(st.url) ? ok('address bar cleaned after sign-in') : fail('code/state left in the URL: ' + st.url);
  const vault = await pg.evaluate(() => [...document.querySelectorAll('#panes .card')].map(c => c.textContent).join(' '));
  /Action Item/.test(vault) ? ok('vault loaded from the Bungie profile') : fail('items from Bungie not shown');
  !st.ls.includes(TOKEN) && st.ss.includes(TOKEN) ? ok('token only in sessionStorage') : fail('token storage wrong');
  st.x === undefined ? ok('hostile ids in the profile are inert') : fail('payload executed');
  st.csp.length === 0 ? ok('zero CSP violations') : fail('CSP violations: ' + st.csp.join(' | '));
  const api = bungieReqs.filter(([m, p]) => p.startsWith('/Platform/') && m !== 'OPTIONS');
  const allowedRe = [/^POST \/Platform\/App\/OAuth\/token\/$/, /^GET \/Platform\/User\/GetMembershipsForCurrentUser\/$/, /^GET \/Platform\/Destiny2\/[1-6]\/Profile\/\d+\/$/];
  const bad = api.filter(([m, p]) => !allowedRe.some(r => r.test(`${m} ${p}`)));
  !bad.length && api.length === 3 ? ok('only the token exchange + 2 read-only calls were sent') : fail('unexpected Bungie requests: ' + api.map(([m, p]) => m + ' ' + p).join(', '));
  const tok = api.find(([, p]) => p.endsWith('/token/'));
  tok && !/secret/i.test(tok[3]) && /client_id=424242/.test(tok[3]) ? ok('token exchange sends client_id, no secret') : fail('token request body wrong');
  const reads = api.filter(([m]) => m === 'GET');
  reads.every(([, , h]) => h['x-api-key'] === FAKE_KEY && h.authorization === 'Bearer ' + TOKEN) ? ok('reads send X-API-Key + bearer token') : fail('read headers wrong');
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
