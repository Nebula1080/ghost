// Run inside a light.gg tab (same origin). Usage:
//   await lgScrape([["1399243961","Reed's Regret"], ...], {delay: 900})
//   then read window.lgOut (hash -> {n,pve,pvp,c}) in slices.
window.lgExtract = function (doc) {
  const c = [...doc.querySelectorAll('#community-average ul.sockets')].map(ul =>
    [...ul.querySelectorAll('li')].map(li => {
      const img = li.querySelector('img'); const sp = li.querySelector('.relative-percent-container span');
      return [img?.alt, parseFloat(li.querySelector('.percent')?.textContent), sp ? Math.round(parseFloat(sp.style.width)) : null];
    }).filter(x => x[0] && !isNaN(x[1])).map(([n, pct, rel]) => [n, rel, pct])
  ).filter(col => col.length);
  const r = Object.fromEntries([...doc.querySelectorAll('img[alt=PVE],img[alt=PVP]')].map(i => [i.alt.toLowerCase(), parseFloat(i.parentElement.querySelector('span')?.textContent) || null]));
  return { pve: r.pve ?? null, pvp: r.pvp ?? null, c };
};
window.lgScrape = async function (list, { delay = 900 } = {}) {
  window.lgOut = window.lgOut || {}; window.lgErr = window.lgErr || {}; window.lgProgress = 0;
  for (const [hash, name] of list) {
    if (window.lgOut[hash] || window.lgStop) { window.lgProgress++; continue; }
    try {
      const res = await fetch(`/db/items/${hash}/`);
      if (res.status === 429) { await new Promise(r => setTimeout(r, 15000)); continue; }
      if (!res.ok) { window.lgErr[hash] = res.status; }
      else {
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const x = lgExtract(doc);
        if (x.c.length || x.pve != null) window.lgOut[hash] = { n: name, ...x };
        else window.lgErr[hash] = 'no data';
      }
    } catch (e) { window.lgErr[hash] = String(e); }
    window.lgProgress++;
    await new Promise(r => setTimeout(r, delay));
  }
  return { done: Object.keys(window.lgOut).length, errors: Object.keys(window.lgErr).length };
};
