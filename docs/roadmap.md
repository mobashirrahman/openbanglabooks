# Roadmap and known limitations

## Phase 1 — the reading experience (done)

Catalog, reader, local library, SEO, brand, deployment files. See the README.

### Known limitations

- **Safari is tested through WebKit, not on a physical iPhone.** The suite
  runs in Playwright's WebKit with iPhone, iPad and desktop Safari profiles
  (see the README). Things only a real device shows (the iOS keyboard,
  Safari's collapsing toolbars while scrolling, memory limits on old phones)
  still need a check on hardware before launch.
- **Reflow keeps your place on the page, not at its top.** After a size or
  layout change the first word you were reading stays on screen, but the
  page is re-cut, so it may sit lower on the page (as in Apple Books).
- **Section-level teardown race in foliate-js:** its ResizeObserver can fire
  while a section iframe is being removed and log an error. Seen only when
  closing a page mid-render; no effect on reading.
- **Page-curl drags are tested in Chromium only.** Timed curls (taps, keys)
  are tested in both engines, but Playwright's WebKit cannot create
  synthetic touch events, so dragging the leaf in Safari has not been
  exercised automatically. Firefox turns pages with the slide.
- **No offline app shell yet.** Books you have opened are cached in
  IndexedDB and reopen offline, but the pages around them need a network
  until the service worker lands (Phase 3).
- **Catalog size.** 14 works. পথের পাঁচালী and দুর্গেশনন্দিনী are waiting for
  Wikisource transcription; Kazi Nazrul Islam is in copyright in BD/IN until
  the end of 2036.

### Done ahead of Phase 2 (on this device, no account needed)

Highlights (five colours, underline) and notes with a "আমার নোট" page,
search, filters and Markdown/JSON export; search inside a book; quote cards;
daily reading goals with streaks and time-left estimates; the page curl.
Everything is stored locally with `updatedAt` on every row, ready for sync.

## Phase 2 — personal reading

- **Accounts:** Supabase Auth with email OTP / magic link (Mailpit locally);
  Google OAuth once keys are provided.
- **Schema:** `user_books`, `user_shelves`, `shelf_items`,
  `reading_positions` (per device), `reading_sessions`, `bookmarks`,
  `annotations`, `reader_settings`; RLS `user_id = auth.uid()` with pgTAP
  tests.
- **Sync:** a Dexie outbox → `sync_push` (row-level last-writer-wins on
  `updatedAt`, tombstones) and `sync_pull(since server_seq)` on focus,
  interval and reconnect. Conflicting note edits produce a conflict copy;
  diverging positions offer a non-blocking "continue from 42% on your other
  device?" prompt. Guest data is claimed on first sign-in.
- **Annotations:** selection toolbar (highlight, underline, note, bookmark,
  copy); anchors = CFI range + text quote (exact/prefix/suffix) + file hash;
  re-anchoring falls back to quote search, else the note is marked orphaned
  (never silently re-attached).
- **আমার নোট:** browse, filter by book/author, search, edit, delete, jump to
  passage, export Markdown/JSON.
- **Shelves:** default (reading, want to read, finished, favourites, did not
  finish) plus custom shelves, ratings, private reflections.
- **Admin UI:** works, authors, editions, covers, genres, publication status,
  validated EPUB upload; server actions with role checks.

## Phase 3 — ecosystem and refinement

- **Goodreads:** CSV import/export with transliteration-aware matching and a
  manual resolution step (no live API).
- **Hardcover (GraphQL) and Readwise (highlights API):** user-authorised
  only. Re-verify the current documentation before building; anything
  unsupported is documented, not faked. Tokens are encrypted server-side.
- **Personal EPUB import:** local-only by default, sanitised in the browser,
  cloud upload strictly opt-in.
- **Offline:** service worker (app shell + cached books), installable PWA
  polish.
- **Polish:** reading goals, performance tuning on mid-range Android, a
  final accessibility and motion review.
