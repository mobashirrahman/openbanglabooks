# PDF → EPUB integration test book and baseline

This note tracks the step-by-step adoption of the existing
`bengali-book-pipeline` / `pdf-craft` mechanisms into `pdf2epub`. Each step is
verified on the same standard prose book before it is committed.

## Fixture

- **Book:** `নিষ্কৃতি` — শরৎচন্দ্র চট্টোপাধ্যায়
- **Source:** 64-page scanned PDF, no text layer, 4.0 MB
- **Local path (not committed):**
  `/home/mrahman/documents/book-scrapper/granthagara/books/3e01ccccc04cbc92cbc5b63cb2ac3845dd6e860ba2cd3fa181c1d412fce00e5b.pdf`
- **Why this book:** standard prose novel, printed title page, publisher page,
  chapter headings, page numbers, no musical notation or decorative text.
- **Metadata sidecar for tests:** `docs`-external file with title, author,
  publisher, `source_date: মাঘ ১৩৫৯`, `first_published: 1953`, subjects,
  description, rights and page/evidence references.

## Baseline (before integration)

Command: Tesseract 5.5.0 + `tessdata_best`, first 12 pages, no structure
recovery, no proofreading.

```bash
pnpm pdf:epub -- <pdf> --engine tesseract --ocr always --max-pages 12 \
  --tesseract /tmp/tesseract --tessdata /home/mrahman/ocr-bench/tessdata \
  --work /tmp/opencode/nishkriti-base --out /tmp/opencode/nishkriti-base.epub \
  --title "নিষ্কৃতি" --author "শরৎচন্দ্র চট্টোপাধ্যায়"
```

Observed:

- 3 sections, 2215 words, 2 figures, cover from PDF page 1.
- One giant `মূল পাঠ` section spanning pages 1–12; the chapter heading `এক`
  was merged into the first body paragraph by the OCR layout, so neither the
  puthi heuristics nor `pdf-craft`'s `recover_structure` could promote it.
- TOC empty; printed title/publisher pages are not yet metadata sources.
- EPUB metadata had title/author/language/publisher/source only.

## Step 1 — metadata sidecar (committed)

Adopted `bengali-book-pipeline`'s sidecar semantics:

- `--metadata path` or adjacent `<book>.metadata.json`.
- CLI flags > sidecar > PDF `/Info` > filename > defaults.
- Bundle writes `metadata.json` (raw sidecar + resolved values); `book.json`
  and the EPUB `content.opf` consume the resolved fields.
- Fields: title, authors, publisher, source date, edition, subjects,
  description, rights/licence, ISBN/identifier (recorded), evidence.

Verified on the same 12 pages:

```bash
pnpm pdf:epub -- <pdf> --engine tesseract --ocr always --max-pages 12 \
  --tesseract /tmp/tesseract --tessdata /home/mrahman/ocr-bench/tessdata \
  --metadata /tmp/opencode/nishkriti.metadata.json \
  --work /tmp/opencode/nishkriti-step1 --out /tmp/opencode/nishkriti-step1.epub
```

The EPUB now carries:

- `dc:title` = নিষ্কৃতি
- `dc:creator` = শরৎচন্দ্র চট্টোপাধ্যায়
- `dc:date` = 1953
- `dc:publisher` = কামিনী প্রকাশনী
- `dc:subject` = বাংলা উপন্যাস; শরৎচন্দ্র চট্টোপাধ্যায়
- `dc:description`, `dc:rights`
- `metadata.json` in the bundle with page/evidence provenance

Checks: `pnpm typecheck`; 23 `pdf2epub` tests; `pnpm pdf:check-ocr` (tessdata
OK; local Tesseract 5.5.0 warns against the pinned 5.5.3). Commits:
`4fc5c85` (duplicate cover figure) and `7b6441e` (metadata + OCR pins).

## Step 2 — page and heading splitting (committed)

Tesseract/pdf-craft can return one `text` paragraph whose blocks are the
individual lines of several pages. The bridge used to join them into a single
`<p>`, which hid paragraph boundaries and chapter headings.

`_split_text_layout` now:

- groups blocks by PDF page (one paragraph per page instead of one per chapter);
- drops a trailing page-number block;
- lifts a leading chapter marker (`এক`, `দ্বিতীয়`, `অধ্যায় ১`, …) into a title
  paragraph before structure recovery.

Verified on the same Nishkriti 12-page extract:

- chapter label and nav entry are now `এক` (previously the generic `মূল পাঠ`);
- body text is split into page-level paragraphs with page anchors;
- 3 sections, 2197 words; the title/publisher front matter is still part of the
  first chapter and needs a later front-matter split.

Tests: `tools/pdf2epub/tests/test_pdfcraft_split.py`; full `pdf2epub` suite
(26 tests) and `pnpm typecheck` pass.

## Step 3 — opt-in conservative proofreading (implemented, experimental)

`pdf2epub` now passes the raw `.pcex` through `pdf-craft`'s
`ConservativeProofreader` when `--proofread` is set. It writes:

- `proofread/audit/p<page>-b<block>.json` — proposals, decisions, evidence;
- `proofread/evidence/*.png` — source word crops used for corroboration;
- `proofread/proofread.pcex` — the proofread extraction.

Verification on Nishkriti pages 1–5 with `qwen3.5:4b-q4_K_M`:

- the audit was produced (21 blocks; 10 unchanged, 10 review, 1 timeout);
- proposed edits such as `ক্লিকাতা → কলকাতা` were correctly held for review
  because the crop evidence did not corroborate them;
- no unsafe edit was applied;
- the run took ~46 minutes on this 4 GB host (~2 min/block), so it is opt-in,
  not a bulk default. A GPU-backed model or a narrower page range is required
  for whole books.

This step is committed as code + docs; the 5-page proofread run is a safety and
wiring check, not an accuracy claim.

## Step 4 — publication provenance and QA (implemented)

`pdf:build` now writes `publication.json` in the bundle and next to the EPUB.
It captures source/OCR/metadata/structure/validation data and can run an
optional EPUBCheck gate (`--epubcheck`, Java required).

`pdf:publish` reads that sidecar automatically (or `--publication`) and stores
its validation report and revision metadata instead of `{}`. `--dry-run`
prints the payload without touching Supabase or R2.

Verified on the Nishkriti build: the sidecar records source SHA-256/pages,
OCR model, title/author/publisher, section/chapter/TOC/page-list counts and the
internal validation report. `pnpm typecheck` and the EPUB unit tests pass.
EPUBCheck is wired but not run here because Java is not installed on this host.

## Step 5 — front matter split (implemented)

The page/heading split exposed another defect: title and publisher pages were
still part of the first chapter. `_split_front_matter` now cuts a chapter at its
first real chapter marker (`এক`, `দ্বিতীয়`, `অধ্যায় ১`, …); everything before
it becomes the `front` section.

Verified on Nishkriti 12 pages:

- 4 sections: `শিরোনাম` (title), `শুরুর পাতা` (pages 1–2, 39 words),
  `এক` (body, pages 3–12, 2159 words), `উৎস ও স্বত্ব`;
- the nav contains both the front matter and `এক`;
- the chapter body starts at the page-3 anchor, not page 1.

Tests: `test_pdfcraft_split.py` (front-matter split cases), full `pdf2epub`
suite (28 tests) and `pnpm typecheck` pass.

## Step 6 — explicit cover page (implemented)

The metadata sidecar and `--cover-page` now select a specific 1-based PDF page
as the original cover, using the same embedded-image/rendered-page path as the
automatic heuristic. `--cover none|generate` still takes precedence.

Verified on Nishkriti with `--cover-page 2`: the bundle records
`sourcePage: 2`, `source: embedded`, reason `requested PDF page 2`, and the EPUB
build uses it. The automatic page-1 cover remains the default. 30 `pdf2epub`
tests and `pnpm typecheck` pass.

## Step 7 — front-matter page images (implemented)

Page images that pdf-craft ordered after the chapter heading but whose source
page is before the chapter marker now move into the front section. The body
chapter therefore reports its real start page and does not own cover/publisher
page images.

Verified on Nishkriti 12 pages: front pages 1–2 (50 words), body `এক` pages
3–12 (2147 words), four sections, nav front + `এক`. 31 `pdf2epub` tests and
`pnpm typecheck` pass.

## Step 8 — Tesseract 5.5.3 pin (implemented)

Added `scripts/pdf/install-ocr-engines.sh` / `pnpm pdf:install-ocr` so the
pipeline can install the exact conda-forge Tesseract 5.5.3 and the pinned
`tessdata_best` without root or a pre-existing conda.

Verified on this host:

```text
tesseract: ok  5.5.3
tessdata:  ok  6e997a9bc0f9dffc3431a0b16ca856ea
```

A 2-page Nishkriti extraction with the new binary records
`pdf-craft/tesseract 5.5.3 ben@6e997a9bc0f9` in both `book.json` and
`publication.json`.

## Step 9 — EPUBCheck gate (implemented, passing)

Added `scripts/pdf/install-epubcheck.sh` / `pnpm pdf:install-epubcheck` for a
local Temurin JRE 21 + EPUBCheck 5.4.0, and wired `pdf:build --epubcheck` to
record the result in `publication.json`.

EPUBCheck found two real bugs, now fixed:

- duplicate XML ID `title` (`dc:title id="title"` collided with the title
  section manifest item); the metadata title is now `id="main-title"`;
- the `landmarks` TOC link pointed at `nav.xhtml`, which was not a spine item;
  the nav is now in the spine with `linear="no"`.

Re-run on the Nishkriti EPUB:

```text
EPUBCheck v5.4.0
No errors or warnings detected.
Messages: 0 fatals / 0 errors / 0 warnings / 0 infos
```

`publication.json` records `validation.epubcheck.status = "passed"` and the
output. `pnpm typecheck` and the EPUB unit tests pass.

## Step 10 — offline metadata resolver (implemented)

Adopted the `bengali-book-pipeline` catalogue rules for title/author:

- `pdf2epub/filename_parser.py` is vendored from
  `catalogue/filename_parser.py` (commit `181fdb46d70a`) with its upstream
  tests; local additions recognise the `book-scrapper/<source>/books/` layout
  and return no candidates for content-hash filenames.
- `pdf2epub/resolve.py` ports the `metadata_manifest` acceptance rule: a field
  is accepted from one *trusted* signal (matched filename template, or
  junk-filtered PDF `/Info`) or from two agreeing signals; trusted signals that
  disagree leave the field empty and mark the entry `ambiguous`. Cover OCR is a
  reserved weak signal. No network.
- Precedence is CLI → sidecar → resolver → `শিরোনামহীন`/`অজ্ঞাত`. The raw
  `/Info`, the file stem and pdf-craft's stem-derived document title are no
  longer used as a fallback.
- `metadata.json` always carries a `resolution` block (candidates, supporting
  signals, rejected `/Info` values, filename volume/edition/year, and which
  source was applied); `book.json` carries `metadataResolution`.

Verified on Nishkriti 12 pages (hash filename, empty `/Info`):

| Run | Resolver status | Title / author in the EPUB | EPUBCheck |
|---|---|---|---|
| with sidecar | `empty`, applied = sidecar | নিষ্কৃতি / শরৎচন্দ্র চট্টোপাধ্যায় | 0 errors / 0 warnings |
| no sidecar | `empty`, warning printed | শিরোনামহীন / অজ্ঞাত (was the 64-char hash) | 0 errors / 0 warnings |

Tests: 49 vendored parser tests + 19 resolver tests (filename formats,
conflicting signals, junk `/Info`, weak cover corroboration, precedence);
full `pdf2epub` suite 99 passed; `pnpm typecheck` and the EPUB unit tests pass.

Next: cover/title-page OCR as a corroborating signal, then local catalogue and
Wikidata lookups behind an explicit flag.

## Step 11 — scrape-record signal (implemented)

The book scraper names downloads by SHA-256 and keeps one SQLite catalogue per
site (`book-scrapper/data/<site>/catalog.sqlite3`). `--scrape-catalog <data dir>`
looks the PDF's SHA-256 up in every site catalogue (`assets → links → pages`)
and adds a `scrape` signal to the resolver:

- the scraped page title is parsed with the same per-site templates as
  filenames (`parse_source_title`; granthagara's `| ` separator is normalised);
- a matched template (confidence ≥ 0.5) is trusted; a non-empty `author`
  column (arefinlibrary) is a trusted author value;
- a filename from the same site is one source with the page, not a second
  signal: it stays a candidate but cannot corroborate (regression-tested);
- rows that disagree with each other cannot accept a title alone;
- publisher/date/ISBN/asset URL are recorded in `resolution.scrape`, never
  applied.

Catalogues are opened `mode=ro&immutable=1`. That never writes `-shm`/`-wal`
files, but SQLite then ignores any not-yet-checkpointed WAL content, so rows
the scraper is writing at that moment may be missed. Run lookups when the
scraper is idle.

Local catalogue survey (2026-11-10): ~90k pages with titles across 25 sites,
~59k hashed downloads; authors only on arefinlibrary (2,638); no publisher or
ISBN. 21,100 of granthagara's 23,175 files are Digital Library of India scans.

Verified on Nishkriti 12 pages, **no sidecar**:

```text
scrape: 1 record(s) (granthagara)
status ok, applied title = resolver, title.signals = [scrape]
EPUB: নিষ্কৃতি | অজ্ঞাত        (was শিরোনামহীন)
EPUBCheck 5.4.0: 0 fatals / 0 errors / 0 warnings
```

All 79 `catalog.sqlite3*` files under the scraper data dir had identical size
and mtime before and after the run. Tests: 110 `pdf2epub` tests pass (new
`test_scrape_catalog.py`, scrape cases in `test_resolve.py`); `pnpm typecheck`
passes.

Next: rebuild the Rokomari-derived catalogue from the published dumps
(Hugging Face `sayurio/rokomari-bd-product-data` + the RokomariBG graph) as a
local title → author index; authors still need a second signal.

## Step 12 — local Rokomari catalogue index (implemented)

The old ~194k-work catalogue was built by `pdf_craft/catalogue/importers/rokomari.py`
from the Hugging Face dump, not by scraping rokomari.com (which sits behind a
Cloudflare challenge). It is rebuilt locally from the two published dumps:

- RokomariBG (GitHub `backlashblitz/Bangla-Book-Recommendation-Dataset`):
  books, authors, `book_to_author`, publishers, categories;
- Hugging Face `sayurio/rokomari-bd-product-data`: only `productType == book`
  lines and their `specification`. The top-level `authors`/`publishers`
  fields are the site navigation menu and are ignored.

`python -m pdf2epub catalogue-build` streams both into a SQLite index
(`works`, `authors`, `meta` with input SHA-256s and counts). Summaries,
covers and prices are not stored. Both dumps are third-party research data and
are used only as local lookup evidence.

Lookup (`catalogue-lookup`): an author is common to a title when every
authored entry names them, or failing that, when they appear on ≥ 90% (and ≥ 3)
of them. Rokomari files a critical study under the bare title `গোরা`, which
otherwise empties the strict intersection. Collection titles (`গল্প সমগ্র`,
`রচনাবলী`, …) are always ambiguous.

Resolver (`--catalogue-index`): a WEAK signal. A catalogue hit corroborates a
candidate title only when exactly one non-collection candidate is found;
catalogue authors only corroborate another author signal and never conflict
with a trusted one (a note is recorded).

Verified (RokomariBG + the first 57% of the HF dump; the rest is still
downloading under HF rate limiting):

| | |
|---|---|
| works | 127,302 (BG) + 144,982 (HF partial); 67,078 author names |
| build | 24 s, peak RSS 86 MB |
| দেবদাস / গোরা / শ্রীকান্ত | শরৎচন্দ্র / রবীন্দ্রনাথ / শরৎচন্দ্র |
| পথের পাঁচালী | বিভূতিভূষণ বন্দ্যোপাধ্যায় (156 entries) |
| গল্প সমগ্র | ambiguous |
| নিষ্কৃতি | 3 HF entries → শরৎচন্দ্র চট্টোপাধ্যায় |

Nishkriti 12 pages with `--scrape-catalog` + `--catalogue-index`, no sidecar:
title নিষ্কৃতি with signals `scrape` + `catalogue`; শরৎচন্দ্র চট্টোপাধ্যায় is
recorded as a catalogue author candidate but not applied (it needs a second
signal). EPUBCheck 5.4.0: 0 errors / 0 warnings. Tests: 136 `pdf2epub` tests
pass; `pnpm typecheck` passes.

Next: cover/title-page OCR as the second author signal.

## Proofreading options measured

On the same Bengali paragraph through Ollama:

| Model | Time | Output | Observation |
|---|---:|---:|---|
| `qwen3.5:2b-q4_K_M` | 13 s | 43 tokens | fully offloaded; proposed one clearly wrong edit |
| `qwen3.5:4b-q4_K_M` | 66 s | 256 tokens (truncated) | 2.58 GB VRAM of 3.74 GB; better proposals, ~2 min at 512 tokens |

The 2B model is a fast triage/proposal generator, not an automatic editor. The
4B model is usable with crop verification but too slow for a whole book on
this 4 GB host. An 8 GB+ GPU, a fully offloaded Vulkan llama.cpp server, or a
remote Ollama endpoint is the practical path for automatic edits.

## Next planned steps

1. **Structure:** make `recover_structure` the default only where it demonstrably
   helps; add line-level heading splitting for pages where the heading is
   merged into the first paragraph. Re-test on the songbook and Nishkriti.
2. **Proofreading:** wire `pdf-craft`'s `ConservativeProofreader` +
   `TesseractCropVerifier` into `pdf2epub`, with a review-only mode first.
3. **Publication:** port the publication queue's provenance, revisions and
   EPUBCheck gate into `pdf:publish`.
