# Architecture decisions

Short records of the choices that shape the code, and why.

## 1. foliate-js as the EPUB engine, behind an adapter

**Chosen over** epub.js (last release Feb 2022). foliate-js is actively
maintained, renders reflowable EPUB 2/3 with real pagination, supports
spreads (`max-column-count`), CFIs, annotation overlays and touch snapping.
It is not published on npm, so it is a pinned git submodule
(`vendor/foliate-js`). All access goes through `src/lib/reader/engine.ts`
so upstream API changes stay contained. The submodule is never patched
(a patched submodule points at a commit upstream does not have); behaviour we
need to change is handled around it:

- foliate snaps the page on every `touchend`, also after a still tap, and that
  snap can race the page turn the same tap starts and pull the page back. The
  adapter keeps a still touch's `touchend` from foliate (`guardTapSnap`).
- foliate drops a turn requested while one is running (including a chapter
  load). The reader remembers one such turn and runs it next, so taps are
  never lost.
- foliate's page margins live in its shadow DOM, outside the section iframe,
  so the reader handles taps on the host as well as inside the text. We build the book object ourselves
(`epub-loader.ts`, fflate), which skips foliate's file sniffing (and its PDF
path) and lets us sanitise section markup.

## 2. Reader security: a separate root layout with a nonce CSP

foliate renders sections in same-origin `blob:` iframes with
`sandbox="allow-same-origin allow-scripts"` (needed for events in WebKit), so
the sandbox does not contain scripts. Blob documents inherit the CSP of the
document that created them. The reader therefore runs under a strict
`script-src 'nonce-…' 'strict-dynamic'` policy (`src/proxy.ts`). Its
`frame-ancestors` is `'self'`, not `'none'`: WebKit applies the inherited
`frame-ancestors` to the blob: chapter frames themselves, and with `'none'`
Safari refuses to load the book. `'self'` still blocks framing by any other
site.

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

Detail pages (`books`, `authors`, `genres`, `collections`) export
`ensureStatic = "navigation"`. Without it, a slug that was not prerendered is
served from the fallback shell, the response has already started when the
page calls `notFound()`, and the first visit is a soft 404 (status 200). With
it, Next waits for the complete render, so unknown slugs get a real 404 and
new books (added after a build) are rendered once and then cached. The reader
is per-request by design (CSP nonce), so its 404 streams: it is branded and
`noindex`, with status 200.

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

## 10. Page curl with View Transitions, in two engine modes

The curl must not re-lay out or distort text, and must look the same with
highlights, fonts and the night theme. So it never draws text itself: the
View Transitions API snapshots the outgoing page (exact pixels, iframe
included) while the page changes underneath, and each frame clips the layers
to a flat-fold geometry (`src/lib/reader/page-curl.ts`, unit tested): the
part of the leaf still lying flat, the lifted part showing the page beneath
with a cast shadow, and the lifted part folded over as shaded paper. Timed
turns move the corner on an arc; drags put it under the finger and settle
forward or back on release (distance and speed).

Engines differ in how they show the *incoming* page during a transition, and
the book lives in an iframe:

- **Blink ("named")**: the page is its own transition layer; its live image
  includes iframe content.
- **WebKit ("root")** — Safari and every browser on iPhone and iPad: a named
  element's live image leaves out iframe content and misses per-frame style
  changes, but the live document itself shows through wherever the screen
  snapshot is clipped away. So the screen snapshot is clipped, and the flap
  and shadow are live elements seen through it. A backward turn on one page
  peels the current page away (mirrored) instead of swinging the previous one
  back, because nothing live can be drawn above the snapshot.
- **Other engines** (not verified): the slide.

Rejected: a WebGL curl (it needs the page as a texture, and there is no API
to rasterise the live page – a redrawn copy would lose crisp text) and DOM
clones of the page (a second layout on every turn, with highlights and the
selection missing from the moving page).

## 11. Bengali-aware search of our own

foliate's search compares runs of grapheme clusters; since ICU 74 a Bengali
conjunct is one cluster, so text with a ZWNJ inside a conjunct and a query
without it never line up. `src/lib/reader/book-search.ts` searches a
normalised copy of each chapter (canonically decomposed, joiners removed,
lower-cased for Latin) that maps every character back to its DOM position,
so matches become exact ranges and CFIs. Vowel signs and hasanta always count.


## 12. Accounts: an emailed code first, the link second

Readers sign in with a six-digit code from the email, typed on any device
(Bengali digits accepted); the same email carries a link for this device.
The link opens a client page that verifies the token in the browser, so mail
scanners that prefetch links cannot use it up. No passwords to forget or
leak. supabase-js loads only when a session cookie exists or on the sign-in
page, so anonymous reading pays nothing for accounts.

## 13. Sync: an outbox written by a Dexie middleware

Every write to a synced table, from any code path, is recorded in an
`outbox` store in the same transaction by a DBCore middleware
(`src/lib/local/outbox.ts`); writes applied from the server are marked
untracked. That makes "forgot to sync this write" impossible by
construction. The server keeps a per-user version counter (a row lock makes
it gapless), so `sync_pull(since)` pages never skip a change. Rules:

- push before pull; last writer wins on `updated_at` (client clocks are
  clamped to now + 5 minutes);
- deletes are tombstones without their text;
- notes are never lost: two concurrent edits keep the loser as a conflict
  copy, and an edit outlives a delete made elsewhere;
- reading places and reading time are per device, so devices never fight
  over "where am I"; the reader offers a newer place instead.

Rejected: syncing whole tables by timestamp (misses deletes and clock-skewed
writes), CRDTs (heavy for single-user data where conflicts are rare).

## 14. Admin: server actions, invoker functions, RLS twice

Admin pages render per request as the signed-in editor; the proxy refreshes
the session for `/admin` only. Each server action checks the role itself and
validates its input, then writes with the editor's own session, so row level
security checks again. Saves that touch several tables are single
`security invoker` functions (`admin_save_work`, …), so a failed save changes
nothing. EPUB upload is a route handler (books outgrow server action and
proxy body limits) that checks the origin and role itself, validates the
file before storing it, and stores it content-addressed.
