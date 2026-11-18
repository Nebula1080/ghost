// Ratings UI (part of `npm run e2e`): cards and the item panel show Ghost's rating with its parts and the Aegis
// credit; the Perk ratings page opens from the desktop rail and the phone ⋯ menu, a personal tier changes the
// score and survives a reload, weights rescale, reset works; phones get whole-page scrolling, no sideways
// overflow and 44px targets; hostile stored ratings render as text.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const exe = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const fx = ['sample-weapons.csv', 'sample-armor.csv'].map(f => path.join(__dirname, 'fixtures', f));
const url = 'file://' + path.join(root, 'dist/index.html').split(path.sep).join('/');
const fails = []; const ok = m => console.log('  ok  ', m); const fail = m => { fails.push(m); console.log('  FAIL', m); };
const reed = pg => pg.evaluate(() => { const c = [...document.querySelectorAll('#panes .card')].find(x => /Reed's Regret/.test(x.textContent)); return c ? c.querySelector('.rate')?.textContent.trim() : null; });
const openReed = async pg => {
  const h = await pg.evaluateHandle(() => [...document.querySelectorAll('#panes .card')].find(x => /Reed's Regret/.test(x.textContent)));
  await h.asElement().click(); await pg.waitForTimeout(700);
};
(async () => {
  const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
  // ---------- desktop ----------
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(url); await pg.waitForTimeout(400); await pg.evaluate(() => document.getElementById('intro')?.remove());
  await pg.setInputFiles('#file', fx); await pg.waitForTimeout(900);
  const card0 = await reed(pg);
  /^\d+/.test(card0 || '') ? ok('cards show the rating (' + card0 + ')') : fail('card rating missing: ' + card0);
  // the total on a card opens the breakdown, not the item panel
  await pg.evaluate(() => [...document.querySelectorAll('#panes .card')].find(x => /Reed's Regret/.test(x.textContent)).querySelector('.rate[data-rbd]').click());
  await pg.waitForTimeout(400);
  const bd = await pg.evaluate(() => ({ modal: document.querySelector('#modal').classList.contains('open') && !!document.querySelector('#modalBox .rbd .rtot'), drawer: document.querySelector('#drawer').classList.contains('open'), parts: document.querySelectorAll('#modalBox .rwhy').length }));
  bd.modal && !bd.drawer && bd.parts === 3 ? ok('clicking the card rating opens the breakdown panel only') : fail('card rating click ' + JSON.stringify(bd));
  await pg.click('#modal [data-close]'); await pg.waitForTimeout(200);
  await openReed(pg);
  await pg.click('#drawer .ring[data-rbd]'); await pg.waitForTimeout(300);
  (await pg.$('#modal.open .rbd')) ? ok('the item panel ring opens the breakdown') : fail('ring click');
  await pg.click('#modal [data-close]'); await pg.waitForTimeout(200);
  const panel = await pg.evaluate(() => {
    const s = document.querySelector('#drawer .rsec'); if (!s) return null;
    return { boxes: [...s.querySelectorAll('.rbox .rn')].map(x => x.textContent), parts: [...s.querySelectorAll('.rwhy > summary')].map(x => x.textContent), aegis: s.querySelector('.rwae')?.textContent || '', ring: document.querySelector('#drawer .ring text')?.textContent };
  });
  panel && panel.boxes.length === 3 && panel.boxes.every(x => /^\d+$/.test(x)) ? ok('item panel shows PvE, PvP and rating') : fail('item panel numbers ' + JSON.stringify(panel));
  panel && panel.parts.length === 3 && /Perk/.test(panel.parts[0]) && /wish list/.test(panel.parts[1]) && /Aegis’s Endgame Analysis/.test(panel.parts[2]) ? ok('item panel lists the three parts') : fail('parts ' + JSON.stringify(panel?.parts));
  /Tier [SABCDEF] · Aegis’s Endgame Analysis/.test(panel?.aegis || '') ? ok('Aegis tier is shown with his credit') : fail('Aegis credit ' + panel?.aegis);
  await pg.click('#drawer [data-open-ratings]'); await pg.waitForTimeout(500);
  (await pg.$('#ratings.open .rrow')) ? ok('"Adjust perk ratings" opens the Perk ratings page') : fail('ratings page did not open from the item panel');
  await pg.click('#rClose'); await pg.waitForTimeout(300);
  await pg.click('#bRatings'); await pg.waitForTimeout(500);
  (await pg.$('#ratings.open')) ? ok('rail "Perk ratings" opens the page') : fail('rail button');
  // groups by column, filters
  const groups = await pg.$$eval('#ratings .rgh', x => x.map(e => e.firstChild.textContent.trim()));
  groups.join('|') === 'Barrels / sights|Magazines / batteries|Traits|Origin traits' ? ok('weapon perks grouped by column') : fail('groups ' + groups);
  await pg.selectOption('#rEl', 'Void'); await pg.waitForTimeout(250);
  const voidRows = await pg.$$eval('#ratings .rrow .rpn', x => x.map(e => e.textContent));
  voidRows.length && voidRows.every(t => /Void only/.test(t)) ? ok('element filter shows element-specific perks') : fail('element filter ' + voidRows.slice(0, 5));
  await pg.selectOption('#rEl', ''); await pg.selectOption('#rType', 'Linear Fusion Rifle'); await pg.waitForTimeout(250);
  const count = () => pg.$$eval('#ratings .rgh small', x => x.reduce((a, e) => a + Number(e.textContent), 0));
  const nLfr = await count(); await pg.selectOption('#rType', ''); await pg.waitForTimeout(250);
  const nAll = await count();
  nLfr > 0 && nLfr < nAll ? ok(`weapon type filter (${nLfr} of ${nAll} shown)`) : fail('type filter ' + nLfr + '/' + nAll);
  await pg.click('[data-rk="a"]'); await pg.waitForTimeout(250);
  (await pg.$$eval('#ratings .rgh', x => x.map(e => e.textContent))).join('').includes('Armor archetypes') ? ok('armor perks tab') : fail('armor tab');
  await pg.click('[data-rk="w"]'); await pg.waitForTimeout(250);
  // rate Triple Tap S for PvE + PvP: Reed's Regret (equipped Triple Tap) goes up
  await pg.fill('#rq', 'triple tap'); await pg.waitForTimeout(400);
  const row = '#ratings .rrow[data-k="tripletap"]';
  await pg.selectOption(row + ' [data-pm="e"]', 'S'); await pg.waitForTimeout(200);
  await pg.selectOption(row + ' [data-pm="p"]', 'S'); await pg.waitForTimeout(700);
  const saved = await pg.evaluate(() => JSON.parse(localStorage.getItem('vs:perkRatings') || 'null'));
  saved?.p?.tripletap?.e === 'S' && saved.p.tripletap.p === 'S' ? ok('personal tier saved per profile') : fail('saved ' + JSON.stringify(saved));
  (await pg.$eval(row + ' .rsrc', e => e.textContent)) === 'Your rating' ? ok('row shows "Your rating" and a reset') : fail('row label');
  await pg.click('#rClose'); await pg.waitForTimeout(500);
  const card1 = await reed(pg);
  Number(card1) > Number(card0) ? ok(`rating follows the change (${card0} → ${card1})`) : fail(`rating did not change ${card0} → ${card1}`);
  await pg.reload(); await pg.waitForTimeout(900); await pg.evaluate(() => document.getElementById('intro')?.remove());
  (await reed(pg)) === card1 ? ok('change survives a reload') : fail('after reload ' + await reed(pg));
  // weights: perks to 0 → PvP = wish list only
  await pg.click('#bRatings'); await pg.waitForTimeout(400);
  await pg.$eval('[data-w="perks"]', e => { e.value = '0'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); }); await pg.waitForTimeout(500);
  (await pg.$eval('[data-wv="perks"]', e => e.textContent)) === '0%' ? ok('weight slider updates the share') : fail('weight label');
  await pg.click('#rClose'); await pg.waitForTimeout(400); await openReed(pg);
  const why = await pg.evaluate(() => [...document.querySelectorAll('#drawer .rwhy summary small')].map(x => x.textContent));
  /^0% of PvE/.test(why[0]) ? ok('item panel shows the new weights') : fail('weights in panel ' + why);
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
  await pg.click('#bRatings'); await pg.waitForTimeout(400); await pg.click('#rwReset'); await pg.waitForTimeout(300);
  await pg.click('#rResetAll'); await pg.click('#rraYes'); await pg.waitForTimeout(700);
  const after = await pg.evaluate(() => JSON.parse(localStorage.getItem('vs:perkRatings')));
  !Object.keys(after.p).length && after.w.perks === 50 ? ok('reset weights and reset all') : fail('reset ' + JSON.stringify(after));
  // combos tab: add one
  await pg.click('[data-rt="combos"]'); await pg.waitForTimeout(300);
  await pg.fill('#rcA', 'Triple Tap'); await pg.fill('#rcB', 'Firing Line'); await pg.click('#rcAdd'); await pg.waitForTimeout(300);
  const cmb = await pg.evaluate(() => JSON.parse(localStorage.getItem('vs:perkRatings') || '{}').c || {});
  Object.keys(cmb).length === 1 || (await pg.$('[data-ck="firingline|tripletap"]')) ? ok('combo tab lists / adds combos') : fail('combo add');
  // About credits
  await pg.click('#rClose'); await pg.click('#bAbout'); await pg.waitForTimeout(200);
  const about = await pg.$eval('#modalBox', e => e.textContent);
  /Aegis’s Endgame Analysis/.test(about) && /48klocs/.test(about) && /seudonym/.test(about) ? ok('About credits Aegis and the wish-list curators') : fail('About credits');
  await pg.click('#modal [data-close]');
  // hostile perk names (from a CSV) flow into the rating parts: they must render as text
  const hostile = path.join(require('os').tmpdir(), 'ghost-ratings-hostile.csv');
  fs.writeFileSync(hostile, fs.readFileSync(fx[0], 'utf8').replace(/Firing Line/g, '<img src=x onerror=window.__y=1>'));
  await pg.setInputFiles('#file', [hostile]); await pg.waitForTimeout(900);
  const m = await pg.$('#modal.open'); if (m) await pg.click('#modal [data-close]').catch(() => {});
  await pg.evaluate(() => [...document.querySelectorAll('#panes .card')].find(x => /Reed's Regret/.test(x.textContent))?.querySelector('.rate[data-rbd]')?.click());
  await pg.waitForTimeout(400);
  const inert = await pg.evaluate(() => ({ y: window.__y, imgs: document.querySelectorAll('#modalBox img[onerror], #drawer img[onerror]').length, text: document.querySelector('#modalBox')?.textContent.includes('<img src=x') }));
  !inert.y && !inert.imgs && inert.text ? ok('hostile perk names in the breakdown stay text') : fail('breakdown renders markup ' + JSON.stringify(inert));
  await pg.click('#modal [data-close]').catch(() => {});
  errs.length ? fail('page errors: ' + errs.join(' | ')) : ok('no page errors (desktop)');
  await ctx.close();

  // ---------- phone ----------
  const pctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pp = await pctx.newPage(); const perrs = []; pp.on('pageerror', e => perrs.push(e.message));
  // hostile stored ratings: must load as data, never as markup
  await pp.goto(url); await pp.waitForTimeout(300);
  await pp.evaluate(() => localStorage.setItem('vs:perkRatings', JSON.stringify({ p: { tripletap: { e: '<img src=x onerror=window.__x=1>' }, 'x"><img': { e: 'S' } }, c: { 'a|b': { a: '<svg onload=window.__x=1>', b: 'b', e: 'S' } }, w: { perks: '<b>' } })));
  await pp.reload(); await pp.waitForTimeout(400); await pp.evaluate(() => document.getElementById('intro')?.remove());
  await pp.setInputFiles('#file', fx); await pp.waitForTimeout(900);
  await pp.click('#bMenu'); await pp.waitForTimeout(200); await pp.click('#mRatings'); await pp.waitForTimeout(600);
  (await pp.$('#ratings.open .rrow')) ? ok('phone ⋯ menu opens Perk ratings') : fail('phone menu');
  const lay = await pp.evaluate(() => {
    const v = document.querySelector('#ratings'); const w = document.documentElement.clientWidth;
    const small = [...v.querySelectorAll('.rrow select, .rrow button, #rq, #rType, #rEl, [data-rk], [data-rt], #rClose, .rw input')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 43.5).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().height));
    const wide = [...v.querySelectorAll('*')].filter(e => e.offsetParent && e.getBoundingClientRect().right > w + 1).map(e => e.tagName + '.' + e.className).slice(0, 5);
    const sc = v.scrollHeight > v.clientHeight && getComputedStyle(v).overflowY !== 'hidden';
    const fixed = [...v.querySelectorAll('*')].filter(e => getComputedStyle(e).position === 'fixed' || getComputedStyle(e).position === 'sticky').length;
    return { small, wide, sc, fixed, w: v.scrollWidth <= v.clientWidth + 1 };
  });
  !lay.small.length ? ok('phone: 44px targets') : fail('phone small targets ' + lay.small.slice(0, 6));
  !lay.wide.length && lay.w ? ok('phone: no sideways overflow') : fail('phone overflow ' + lay.wide);
  lay.sc && !lay.fixed ? ok('phone: the page scrolls as one, nothing fixed over content') : fail('phone scroll ' + JSON.stringify(lay));
  const xss = await pp.evaluate(() => ({ x: window.__x, imgs: document.querySelectorAll('#ratings img[onerror], #ratings svg[onload]').length }));
  !xss.x && !xss.imgs ? ok('hostile stored ratings are dropped / inert') : fail('xss ' + JSON.stringify(xss));
  await pp.fill('#rq', 'triple tap'); await pp.waitForTimeout(400);
  await pp.selectOption('#ratings .rrow[data-k="tripletap"] [data-pm="p"]', 'F'); await pp.waitForTimeout(500);
  await pp.click('#rClose'); await pp.waitForTimeout(400);
  await pp.evaluate(() => [...document.querySelectorAll('#panes .card')].find(x => /Reed's Regret/.test(x.textContent))?.scrollIntoView());
  await openReed(pp);
  await pp.keyboard.press('Escape'); await pp.waitForTimeout(300);
  await pp.evaluate(() => [...document.querySelectorAll('#panes .card')].find(x => /Reed's Regret/.test(x.textContent)).querySelector('.rate[data-rbd]')?.scrollIntoView({ block: 'center' }));
  const rb = await pp.evaluate(() => { const r = [...document.querySelectorAll('#panes .card')].find(x => /Reed's Regret/.test(x.textContent)).querySelector('.rate[data-rbd]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await pp.touchscreen.tap(rb[0], rb[1]); await pp.waitForTimeout(500);
  const psheet = await pp.evaluate(() => { const b = document.querySelector('#modalBox'); const r = b.getBoundingClientRect(); return { open: document.querySelector('#modal').classList.contains('open') && !!b.querySelector('.rbd'), bottom: Math.round(innerHeight - r.bottom), drawer: document.querySelector('#drawer').classList.contains('open') }; });
  psheet.open && !psheet.drawer && psheet.bottom <= 2 ? ok('phone: tapping the rating opens the breakdown as a bottom sheet') : fail('phone breakdown ' + JSON.stringify(psheet));
  await pp.click('#modal [data-close]'); await pp.waitForTimeout(300);
  await openReed(pp);
  const pv = await pp.evaluate(() => { const s = document.querySelector('#drawer .rsec'); return s ? { n: s.querySelectorAll('.rbox').length, w: s.getBoundingClientRect().width, vw: innerWidth } : null; });
  pv && pv.n === 3 && pv.w <= pv.vw ? ok('phone: item panel shows the rating parts within the screen') : fail('phone panel ' + JSON.stringify(pv));
  perrs.length ? fail('page errors (phone): ' + perrs.join(' | ')) : ok('no page errors (phone)');
  await b.close();
  console.log(fails.length ? `${fails.length} ratings UI checks failed` : 'ratings UI checks passed');
  if (fails.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
