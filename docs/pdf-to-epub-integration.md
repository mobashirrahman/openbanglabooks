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

## Next planned steps

1. **Structure:** make `recover_structure` the default only where it demonstrably
   helps; add line-level heading splitting for pages where the heading is
   merged into the first paragraph. Re-test on the songbook and Nishkriti.
2. **Proofreading:** wire `pdf-craft`'s `ConservativeProofreader` +
   `TesseractCropVerifier` into `pdf2epub`, with a review-only mode first.
3. **Publication:** port the publication queue's provenance, revisions and
   EPUBCheck gate into `pdf:publish`.
