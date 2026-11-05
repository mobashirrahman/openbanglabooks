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
- ~~No offline app shell yet.~~ The service worker landed in Phase 3.
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

### Done so far

- **Offline and installable:** a service worker of our own
  ([decision 15](decisions.md#15-offline-a-small-service-worker-of-our-own)).
  The library, notes, profile and every page visited open without a
  network; books opened once read offline, including links to a passage;
  `/offline` lists the books on the device. The profile has an "App"
  section to install it (or how to, on iOS). The manifest has shortcuts to
  the library and notes.
- **Your own EPUBs** ([decision 16](decisions.md#16-a-readers-own-books-on-the-device-unless-asked)):
  "Add your own book" in the library (or drop a file on the page) checks,
  cleans and repacks the book on the device. It stays there, with its
  highlights and notes, until the reader chooses "Keep in my account";
  then it follows them to their other devices. DRM-protected books are
  refused with a reason.
- **Goodreads** ([decision 17](decisions.md#17-goodreads-a-file-matched-by-sound)):
  `/library/goodreads` reads a Goodreads export, finds its Bengali books in
  the catalogue across spellings and scripts, asks about the doubtful ones,
  and adds them with status, rating, dates, shelves and (by choice) reviews
  as private reflections. The library goes back out as a Goodreads-format
  file.

### Known limitations (Phase 3 so far)

- **Offline needs one online visit.** The worker installs on the first
  visit; pages never opened are not kept (the offline page says so and
  offers the books that are). Safari may clear a site's storage after
  about seven days unused unless it is installed to the home screen; books
  and pages then download again.
- **Device-only books are not backed up.** That is the promise, and the
  risk: a lost phone loses them. The import dialog and the library say
  where each book lives.
- **Own books lose what is not text.** Cleaning removes scripts, forms and
  anything fetched from outside the book (remote images, fonts, styles), so
  an EPUB that relies on them reads plainer than in its own app.
- **Goodreads has no "date started" in its export,** so imported books keep
  only the date added and the date read. Most of a typical Goodreads
  library is not in our catalogue (public-domain Bengali only); those rows
  are listed and left out.
- **Goodreads' own import matches by ISBN first.** Our editions have none,
  so on Goodreads the exported books are found by title and author, and a
  Bengali-only title may not be found there.
- **A flaky page-turn test.** "A tap while the leaf is still turning"
  fails about one run in six in WebKit at desktop sizes on a loaded test
  machine (the second tap is lost). Reader code is unchanged in Phase 3;
  to be looked at in the polish step.
