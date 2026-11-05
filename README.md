# OpenBanglaBooks — ওপেন বাংলা বুকস

**বাংলা বইয়ের উন্মুক্ত পাঠাগার** — *Discover. Read. Remember.*

A digital library of Bengali literature with an immersive EPUB reader: genuine
two-page spreads on wide screens, a single-page native-feeling reader on
phones, local-first reading progress and bookmarks, and an indexable,
SEO-ready public catalog. Only public-domain or openly licensed books are
published, each with its source and rights basis recorded.

## What's in it

| Area | Status |
|---|---|
| Public catalog: home, book, author, genre, collection, browse + filters, search | Done (SSG/PPR, bn + en) |
| Reader: foliate-js engine, spreads/single page, tap/swipe/keys, TOC, bookmarks, settings, CFI persistence | Done |
| Signature motion: cover-to-book opening, a page curl that follows the finger (slide, fade or instant as options), reduced-motion paths | Done |
| Highlights in five colours and underline, notes, "আমার নোট" with search, filters and Markdown/JSON export | Done (synced when signed in) |
| Search inside a book (Bengali-aware), quote cards to save or share, daily reading goals with streaks, time left in chapter and book | Done |
| Library (local-first in IndexedDB): continue reading, statuses, favourites, own shelves, bookmarks | Done |
| SEO: metadata, canonical, hreflang, JSON-LD, sitemap, robots, OG images | Done |
| Security: strict nonce CSP for the reader, EPUB sanitising, RLS everywhere | Done |
| Content: 14 verified works ingested from Bengali Wikisource | Done |
| Accounts (emailed code or link), sync across devices, shelves, ratings, reflections, history | Done (Phase 2) |
| Admin: works, authors, editions, validated EPUB upload, genres, collections | Done (Phase 2, editors only) |
| Offline app (service worker, installable), your own EPUBs (device-only unless kept in the account), Goodreads import/export | Done (Phase 3) |
| Hardcover (OAuth: shelves in and out) and Readwise (highlights out), tokens sealed on the server | Done (Phase 3, needs per-site setup: [docs/deploy.md](docs/deploy.md)) |
| Performance and accessibility pass | In progress (Phase 3) |

## Stack

Next.js 16 (App Router, Cache Components, Turbopack) · React 19 · TypeScript ·
Tailwind CSS 4 · shadcn/ui (Radix) · Motion · foliate-js (vendored, pinned) ·
Dexie (IndexedDB) · Supabase (Postgres, RLS, Storage) · Vitest · Playwright.

## Local setup

Requirements: Node 26 (LTS), pnpm 12, Docker (for local Supabase).

```bash
git clone --recurse-submodules <repo> && cd puthi   # foliate-js is a submodule
pnpm install
pnpm db:start            # trimmed local Supabase (db, auth, rest, storage, mail)
pnpm exec supabase status -o env   # copy URL + keys into .env.local (see .env.example)
pnpm db:reset            # applies migrations + seed (genres, collections)
pnpm ingest              # builds and publishes the 14 verified books (~2 min, cached afterwards)
pnpm dev                 # http://localhost:3000
```

If you cloned without submodules: `git submodule update --init`.

Useful scripts:

| Script | What it does |
|---|---|
| `pnpm ingest [--only slug,slug] [--dry]` | Wikisource → verified EPUB → storage + catalog ([docs/ingestion.md](docs/ingestion.md)) |
| `pnpm render:og` | Renders Open Graph images from a running site into `public/og` |
| `pnpm brand` | Regenerates logos, favicon and PWA icons from the mark geometry |
| `pnpm fonts` | Re-syncs self-hosted Bengali font subsets from @fontsource |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:e2e` | Browser tests at six viewports in Chromium and WebKit (needs a running build on :3100, see below) |
| `pnpm test:e2e:webkit` | The WebKit (Safari engine) projects only |
| `pnpm typecheck` | Route type generation + `tsc` |
| `pnpm db:test` | Database tests (pgTAP): personal data isolation, sync rules, catalogue permissions, connection secrets |

## Testing

```bash
pnpm test                                   # unit: rights rule, sanitiser, EPUB validation, …
pnpm build && pnpm start -p 3100 &          # production server for browser tests
pnpm test:e2e                               # everything: 6 Chromium + 7 WebKit projects
pnpm test:e2e:webkit                        # WebKit (Safari engine) only
pnpm test:e2e --project=mobile-390          # one viewport, one engine
pnpm db:test                                # pgTAP against the local database
```

The account, sync and admin tests need the local Supabase stack: sign-in
emails are read from Mailpit (http://127.0.0.1:54324), and the admin test
uses the service-role key from `.env.local` to make its test account an
editor and to remove the rows it created.

To test a new build while a server is still running from `.next`, build into
another folder and point the tests at its port:

```bash
NEXT_DIST_DIR=.next-e2e pnpm build && NEXT_DIST_DIR=.next-e2e pnpm start -p 3101 &
E2E_PORT=3101 pnpm test:e2e
```

The connection tests talk to stand-ins for Hardcover and Readwise
(`tests/e2e/mock-upstreams.ts`, which Playwright starts on :3199). Start the
server with their test-only settings, or those tests skip themselves:

```bash
set -a; . tests/e2e/upstreams.env; set +a
NEXT_DIST_DIR=.next-e2e pnpm start -p 3101 &
```

Browser tests block the service worker (it would answer requests that tests
intercept); `offline.spec.ts` turns it on and tests reading without a network.

Viewports: 375×812, 390×844, 768×1024, 1024×768, 1440×900, 1920×1080, each in
two engines:

- **Chromium** (`mobile-390`, …) with touch emulation for the phone and tablet sizes.
- **WebKit** (`webkit-mobile-390`, …) with Apple device profiles: iPhone 13 mini and
  iPhone 13, iPad mini portrait and landscape, desktop Safari. One more project,
  `webkit-iphone-safari-ui`, uses an iPhone 13 as Safari really shows it
  (390×664, with the address bar and toolbar taking part of the screen).

WebKit is Playwright's build of Safari's engine on Linux. It catches WebKit
rendering and behaviour (it found two real Safari bugs), but it is not Safari
on a physical iPhone. It needs system libraries once:
`sudo pnpm exec playwright install-deps webkit`.

Screenshots for visual review land in `test-results/screenshots/<project>/`.

## Project layout

```
src/app/[lang]/(site)/     catalog + personal pages (static root layout)
src/app/[lang]/(reader)/   immersive reader (own root layout, per-request CSP nonce)
src/app/api/               search, EPUB delivery, revalidation
src/proxy.ts               locale routing (bn unprefixed, /en) + CSP
src/lib/catalog/           cached, RLS-scoped catalog queries
src/lib/reader/            foliate adapter, layout, styles, settings, persistence
src/lib/local/             Dexie schema (local-first state)
src/components/            brand, cover, catalog, nav, reader, library
vendor/foliate-js          EPUB engine (git submodule, pinned)
supabase/                  migrations, seed
scripts/                   ingestion, fonts, brand, OG rendering, dev screenshots
content/catalog.yaml       the curated, rights-checked catalog manifest
docs/                      design, decisions, ingestion, deployment, roadmap
```

## Documentation

- [docs/design.md](docs/design.md) — brand, tokens, typography, motion
- [docs/decisions.md](docs/decisions.md) — architecture decisions and why
- [docs/ingestion.md](docs/ingestion.md) — adding books, the rights rule
- [docs/deploy.md](docs/deploy.md) — self-hosted Docker deployment
- [docs/roadmap.md](docs/roadmap.md) — Phase 2 and 3 plans, known limitations

## Content and licences

Book texts: Bengali Wikisource transcriptions (CC BY-SA 4.0) of public-domain
works; every EPUB ends with source links to the exact page revisions used.
Covers and brand: original. Fonts: SIL Open Font License (Noto Serif Bengali,
Tiro Bangla, Hind Siliguri, Anek Bangla). foliate-js: MIT.
