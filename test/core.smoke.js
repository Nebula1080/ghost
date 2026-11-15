const C=require('../src/core.js'),fs=require('fs');
let defs=null; try { defs=JSON.parse(fs.readFileSync(__dirname+'/../data/defs.json','utf8')); } catch {}
const {kind,items}=C.parseDimCsv(fs.readFileSync(__dirname+'/fixtures/sample-weapons.csv','utf8'));
C.applyDefs(items, defs);
console.log(kind, items.length, items[1].id, items[1].perks.map(p=>p.n+(p.s?'*':'')).join('|'), items[0].stats, items[0].notes);
console.log('breakers', items.map(i=>[i.name,i.breaker||'-',i.ammo,i.crafted]));
const R=C.prepRatings({"1399243961":{n:"Reed",pve:4.8,pvp:3.7,c:[[["Arrowhead Brake",100,20.6],["Corkscrew Rifling",60,12.5]],[["Accelerated Coils",100,30],["Liquid Coils",40,12]],[["Triple Tap",100,39.6],["Surplus",26,10.2]],[["Firing Line",100,40],["Precision Instrument",50,20]]]}});
items.forEach(i=>C.rateItem(i,R));
console.log(items.map(i=>[i.name,i.rating,i.pve]));
const ctx=C.buildCtx(items,null,defs);
for (const q of ['is:dupe','perk:"triple tap" or perk:vorpal','stat:range>=55 -tag:junk','tier>=3','rating<70','frame:precision is:stasis','tag:none','notes:pvp','is:exotic power:>=555','handcannon','sort:power is:weapon','stat:rpm:=120',
  'is:breaker','breaker:stagger','is:shieldpiercing','is:disruption','breaker:overload','breaker:none','ammo:heavy','is:special','desc:"reload"','is:crafted']) {
  const p=C.parseQuery(q); const r=C.runQuery(p,items,ctx);
  console.log(q.padEnd(34),'→',[...r].map(([id,h])=>id.slice(-1)+':'+[...h].join(',')).join('  '), p.sort||'');
}
console.log('sort rating', C.sortItems([...items],'rating','desc').map(i=>i.id.slice(-1)));
console.log('sort ammo asc', C.sortItems([...items],'ammo','asc').map(i=>i.name+':'+i.ammo));
console.log('sort breaker asc', C.sortItems([...items],'breaker','asc').map(i=>i.name+':'+(i.breaker||'-')));
console.log('group breaker', items.map(i=>C.groupKey(i,'breaker')), C.groupOrder('ammo','Heavy'));
console.log(C.toCSV(['Id','Hash','Tag','Notes'],[{Id:'1',Hash:'2',Tag:'keep',Notes:'a, "b"'}]));
