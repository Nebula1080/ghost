// Downloads every Bungie icon referenced by data/defs.json into data/raw/icons/b/ (cached; polite, 6 at a time).
// Usage: node tools/fetch-icons.mjs   (run after tools/build-defs.mjs; then tools/build-sprite.ps1)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const d = JSON.parse(fs.readFileSync(path.join(root, 'data/defs.json'), 'utf8'));
const s = new Set();
Object.values(d.pi).forEach(p => p[0] && s.add(p[0]));
d.sets.forEach(x => x.p.forEach(p => p.i && s.add(p.i)));
for (const c of Object.values(d.sub)) for (const e of Object.values(c)) { e.i && s.add(e.i); Object.values(e.s).flat().forEach(a => a.i && s.add(a.i)); }
const dir = path.join(root, 'data/raw/icons/b'); fs.mkdirSync(dir, { recursive: true });
const list = [...s].filter(t => !fs.existsSync(path.join(dir, t.replace(/\//g, '_'))));
console.log(s.size, 'icons,', list.length, 'to download');
let i = 0, fail = 0;
async function worker() {
  while (i < list.length) {
    const t = list[i++];
    try {
      const r = await fetch('https://www.bungie.net/common/destiny2_content/icons/' + t, { headers: { 'User-Agent': 'vault-sorter-icons/1.0' } });
      if (!r.ok) throw new Error(r.status);
      fs.writeFileSync(path.join(dir, t.replace(/\//g, '_')), Buffer.from(await r.arrayBuffer()));
    } catch (e) { fail++; console.log('fail', t, e.message); }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
fs.writeFileSync(path.join(root, 'data/raw/icons/list.json'), JSON.stringify([...s]));
console.log('done, failures:', fail);
