# Adding books

Books come from `content/catalog.yaml` and are built by `pnpm ingest`.

## The inclusion rule

A work is published only when **all** of these hold:

1. **Public domain in Bangladesh, India and the US.** `src/lib/rights.ts`:
   the (latest) author died more than 60 years ago (BD/IN term), and the work
   was first published before the US cut-off (in 2026: before 1931).
2. **Complete and proofread text.** Every transcluded Wikisource scan page has
   quality ≥ 3 (proofread or validated), and the scan index does not report
   unproofread pages.
3. **A recorded human review.** `reviewed.by` / `reviewed.on` in the manifest
   become `rights_verified_by` / `rights_verified_at`; the database refuses
   `published` without them (`published_requires_rights` constraint).

This is a conservative screen, not legal advice. Translations, later editions
with editorial apparatus, and anything uncertain need individual review.
Editorial matter added by modern publishers (e.g. a Visva-Bharati appendix) is
excluded with `exclude:`.

### Currently excluded (checked 2026-11-04)

- **পথের পাঁচালী** — only 12 of 35 chapters transcluded; 167 of 235 scan pages
  unproofread on Wikisource.
- **দুর্গেশনন্দিনী** — several second-part chapters missing.
- **Kazi Nazrul Islam** — in copyright in BD/IN until the end of 2036.

When Wikisource volunteers finish a text, add it to the manifest and re-run.

## Pipeline

```
Wikisource (MediaWiki API, cached in .cache/wikisource, polite rate limit)
  → chapter list (root page links, or a "next" chain)
  → completeness + rights gate
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

## Uploading authorised EPUBs (publisher contributions)

Phase 2 adds an admin UI for this. Until then, files that a publisher has
licensed can be validated with `validateEpub` and uploaded with the same
storage/catalog steps; their XHTML is sanitised at render time and the reader
CSP blocks scripts regardless.
