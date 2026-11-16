---
name: Ghost
description: Destiny's Light projected over your vault; dossier sheets and leaded-glass perk cells where every search match lights up in its own colour.
colors:
  dusk-ground: "#170f1c"
  dusk-rail: "#211627"
  dusk-well: "#130c18"
  dusk-sheet: "#241a2b"
  dusk-sheet-raised: "#2b1e33"
  dusk-raise: "#352640"
  dusk-hairline: "#4a3a55"
  dusk-hairline-strong: "#62506d"
  dusk-ink: "#f7ece5"
  dusk-ink-dim: "#c9b8bf"
  dusk-ink-faint: "#a08e9a"
  peach-light: "#f7d3bd"
  tower-amber: "#f2a65a"
  amber-ink: "#2a1608"
  solar: "#f2721b"
  arc: "#7aecf3"
  void: "#b98ae8"
  stasis: "#6aa6ff"
  strand: "#3fe07a"
  kinetic: "#e9e2d6"
  prismatic: "#ff7ad9"
  exotic: "#ceae33"
  legendary: "#8e5fd0"
  rare: "#5a8fd6"
  uncommon: "#4f9a5f"
  common: "#c3bcb4"
  keep: "#6fd389"
  trash: "#f0715f"
  pane-1: "#4da3ff"
  pane-2: "#f2a33a"
  pane-3: "#5bd17a"
  pane-4: "#e05fb7"
  pane-5: "#a67cff"
  pane-6: "#41d6c3"
  pane-7: "#e5624f"
  pane-8: "#d8d35a"
typography:
  display:
    fontFamily: "Cinzel, Georgia, 'Times New Roman', serif"
    fontSize: "clamp(44px, 6vw, 78px)"
    fontWeight: 500
    lineHeight: 0.95
    letterSpacing: "0.14em"
  headline:
    fontFamily: "Cinzel, Georgia, 'Times New Roman', serif"
    fontSize: "clamp(30px, 3.6vw, 46px)"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "0.1em"
  title:
    fontFamily: "Cinzel, Georgia, 'Times New Roman', serif"
    fontSize: "13.5px"
    fontWeight: 600
    letterSpacing: "0.2em"
  section:
    fontFamily: "Cinzel, Georgia, 'Times New Roman', serif"
    fontSize: "12.5px"
    fontWeight: 600
    letterSpacing: "0.24em"
  summary:
    fontFamily: "'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "22px"
    fontWeight: 300
    lineHeight: 1.3
  item-name:
    fontFamily: "'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "34px"
    fontWeight: 300
    lineHeight: 1.05
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  card-name:
    fontFamily: "'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 700
  label:
    fontFamily: "'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.16em"
  numeral:
    fontFamily: "'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "20px"
    fontWeight: 300
  query:
    fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace"
    fontSize: "12px"
rounded:
  none: "0px"
  perk: "14px"
  orb: "50%"
spacing:
  hair: "1px"
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "22px"
  gutter: "40px"
  phone-gutter: "16px"
  rail: "232px"
components:
  button:
    backgroundColor: "{colors.dusk-sheet-raised}"
    textColor: "{colors.dusk-ink}"
    rounded: "{rounded.none}"
    padding: "8px 14px"
  button-hover:
    backgroundColor: "{colors.dusk-raise}"
  button-primary:
    backgroundColor: "{colors.tower-amber}"
    textColor: "{colors.amber-ink}"
    rounded: "{rounded.none}"
    padding: "8px 14px"
  query-input:
    backgroundColor: "{colors.dusk-well}"
    textColor: "{colors.dusk-ink}"
    typography: "{typography.query}"
    rounded: "{rounded.none}"
  pane:
    backgroundColor: "{colors.dusk-sheet}"
    rounded: "{rounded.none}"
    width: "320px-640px"
  pane-title:
    textColor: "{colors.dusk-ink}"
    typography: "{typography.title}"
  item-row:
    backgroundColor: "transparent"
    textColor: "{colors.dusk-ink}"
    typography: "{typography.card-name}"
    padding: "11px 6px"
  rail-nav-active:
    textColor: "{colors.peach-light}"
    typography: "{typography.label}"
    padding: "12px"
  toggle-on:
    textColor: "{colors.dusk-ink}"
    rounded: "{rounded.none}"
  perk-cell:
    backgroundColor: "{colors.dusk-rail}"
    textColor: "{colors.dusk-ink-dim}"
    rounded: "{rounded.none}"
    padding: "10px 4px 8px"
  item-panel:
    backgroundColor: "{colors.dusk-rail}"
    width: "680px"
---

# Design System: Ghost

## Overview

**Creative North Star: "The Ghost's Projection"**

Ghost is a Ghost shell throwing Destiny's Light across a dark vault. The screen reads as a projected dossier: ruled sheets on a dusk ground, Cinzel inscriptions carved across the top of each view, and thin warm light that picks out whatever matters. The Light has two jobs and only two: it marks what the user is touching (hover, focus, the active nav row) and it marks *why* something matched (each search pane owns a colour, and every field, perk cell and icon it hit glows in that colour). Everything else stays quiet, dim and square.

The world is dense but legible. Desktop is the Vanguard Dossier: a 232px left rail, a scene header where relevant Bungie art sits behind the title band only, and search panes laid side by side as ruled sheets. Phone is Leaded Light: one pane per screen, items as framed cards whose perks sit in leaded-glass cells, bottom tabs, a bottom-sheet item panel. Seven colour worlds share one structure; Dusk is the default,  is the light world.

It refuses the generic dark-blue dashboard: no rounded card grids, no blue-grey chrome, no gradient KPI tiles. Depth comes from light and hairlines, not from lifted boxes.

**Key Characteristics:**
- Square corners everywhere except round perk icons and theme orbs.
- Hairline rules (1px) separate everything; sheets carry a 2px top rule in their pane colour.
- Cinzel uppercase inscriptions for view titles, pane titles and section heads; Hanken Grotesk for all working UI.
- Search matches glow in their pane's colour; the item's element lights its row edge.
- Art lives behind titles, never behind data.
- Motion is projection: things open from a line of light and titles are written in light; all of it switches off together.

## Colors

Each world is a near-black tinted ground with one warm Light and one accent; meaning colours (elements, rarity, keep/trash, pane colours) sit on top and never change role. The frontmatter records Dusk, the default world; the other six worlds redefine the same token slots (see the sidecar).

### Primary
- **Peach Light** (`peach-light`): the Light itself. Hover borders, focus rings (1.5px outline, 2px offset), active nav text and its 2px left bar, links, the drawn sigil, emphasised numbers in the scene summary, progress fills, burst rings.
- **Tower Amber** (`tower-amber`): the one filled accent. Primary buttons (with **Amber Ink** text), "on" toggles (14% amber wash plus amber border), tag icons, pending counts, the modded portion of stat bars. It is the colour when no element applies.

### Secondary
- **Pane colours** (`pane-1` to `pane-8`): one per search pane, in order. Each pane's 2px top rule, its chip, and every highlight its query produced. These are the "why it matched" voice and are never used decoratively.
- **Element colours** (`solar`, `arc`, `void`, `stasis`, `strand`, `kinetic`, `prismatic`): an item's element. Row edge glow, selected perk cell fill, drawer hero tint, subclass tiles.

### Tertiary
- **Rarity colours** (`exotic`, `legendary`, `rare`, `uncommon`, `common`): item icon frame and tooltip header only.
- **Keep / Trash** (`keep`, `trash`): Clean up decisions, stamps, tile borders, the best value in Compare.

### Neutral
- **Dusk Ground** (`dusk-ground`): page background and the base every scrim fades into.
- **Dusk Rail** (`dusk-rail`): left rail, item panel, modals, perk cells.
- **Dusk Well** (`dusk-well`): sunken fields: inputs, chips, context blocks.
- **Dusk Sheet / Sheet Raised / Raise** (`dusk-sheet`, `dusk-sheet-raised`, `dusk-raise`): panes (at 92% over the ground), buttons and toggles, hover fills.
- **Hairline / Hairline Strong** (`dusk-hairline`, `dusk-hairline-strong`): structural rules and control borders respectively.
- **Ink / Ink Dim / Ink Faint** (`dusk-ink`, `dusk-ink-dim`, `dusk-ink-faint`): primary text, secondary text, labels and group heads.

### Named Rules
**The Light Means Attention Rule.** Peach Light marks only what the user is pointing at, what is active, or progress. Never use it as a fill or as decoration.

**The Matched Colour Rule.** A pane colour appears only where that pane's search matched, plus the pane's own top rule and chip. If a highlight cannot say which search lit it, it is wrong.

**The Six Worlds Rule.** Every surface uses theme tokens (`--bg`, `--panel`, `--line`, `--light`, `--accent`...), never literal hexes, so all six worlds (and the  light world, which also darkens the element and keep/trash colours) work unchanged.

## Typography

**Display Font:** Cinzel (with Georgia, Times New Roman)
**Body Font:** Hanken Grotesk (with system-ui, Segoe UI)
**Label/Mono Font:** ui-monospace / Cascadia Mono / Consolas for the query field only

**Character:** Cinzel is the inscription carved over the door, always uppercase and widely tracked; Hanken Grotesk does all the work underneath, light (300) at large sizes and bold (700) for item names. Both are embedded OFL WOFF2 subsets; no third-party font loading.

### Hierarchy
- **Display** (Cinzel 500, clamp(44px, 6vw, 78px), 0.95, 0.14em, uppercase; 40px on phones): the view title in a scene header, written in light on view change.
- **Headline** (Cinzel 500, clamp(30px, 3.6vw, 46px), 1.05, 0.1em, uppercase): band titles in Clean up, Compare and review.
- **Title** (Cinzel 600, 13.5px, 0.2em, uppercase; 0.12em on phones): pane titles. Section heads in the item panel and Subclasses use Cinzel 600 12.5px at 0.24em, flanked by hairlines.
- **Summary** (Hanken 300, 22px, 1.3, max 44ch, balanced; 17px on phones): the one-sentence vault summary under the display title, with key counts in Peach Light at 500.
- **Item name** (Hanken 300, 34px, 1.05, -0.01em; 26px on phones): the item panel heading.
- **Body** (Hanken 400, 14px, 1.5): everything else. Card names are Hanken 700 15px, truncated with an ellipsis.
- **Label** (Hanken 600, 11px, 0.16em, uppercase, Ink Faint): group heads, perk column heads, field labels. Rail nav uses 12.5px at 0.18em.
- **Numeral** (Hanken 300, 20px, tabular where counted): ratings and rating rings; the Clean up "space freed" figure is 48px (40px on phones).

### Named Rules
**The Inscription Rule.** Cinzel is only ever uppercase, tracked at 0.1em or more, and only for titles and section heads. Never set body, buttons or numbers in Cinzel.

**The Light Weight Rule.** Large Hanken text (20px and up) is weight 300; weight comes from size, not boldness.

## Layout

**Desktop (761px and up), Vanguard Dossier.** A two-column grid: a 232px rail on Dusk Rail with a 1px right hairline, then the main column. The rail stacks the sigil and wordmark, uppercase nav with 22px line icons, a flexible gap, profile, summary, pending count, full-width actions, and a footer (theme orbs, motion toggle) above a hairline. The main column opens with a scene header (min 300px, content bottom-aligned, 40px side gutters), a row of actions, then the panes: a horizontally scrolling row with 22px gaps, each sheet 320 to 640px (wide panes up to 960px). "Add a sort" rests as a 52px vertical-text column and opens to 260px on hover or focus.

**Phone (760px and below), Leaded Light.** A top bar, a 210px scene header with 16px gutters, a pane-chip row, then one pane per screen with scroll-snap (each pane is the viewport minus 16px). Bottom tab bar, bottom-sheet item panel (190px hero). Rail footer and the desktop action row are hidden. Inputs stay 16px to prevent zoom; tap targets are 44px.

**Rhythm.** Spacing steps of 6, 10, 14 and 22px inside components; 40px page gutters on desktop and 16px on phones.

**The Art Behind Titles Rule.** Bungie art appears only in scene headers, bands, the subclass head and the item panel hero, always under a scrim that fades to the ground from the left and bottom. It never sits behind lists, tables or controls.

## Elevation & Depth

Ghost is flat and lit, not lifted. Surfaces sit at tonal steps (well, ground, rail, sheet, raise) separated by hairlines. Depth is conveyed by light: faint 4px scanlines on panes, tiles and the item panel; a 380px radial pointer light that follows the cursor over panes and tiles; inset glows on rows and selected cells. Drop shadows exist only on things that float over the page.

### Shadow Vocabulary
- **Element edge** (`box-shadow: inset 2px 0 0 color-mix(in srgb, var(--el) 80%, transparent), inset 26px 0 30px -26px color-mix(in srgb, var(--el) 45%, transparent)`): item rows carry their element on the left edge. On phones it becomes a 3px top edge.
- **Matched glow** (`box-shadow: 0 0 0 1px var(--pc), 0 0 14px 2px color-mix(in srgb, var(--pc) 55%, transparent)`): a perk icon a search hit.
- **Lit cell** (`box-shadow: inset 0 -2px 0 var(--el), inset 0 0 18px -6px color-mix(in srgb, var(--el) 55%, transparent)`): the equipped perk in a leaded-glass column.
- **Float** (`box-shadow: 0 24px 70px rgba(0,0,0,.55)`): modals. Toasts use `0 10px 30px rgba(0,0,0,.4)`.

### Named Rules
**The Lit Not Lifted Rule.** Resting surfaces never cast drop shadows. Emphasis is an inset glow or a coloured hairline; only modals and toasts float.

## Shapes

Square by doctrine: every button, input, sheet, row, chip, tab, perk cell, modal and tile has 0 radius. Hairlines (1px) do the shaping; dashed hairlines mark a place to add something. Exceptions carry meaning: perk icons and perk pills are round (14px pills, circular icons, with square icons for mods), theme orbs are circles, the pane marker is a 9px diamond (a square rotated 45 degrees), and Clean up stamps are tilted -8 degrees. Selected exotics get a gilt arch (200px top radius with a gold double rule) on the item panel hero.

## Components

### Buttons
Quiet slabs that warm to the Light on hover.
- **Shape:** square (0).
- **Default:** Sheet Raised fill, Hairline Strong 1px border, Ink text, Hanken 600 13px, 8px 14px padding.
- **Hover / Focus:** border turns Peach Light, fill steps to Raise (0.25s); focus is the global 1.5px Light outline at 2px offset.
- **Primary:** Tower Amber fill and border, Amber Ink text; hover mixes 15% white in.
- **Rail actions:** full width, centred.

### Chips and Toggles
- **Style:** tabs, tag buttons, checks and presets share the button slab.
- **On:** Tower Amber border with a 14% amber wash. Segmented controls fill the selected segment solid amber.
- **Pane chips (phone):** the chip's pane colour becomes the border and a 16% wash when on.
- **Tag light burst:** pressing a tag sends a Light ring out from the touch point (scale 16, 0.55s).

### Cards / Containers
- **Panes (ruled sheets):** square, Sheet at 92% over the ground, Hairline border, 2px top rule in the pane colour, scanlines and pointer light, rise in with a 0.08s stagger. Head is transparent over a hairline, 12px 14px.
- **Item rows (desktop):** no box. Rows are separated by a 70% hairline, 11px 6px padding, a 48px item icon framed in rarity colour, Hanken 700 15px name, element edge on the left. Hover: 6% Light wash and the name turns Peach Light.
- **Item cards (phone):** framed (Hairline border, Sheet fill, 10px gap), element as a 3px top edge, perks in a leaded strip.

### Inputs / Fields
- **Style:** Well fill, Hairline border, square; the query field is monospace.
- **Focus:** the border takes the pane colour of the pane it belongs to (Peach Light elsewhere); no outer glow.

### Navigation
- **Desktop rail:** Hanken 600 12.5px uppercase at 0.18em, Ink Dim, 22px line icons. Hover: Ink, and the icon redraws its strokes (0.7s). Active: Peach Light text, a 2px Light bar on the left edge and a 14% Light gradient fading right; its icon turns a quarter every 10s.
- **Phone:** bottom tab bar on Dusk Rail over a top hairline, 11px labels; active tab is Peach Light with a Light top border.

### Leaded-Glass Perk Columns (signature)
The item panel shows each perk column as a cell in a leaded window: columns share 1px hairlines (overlapping by -1px), headed by a centred label. Unselected options are Ink Dim on Dusk Rail; the equipped perk is lit by its element (a 30% to 8% vertical gradient, a 2px element base line and an inner glow). A perk the current search matched turns its name to the pane colour. On phones the card's perk strip uses the same cells in an auto-filling 52px grid.

### Item Panel (projected dossier)
A 680px panel on Dusk Rail with a 250px hero (Bungie screenshot, settling from 1.05 scale, tinted by the element), Hanken 300 name, a rating ring and fact chips. On desktop it projects open from a horizontal line of light (clip-path from 49.6% inset with brightness 2.4, 0.55s) and closes back to the line in 0.22s. On phones it is a bottom sheet.

### Scene Header
The view title in Display Cinzel over relevant Bungie art that drifts slowly (22s), scrimmed to the ground from the left and bottom, with the one-sentence summary beneath and a small uppercase art credit in the corner. Titles are written in light on view change (a 1.1s sweeping mask).

### Clean up Tiles and Stamps
Square tiles with keep/trash split footers; a decision colours the border (55% keep or trash) and slams a tilted uppercase stamp (2x to 1x, 0.38s). Trashed tiles drop to 80% opacity.

## Do's and Don'ts

### Do:
- **Do** use theme tokens for every surface and text colour so all six worlds work.
- **Do** light a search match in that pane's colour, on the exact field, perk or icon it matched.
- **Do** keep every container square and separate with 1px hairlines.
- **Do** set titles and section heads in uppercase Cinzel tracked 0.1em to 0.24em; everything else in Hanken Grotesk.
- **Do** put Bungie art only behind title bands and the item hero, under a scrim to the ground colour, and credit it.
- **Do** use the authored line-icon set (24px viewBox, 1.6 stroke, round caps) and Bungie or sprite icons for game objects.
- **Do** route all motion through the shared easing (`cubic-bezier(.16,1,.3,1)`) and make it stop under `prefers-reduced-motion` and the in-app Motion toggle.

### Don't:
- **Don't** build the generic dark-blue dashboard: no rounded card grids, blue-grey chrome or gradient metric tiles.
- **Don't** round containers or controls; roundness belongs to perk icons and theme orbs only.
- **Don't** put art or imagery behind lists, tables or controls.
- **Don't** use Peach Light or pane colours as decoration or large fills.
- **Don't** cast drop shadows from resting surfaces.
- **Don't** set body text, buttons or numbers in Cinzel.
- **Don't** use text glyphs or emoji as icons, and don't copy Bungie's UI glyphs; chrome is original SVG.
- **Don't** add small uppercase kicker labels above titles; the inscription title stands alone.


> **2026-11-15:** the Bone & Sepia light theme was retired at the user's request: too bright for them, and Destiny's white-on-dark icons, Clarity and Data Compendium colours are made for dark grounds. All worlds are dark.
