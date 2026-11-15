// Exact-value secret check (complements gitleaks): fails if the real Bungie API key or client_id from
// config/local.json (gitignored) or from the BUNGIE_API_KEY / BUNGIE_CLIENT_ID environment variables
// appears in any file that git would commit. Never prints the values.
//   node tools/check-secrets.mjs            -> checks staged files (pre-commit)
//   node tools/check-secrets.mjs --all      -> checks every tracked + untracked, not-ignored file
//   node tools/check-secrets.mjs --dir dist -> checks a build folder (artifact build must never contain the key)
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const secrets = [];
try {
  if (existsSync('config/local.json')) {
    const c = JSON.parse(readFileSync('config/local.json', 'utf8'));
    for (const k of ['bungieApiKey', 'apiKey', 'BUNGIE_API_KEY']) if (typeof c[k] === 'string' && c[k].length >= 16) secrets.push(['API key', c[k]]);
    for (const k of ['bungieClientId', 'clientId', 'BUNGIE_CLIENT_ID']) if (c[k] != null && String(c[k]).length >= 4) secrets.push(['client_id', String(c[k])]);
  }
} catch { console.error('check-secrets: config/local.json is not valid JSON'); process.exit(1); }
if (process.env.BUNGIE_API_KEY) secrets.push(['API key', process.env.BUNGIE_API_KEY]);
// client_id is not a secret in a public OAuth client (it appears in the sign-in URL), but it must still not be
// committed: it is injected at build time like the key. It is short, so match it only as a whole token.
if (process.env.BUNGIE_CLIENT_ID) secrets.push(['client_id', process.env.BUNGIE_CLIENT_ID]);
if (!secrets.length) { console.log('check-secrets: no local key configured, nothing to compare (gitleaks still runs)'); process.exit(0); }

const git = a => execFileSync('git', a, { encoding: 'utf8' }).split('\n').filter(Boolean);
let files;
const di = args.indexOf('--dir');
if (di >= 0) {
  const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  files = walk(args[di + 1]);
} else if (args.includes('--all')) files = git(['ls-files', '--cached', '--others', '--exclude-standard']);
else files = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);

let bad = 0;
for (const f of files) {
  if (!existsSync(f) || statSync(f).size > 50 * 1024 * 1024) continue;
  const s = readFileSync(f, 'utf8');
  for (const [label, v] of secrets) {
    const re = new RegExp('(^|[^0-9A-Za-z])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^0-9A-Za-z])');
    if (re.test(s)) { console.error(`check-secrets: the real Bungie ${label} appears in ${f}`); bad++; }
  }
}
if (bad) { console.error('check-secrets: FAILED. Remove the value; it belongs only in config/local.json or a GitHub Actions secret.'); process.exit(1); }
console.log(`check-secrets: ok (${files.length} files, ${secrets.length} values)`);
