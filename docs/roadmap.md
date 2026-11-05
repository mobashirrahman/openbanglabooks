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

## Phase 2 — personal reading (done)

- **Accounts:** sign in with a six-digit code or the link in the same email
  (Supabase Auth, Mailpit locally); no passwords. Account deletion removes
  every personal row. Google sign-in is documented in `docs/deploy.md` but
  not switched on (it needs OAuth keys).
- **Sync** (local-first; nothing needs an account): every write to a synced
  table lands in an outbox in the same IndexedDB transaction; `sync_push`
  (last writer wins, tombstones) runs before `sync_pull(since version)` on
  sign-in, changes, focus, reconnect and a one-minute timer. Notes are never
  lost: concurrent edits keep a conflict copy, an edit outlives a delete
  elsewhere. Reading places and reading time are per device; an open book
  offers a newer place read on another device. Guest data is claimed on the
  first sign-in; signing out clears the account's data from that device only.
  A cloud in the header and a line on the profile page show the state.
- **Library:** want to read, reading, finished, did not finish; favourites;
  the reader's own shelves; a 1–5 rating and a private reflection per book;
  a month-by-month history.
- **Re-anchoring:** highlights from an older file of a book are found again
  by their quote and its context, or kept and marked orphaned (never
  attached to a guess).
- **Admin UI** (`/admin`, editors only): works with credits, genres,
  collections, cover and status; authors, editions, genres, collections;
  validated EPUB upload with file history. Publishing needs a verified
  rights basis.
- **Tests:** pgTAP for personal data isolation, sync rules and catalogue
  permissions; e2e for two devices of one reader, the library and the
  admin.

### Known limitations (Phase 2)

- **Reading time is summed, not de-duplicated.** Two devices reading at the
  same minute both count it.
- **No conflict UI beyond copies.** A conflicting note shows up as a second
  note marked "written on another device at the same time"; merging the two
  is left to the reader.
- **Settings sync whole.** Reader settings (theme, size, font, layout) are
  one row: the device that changed them last wins all of them.
- **Admin covers are generated variants only.** Uploading cover images
  (the `covers` bucket exists) is not built yet.
- **Roles are set in SQL.** Making someone an editor:
  `update profiles set role = 'editor' where id = '<user id>';`

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
