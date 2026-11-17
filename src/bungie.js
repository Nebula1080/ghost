// ===== Ghost: Bungie sign-in + read-only API (hosted build only; GHOST_PLAN A4/A5) =====
// Public OAuth client: authorize in the visible browser (never an iframe), exchange the code with client_id only,
// keep the ~1 hour access token in sessionStorage (never localStorage, cookies, IndexedDB or the SW cache).
// Security rules (GHOST_PLAN → Security, plus the 2026-11-16 scope decision):
//  - state: 32 random bytes, sessionStorage, single use, compared exactly; mismatch is rejected.
//  - the app is registered with move/equip permission, but this module can ONLY send the token exchange POST and
//    the read-only GETs listed in READ_PATHS. `allowed()` enforces it and test/security.test.js fails if a write
//    endpoint (transfer, equip, lock, pull, insert, apply, action) ever appears here.
//  - tokens, codes and the API key never go into messages, logs or toasts.
// Pure enough to unit-test in Node: browser objects are passed in to create().
const Bungie = (() => {
  const ORIGIN = 'https://www.bungie.net';
  const AUTH_URL = ORIGIN + '/en/OAuth/Authorize';
  const TOKEN_PATH = '/Platform/App/OAuth/token/';
  const READ_PATHS = [
    /^\/Platform\/User\/GetMembershipsForCurrentUser\/$/,
    /^\/Platform\/Destiny2\/[1-6]\/Profile\/\d{1,20}\/$/,
  ];
  // profiles, profile inventory, characters, character inventories + equipment, instances, stats, sockets, reusable plugs
  const PROFILE_COMPONENTS = '100,102,200,201,205,300,304,305,310';
  const K_STATE = 'gh:oauth:state', K_TOKEN = 'gh:oauth:token';

  function allowed(method, path) {
    if (method === 'POST') return path === TOKEN_PATH;
    if (method === 'GET') return READ_PATHS.some(r => r.test(path));
    return false;
  }

  class BungieError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

  function create({ key, client, fetch, store, random, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
    const ok = typeof key === 'string' && /^[0-9a-f]{32}$/i.test(key) && /^\d{1,12}$/.test(String(client ?? ''));
    const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

    function authorizeUrl() {
      if (!ok) throw new BungieError('Bungie sign-in isn’t set up on this copy of Ghost.', 'config');
      const state = hex(random(32));
      store.setItem(K_STATE, state);
      return `${AUTH_URL}?client_id=${encodeURIComponent(client)}&response_type=code&state=${state}`;
    }

    // returns null when the URL is not a sign-in callback
    async function handleCallback(search) {
      const q = new URLSearchParams(search || '');
      if (!q.has('code') && !q.has('state') && !q.has('error')) return null;
      const expected = store.getItem(K_STATE); store.removeItem(K_STATE); // single use, whatever happens next
      if (q.has('error')) throw new BungieError('Bungie sign-in was cancelled or refused.', 'denied');
      const code = q.get('code') || '', state = q.get('state') || '';
      if (!expected || state.length !== expected.length || state !== expected) throw new BungieError('Sign-in was rejected because its security check didn’t match. Please sign in again.', 'state');
      if (!/^[A-Za-z0-9._~-]{1,512}$/.test(code)) throw new BungieError('Bungie sent back an unexpected sign-in code.', 'code');
      if (!ok) throw new BungieError('Bungie sign-in isn’t set up on this copy of Ghost.', 'config');
      if (!allowed('POST', TOKEN_PATH)) throw new BungieError('Blocked request.', 'guard');
      const res = await fetch(ORIGIN + TOKEN_PATH, {
        method: 'POST', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-API-Key': key },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: String(client) }).toString(),
      });
      if (!res.ok) throw new BungieError(`Bungie didn’t accept the sign-in (HTTP ${res.status}). Please try again.`, 'token');
      const j = await res.json().catch(() => null);
      const t = j?.access_token, exp = Number(j?.expires_in), mid = String(j?.membership_id ?? '');
      if (typeof t !== 'string' || !t || t.length > 4096 || !(exp > 0)) throw new BungieError('Bungie sent back an unexpected sign-in response.', 'token');
      store.setItem(K_TOKEN, JSON.stringify({ t, exp: now() + Math.min(exp, 86400) * 1000 - 60000, mid: /^\d{1,20}$/.test(mid) ? mid : '' }));
      return true;
    }

    function session() {
      try { const s = JSON.parse(store.getItem(K_TOKEN) || 'null'); if (s && typeof s.t === 'string' && s.exp > now()) return s; } catch {}
      return null;
    }
    const signedIn = () => !!session();
    const signOut = () => { store.removeItem(K_TOKEN); store.removeItem(K_STATE); };

    async function get(path, query = '') {
      if (!allowed('GET', path)) throw new BungieError('Blocked request.', 'guard');
      const s = session(); if (!s) throw new BungieError('Your Bungie sign-in has expired. Sign in again to refresh your vault.', 'auth');
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(ORIGIN + path + (query ? '?' + query : ''), {
          method: 'GET', credentials: 'omit', cache: 'no-store',
          headers: { 'X-API-Key': key, Authorization: 'Bearer ' + s.t },
        });
        if (res.status === 401) { signOut(); throw new BungieError('Your Bungie sign-in has expired. Sign in again to refresh your vault.', 'auth'); }
        const j = await res.json().catch(() => null);
        const throttle = Math.min(Number(j?.ThrottleSeconds) || 0, 30);
        if (res.status === 429 || j?.ErrorStatus === 'PerEndpointRequestThrottleExceeded' || j?.ErrorStatus === 'ThrottleLimitExceeded') {
          if (attempt === 2) break; await sleep((throttle || 2 ** attempt) * 1000); continue;
        }
        if (!res.ok || !j || j.ErrorCode !== 1) {
          if (j?.ErrorStatus === 'SystemDisabled') throw new BungieError('Bungie’s API is down for maintenance. Try again later.', 'down');
          throw new BungieError(`Bungie returned an error (HTTP ${res.status}). Try again in a moment.`, 'api');
        }
        if (throttle) await sleep(throttle * 1000);
        return j.Response;
      }
      throw new BungieError('Bungie is busy right now. Try again in a minute.', 'throttle');
    }

    // Destiny accounts on this Bungie.net account; with cross save only the active platform counts
    async function memberships() {
      const r = await get('/Platform/User/GetMembershipsForCurrentUser/');
      const list = (Array.isArray(r?.destinyMemberships) ? r.destinyMemberships : [])
        .map(m => ({ type: Number(m?.membershipType), id: String(m?.membershipId ?? ''), name: String(m?.bungieGlobalDisplayName || m?.displayName || 'Guardian').slice(0, 64), cross: Number(m?.crossSaveOverride) || 0 }))
        .filter(m => m.type >= 1 && m.type <= 6 && /^\d{1,20}$/.test(m.id));
      const live = list.filter(m => !m.cross || m.cross === m.type);
      return { list: live.length ? live : list, primary: String(r?.primaryMembershipId ?? '') };
    }
    const profile = (type, id) => {
      if (!(Number(type) >= 1 && Number(type) <= 6) || !/^\d{1,20}$/.test(String(id))) throw new BungieError('Unknown Destiny account.', 'guard');
      return get(`/Platform/Destiny2/${Number(type)}/Profile/${id}/`, 'components=' + PROFILE_COMPONENTS);
    };

    return { available: ok, authorizeUrl, handleCallback, signedIn, signOut, memberships, profile };
  }
  return { create, allowed, BungieError, TOKEN_PATH, READ_PATHS, PROFILE_COMPONENTS, K_STATE, K_TOKEN };
})();
if (typeof module !== 'undefined') module.exports = Bungie;
