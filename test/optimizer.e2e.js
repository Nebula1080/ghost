// Armor optimizer UI (part of `npm run e2e`): Builds → Find armor for target stats. Nothing searches until Find armor
// is pressed; results reach the targets; "Use this armor" fills the build; phone: bottom sheet, no sideways
// overflow, 44px controls. The armor CSV is written at runtime to the temp folder (a full Warlock set, Tier 5).
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), os = require('os');
const root = path.join(__dirname, '..');
const exe = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const url = 'file://' + path.join(root, 'dist/index.html').split(path.sep).join('/');
const fails = []; const ok = m => console.log('  ok  ', m); const fail = m => { fails.push(m); console.log('  FAIL', m); };
// three Warlock pieces per slot with the Armor 3.0 spread (30/25/20 + 0s, Tier 5), one exotic class item
const head = 'Name,Hash,Id,Tag,Rarity,Tier,Type,Source,Equippable,Category,Power,Energy Capacity,Archetype,Tertiary Stat,Tuning Stat,Masterwork Type,Masterwork Tier,Owner,Locked,Equipped,Featured,Holofoil,Year,Season,Event,Weapons,Health,Class,Grenade,Super,Melee,Total,Weapons (Base),Health (Base),Class (Base),Grenade (Base),Super (Base),Melee (Base),Total (Base),Seasonal Mod,Loadouts,Notes,Perks 0';
const SL = [['Helmet', 'Helmet'], ['Gauntlets', 'Gauntlets'], ['Chest Armor', 'Chest Armor'], ['Leg Armor', 'Leg Armor'], ['Warlock Bond', 'Class Item']];
const spreads = [[0, 30, 0, 25, 0, 20], [30, 0, 25, 0, 20, 0], [0, 25, 20, 30, 0, 0]];
const rows = []; let n = 1;
SL.forEach(([type, cat], s) => spreads.forEach((st, j) => {
  const ex = s === 4 && j === 0; const name = ex ? 'Solipsism' : `Test ${type} ${j + 1}`; const tot = st.reduce((a, b) => a + b, 0);
  rows.push([name, ex ? 2273643087 : 900000 + n, `69175299992000${String(n++).padStart(2, '0')}`, '', ex ? 'Exotic' : 'Legendary', 5, type, 'Test', 'Warlock', cat, 550, 11, 'Bulwark', '', '', '', '', 'Vault', 'false', 'false', 'false', 'false', 11, 27, '', ...st, tot, ...st, tot, '', '', '', 'Bulwark*'].join(','));
}));
const csv = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-opt-')), 'destiny-armor.csv');
fs.writeFileSync(csv, [head, ...rows].join('\n'));
const fx = [path.join(__dirname, 'fixtures', 'sample-weapons.csv'), csv];

async function open(pg) {
  await pg.goto(url); await pg.waitForTimeout(500); await pg.evaluate(() => document.getElementById('intro')?.remove());
  await pg.setInputFiles('#file', fx); await pg.waitForTimeout(900);
  await pg.evaluate(() => document.querySelector('#modal').classList.remove('open'));
  await pg.click('nav.views [data-view=builds]'); await pg.waitForTimeout(300);
  if (await pg.$('#bNew2')) await pg.click('#bNew2');
  await pg.waitForTimeout(200); await pg.click('#builds [data-cls=warlock]'); await pg.waitForTimeout(200);
  await pg.click('#bOpt'); await pg.waitForSelector('#modalBox.opt-box');
}
const setT = async (pg, i, v) => { await pg.fill(`[data-on="${i}"]`, String(v)); await pg.dispatchEvent(`[data-on="${i}"]`, 'change'); };
(async () => {
  const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await open(pg);
  (await pg.$eval('#modalBox .gsh', e => e.textContent)).includes('Warlock') ? ok('Find armor opens for the build’s class') : fail('optimizer title');
  await pg.click('#oRun'); await pg.waitForTimeout(200);
  (await pg.$('.optsum')) ? fail('searched with no targets') : ok('no search without a target');
  await setT(pg, 1, 100); await setT(pg, 3, 80); await pg.fill('[data-ot="5"]', '40'); await pg.dispatchEvent('[data-ot="5"]', 'input');
  await pg.waitForTimeout(400);
  (await pg.$('.optsum')) ? fail('changing a target started a search') : ok('setting targets does not search');
  await pg.click('#oRun'); await pg.waitForSelector('.optsum', { timeout: 30000 });
  const sum = await pg.$eval('.optsum', e => e.textContent); const nRes = parseInt(sum.replace(/,/g, ''));
  nRes > 0 ? ok('Find armor lists combinations: ' + sum.trim()) : fail('no results: ' + sum);
  const vals = await pg.$$eval('.optr:first-child .optv', x => x.slice(0, 6).map(e => +e.querySelector('b').textContent));
  vals[1] >= 100 && vals[3] >= 80 && vals[5] >= 40 ? ok('first result reaches every target ' + vals.join('/')) : fail('first result ' + vals.join('/'));
  const maxes = await pg.$$eval('.optt small b', x => x.map(e => +e.textContent));
  maxes.length === 3 && maxes.every(v => v >= 40) ? ok('reachable max shown for the 3 targeted stats') : fail('max labels ' + maxes.join(','));
  // changing a setting marks the results out of date, still without searching
  await pg.selectOption('#oMods', '3'); await pg.waitForTimeout(200);
  /Settings changed/.test(await pg.$eval('#oProg', e => e.textContent)) ? ok('a changed setting asks for a new search') : fail('stale note missing');
  await pg.click('#oRun'); await pg.waitForSelector('.optsum', { timeout: 30000 });
  // sorting, opening a result, using it
  await pg.click('[data-os=s1]'); await pg.waitForTimeout(150);
  const h = await pg.$$eval('.optr .optv:nth-of-type(2) b', x => x.map(e => +e.textContent));
  h.every((v, i) => !i || v <= h[i - 1]) ? ok('sort by Health puts the highest first') : fail('sort ' + h.join(','));
  await pg.click('[data-or="0"]'); await pg.waitForSelector('.optd');
  const nP = await pg.$$eval('.optd .optp', x => x.length);
  nP === 5 ? ok('a result lists its 5 pieces with mods and tuning') : fail('pieces ' + nP);
  await pg.click('[data-ouse]'); await pg.waitForTimeout(500);
  const filled = await pg.$$eval('#builds [data-a] .bit b', x => x.filter(e => !/Choose/.test(e.textContent)).length);
  filled === 5 && !(await pg.$eval('#modal', e => e.classList.contains('open'))) ? ok('Use this armor fills all 5 armor slots') : fail('slots filled ' + filled);
  errs.length ? fail('page errors: ' + errs.join(' | ')) : ok('desktop: no page errors');
  // phone
  const ph = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p2 = await ph.newPage(); const e2 = []; p2.on('pageerror', e => e2.push(e.message));
  await open(p2); await setT(p2, 1, 90); await p2.click('#oRun'); await p2.waitForSelector('.optsum', { timeout: 30000 });
  await p2.click('[data-or="0"]'); await p2.waitForSelector('.optd');
  const m = await p2.evaluate(() => { const box = document.querySelector('#modalBox'); const r = box.getBoundingClientRect();
    const small = [...box.querySelectorAll('.optt input, .optrun .btn, .optsort .tchip, [data-ouse]')].filter(e => e.getBoundingClientRect().height && e.getBoundingClientRect().height < 44).map(e => e.className || e.type);
    return { sheet: r.bottom >= innerHeight - 2 && r.left <= 1, over: box.scrollWidth - box.clientWidth, small }; });
  m.sheet ? ok('phone: Find armor opens as a bottom sheet') : fail('phone: not a bottom sheet');
  m.over <= 1 ? ok('phone: no sideways overflow') : fail('phone: ' + m.over + 'px too wide');
  m.small.length ? fail('phone: controls under 44px: ' + m.small.slice(0, 5).join(', ')) : ok('phone: controls are at least 44px tall');
  e2.length ? fail('phone page errors: ' + e2.join(' | ')) : ok('phone: no page errors');
  await b.close();
  fs.rmSync(path.dirname(csv), { recursive: true, force: true });
  if (fails.length) { console.log(`\n${fails.length} optimizer UI check(s) failed`); process.exit(1); }
  console.log('\noptimizer UI checks passed');
})().catch(e => { console.error(e); process.exit(1); });
