# Handoff: Ghost, formerly Vault Sorter (from Claude on claude.ai, 2026-11-14)

## Ghost plan progress (`GHOST_PLAN.md`)
- **Step 0, security groundwork: done 2026-11-15** in Claude Code. Done: local git repo (`main`, remote `origin` = github.com/nebula1080/ghost, **nothing pushed**; commits use the GitHub noreply address; the repo is public so Pages works on a free account), `.gitignore`, gitleaks pre-commit hook + CI workflow + Dependabot, `package-lock.json`, security unit + browser tests, the XSS/`innerHTML` audit with fixes (sanitizer for Clarity/Compendium HTML and CSS, CSV limits, id/ratings/profile validation, no inline handlers, banner as text), the hosted CSP with script hashes (`build.py --target hosted`), and a tighter service worker. See CLAUDE.md → Security.
- **Waiting on the user:**
  - GitHub settings: secret scanning + push protection, Dependabot alerts, Pages HTTPS, protect `main`. The user clicks these; Claude gives the steps.
  - Whether images ship in the artifact build too (recommended: yes, ~1 MB of lazy-loaded WebP).
  - `GILT_EXOTICS`: exotic review later, with the user.
- **Imagery chosen 2026-11-15:** `data/art.json` maps each slot (loading, welcome, view headers, About, Subclasses element panels, light-theme headers) to an image number in `UI Inspo/`, with credits and links from the design doc's credit table. Only images with high-confidence or user-confirmed credits were used. Text-heavy infographics, watermarked/logo images and unsure credits were excluded. Wired in at step 3.
- GitHub: user `nebula1080`, repo `ghost`, Bungie app "Ghost Buddy". The user has added the repo secrets `BUNGIE_API_KEY` and `BUNGIE_CLIENT_ID`.
- **Design overhaul built 2026-11-15** (covers GHOST_PLAN steps 1, 3, 5 and 7: tokens/themes + rename, type/layout, components, motion), after three prototype rounds with the user (`.impeccable/mocks/`). The user chose: Vanguard Dossier layout on desktop, Leaded Light on phones, relevant high-res art only, real item icons, stat bars, seven themes from the inspo images. Details in CLAUDE.md → Look.
  - Still open: exotic review for `GILT_EXOTICS`; About screen (A7) with credits; artifact build shows sprite icons instead of Bungie item icons (CSP).
- **2026-11-15 fixes after the first artifact republish:** item panel stayed invisible when the OS asks for reduced motion (now its open state needs no animation; tested both ways), pane ⋯ menu ignored clicks on its icon, armor rows now show slot, archetype, total and tertiary, subclass art has per-image focal points, artifact build bundles Bungie item icons as sprites. Light theme retired.
- `.github/workflows/deploy.yml` (Pages) is written. When the API key is injected (step 4) the hosted build will contain it by design (public client), so its `check-secrets --dir dist-hosted` step must then exclude the key.
- **Next: step 2** (A1 build targets are partly done; A2 GitHub Pages deploy). Then the user activates the `protect-main` ruleset after the first push.

## Status
- **Built and published** as a claude.ai artifact, private to the user: https://claude.ai/artifact/Xcjyw6xewWGirToYpj5Uq2 (slug `f7efae1b-2831-4dd2-83dd-80c970fc780d`). The code in `dist/index.html` is identical to what's published.
- **The user has loaded their real vault** into the artifact: 640 weapons and 318 armor (about 400 unique weapon hashes), stored in the artifact's db on 2026-11-14. **There are no unsent tag/note edits and no ratings yet.** The user had created two panes: "Duplicates" (`is:dupe`, grouped by name) and a blank one.
- Tested only against **synthetic** CSVs (`test/fixtures`) built from DIM's source code. They have not been checked against the user's real export yet.
- Light.gg scraping was **proven** in the desktop app's built-in browser. Reed's Regret and Dead Man's Tale extracted correctly (5 and 4 columns, about 0.5 s per page), but nothing has been scraped for the user's vault.

## Working with the claude.ai artifact from Claude Code
The artifact's db (vault, edits, ratings) can only be reached by the page itself or through the claude.ai **artifact tools** (`db_get`/`db_write`/`publish_files`, `mcp__claude-artifacts__*`). If those tools are present in this Claude Code session, use them with the slug above. If they aren't, don't try to reach the db some other way. Use one of these paths instead:
- **Local-first (recommended):** run `dist/index.html` locally. It falls back to localStorage. The user reloads their DIM CSVs there, because reloading is cheap and DIM stays the source of truth. Ratings get loaded through an import button (task 1).
- **Keep the artifact as the UI:** add a ratings import button (task 1). Then the user opens the artifact on claude.ai and imports `ratings.json`, and the page writes it into its own db. Republishing the artifact needs the artifact tools, so otherwise the user asks Claude on claude.ai to republish `dist/index.html`.

## Done in Claude Code (2026-11-14)
- Sort / group / search by **ammo type** and **intrinsic breaker** (Shield Piercing, Disruption, Stagger), plus crafted.
- **Icons** for elements, ammo, breakers, crafted and perks (see CLAUDE.md → Reference data).
- **Clarity** and **Destiny Data Compendium** saved under `data/raw/` and shown in the app (perk tooltips, drawer perk details, exotic notes, `desc:` search). Neither publishes perk ratings, so unrated weapons stay unrated.
- `dist/index.html` is rebuilt (~1.1 MB) but **not yet republished** to the claude.ai artifact. Bungie-hosted perk icons may be blocked by the artifact's CSP; everything else is embedded.

## Done in Claude Code, round 2 (2026-11-14)
- Game-style sockets on cards and in the drawer (square intrinsic/mods, round perks in columns, blue fill = equipped). Every perk, mod, exotic perk (incl. Solipsism spirits) and armor set bonus is clickable for Bungie + Clarity + Compendium text.
- Compendium text keeps the sheet's own colors/formatting.
- Breakers now include the current artifact's weapon-type perks and intrinsic-text exotics.
- Armor set sort/group/search. Sort and group menus adapt to each pane's query.
- Subclasses viewer (header button), Warlock first, also Titan/Hunter.
- Republished to the artifact (see top).

## Profiles (2026-11-15)
Multiple players' vaults in one app (see CLAUDE.md → Persistence). Next step discussed with the user: Bungie OAuth login for one-click refresh on a hosted copy (needs the user to register an app at bungie.net/developer and pick a host); optional desktop "refresh from Downloads folder" via the File System Access API.

## Ratings (2026-11-17)
Ghost's own weapon ratings replaced light.gg (CLAUDE.md → Ratings): DIM wish list + Aegis's Endgame Analysis + perk ratings, Perk ratings page. Tasks 1, 2 and 4 (per-perk overrides) below are superseded.

## Next tasks (in priority order)
1. **"Import ratings JSON" in the UI.** Add a file input next to *Load DIM CSVs* that reads a ratings JSON (shape in CLAUDE.md), merges it into `S.ratingsRaw`, and saves it. In db mode, write chunks of ≤150 weapons to `ratings/rN` as `{w:{…}}`. In local mode, use `vs:ratings`. Then call `applyRatings(); refreshBodies()`.
2. **Ratings pipeline** (`tools/`):
   - `tools/weapon-list.mjs`: reads the user's DIM weapon CSV (use `src/core.js`) and outputs the unique `[hash, name]` pairs.
   - Fetching: first try plain Node `fetch` from the user's machine with a normal browser User-Agent, sequentially, with a 0.9 s delay and backoff on 429. Light.gg refused requests from Anthropic's cloud, but a home IP may work. If it's blocked (e.g. a Cloudflare challenge), use the Claude in Chrome extension: open any light.gg item page, inject `tools/lightgg-scraper.js`, run `lgScrape` in batches of about 60, and read `window.lgOut` back in slices. Don't bypass bot protection.
   - Output: `ratings.json`. Port `lgExtract` to a Node DOM parser (e.g. `linkedom`) if fetching from Node works.
3. **Validate against the user's real CSVs.** Ask them for `destiny-weapon.csv` and `destiny-armor.csv`, and keep the files out of git (`private/` is gitignored). Check: the `Tier` format, armor stat column names, whether perk names have an `Enhanced` prefix or other variants that light.gg names differently, the `JUNK_PERK` regex (shaders, ornaments, trackers, mementos), and exotic catalyst columns in the rating.
4. **Quality of life the user would likely want:** per-perk manual rating overrides; editing preset searches; a stat-based rating for armor (e.g. total plus the tertiary/tuning match), since armor currently shows no rating; a "copy as real DIM query" translation for queries where the syntax matches DIM's.
5. Save each step to the claude.ai Project "Destiny 2" doc `claude/vault-sorter-workflow.md` if you have the Projects tool. It currently describes the artifact db layout and the scraper.

## Decisions already made (don't relitigate without the user)
- DIM's CSV round trip is the integration for tags/notes (there's no DIM Sync API). **Changed 2026-11-15 (GHOST_PLAN):** the hosted GitHub Pages build adds a Bungie OAuth public-client sign-in to load inventory; the claude.ai artifact build stays CSV-only.
- ~~The rating comes from light.gg perk popularity.~~ **Changed 2026-11-17:** Ghost's own ratings (CLAUDE.md → Ratings).
- The UI is one self-contained HTML file so it works as a claude.ai artifact and straight from disk.
- Export only the changed rows, because DIM's importer clears tags/notes for any row it is given with empty values.
