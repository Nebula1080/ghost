# Ghost: build plan (visual overhaul + hosted copy with Bungie sign-in)

Written 2026-11-15 on claude.ai with the user. Design source: the doc "Ghost (formerly Vault Sorter): Visual Overhaul Themes & Rated Design Ideas" (https://claude.ai/artifact/TeWLXp3gdSdxVjfGBYhjLR). Read `CLAUDE.md` and `HANDOFF.md` first. This plan **replaces** the HANDOFF decision "There's no Bungie API OAuth app": the user has now chosen to add one, for the hosted copy only.

## Decisions (made by the user, don't relitigate)
- **Name:** the app is now **Ghost**. Rename the visible strings only: `<title>`, header brand, manifest `name`/`short_name`, Help text. **Do not** rename the `vs:` localStorage keys or the db paths. Existing data must keep loading.
- **Two builds from one source:**
  - **Artifact build:** the claude.ai copy stays for the user, working as it does today (CSV in, CSV out, db persistence, sprite sheet). It has no Bungie API code, because the artifact's CSP blocks bungie.net.
  - **Hosted build:** on **GitHub Pages** for the user and a few friends. It adds "Sign in with Bungie", loads inventory from the API, and keeps the DIM CSV drop for tags/notes.
- **Look:** **Tower Terminal** is the base (editorial and infographic style). **Elemental Glow** is used on item cards. **Sigil Minimal** is used for navigation, empty states and loading.
- **Accent:** **Tower amber** when no element applies.
- **Themes:** dark (default) plus an optional light mode, **Bone & Sepia**.
- **Gilded Deco:** only on *selected* exotics, and the user hasn't picked them yet, so build it behind a list (`GILT_EXOTICS = []`, keyed by item hash) and ask. Exotics with a strong design of their own get a treatment based on that design instead. Don't invent per-exotic designs; ask the user which ones.
- **Motion:** copy the bray.tech motion measured on its Character, Dresstiny browse and Maps pages (table below).
- **Non-commercial, always:** no ads, donations, fees or paid tiers. Add an **About** screen with Bungie's required notice and a line saying "Ghost is not affiliated with or endorsed by Bungie."
- **Art:** the user reports that **every artist whose work is in `UI Inspo/` has given permission** for it to be used. All of them, plus Bungie, are credited in the About screen.
  - The UI chrome is still original CSS/SVG. Inspo images may be used as imagery, for example loading-screen or view-header backgrounds.
  - Ask the user which images go where, and for each artist's credit exactly as they want it: name, handle and link. **Don't guess credits from filenames**; many files are named `download (N)`. `UI Inspo/_image-index.csv` maps numbers to files.
  - Convert the chosen images to WebP, size them for their slot, and lazy-load them.
  - Ask whether they ship in the claude.ai artifact build too, or only in the hosted build.
- **Security is top priority.** Follow the Security section below strictly. A step isn't done while any security check fails.
- **Never assume:** ask the user whenever something isn't covered here.

## Security (strict; it applies to every step)
Treat every rule here as a release blocker. If a rule conflicts with a feature, stop and ask the user. Never weaken a rule to make something work.

**Secrets and accounts**
- The Bungie API key and client_id are never committed, logged or pasted into issues or commits.
  - The key lives only in a GitHub Actions secret, injected at build time.
  - Locally it lives in a gitignored `config/local.json`.
- Turn on GitHub secret scanning and push protection for the repo. Add a `gitleaks` (or equivalent) check to CI and as a pre-commit hook.
- `.gitignore` must cover `private/`, `*.csv`, `config/local.json`, `.env*` and the user's real vault exports.
- Ask the user before creating repos, changing repo settings, adding secrets, registering apps, or publishing anything. The user enters credentials themselves; never handle their passwords.

**OAuth and tokens (hosted build)**
- **`state`:** 32+ random bytes from `crypto.getRandomValues`, stored in `sessionStorage`, single use, compared exactly on callback. Reject on mismatch and show a clear error.
- **Callback URL:** after the code exchange, remove `code` and `state` from the address bar with `history.replaceState`.
- **Token storage:** the access token lives in memory plus `sessionStorage` only, never in `localStorage`, IndexedDB, cookies or the service worker cache. Clear it on sign-out and on a 401.
- **Scopes:** ~~request read-only scopes only~~ **Changed with the user 2026-11-16:** the Bungie app ("Ghost Buddy") keeps move/equip permission for a future build/loadout feature. Until such a feature is approved, Ghost's code may only send the token exchange and read-only GETs: `Bungie.allowed()` in `src/bungie.js` enforces it, and `test/security.test.js` fails if any write endpoint (transfer, equip, lock, postmaster, socket insert, actions) appears in `bungie.js` or is allowed.
- **Key in the hosted page:** **Decided with the user 2026-11-16:** a public client needs the API key and client_id in the browser, so the hosted build carries them (injected from the Actions secrets at deploy, origin-locked by Bungie). They stay out of the repo, logs and the artifact build (`check-secrets --dir dist` in CI and deploy).
- **Logging:** never put tokens, codes or the API key in console output, error messages or toasts.
- **Throttling:** honor `ThrottleSeconds` and HTTP 429 with backoff, and never retry-storm.

**Untrusted data and XSS.** Everything from the Bungie API, DIM CSVs, light.gg, Clarity and the Compendium is untrusted input.
- Escape on output: keep and extend the existing `esc()`, and audit every `innerHTML` and template string.
- Clarity and Compendium HTML is rendered as markup. Sanitize it with a strict allowlist of the tags, classes and attributes they actually use; drop event handlers, `style` URLs, `javascript:` and `data:` URLs. Either inline a vetted sanitizer with a pinned version and hash, or write a tested allowlist.
- No `eval`, `new Function`, string `setTimeout`, or dynamic `<script>`.
- **CSV import:** cap file size and row count, and reject malformed input cleanly.
- **CSV export:** keep the formula-injection guard, prefixing `= + - @` values with `'`.

**Content Security Policy (hosted build)**
- Put a strict CSP in a `<meta http-equiv>` tag. GitHub Pages can't set headers.
- Required directives:
  - `default-src 'none'`
  - `script-src` with **sha256 hashes generated by `build.py`** (no `'unsafe-inline'`, no `'unsafe-eval'`)
  - `connect-src 'self' https://www.bungie.net`
  - `img-src 'self' data: https://www.bungie.net`
  - `style-src 'self'` plus hashes, or `'unsafe-inline'` only if the inline `style=""` variables make it unavoidable. Document why if so.
  - `font-src 'self' data:`
  - `manifest-src 'self'`
  - `worker-src 'self'`
  - `base-uri 'none'`
  - `form-action 'none'`
  - `object-src 'none'`
- Also add `<meta name="referrer" content="no-referrer">`.
- A meta CSP can't set `frame-ancestors`, so the page refuses to run sign-in when `window.top !== window.self`.
- Zero CSP violations in the console is a test requirement.

**Service worker.** Cache only same-origin static build files, with a versioned cache name. Never cache bungie.net API responses or anything with an `Authorization` header. Delete old caches on activate.

**Supply chain and CI**
- No runtime third-party scripts or CDNs; everything is inlined at build time.
- Commit the lockfile. Use `npm ci` in CI, and run `npm audit --audit-level=high` as a failing check. Turn on Dependabot.
- Pin GitHub Actions to full commit SHAs. Give each workflow minimum permissions (`contents: read`, plus `pages: write` and `id-token: write` only on the deploy job).
- Enforce HTTPS in the Pages settings, and protect `main` so changes go through a PR with checks passing.

**Privacy**
- No analytics, trackers or backend. Each friend's vault and tokens stay in their own browser.
- The About screen says what's stored locally and how to clear it, and offers a "Delete my data" button.

**Security gates (run before every commit that touches code, and before every deploy)**
1. `npm test` and `npm run e2e`, plus new security tests:
   - XSS payloads in item names, notes, perk text and CSV cells render as inert text
   - a mismatched OAuth `state` is rejected
   - no token reaches `localStorage` or the SW cache
   - the CSP produces no violations
   - export formula injection is blocked
2. The secret scan finds nothing, and `npm audit` shows no high or critical issues.
3. A full security review of the diff, using Claude Code's `/security-review` if available, or a manual checklist pass over this section. Fix every high or medium finding before moving on. Report low findings to the user.
4. Tell the user what was checked and the results before deploying.

## Track V: visual overhaul (both builds)

**V1. Tokens and themes.** Replace the theme block in `src/app.html` (`/* ===== theme: flat, squared, grayscale panels … */`, around line 233) with tokens on `:root[data-theme=dark]` and `:root[data-theme=light]`. Add a theme toggle in Settings/⋯, remembered in `vs:theme`. The default follows `prefers-color-scheme`. Starting values (tune them by eye, and keep text contrast at AA or better):
- Dark: `--bg #0b0e14`, `--panel #121722`, `--panel2 #18202d`, `--line #263042`, `--text #e8ebf1`, `--dim #8d97ab`
- Light (Bone & Sepia): `--bg #ece6da`, `--panel #f6f2ea`, `--panel2 #efe8dc`, `--line #cfc6b5`, `--text #1c1b19`, `--dim #5d574c`
- `--accent` (Tower amber) `#e8a33d`. Keep the existing element, rarity and keep/trash variables, and check that each element color still reads on the light background.

**V2. Type and layout (Tower Terminal).**
- **View title:** each view gets a large light-weight title (about 28–32px, weight 300). Underneath, a subtitle in letter-spaced small caps with live stats, e.g. `VAULT · 640 WEAPONS · 318 ARMOR`.
- **Pane title:** spaced serif caps between two hairline rules, with the query shown below it in mono/dim.
  - Fonts: the artifact's CSP blocks most font hosts. Use a system serif stack, or embed a small base64 WOFF2 subset.
  - Check the CSP before choosing either.
- **Labels and dividers:** small uppercase labels at 11px with 0.14em letter spacing. Hairline dividers throughout.

**V3. Components.**
1. **Element edge glow on cards:** a 2px left edge plus a soft outer glow in the item's element color. Hits highlighted for a query take a tint of that color.
2. **Rating ring:** a 0–100 hairline circular meter replaces the rating number on cards, in the drawer and in Compare.
3. **Perk columns in the drawer:** labeled column heads (BARREL, MAGAZINE, TRAIT, TRAIT, ORIGIN), with thin dividers.
4. **Clean up:** a green or red edge glow plus a small stamp when you keep or trash an item.
5. **Original sigils:** hairline geometric SVG sigils for Vault, Clean up, Compare and Subclasses, used in the header nav and the phone tab bar. Don't copy Bungie glyphs.
6. **Sigil empty and loading states:** a triangle inside a circle that draws itself, with one line of guidance. The loading screen puts the Ghost sigil over a Tower amber radial glow, with a progress bar and a status line.
7. **Gilt arched frame** on exotics listed in `GILT_EXOTICS` (empty until the user picks).
8. **Optional background:** a subtle CSS-only starfield/nebula gradient. Turn it off on phones if it costs frames.

**V4. Motion (bray.tech, measured 2026-11-15).** All of it is CSS or Web Animations. Everything sits behind `prefers-reduced-motion` plus an in-app toggle, and loops are disabled when motion is reduced.

| Motion | Spec | Use |
| --- | --- | --- |
| Rise and fade on enter | From `opacity:0; translateY(16px)` to rest, about 500ms ease-out; sections start 100ms apart | View switch, pane add, query re-run |
| Card stagger | Same rise and fade per card, about 20ms per card, capped so the pane's first screen finishes within about 1s; later cards appear without animation | Cards in a pane |
| Hover fade | `color, background-color, box-shadow` 0.25s | Tabs, chips, buttons, cards |
| Hover tooltip | A rarity-header tooltip that follows the cursor (desktop only); clicking still opens the drawer | Cards |
| Light sweep | A `background-position` sheen across the header, 4s loop (2s in tooltips) | Masterworked items' header strips; the Ghost wordmark (8s) |
| Frosted panels | `backdrop-filter: blur(10px) brightness(1.2) saturate(1.2)` on translucent panels; focused controls get a white or amber outline | Drawer, menus, dialogs |
| Idle icon motion | Icon rests, then rotates 90° in the last 12% of an 8–12s cycle; tracked items pulse every 4s | Sigil loaders; items with unexported edits |
| Toast | Scale and rise in over 0.4s with `cubic-bezier(.4,0,.2,1)`, a timer bar drains, then fades out | Export/copy confirmations |

The drawer slide (0.18s) and phone bottom sheet (0.22s) already exist. Keep them and give them the new easing.

**V5. Check.**
- Phones at 375px and 760px, light and dark themes, reduced motion, and the 40/150 lazy card rendering.
- `npm test`, `npm run e2e`, and a visual pass with screenshots.

## Track A: hosted copy with Bungie sign-in (hosted build only)

**A1. Build targets.** Add `--target artifact|hosted` to `build.py`.
- The `artifact` target produces today's output, minus nothing.
- The `hosted` target adds:
  - the Bungie module (`src/bungie.js`, inlined at a `/*__BUNGIE__*/` anchor that stays empty in the artifact build)
  - the existing manifest and service worker
  - icons loaded straight from bungie.net, so the sprite sheet becomes optional
- Runtime guard: never call bungie.net when running inside claude.ai.

**A2. GitHub Pages deploy.** Ask the user for their GitHub username and the repo name.
- If needed, create the repo with the user's go-ahead.
- Add a GitHub Actions workflow that runs `python build.py --target hosted` and publishes `dist-hosted/` to Pages.
- The site is `https://<user>.github.io/<repo>/`.

**A3. Bungie application (the user does this; give them exact steps).** The user registers at https://www.bungie.net/en/Application with these settings:
- OAuth client type: **Public**
- Redirect URL: exactly the site URL
- Origin header: `https://<user>.github.io`, a single origin, not `*`
- Scope: read basic profile and read Destiny inventory
- Website link: the site

The user then sends you the **API key** and **OAuth client_id**.
- Don't commit the key. Store it as a GitHub Actions secret and inject it at build time.
- The key is origin-locked, but Bungie's terms still say to keep it confidential.

**A4. Sign-in flow (public client).**
- **Authorize:** "Sign in with Bungie" sends the user to `https://www.bungie.net/en/OAuth/Authorize?client_id=…&response_type=code&state=<random>`. Never open it in an iframe; Bungie requires a visible URL bar.
- **Callback:** check `state`. Then POST `grant_type=authorization_code&code=…&client_id=…` (no secret) to `https://www.bungie.net/Platform/App/OAuth/token/`.
- **Token storage:** keep the access token, which lasts about an hour with no refresh token, in `sessionStorage`. On a 401, show "Sign in again" without losing state.
- **Request rules:** every request sends `X-API-Key`. Use `https://www.bungie.net` (not `bungie.net`, which redirects and drops auth headers), and end paths with `/`.
- **Verify** all of this against https://github.com/Bungie-net/api/wiki/OAuth-Documentation before coding.

**A5. Load inventory.**
- **Fetch:**
  - Call `User/GetMembershipsForCurrentUser/` to find the Destiny membership. If there are several, let the user pick.
  - Then call `Destiny2/{type}/Profile/{id}/` with the components for profile/character inventories, equipment, characters, item instances, stats, sockets and reusable plugs.
  - Check the component numbers in the API docs.
- **Adapter:** write `Core.apiToItems()` so it returns **the same item objects the DIM CSV path produces** (same fields, ids as 19-digit strings). That way queries, highlighting, ratings, Clean up and Compare work unchanged. Map definitions with the existing `defs.json`. Fetch the live manifest only for hashes `defs.json` doesn't have, and cache it in IndexedDB.
- **Profiles:** match by membership id and reuse the existing profile system.

**A6. DIM tags/notes stay on CSV.** Bungie's API doesn't carry DIM tags or notes.
- After an API load, the user can still drop DIM CSVs. Merge only Tag/Notes by instance id onto the API items.
- Export to DIM stays exactly as it is now: changed rows only, full tag + notes.

**A7. About screen and footer.**
- Add Bungie's required copyright and trademark notice. Copy the exact wording from the end of the "Game Content Usage Rules" section of https://www.bungie.net/7/en/Legal/Terms. It begins "© Bungie, Inc. All rights reserved."
- Add the not-affiliated line.
- **Credits:**
  - every artist whose work is used, exactly as the user supplies (name, handle, link)
  - Bungie for its art and data
  - light.gg, Clarity and the Destiny Data Compendium
- Add the privacy note and the "Delete my data" button.
- Both builds show it.

**A8. Check.**
- Sign in, load the vault, merge a DIM CSV, export, sign out.
- Expired token, then re-sign-in.
- Two Bungie accounts as two profiles.
- Phone layout.
- Request volume stays reasonable: one profile call per load or refresh, with no polling.

## Order: side by side
0. Security groundwork:
   - `.gitignore`, secret scanning, the pre-commit hook and CI checks
   - the security test harness
   - an XSS/`innerHTML` audit of the existing `app.html`, with fixes
   - the hosted CSP with script hashes in `build.py`
1. V1 tokens and themes, plus the rename to Ghost
2. A1 build targets, plus A2 GitHub Pages deploy of the current app. Pass the security gates before the first deploy.
3. V2 type and layout. Meanwhile the user does A3, registering the Bungie app.
4. A4 sign-in, plus A7 About screen
5. V3 components
6. A5 inventory loader, plus A6 CSV tag merge
7. V4 motion
8. V5 and A8 checks. Then rebuild the artifact target and ask the user before republishing the claude.ai artifact.

At the end of each step: run the security gates and tests, update `CLAUDE.md` and `HANDOFF.md` (including the changed decision about the Bungie API), commit, and tell the user what changed with a screenshot.
