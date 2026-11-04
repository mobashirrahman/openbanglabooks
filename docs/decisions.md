# Architecture decisions

Short records of the choices that shape the code, and why.

## 1. foliate-js as the EPUB engine, behind an adapter

**Chosen over** epub.js (last release Feb 2022). foliate-js is actively
maintained, renders reflowable EPUB 2/3 with real pagination, supports
spreads (`max-column-count`), CFIs, annotation overlays and touch snapping.
It is not published on npm, so it is a pinned git submodule
(`vendor/foliate-js`). All access goes through `src/lib/reader/engine.ts`
so upstream API changes stay contained. We build the book object ourselves
(`epub-loader.ts`, fflate), which skips foliate's file sniffing (and its PDF
path) and lets us sanitise section markup.

## 2. Reader security: a separate root layout with a nonce CSP

foliate renders sections in same-origin `blob:` iframes with
`sandbox="allow-same-origin allow-scripts"` (needed for events in WebKit), so
the sandbox does not contain scripts. Blob documents inherit the CSP of the
document that created them. The reader therefore runs under a strict
`script-src 'nonce-…' 'strict-dynamic'` policy (`src/proxy.ts`).

CSP is per document, so the reader must always be a fresh document: it has
its **own root layout** (`app/[lang]/(reader)`), and navigation between root
layouts is always a full page load. Catalog pages stay static (nonces would
force dynamic rendering) with a baseline CSP. Defence in depth: ingestion
emits only whitelisted XHTML, and the reader strips active content from
section markup before rendering. Both are covered by e2e tests (a hostile
EPUB planted in the local cache, and a script-bearing blob iframe).

## 3. Positions are CFIs of the first visible character

Positions, bookmarks and resume points are EPUB CFIs, never page numbers.
foliate's visible-range CFI can start on an element boundary (a paragraph
that began on an earlier page); we derive a point CFI at the first visible
character instead (`firstCharRange` in `engine.ts`). After any presentation
change (font, size, spacing, margins, layout, viewport) the reader navigates
back to the CFI it held before the change. CFIs are only valid for the exact
file they came from (`book_files.sha256`); when a book's file changes,
reading resumes by progress fraction.

## 4. Catalog in Postgres from day one; pages are static

Works, editions and files are separate (`supabase/migrations`), with RLS:
anonymous reads see published rows only, writes require the editor role, and
the database refuses to publish a work without a recorded rights basis. Pages
read the catalog with the anon key inside `"use cache"` functions tagged
`catalog`, so they prerender at build time and refresh via
`POST /api/revalidate` after ingestion or edits.

## 5. Our own Wikisource → EPUB assembler

WS Export cannot export works that lack a root page (e.g. পথের পাঁচালী), and
we wanted one code path for cleanup, typography, attribution and
sanitisation. The pipeline (`scripts/ingest`) fetches chapters through the
MediaWiki API, gates on completeness and the public-domain rule, serialises
through a whitelist, and builds deterministic EPUBs (same input, same bytes,
same hash). Files are content-addressed in storage and served same-origin
with immutable caching.

## 6. Generated covers; Playwright for social images

No scanned or third-party cover art (no rights questions; one coherent
library). Covers are HTML/CSS with live text. Social images are rendered by
Playwright from the real pages — Satori (`next/og`) does not shape Bengali
conjuncts. Logo text is outlined with HarfBuzz for the same reason.

## 7. Locales: Bengali unprefixed, English under /en

`app/[lang]` with the locale as a root param; `proxy.ts` rewrites
unprefixed URLs to `bn` and redirects `/bn/…` to the canonical form.
`hreflang` alternates are emitted only where English text exists.

## 8. Local-first state in IndexedDB

Reading positions, the local library, bookmarks, reader settings and cached
EPUB files live in Dexie (`src/lib/local/db.ts`). Every row carries
`updatedAt` so Phase 2 can sync them with last-writer-wins plus conflict
copies. Reader settings are mirrored to localStorage so the first render
already has the right theme and size.

## 9. Self-hosted deployment

Next.js `output: "standalone"` in a container behind Caddy (automatic TLS),
Supabase external. HTTPS is required in production (WebCrypto, service
worker). See `docs/deploy.md`.
