// Builds data/item-art.json for the hosted build: weapon/armor hash -> [icon, watermark, screenshot] paths on
// www.bungie.net (stored without the common prefix). The claude.ai artifact can't load bungie.net images, so
// build.py only inlines this map into the hosted target. Needs the manifest cache from tools/build-defs.mjs.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const I = JSON.parse(fs.readFileSync(root + 'data/raw/items.json', 'utf8'));
const P = '/common/destiny2_content/';
const strip = p => (p && p.startsWith(P)) ? p.slice(P.length) : '';
// compact: icon = 32-hex name (".jpg" implied unless the entry says png), watermarks via a shared table,
// screenshot flag 1 when it is the usual screenshots/<hash>.jpg
const out = {}, wms = [], wmi = {};
let n = 0;
for (const [h, d] of Object.entries(I)) {
  if (d.itemType !== 3 && d.itemType !== 2) continue;            // weapons, armor
  if (!d.displayProperties?.icon || d.redacted) continue;
  const icon = strip(d.displayProperties.icon), wm = strip(d.iconWatermark || d.quality?.displayVersionWatermarkIcons?.[0] || ''), shot = strip(d.screenshot || '');
  if (!/^icons\/[0-9a-f]+\.(jpg|png)$/.test(icon)) continue;
  const w = /^icons\//.test(wm) ? wm.slice(6) : '';
  if (w && !(w in wmi)) { wmi[w] = wms.length; wms.push(w); }
  const s = shot === `screenshots/${h}.jpg` ? 1 : (/^screenshots\//.test(shot) ? shot.slice(12) : 0);
  out[h] = [icon.slice(6).replace(/\.jpg$/, ''), w ? wmi[w] : -1, s];
  n++;
}
fs.writeFileSync(root + 'data/item-art.json', JSON.stringify({ wm: wms, i: out }));
console.log('item art:', n, 'items,', Math.round(fs.statSync(root + 'data/item-art.json').size / 1024), 'KB');
