// Parses a Google Sheets "htmlview" tab into rows of cells, keeping the sheet's text formatting
// (colors, bold, italic, underline, strikethrough, line breaks) as sanitized HTML.
// Only <span style="..."> with whitelisted properties and <br> survive; everything else is dropped.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', '#34': '"' };
export const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
  if (ENT[e] !== undefined) return ENT[e];
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isNaN(n) ? m : String.fromCodePoint(n); }
  return m;
});
const escHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Keep only presentational declarations we can trust.
function cleanStyle(style, base = {}) {
  const out = {};
  for (const decl of style.split(';')) {
    const [k, ...rest] = decl.split(':'); if (!k || !rest.length) continue;
    const key = k.trim().toLowerCase(); const val = rest.join(':').trim().toLowerCase();
    if (key === 'color' && /^#[0-9a-f]{3,8}$/.test(val)) out.color = val;
    else if (key === 'font-weight' && /^(bold|normal|[1-9]00)$/.test(val)) out.b = /bold|[6-9]00/.test(val);
    else if (key === 'font-style' && /^(italic|normal)$/.test(val)) out.i = val === 'italic';
    else if (key === 'text-decoration' || key === 'text-decoration-line') { out.u = /underline/.test(val); out.s = /line-through/.test(val); }
  }
  return { ...base, ...out };
}
function styleAttr(st) {
  const p = [];
  if (st.color) p.push('color:' + st.color);
  if (st.b) p.push('font-weight:700');
  if (st.i) p.push('font-style:italic');
  if (st.u || st.s) p.push('text-decoration:' + [st.u && 'underline', st.s && 'line-through'].filter(Boolean).join(' '));
  return p.join(';');
}

export function parseSheetHtml(html) {
  // cell base styles from the tab's CSS: .ritz .waffle .s12{...}
  const cls = {};
  for (const m of html.matchAll(/\.ritz \.waffle \.(s\d+)\{([^}]*)\}/g)) cls[m[1]] = cleanStyle(m[2]);
  const tbody = html.slice(html.indexOf('<tbody'), html.lastIndexOf('</tbody>'));
  const rows = [];
  for (const tr of tbody.split(/<tr[^>]*>/).slice(1)) {
    const cells = [];
    for (const m of tr.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)) {
      const attrs = m[1]; const inner = m[2];
      const c = (attrs.match(/class="([^"]*)"/) || [])[1] || '';
      const colspan = +((attrs.match(/colspan="(\d+)"/) || [])[1] || 1);
      const base = c.split(/\s+/).reduce((a, k) => ({ ...a, ...(cls[k] || {}) }), {});
      cells.push({ ...renderCell(inner, base), colspan });
    }
    rows.push(cells);
  }
  return rows;
}

// Shared style registry: each distinct run style becomes a short class "dN"; build-defs ships the
// list so the page can emit matching CSS. Keeps the formatted text small.
export const STYLES = [];
const styleIdx = new Map();
function styleClass(st) {
  const sa = styleAttr(st); if (!sa) return '';
  if (!styleIdx.has(sa)) { styleIdx.set(sa, STYLES.length); STYLES.push(sa); }
  return 'd' + styleIdx.get(sa);
}
function renderCell(inner, base) {
  // Walk tags: spans (styled runs), <br>, <a> (keep text), divs/imgs (drop)
  let text = '';
  const runs = []; // [class, escapedHtml]
  const stack = [base];
  const push = (cls, h) => { const last = runs[runs.length - 1]; if (last && last[0] === cls) last[1] += h; else runs.push([cls, h]); };
  const re = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi;
  for (const m of inner.matchAll(re)) {
    if (m[4] !== undefined) {
      const t = decode(m[4]); if (!t) continue;
      text += t; push(styleClass(stack[stack.length - 1]), escHtml(t));
      continue;
    }
    const close = m[1] === '/', tag = m[2].toLowerCase(), attrs = m[3];
    if (tag === 'br') { text += '\n'; push(runs.length ? runs[runs.length - 1][0] : '', '<br>'); continue; }
    if (tag === 'span' || tag === 'a' || tag === 'font') {
      if (close) { if (stack.length > 1) stack.pop(); }
      else { const sm = attrs.match(/style="([^"]*)"/); stack.push(cleanStyle(sm ? sm[1] : '', stack[stack.length - 1])); }
    }
  }
  const html = runs.map(([c, h]) => c ? `<span class=${c}>${h}</span>` : h).join('');
  return { text: text.replace(/ /g, ' ').trim(), html: html.replace(/^(<br>)+|(<br>)+$/g, '').replace(/(<br>){3,}/g, '<br><br>') };
}
