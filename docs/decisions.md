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

## 15. Offline: a small service worker of our own

The plan named Serwist. We wrote the worker ourselves (`public/sw-core.js`,
about 200 lines) because the rules are few and specific to this app, and
Serwist's precache manifest comes from a bundler plugin, while our builds
run on Turbopack:

- **Pages** are network first, and every page that loads is kept. The app
  navigates in the browser, so those navigations never pass the worker as
  page loads: the page names each new path to the worker, which fetches and
  keeps it. With no network and no copy, the worker serves `/offline`, which
  lists the books on this device.
- **Build assets and fonts** are cache first (content-hashed or immutable).
  On a first visit the page is not yet controlled by the worker, so the page
  reports every script and font it has loaded (a `PerformanceObserver`) and
  the worker keeps them. Without that, the reader's engine, loaded on
  demand, would be missing offline.
- **Book files are not touched.** They already live in IndexedDB, keyed by
  hash; a second copy in the Cache API would double the storage.
- **Reader pages** are kept by path. Their response carries its own nonce
  CSP header, and the kept copy is served with that header, so the cached
  page and its policy still match. A reader link's `?cfi=` is read by the
  page itself, so links to a passage work offline too.
- **Builds:** pages reference their build's scripts, so they are kept per
  build (`/sw.js` names the build; a new build installs a new worker). The
  new worker fetches every page the old one kept, and only then drops the
  old copies.
- Never kept: `/admin`, `/api`, the sign-in link page, redirects, errors.

The worker is registered in production builds only. Browser tests block it
(`serviceWorkers: "block"`), except `offline.spec.ts`, because a worker
answering requests hides them from `page.route()`.

## 16. A reader's own books: on the device unless asked

An EPUB a reader adds is checked and cleaned in their browser
(`src/lib/personal/import.ts`), then stored in IndexedDB like a catalogue
book's file. Nothing about it leaves the device by default: not the file,
not its title, not a highlight made in it.

- **Cleaning** reuses the catalogue's rules, run on the reader's device:
  scripts, event handlers, forms, frames, remote images and stylesheets,
  `javascript:` links and CSS that reaches outside the book are removed
  (`src/lib/epub/clean.ts`), and the book is repacked. The reader's CSP
  still applies when it is read: cleaning is the first wall, not the only
  one. DRM-protected books are refused with a reason; obfuscated fonts are
  not DRM and are kept.
- **One id everywhere.** The repacked file is deterministic (sorted entries,
  a fixed timestamp), so the same EPUB gets the same SHA-256 on every
  device; the book's id is `mine-` and the first 24 hex digits. Catalogue
  slugs can never start with `mine-` (a check constraint), so a reader's
  book can never collide with one.
- **Staying on the device** is enforced at the sync layer, not by
  convention: `staysOnDevice` drops every outbox change about a device-only
  book (its record, library entry, place, highlights, notes, bookmarks)
  before the push. The test checks the server sees none of it.
- **"Keep in my account"** is a button, never a default. It uploads the
  file to a private bucket, in the reader's own folder (`<uid>/<sha>.epub`;
  50 MB a file, 200 files and 1 GB per reader, enforced in the storage
  policy), and requeues the book's rows so they sync from then on. Another
  device sees the book and downloads the file on demand, checking its hash.
- **Deleting** removes the file from storage first, then every row. Account
  deletion empties the folder first; the database refuses to delete an
  account while files remain, so no bytes are orphaned.
- **Sign-out** keeps device-only books (they were never the account's) and
  removes books that came from the account. "Remove everything from this
  device" removes both.

## 17. Goodreads: a file, matched by sound

Goodreads closed its API to new keys in 2020, so the exchange is the CSV
the reader exports from Goodreads ("Import and export"). It is read and
matched in the browser; nothing is uploaded.

- **Matching.** Our books are public-domain Bengali editions without ISBNs,
  and Goodreads spells their titles in many romanisations (Debdas, Devdas;
  Golpoguccho, Galpaguchchha) or in Bengali script. Titles and authors are
  reduced to a phonetic skeleton (`src/lib/transfer/phonetic.ts`):
  consonants only, with the letters romanisations confuse folded together
  (v/b, sh/s, th/t, chh/ch; ্য and ্ব dropped), a mark for a word that
  starts with a vowel, and a few surname pairs that share no letters
  (Chatterjee/Chattopadhyay, Tagore/Thakur). Words are then compared with a
  little tolerance (one letter in longer words, run-together names), and
  English titles we know as other names (The Golden Boat) come from the
  catalogue's `title_latn` aliases.
- **The reader decides.** A book is "found" only when exactly one of ours
  agrees on both title and author. Close calls, two books that fit equally
  (two parts of Srikanta) and the right title by another author go to
  "Is this the book?", unchosen. Nothing is added before the reader presses
  the button.
- **Never overwriting.** For books already in the library, Goodreads only
  fills what is empty (a rating, a reflection) unless the reader asks for
  its status and dates. A reflection written here is never replaced.
  Reviews and private notes come in as private reflections, by choice.
- **Export** writes Goodreads' own column set (so Goodreads, StoryGraph and
  others can import it), with English titles and authors from the
  catalogue, and our id, Bengali title and author in extra columns that a
  later import here uses to match exactly. Reflections go out only when the
  reader ticks the box, and as Private Notes, never as public reviews.
  Cells that a spreadsheet would run as formulas are escaped.

## 18. Hardcover and Readwise: the reader's own accounts, used when asked

Both connections act for one reader, with that reader's permission, and
only when the reader presses a button. Nothing runs in the background.
Both services' documentation was re-checked on 2026-11-05.

- **Hardcover: OAuth.** Hardcover asks apps that people sign into to use
  OAuth, never a pasted personal token, and to call its API from a server.
  The app is a confidential client: authorization code with PKCE (S256),
  the client secret sent over HTTP Basic, and a check of the `iss` in the
  redirect (RFC 9207). The state, the PKCE verifier and the return path
  wait in a short-lived (ten minutes) httpOnly cookie, sealed to the
  signed-in reader. Scopes: `read:me:content read:library write:library
  read:catalog:search`, and nothing more.
- **Refresh tokens rotate.** Hardcover's access tokens last a week and its
  refresh tokens six months; each refresh returns a new pair, and using a
  refresh token twice revokes the whole chain. So refreshing is serialised
  by a lease in the database (`connection_lease`), and new tokens are only
  stored for the version that was leased (`connection_rotate`): two
  requests cannot both spend the same refresh token. A refused refresh
  (`invalid_grant`) removes the connection and asks the reader to connect
  again.
- **Readwise: the reader's token.** Readwise has no OAuth; the access token
  from readwise.io/access_token is its documented way in. It is checked
  with Readwise (`GET /api/v2/auth/`) before it is kept.
- **Sealed, server-side.** Tokens are sealed with AES-256-GCM
  (`CONNECTIONS_KEY`, held only by the web server) before they reach the
  database; the additional data names the reader and the service, so a
  sealed value copied to another row does not open. The `connections` table
  has row-level security and no policies at all: readers reach their own
  row only through `security definer` functions that take the user from
  the session, and never get a token back in the browser. No service-role
  key is involved. Without `CONNECTIONS_KEY` (and, for Hardcover, a
  registered client), the connections show as not available.
- **Bringing Hardcover books in** reads the reader's shelves and feeds them
  through the same matching and review as a Goodreads file (§17). Ratings
  are rounded to whole stars; "paused" counts as reading; books marked
  "ignored" there are left out. Hardcover reviews and notes are not
  brought in.
- **Sending books to Hardcover.** Each book is looked up in Hardcover's
  catalogue and matched with the same phonetic matching, the other way
  round; the reader confirms every unsure one. New books are added with
  `imported: true` (no posts to the reader's followers). For books already
  there, the status follows ours and a rating is only added where there is
  none. The confirmed Hardcover book is remembered on the device so the
  next send needs no second look. A reader's own books are never sent.
- **Sending highlights to Readwise.** New or changed highlights since the
  last send, or all of them on request, each with a link back to the
  passage here as its `highlight_url`, so sending one again updates it
  instead of adding another. Highlights in a reader's own books go only if
  the book is kept in the account and the reader ticks the box; a copy kept
  after an edit conflict is never sent.
- **What is not supported, and said so.** A highlight deleted here stays
  in Readwise (the profile says so). Readwise can delete a highlight by its
  id (`DELETE /api/v2/highlights/<id>/`), but creating highlights answers
  with the ids changed per book, not per highlight, so we do not know which
  id is which without listing them back (a far tighter limit: 20 a
  minute). Deleting there is left for later. Hardcover reviews, journal entries and reading dates beyond
  "finished on" do not move in either direction. Readwise allows 240 requests
  a minute and says when to wait (`Retry-After`), which we do. Hardcover's
  limit is a bucket of ten tokens refilled at 60 a minute, where every
  top-level field of a request costs one: each call from the browser
  spends at most the bucket, and the browser keeps its own copy of the
  bucket and waits before a call that would overdraw it. A large library
  takes minutes (about a book a second), and the page says so.
- **Leaving.** Disconnecting revokes Hardcover's tokens at Hardcover and
  deletes the row; deleting the account does the same for every connection
  first, and the rows go with the account in any case.
- **Tests** run against stand-ins for both services
  (`tests/e2e/mock-upstreams.ts`) that follow the documented behaviour:
  PKCE, Basic client auth, rotating refresh tokens that revoke the chain
  when replayed, and highlight updates by `highlight_url`.
- **Checked live** on 2026-11-05, with a reader's own accounts and the
  app's own server code (a Hardcover personal token standing in for the
  OAuth one, sent the same way, as a bearer token). Hardcover: the reader,
  the library, the catalogue search (the Bengali গোরা is found by its
  Bengali title), and a book added quietly (no activity in the feed),
  read back, left alone when sent again, then removed; every input field
  and mutation used exists in the live schema. Readwise: the token
  check, a highlight sent with its title, author, note and link, the same
  highlight sent again updated rather than doubled, then deleted. Readwise
  lists each highlight with our link, which is how a later "delete there
  too" could find it; it keeps the book, empty, after its last highlight
  goes. Hardcover's OAuth sign-in itself (authorize, token, refresh,
  revoke) has not met the live service: it needs a registered client. A
  personal token may do everything, so whether the four scopes above are
  enough is also still to be seen.
