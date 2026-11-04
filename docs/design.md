# Design system — "the cloth-bound library"

The visual language comes from Bengali book-making: punthi (পুঁথি) palm-leaf
folios with their two string holes, cloth bindings, and gilt foil stamping.
One thing is bold — the books themselves (covers, the opening transition,
the reader). Everything around them stays quiet.

## Colour

| Role | Token | Value | Use |
|---|---|---|---|
| Cloth | `--cloth` | `#233B30` Deep Forest Green | identity fields: header band, featured volume, active navigation, primary buttons |
| Paper | `--bg` / `--surface` | `#F5EFE4` Warm Ivory / `#FBF8F2` | page and editorial surfaces |
| Ink | `--fg` | `#282720` Rich Ink | text (13:1 on ivory) |
| Foil | `--foil` | `#C2A06C` Antique Brass | hairlines, logo, cover stamping. Text only on cloth or charcoal (4.9:1 on green) — never on ivory |
| Accent | `--accent` | `#A65D4E` Muted Terracotta | progress, bookmark ribbon. Small text uses `--accent-text` `#8E4C3E` (5.6:1) |
| Night | dark theme `--bg` | `#202423` Dark Charcoal | dark theme; text `#ECE6DA`, never pure white |

The logo mark on page surfaces uses `--mark` (cloth on paper, foil at night),
a token rather than a `dark:` class so it is right even when the theme script
has not run (e.g. a streamed 404, which Next renders on the client).

Tokens are three layers in `src/app/globals.css`: primitives (`--green-800`…),
semantic (`--bg`, `--fg`, `--cloth`, `--foil`, `--mark`, `--line`…) and the Tailwind
mapping (`bg-cloth`, `text-fg-muted`…). Components use semantic tokens only.
Dark mode switches the semantic layer via `html[data-theme="dark"]`, set
before first paint by an inline script (no flash).

Reader themes (`src/lib/reader/settings.ts`): white `#FBF8F2`/`#282720`,
sepia `#F1E5CC`/`#3B2F22`, night `#202423`/`#D8D1C2`, each with a matching
"desk" colour around the book.

## Type

| Family | Role | Notes |
|---|---|---|
| Tiro Bangla | display: titles, book names, brand | one weight — hierarchy comes from size; `font-synthesis: none` |
| Hind Siliguri | UI: navigation, buttons, metadata | 400/500/600 |
| Noto Serif Bengali | reading (default), excerpts | variable weight |
| Anek Bangla | reader option only | |

- Self-hosted woff2, Bengali + Latin subsets only (`pnpm fonts`). The two UI
  faces are preloaded. Inside the reader, `@font-face` rules are injected once
  per section document with `font-display: block` (no fallback pagination).
- Scale: major third from a 17 px base (Bengali reads smaller than Latin at
  equal size); 14 px minimum. Heading line-height 1.25–1.4 so matras and vowel
  signs (ি ী ঁ ু ূ ৃ) never clip; UI body 1.65; reading 1.85 by default.
- Left-aligned, `hyphens: none`; justification is an opt-in reader setting.
- Bengali numerals (০–৯) in the Bengali UI via `Intl` `bn-BD`.
- No all-caps labels, no middle-dot metadata strings, no "→" in buttons.

## Logo

A horizontal punthi folio whose halves hinge open into a shallow open book;
each leaf keeps one string hole, and two thin slivers below suggest the
stacked folios of a bundle. Geometry lives in
`src/components/brand/mark-geometry.ts` and drives every rendition:

- `public/brand/logo*.svg` — horizontal lockup (mark + OpenBanglaBooks + ওপেন বাংলা বুকস), compact, mark; light and dark
- `src/app/icon.svg`, `favicon.ico`, `apple-icon.png`, `public/icons/*` — tile icons (a heavier "small" variant survives 16 px)
- The wordmark is shaped with HarfBuzz and outlined to paths, so the Bengali name is correct without any font installed.

Regenerate with `pnpm brand`.

## Covers

Original, generated (`src/components/cover/book-cover.tsx`): six cloths
(forest, madder, indigo, turmeric, charcoal, lac) × six foil-stamped motifs —
double-rule frame, library bands, alpana lozenge, punthi-leaf paper label,
ribbed spine, and the curved *do-chala* roof of Bengal's temples. Variants are
assigned in catalog order so neighbouring books differ. Titles are live text
(correct shaping at every size, scaled with container units) and
`aria-hidden` — the surrounding markup carries the accessible title.

## Layout

- **Desktop home:** the green header band continues into the featured
  volume — cover, title, description, actions, and on wide screens the book's
  real opening lines set on a page. Then Continue Reading (only when there is
  local progress; its space is reserved before hydration), shelves per
  collection, a typographic genre index, recently added, authors with life
  years, and a short editorial note.
- **Mobile home:** compact cloth top bar, featured book with full-width
  actions, horizontally scrolling shelves with snap, bottom navigation
  (icon + label, 56 px targets, safe-area aware).
- **Book page:** editorial header (cover, title, author, actions), then
  description, opening lines, contents (deep-linking into the reader), and a
  details column with edition, source and licence.
- **Reader:** see below.

Radii: covers 2 px, controls 10 px, sheets 20 px. Shadows are directional
book shadows, not a generic card shadow. No glassmorphism, no gradient washes.

## Reader

- Wide screens: two facing pages with a gutter shadow, soft paper curvature
  at the outer edges, and page-block edges whose thickness follows progress
  (pages read on the left, pages to come on the right).
- Phones: full-bleed single page, safe areas respected, edge taps turn pages,
  a centre tap toggles controls.
- Chrome uses the page colour, hides itself, and leaves a 2 px progress
  hairline. Sheets: contents + bookmarks (left), settings (right; bottom
  sheet on phones).

## Motion

| Moment | Duration | Notes |
|---|---|---|
| press feedback | 120 ms | |
| hover / toggles | 200 ms | |
| drawers / sheets | 300–320 ms | |
| page turn: curl (default) | 560 ms (340 ms when flipping quickly) | the leaf folds over from the bottom corner with a shaded back and a cast shadow; on touch screens it follows the finger and settles back on a short drag. Text is never re-laid out or distorted: snapshots are only clipped (see decisions §10) |
| page turn: slide / fade / instant | 420 / 220 / 0 ms | reader settings ("পাতা ওল্টানোর ধরন"); slide is foliate's own motion with a leaf shadow sweeping across the page |
| book opening | ~420 ms flight + 620 ms hinge | the tapped cover flies to the book's position, waits for the book, then hinges open about its spine; 260 ms on repeat opens in a session |

Easing: "paper" `cubic-bezier(.2,.7,.2,1)`. Every animation has a
`prefers-reduced-motion` path (crossfade or none): with reduced motion a page
turn is a 220 ms fade, whatever the setting.

Highlights: yellow, green, blue, pink, purple and an underline, drawn as soft
marker strokes over the text (multiply on light pages, screen at night, so
the ink stays crisp); a note adds a small dot at the end of the passage.
