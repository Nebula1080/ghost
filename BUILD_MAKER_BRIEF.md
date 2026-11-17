# Brief: Build Maker (next session)

Written 2026-11-17 at the end of a long session. Read `CLAUDE.md`, `HANDOFF.md` and `GHOST_PLAN.md` (Security section) first; this brief only adds what's specific to the build maker.

## What the user asked for (their words, condensed)
"A full build maker, with emphasis on element keyword synergies. It should show the stats and possible interactions between your subclass, weapons, and armor." It must also be able to **equip a build from Ghost**.

A build contains:
- **Subclass setup:** class, subclass, super, abilities, aspects, fragments
- **Weapons:** kinetic, energy, power, picked from the vault
- **Armor + stats:** 5 pieces from the vault, including the exotic, with stat totals
- **Armor mods:** per slot

## Decisions already made (don't relitigate)
- **Equip from Ghost:** yes. It uses the move/equip scope the Bungie app ("Ghost Buddy") already has. **This needs a security design approved by the user before any write code exists** (see "Equip: security design" below).
- **Shipping:**
  - Every finished change goes to the live site right away: branch → PR → green checks → squash-merge → Pages deploy → verify.
  - End every reply that updates the site with https://nebula1080.github.io/ghost/
  - **Exception:** UI changes from the mobile audit need **demo screenshots approved first** (see the end of this brief).
- **Ask before installs.** Ask before anything touching accounts, repo settings, secrets or publishing beyond the standing "ship to the live site" OK. Never ask the user to paste the API key.

## Where things are (verify before relying on them)
- **App and logic:**
  - `src/app.html`: UI, views via `setView`, nav buttons `nav.views`, the phone layout CSS block
  - `src/core.js`: pure logic, Node-testable
  - `src/ghost.css`: design system and themes
  - `build.py`: inlines everything
  - `src/bungie.js`: sign-in and read-only API guard (hosted build only)
- **Data the build maker can use:**
  - Inlined `window.VS_DEFS` (from `data/defs.json`):
    - `sub[class][element]`: subclass name and icon, plus `s` = super, classAbility, movement, melee, grenade, aspects, fragments, transcendence (each `{n, h, i, d}`)
    - `pi` / `pw` / `pa`: plug name → [icon, socketType, Bungie description, hash]. Always look up with `Core.plugOf(name, defs, kind)`.
    - `cl`: Clarity perk text (HTML; render only through `SH()`)
    - `dc` / `dcx`: Compendium perk and exotic notes
    - `sets` / `as`: armor set bonuses
    - `wb` / `fb`: breakers
  - `window.VS_APIDEFS` (hosted only; `data/api-defs.json`): item, plug and stat tables. Rebuild with `node tools/build-api-defs.mjs` (reads the cached manifest in `data/raw`).
  - **Items:** `S.items` (weapons and armor, same shape from CSV or Bungie; Bungie-loaded items have `src:'api'`). Armor 3.0 stats: Weapons, Health, Class, Grenade, Super, Melee, Total. Weapon stats use DIM's short names.
  - **Text search:**
    - `Core.descHits` / `Core.descText`: perk descriptions
    - `Core.keywordRe`: word-form matching, e.g. freeze → frozen, ignition → ignite
    - Reuse these for synergy matching.
- **Persistence pattern to copy:** Compare (`CMP`, localStorage `vs:compare`, per profile via `PK()`/`PP()`); profiles via `PROF`. Builds must be per-profile, through `PK()`/`PP()`.
- **UI patterns:** item picker → the Compare / "Find & compare" flows; perk detail → `infoHtml` / `showPerk`; subclass tiles → `renderSub` / `openSubclasses`.

## Synergy engine (the core of the feature)
1. **Keyword map per element**, data-driven in `core.js` with unit tests. For each verb/keyword:
   - which subclass pieces **produce** it (aspects, fragments, abilities)
   - which weapon perks and exotics **benefit from** it
   - which armor mods / set bonuses **benefit from** it
   - Examples:
     - Solar: scorch, ignite, radiant, restoration, cure
     - Arc: jolt, blind, amplified, ionic trace
     - Void: volatile, weaken, suppress, devour, overshield, invisibility
     - Stasis: slow, freeze, shatter, Stasis crystal
     - Strand: sever, suspend, unravel, woven mail, threadling, tangle
     - Prismatic: transcendence, plus the mix of the above
     - Also: elemental orbs / Orbs of Power, elemental wells (Font / armor mods), surge mods
2. **Classify** each build piece by matching its description text (Bungie + Clarity + Compendium) against the map. Show matches as "interactions": "Incandescent (weapon) → scorch → Ember of Torches (fragment)". Explain why; never claim an effect that isn't in the source text.
3. **Stats:**
   - Sum armor stats.
   - Show fragment stat penalties/bonuses if present in the descriptions.
   - Show the weapon stats already on items.
   - Armor 3.0 stat effects aren't in defs; don't invent them. Ask the user or the Compendium tab "Game Mechanics" (`data/raw/compendium`).
4. **Suggestions (optional):** rank the vault's weapons and armor by synergy with the chosen subclass.

## Equip: security design (get the user's OK first)
Currently `Bungie.allowed()` permits only the token exchange and read-only GETs, and `test/security.test.js` fails if any write endpoint appears in `bungie.js`. To equip:
- **Endpoints:** verify each against the Bungie API docs before coding:
  - `POST /Platform/Destiny2/Actions/Items/TransferItem/`
  - `EquipItem/` or `EquipItems/`
  - maybe `PullFromPostmaster/`
  - **Not** InsertSocketPlug (mods/subclass): check whether Bungie allows third parties at all. If not, the build applies weapons and armor only; show the subclass and mods as a checklist.
- **Rules:**
  - Write calls only from an explicit user action ("Equip this build" → a confirmation sheet listing every move).
  - Never automatic or in a loop.
  - Throttle sequentially and honor ThrottleSeconds.
  - Stop at the first error.
  - The character must be in orbit/social space (handle `DestinyCannotPerformActionAtThisLocation` and similar).
- **Guard and tests:** extend the guard with an explicit allowlist for only those endpoints. Update the security tests to:
  - assert the exact allowlist
  - assert POST bodies only carry `itemId` / `itemReferenceHash` / `characterId` / `membershipType` / `stackSize` / `transferToVault`
  - assert writes happen only behind the confirm UI
- **Records:**
  - Update GHOST_PLAN's Security section (the 2026-11-16 scope note says "until a feature that needs moves is approved").
  - Add a `test/bungie.e2e.js` case against the fake bungie.net.
- Equipping requires being signed in with Bungie. A CSV-only vault lacks character ids, so offer sign-in.

## UI
- A new **Builds** view in the nav (desktop rail + phone tab bar):
  - a list of saved builds
  - an editor:
    - a subclass picker (class → element → super/abilities/aspects/fragments within slot limits)
    - weapon and armor slots that open a filtered item picker
    - mods
  - a synergy/interaction panel and a stat panel
- **Phone:** follow the current phone rules:
  - bottom-sheet pickers
  - the header fold (`syncCompact`)
  - 44px targets
  - nothing fixed over content
  - landscape short-screen rules in `ghost.css`
- Reuse existing visuals: perk tiles, stat bars, element icons.
- Theme tokens only; no new hard-coded colours.

## Tests and gates (every change)
- `npm run gates`:
  - audit
  - secret check
  - unit + security tests
  - all e2e (`e2e.playwright`, `ui.e2e`, `security.e2e`, `bungie.e2e`)
  - gitleaks pre-commit
- Add:
  - unit tests for the keyword map and synergy matching (`core.js`)
  - UI e2e for creating, saving and reopening a build (desktop + phone + landscape)
  - the security tests above
- **Shipping pitfalls seen this session:**
  - gitleaks flags realistic-looking fake keys in tests: build them at runtime (`'ab'.repeat(16)`).
  - CodeQL runs on PRs and flags real issues: read the annotations; don't dismiss without the user's OK.
  - Don't put literal `<!--` / `-->` in inlined JS (`build.py` asserts this).
  - PR flow: no `gh` CLI. Push the branch, open the PR in the built-in browser (signed in to GitHub), and merge as squash. The author must be the noreply address; it already is.

## Answers (2026-11-17)
- Scope: vault only for now; keep refs ready for theorycrafting later.
- Suggestions: yes, show interactions and suggest.
- Sharing: DIM loadout link.
- Equip scope: weapons + armor only; subclass and mods as a checklist.
- Step 1 (planner) shipped; next: DIM loadout link, then the equip security design for approval.

## Open questions to ask the user early
1. Is the Bungie notice wording from bungie.net/7/en/Legal/Terms ("Game Content Usage Rules") pasted yet? It's needed for the About screen; Claude couldn't load the page.
2. Should builds be shareable (link/JSON, or a DIM loadout link)?
3. Should the synergy view cover only the user's own vault, or all weapons/armor in the game data?
4. Should the build maker suggest items automatically, or only show interactions for what the user picks?

## Separate track today: mobile audit
The user wants a full phone audit:
- portrait + landscape
- accessible scrolling
- easy-to-read menus/buttons
- clean, simple interfaces
- remove obstructive text, panels and buttons; keep what's needed for function

**Show demo screenshots before applying anything to the live build.** Screenshot scripts used this session took the user's CSVs from `C:/Users/vorte/Downloads/destiny-*.csv` (private: never commit). The Bungie sign-in shipped in PR #7; it hasn't been tested yet with a real Bungie sign-in.
