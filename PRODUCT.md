# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
The owner and a few friends: Destiny 2 players who already use DIM (Destiny Item Manager). Desktop and phone are equal, first-class contexts (confirmed 2026-11-15). Desktop is used for long vault-organizing sessions. Phone is used for lookups, tagging and quick cleanup passes.

## Product Purpose
Ghost is meant to be the ideal place to sort and organize a Destiny 2 vault. The core loop: load the vault, then view it through several side-by-side searches. Compare similar items, then use Clean up to decide what to keep and what to trash, and free vault space. The decisions go back to DIM as tags and notes. Success means a leaner vault, with confidence that the right rolls were kept.
Planned later: a **builds** feature for making loadouts/builds for in-game use (not designed yet; don't fabricate it).

## Positioning
Ghost is the thinking and deciding layer on top of DIM:
- several queries side by side, each highlighting *why* an item matched
- light.gg popularity-based perk ratings
- Bungie, Clarity and Data Compendium text next to every perk
- Compare for up to 10 items with aligned perk rows
- a group-by-group Clean up workflow

DIM stays the source of truth and the only write path (CSV tags/notes import).

## Operating Context
- **Input:**
  - DIM spreadsheet CSV exports (weapons, armor)
  - later, Bungie sign-in on the hosted copy
- **Output:** a DIM tags/notes CSV with changed rows only.
- **Builds:**
  - a claude.ai artifact (owner's copy; CSP blocks external hosts)
  - a GitHub Pages copy for friends (strict CSP, no third-party fonts/scripts)
- **Profiles:** one per player.
- **Views:** Vault (query panes), Clean up, Compare, Subclasses (Warlock first).
- **Phones:** handled by a dedicated phone layer: bottom tabs, bottom sheets, swipe keep/trash.

## Capabilities and Constraints
- **Data volume:** ~640 weapons and ~320 armor per player. Cards render 40 at a time on phones and 150 on desktop.
- **Packaging:** single self-contained HTML file. Everything is inlined at build time; there are no runtime CDNs. The icon sprite ships alongside.
- **Security:** GHOST_PLAN.md's Security section is a release blocker for every change. That includes the strict CSP, no inline handlers, and sanitized reference HTML.
- **Terminology:**
  - perk, trait, origin trait, intrinsic/frame/archetype
  - breaker (Shield Piercing, Disruption, Stagger), element, ammo, tier, rarity
  - tag (favorite, keep, junk, infuse, archive), notes
  - pane, Clean up, Compare, profile
- **Undecided:**
  - the builds feature
  - which exotics get the gilt frame (`GILT_EXOTICS`, reviewed later with the user)

## Brand Commitments
- Name: **Ghost** (formerly Vault Sorter); the `vs:` storage keys stay.
- Non-commercial forever: no ads, donations, fees or paid tiers.
- "Ghost is not affiliated with or endorsed by Bungie." Bungie's notice and full credits go on the About screen.
- No Bungie glyphs are copied; UI chrome is original CSS/SVG. Inspiration images may be used as imagery, with every artist credited (`data/art.json`; the user reports that all of them gave permission).
- Binding look decisions from the user (GHOST_PLAN.md):
  - Tower Terminal (editorial/infographic) as the base
  - Elemental Glow on item cards
  - Sigil Minimal for navigation, empty and loading states
  - Tower amber accent when no element applies
  - dark default plus a Bone & Sepia light theme
  - motion modeled on bray.tech
  - a gilt frame for selected exotics only

## Evidence on Hand
- **Reference images:** 61 under `../../UI Inspo/` (six theme folders, index in `_image-index.csv`).
- **Credits:** in the design doc and `data/art.json`.
- **Synthetic fixtures:** `test/fixtures/*.csv`. The user's real vault lives only in their artifact or browser storage and must not be committed.
- **Not on hand:** no testimonials, metrics or user counts exist; don't fabricate any.

## Product Principles
1. Decisions over data: every screen helps the user decide keep, trash or compare, not just browse.
2. Show the why: anything a search matched is visibly highlighted.
3. DIM is the source of truth; Ghost never silently diverges from it.
4. Equal on desk and phone: no feature is desktop-only.
5. Private and safe by default: no tracking, local data, strict security gates.

## Accessibility & Inclusion
Defaults (confirmed): WCAG AA contrast in both themes, full keyboard use, `prefers-reduced-motion` plus an in-app motion toggle, 44px touch targets.
