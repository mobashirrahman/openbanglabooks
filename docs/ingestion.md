# Adding books

Books come from `content/catalog.yaml` and are built by `pnpm ingest`.

## The inclusion rule

A work is published when its text is **complete and proofread**. Every
transcription must cover all chapters, and every transcluded Wikisource scan
page must have quality ≥ 3; an index reporting unproofread pages blocks the
build.

Source and licence are recorded per edition (`source_name`, `source_url`,
`license`, `attribution`) so the catalog stays traceable, but they do not gate
publication. Editorial matter added by modern publishers (e.g. a Visva-Bharati
appendix) is excluded with `exclude:`.

### Not included yet (checked 2026-11-04)

- **পথের পাঁচালী** — only 12 of 35 chapters transcluded; 167 of 235 scan pages
  unproofread on Wikisource.
- **দুর্গেশনন্দিনী** — several second-part chapters missing.
- **Kazi Nazrul Islam** — in copyright in BD/IN until the end of 2036.

When Wikisource volunteers finish a text, add it to the manifest and re-run.

## Pipeline

```
Wikisource (MediaWiki API, cached in .cache/wikisource, polite rate limit)
  → chapter list (root page links, or a "next" chain)
  → completeness gate
  → clean (remove headers, page numbers, edit links) + whitelist XHTML serialiser
  → deterministic EPUB 3 with NCX, title page, source/licence colophon
  → structural validation (src/lib/epub/validate.ts)
  → upload to storage as <sha256>.epub (content-addressed, immutable)
  → upsert works / editions / book_files / genres / collections
  → POST /api/revalidate to refresh a running site
```

Builds are deterministic: unchanged sources produce byte-identical EPUBs, so
`sha256` is stable and readers' saved positions (CFIs) remain valid. When a
text changes, the file hash changes; readers resume by progress fraction.

## Manifest fields

```yaml
- slug: devdas                 # URL: /books/devdas
  title_bn / title_en / title_latn   # latn = romanised spellings for search
  author: sarat-chandra-chattopadhyay
  form: novel | short-stories | poetry | essays | drama
  genres: [upanyas]            # supabase/seed.sql
  collections: [classics]
  first_published: 1917        # drives the US rule
  featured_rank: 2             # optional, home page
  poem_labels: true            # optional, TOC shows each poem's first line
  source: { root: "<Wikisource title>", exclude: [পরিশিষ্ট] }   # or { chain: "<first chapter>" }
  description_bn / description_en   # original editorial text
```

Descriptions and biographies are written fresh (never copied from Wikipedia),
with facts cross-checked against Wikisource and Wikidata.

## Commands

```bash
pnpm ingest --dry                 # build + validate only
pnpm ingest --only gora,devdas    # selected works
pnpm exec tsx scripts/ingest/check.ts "<Wikisource root>"   # completeness report for a candidate
```

## PDF → EPUB

Scanned or digital PDFs use a separate two-stage pipeline. Python extracts the
text layer (or runs Surya OCR), detects chapters, parts, footnotes, figures,
tables and page numbers, then TypeScript builds and validates the EPUB:

```bash
pnpm pdf:epub -- scan.pdf --out dist/scan.epub \
  --title "বইয়ের নাম" --author "লেখকের নাম" \
  --source-name "Scan: 1932 edition" --rights "Public domain"

# or use the pdf-craft Tesseract extractor
pnpm pdf:craft -- scan.pdf --out dist/scan.epub
```

A PDF conversion is still a candidate that needs a human review of the scan
before it enters the catalog. The
bundle records the source PDF's `sha256`, so the exact scan behind an edition is
reproducible. See [pdf-to-epub.md](pdf-to-epub.md) for OCR model choice
(Surya 2.5 is newer, but Surya 2 currently scores higher on Bengali), the review
checklist, and troubleshooting.

## Uploading authorised EPUBs (publisher contributions)

Phase 2 adds an admin UI for this. Until then, files that a publisher has
licensed can be validated with `validateEpub` and uploaded with the same
storage/catalog steps; their XHTML is sanitised at render time and the reader
CSP blocks scripts regardless.
