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
| Signature motion: cover-to-book opening, page-turn leaf shadow, reduced-motion paths | Done |
| Local library (IndexedDB): continue reading, want-to-read, finished, bookmarks | Done |
| SEO: metadata, canonical, hreflang, JSON-LD, sitemap, robots, OG images | Done |
| Security: strict nonce CSP for the reader, EPUB sanitising, RLS everywhere | Done |
| Content: 14 verified works ingested from Bengali Wikisource | Done |
| Accounts, sync, highlights/notes, admin UI (Phase 2) | Not started — see [docs/roadmap.md](docs/roadmap.md) |
| Goodreads/Hardcover/Readwise, personal EPUB import, service worker (Phase 3) | Not started |

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
| `pnpm test:e2e` | Browser tests at six viewports (needs a running build on :3100, see below) |
| `pnpm typecheck` | Route type generation + `tsc` |

## Testing

```bash
pnpm test                                   # unit: rights rule, sanitiser, EPUB validation, …
pnpm build && pnpm start -p 3100 &          # production server for browser tests
pnpm test:e2e                               # all six viewports
pnpm test:e2e --project=mobile-390          # one viewport
```

Screenshots for visual review land in `test-results/screenshots/<viewport>/`.
Viewports: 375×812, 390×844, 768×1024, 1024×768, 1440×900, 1920×1080
(Chromium with touch emulation for the mobile/tablet sizes).

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
