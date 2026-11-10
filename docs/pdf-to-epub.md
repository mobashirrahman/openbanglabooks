# PDF → EPUB

`pnpm pdf:epub` turns a scanned or digital Bengali PDF into an EPUB 3.3 book.
It is a two-stage pipeline: Python extracts and structures the text, then
TypeScript assembles, sanitises and validates the EPUB.

```bash
pnpm pdf:epub -- book.pdf --out dist/book.epub
```

The first run creates a work bundle in `.work/pdf/<stem>/`. It is kept so you
can inspect intermediate XHTML, re-build the EPUB, or re-run only the cover
step. Pass `--clean` to remove it on success.

## What it does

- **Inspects the PDF** and picks the cheapest reliable path: a good text layer
  is used directly; a scanned book goes through Surya OCR.
- **Hybrid fallback:** with `--ocr auto`, pages that contain an image but almost
  no text are OCR'd individually, so a mostly-digital book with a few scanned
  plates does not need a full OCR run.
- **Reads in the right order.** A small XY-cut separates columns, running heads,
  headings and footnotes instead of sorting blocks naively by `y`.
- **Finds structure.** Chapter and part headings, front matter, a title page,
  footnotes, figures with captions, tables and printed page numbers become
  semantic XHTML.
- **Keeps the original cover** when the PDF has one, upscaled to 1600×2400;
  otherwise it generates a cloth-green cover with HarfBuzz-shaped Bengali type
  (so conjuncts and vowel signs are correct even without a Bengali font on the
  machine).
- **Builds a clean EPUB**: EPUB 3.3 metadata, nav + NCX fallback, landmarks,
  page list, accessibility metadata, embedded Bengali fonts, per-chapter page
  anchors, linked endnotes, sanitised XHTML, and a static link check.
- **Writes a sidecar report** next to the EPUB (`book.epub.report.json`) with
  the hash, size, section count and validation result.

The bundle→EPUB stage is deterministic for the same inputs, including the cover.

## Requirements

- Node 26 and pnpm (the repo's normal requirements).
- Python ≥ 3.10 with PyMuPDF, Pillow and BeautifulSoup (Surya engine). The
  Tesseract/`pdf-craft` engine needs Python 3.11-3.13:

  ```bash
  python3 -m venv tools/pdf2epub/.venv
  tools/pdf2epub/.venv/bin/pip install -e tools/pdf2epub
  ```

  `scripts/pdf/cli.ts` uses `tools/pdf2epub/.venv/bin/python` when it exists,
  otherwise `python3`. Override with `PDF2EPUB_PYTHON=/path/to/python`.

OCR is optional, but the pipeline is pinned to the two engines measured in the
November 2026 Bengali benchmark:

| Engine | Pin | Measured result on 50 Bengali block crops |
| --- | --- | --- |
| **Surya 2** (default) | `datalab-to/surya-ocr-2`, `surya-ocr` 0.22.x | 80.1% word accuracy, 19.9% WER, 5.8 s/crop (4 GB GPU) |
| **Tesseract** (CPU) | 5.5.3 + `tessdata_best` `ben` md5 `6e997a9bc0f9dffc3431a0b16ca856ea` | 74.3% word accuracy, 25.7% WER, 0.3 s/crop |

Install Surya 2:

```bash
tools/pdf2epub/.venv/bin/pip install -e 'tools/pdf2epub[surya]'
```

Surya 2.x needs an inference backend: vLLM on NVIDIA (Docker), or llama.cpp on
CPU/Apple Silicon. The model manager starts a server on first use. Point it at
an already-running server with `SURYA_INFERENCE_URL=http://host:port/v1`.

Install Tesseract 5.5.3 and the pinned Bengali model with the helper (no root
or conda required):

```bash
scripts/pdf/install-ocr-engines.sh
# Default root: ~/.local/share/ocr-engines
#   tesseract-5.5.3/bin/tesseract
#   tessdata/ben.traineddata
```

The script downloads a static micromamba, creates a conda-forge
`tesseract=5.5.3` environment, downloads the `tessdata_best` `ben` file at the
pinned commit, and verifies its MD5. Set `OCR_ENGINES_ROOT` to install
elsewhere. The equivalent manual path is:

```bash
# The exact binary; apt may ship an older Tesseract.
conda create -n pdf-ocr -c conda-forge tesseract=5.5.3
# tessdata_best, pinned by commit and checksum.
curl -L -o tessdata/ben.traineddata \
  https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/9ddc24e750eec0994223a9edc3fcb434a2244f3b/ben.traineddata
echo "6e997a9bc0f9dffc3431a0b16ca856ea  tessdata/ben.traineddata" | md5sum -c -
```

Then verify the whole OCR stack (use the installed path):

```bash
pnpm pdf:check-ocr --check-engine tesseract \
  --tesseract "$HOME/.local/share/ocr-engines/tesseract-5.5.3/bin/tesseract" \
  --tessdata "$HOME/.local/share/ocr-engines/tessdata"
```

`publication.json` records the exact OCR revision, e.g.
`pdf-craft/tesseract 5.5.3 ben@6e997a9bc0f9`.

`pnpm pdf:check-ocr` prints the Surya model, the `surya-ocr` version, the
Tesseract version and the `ben.traineddata` checksum. Add `--strict` to fail on
any mismatch.

> **Historical note:** the 2026-09-11 paper run recorded
> `ben@4ded8631c91f`. That hash is **`tessdata_fast`**, not `tessdata_best`
> (despite what the old docs said). On the same 50 crops, fast scored 67.4%
> word accuracy vs 74.3% for best. Keep `tessdata_best` as the default; use
> `tessdata_fast` only to reproduce the old run.

## Two OCR backends

There are exactly two OCR paths, and both produce the same book bundle:

- **Surya** — the native engine (default). Uses the PDF text layer when it is
  good, otherwise Surya OCR. Also supports `--ocr-json` imports.
- **Tesseract** — the `pdf-craft` engine. Runs Tesseract locally, with optional
  pdf-craft reading-structure recovery.


## Commands

```bash
# Verify the pinned OCR engines (Surya 2, Tesseract 5.5.3, tessdata_best)
pnpm pdf:check-ocr --tessdata tessdata

# What is in this PDF, and which path would be used?
pnpm pdf:epub -- book.pdf --inspect

# Text-layer conversion (auto-detects)
pnpm pdf:epub -- book.pdf --out dist/book.epub

# Surya OCR for a scanned book
pnpm pdf:epub -- book.pdf --engine surya --ocr always --out dist/book.epub

# Optional: A/B Surya 2 and 2.5 on a few pages of one book
pnpm pdf:epub -- book.pdf --ocr always --max-pages 8 \
  --model datalab-to/surya-ocr-2.5 --out dist/surya25.epub
pnpm pdf:epub -- book.pdf --ocr always --max-pages 8 \
  --model datalab-to/surya-ocr-2 --out dist/surya2.epub

# Reuse a saved run (no GPU needed at build time)
pnpm pdf:epub -- book.pdf --ocr-json results.json --out dist/book.epub

# Cover choices
pnpm pdf:epub -- book.pdf --cover original   # fail if there is no cover image
pnpm pdf:epub -- book.pdf --cover generate   # always draw one
pnpm pdf:epub -- book.pdf --cover none       # no cover page
```

Metadata flags: `--title`, `--title-en`, `--subtitle`, `--author`,
`--author-en`, `--author-sort`, `--language`, `--publisher`,
`--first-published`, `--source-name`, `--source-url`, `--rights`, `--license`,
`--license-url`, `--description`, `--subject` (repeatable), `--modified`.

## Tesseract via pdf-craft

`pdf-craft` is the Tesseract engine. It writes a portable `.pcex` archive; the
bridge converts its chapters, notes, figures and tables into puthi's bundle
format, and the normal TypeScript EPUB builder takes over from there.

```bash
# One command (Tesseract on CPU)
pnpm pdf:craft -- book.pdf --out dist/book.epub

# Equivalent explicit engine
pnpm pdf:epub -- book.pdf --engine tesseract --out dist/book.epub

# Tesseract with explicit binary/tessdata
pnpm pdf:craft -- book.pdf \
  --tesseract /path/to/tesseract \
  --tessdata /path/to/tessdata_best \
  --out dist/book.epub
```

`--language` is the EPUB/BCP 47 language (`bn`). Tesseract uses its own code,
which defaults to `ben`; override with `--pdfcraft-language` for other scripts.

Pass `--pdfcraft-recover-structure` to run pdf-craft's audited reading-structure
recovery before conversion. It rewrites headings/order from extraction facts
only and leaves an audit file in the work bundle; it is off by default so the
raw extraction stays available for comparison.

### Install pdf-craft

`pdf-craft` currently needs Python 3.11-3.13, while the rest of puthi runs on
Node and a normal Python 3.10+ environment. Create one shared venv for puthi's
Python side and pdf-craft:

```bash
python3.13 -m venv tools/pdf2epub/.venv
tools/pdf2epub/.venv/bin/pip install -e 'tools/pdf2epub[pdfcraft]'
```

Then either put that venv at `tools/pdf2epub/.venv` (the CLI picks it up
automatically) or point to it explicitly:

```bash
PDFCRAFT_PYTHON=/path/to/venv/bin/python pnpm pdf:craft -- book.pdf
```

You also need Poppler (`pdftoppm`). For the Tesseract backend, install
Tesseract 5.5.3 and the pinned Bengali `tessdata_best` described in
[Requirements](#requirements), then pass `--tesseract` / `--tessdata` (or
verify with `pnpm pdf:check-ocr`).

### What survives the bridge

pdf-craft decides chapters, reading order, notes, figures and tables. Puthi
still adds its EPUB layer: sanitised XHTML, accessibility metadata, landmarks,
printed-page anchors and page list, embedded Bengali fonts, deterministic ZIP,
cover enhancement/generation, link checking and structural validation.

pdf-craft's `.pcex` is kept in the work bundle as `extraction.pcex`, so a failed
or interrupted EPUB build does not require another OCR run.

## Two-step use

```bash
python -m pdf2epub extract book.pdf --out .work/book --ocr never
pnpm pdf:build --work .work/book --out dist/book.epub
```

`pdf:build` takes `--cover`, `--no-fonts`, `--json`, and the same title/author
overrides. This is useful when tuning the generated cover or re-building after
editing a chapter fragment by hand.

## Metadata sidecar

Bibliographic metadata belongs in a JSON sidecar next to the PDF
(`book.metadata.json`) or in an explicit file passed with `--metadata`. The
sidecar is **read, never rewritten**; CLI flags win over it. The bundle gets a
`metadata.json` with the raw sidecar plus the resolved values, and `book.json`
carries the fields the EPUB builder uses.

| Field | Type | Notes |
| --- | --- | --- |
| `title`, `title_en`, `subtitle` | string | `title` falls back to the metadata resolver, then to `শিরোনামহীন` |
| `authors` | string[] | joined for the current single-author EPUB field; the full list stays in `metadata.json` |
| `editors`, `translators` | string[] | stored for the catalogue step |
| `publisher`, `source_date`, `edition` | string | `source_date` keeps the printed date (e.g. `মাঘ ১৩৫৯`) |
| `first_published` | integer | Gregorian year for `dc:date`, not the Bengali year |
| `subjects` | string[] | `dc:subject` |
| `description` | string | `dc:description` |
| `isbn`, `rights`, `license`, `license_url` | string | rights/licence are also EPUB metadata |
| `identifier` | string | reserved for a stable ISBN/URI; recorded now |
| `source_name`, `source_url` | string | human-readable source and canonical URL |
| `modified` | ISO 8601 | defaults to the deterministic build date |
| `cover_page` | integer | 1-based PDF page to use as the original cover |
| `evidence` | object | page/note provenance for each accepted field |

```json
{
  "title": "নিষ্কৃতি",
  "authors": ["শরৎচন্দ্র চট্টোপাধ্যায়"],
  "publisher": "কামিনী প্রকাশনী",
  "source_date": "মাঘ ১৩৫৯",
  "first_published": 1953,
  "edition": "প্রথম সংস্করণ",
  "subjects": ["বাংলা উপন্যাস"],
  "description": "শরৎচন্দ্র চট্টোপাধ্যায়ের নিষ্কৃতি উপন্যাসের স্ক্যান করা সংস্করণ।",
  "rights": "Public domain",
  "license": "Public domain",
  "cover_page": 1,
  "evidence": {
    "authors": {"page": 1, "note": "title page"},
    "publisher": {"page": 2, "note": "publisher page"}
  }
}
```

Precedence: **CLI flags → sidecar → resolver (trusted filename template or vetted PDF /Info, corroborated) → `"শিরোনামহীন"` / `"অজ্ঞাত"`**.
`cover_page` selects an explicit original page; `--cover auto|original|generate|none`
still controls whether a cover is used or generated.

### Metadata resolver

When neither the CLI nor the sidecar supplies a title, an offline resolver
(`pdf2epub/resolve.py`) reads these signals:

- **Filename template** — only a matched scraper template (confidence ≥ 0.5)
  is trusted; a bare slug stays a low-ranked candidate and a content-hash
  stem yields no candidate at all.
- **PDF `/Info`** — `/Title` and `/Author` after junk filters (placeholders,
  numeric/UUID values, filenames in disguise) and author splitting.
- **Cover OCR** is reserved as a *weak* corroborating signal; it never accepts
  a value alone.

A field is accepted when a single trusted signal carries it, or when two
signals agree. Two trusted signals that disagree make the entry `ambiguous`
and leave that field empty (per-field: a title conflict does not clear
authors). Volume/edition/year from the filename are recorded under
`filename`, never applied. Raw `/Info` and the file stem are never used as a
title fallback. `metadata.json` gains a `resolution` block and `book.json` a
`metadataResolution` block; `status` is `ok`, `ambiguous`, `empty`, or
`not_a_book`.

## Conservative proofreading (opt-in)

`--proofread` runs the existing `pdf-craft` `ConservativeProofreader` after
Tesseract extraction. The model proposes **exact whole-word** edits; validation
rejects anything that is not a unique Bengali word change, changes more than two
characters, touches protected words, or exceeds the paragraph budget. Each
accepted edit is then corroborated by re-OCRing the original word crop at 2×
with PSM 8 and 13; without that evidence the edit stays in review.

```bash
pnpm pdf:epub -- book.pdf --engine tesseract --ocr always \
  --proofread --proofread-model qwen3.5:4b --ollama-url http://127.0.0.1:11434 \
  --tesseract "$(which tesseract)" --tessdata tessdata \
  --out dist/book.epub
```

Useful switches:

- `--review-only` — write the audit but change no text. Recommended for a new
  edition until its held-out benchmark supports automatic edits.
- `--protected-word NAME` — repeat for names or spellings that must not change.
- `--ollama-url`, `--proofread-model` — select the Ollama server and model.

Outputs under the work bundle:

```
proofread/audit/p<page>-b<block>.json   # proposals, decisions, evidence
proofread/evidence/*.png               # word crops used for corroboration
proofread/proofread.pcex               # proofread extraction
```

The pass fails closed: a missing Ollama/model, malformed response, incomplete
generation or unsupported edit leaves the original text unchanged. An LLM
confidence value is never treated as proof of correctness.

**Performance note:** on the 4 GB test host, `qwen3.5:4b-q4_K_M` took roughly
two minutes per block; five pages (21 audited blocks) took ~46 minutes and
applied no edits because the crop evidence did not support them. Treat this as
an opt-in quality pass, not a bulk default. Use a GPU-backed model, a smaller
page range, or a faster server for whole books.

Measured on the same paragraph:

| Model | Time | Output | Notes |
|---|---:|---:|---|
| `qwen3.5:2b-q4_K_M` | 13 s | 43 tokens | fully offloaded; weaker proposals (one wrong edit); use review-only + crop verification |
| `qwen3.5:4b-q4_K_M` | 66 s | 256 tokens (truncated) | 2.58 GB VRAM of 3.74 GB; better proposals, ~2 min for a full 512-token budget |

For automatic edits, prefer an 8 GB+ GPU, a fully offloaded Vulkan llama.cpp
server, or a remote Ollama endpoint. The client already accepts
`--ollama-url`, and the model digest is recorded. The 2B model is useful for
fast triage only; its proposals must stay review-only until a Bengali
correction benchmark supports more.

## OCR model choice

`datalab-to/surya-ocr-2` is the default and stays the default. The November
2026 benchmark measured Surya 2 against Surya 2.5 on 50 Sarvam Indic OCR Bench
Bengali crops: Surya 2 led on WER (19.9% vs 21.1%) and was ~2.4× faster; Surya
2.5 led on mean CER (8.3% vs 9.6%) and had no tail loops (Surya 2 had two).
They are effectively tied, so there is no measured reason to switch to 2.5 for
Bengali. `dots.mocr` (3B) was close on word accuracy (78.0%) but ~4× slower;
`LightOnOCR-3-4B` reached 71.6%; Tesseract reached 74.3% but is ~20× faster
(0.3 s vs 5.8–14.2 s per crop). Keep Surya 2 for quality, Tesseract for
throughput.

`--backend vllm|llamacpp|mlx` selects the inference server. A 4 GB GPU is
generally too small for a comfortable vLLM run; llama.cpp on CPU is slower but
works, and `--ocr-json` lets you do the model run elsewhere.

Surya's output is saved in the bundle when `--keep-raw` is used, and can be
imported later with `--ocr-json`. The importer accepts both the Surya 2.5
`blocks` format and the older Surya 2 `text_lines` format.

## How the EPUB is structured

- `OEBPS/content.opf` — EPUB 3.3 package, DC metadata, cover image, accessibility
  metadata, source/licence, page-list and nav references.
- `OEBPS/nav.xhtml` — TOC, landmarks and a printed-page list.
- `OEBPS/toc.ncx` — NCX fallback for older readers; depth matches the real TOC.
- `OEBPS/chapters/*.xhtml` — one section per chapter or part. Page breaks are
  empty `span` anchors with `epub:type="pagebreak"` and `role="doc-pagebreak"`.
- Footnotes become a `section.footnotes` / `aside.footnote` at the end of the
  chapter, with `noteref` links and a back-link.
- Figures are `<figure>` + `<figcaption>`; tables are wrapped and given a
  caption; lists are real `<ul>`/`<ol>`.
- `OEBPS/images/` — cover and extracted figures. `OEBPS/fonts/` — Noto Serif
  Bengali, Tiro Bangla and their OFL licence.

The TypeScript side re-sanitises every fragment with a whitelist serialiser
(`src/lib/epub/xhtml.ts`), so nothing from the PDF or OCR HTML can introduce
scripts, event handlers, inline styles or remote resources. It then checks every
local link, image reference, TOC target, page-list entry and anchor before
writing the file.

## Publication provenance and QA

Every build writes a deterministic `publication.json` in the work bundle and
next to the EPUB (`book.epub.publication.json`). It records:

- EPUB filename, SHA-256 and byte size;
- source PDF SHA-256, page count and byte size;
- OCR pipeline/version/model and DPI;
- resolved title/author/publisher/date/rights/licence/subjects;
- section, chapter, TOC, page-list and word counts; cover source;
- the internal EPUB validation report, warnings, and optional EPUBCheck status.

`pnpm pdf:build --epubcheck /path/to/epubcheck.jar` runs EPUBCheck as a gate
and records its result in `publication.json` and `epubcheck.txt`. Install a
local JRE + EPUBCheck without root:

```bash
pnpm pdf:install-epubcheck
# prints the exact JAVA and EPUBCHECK paths

PATH="$HOME/.local/share/ocr-engines/java/jdk-21.0.13+9-jre/bin:$PATH" \
  pnpm pdf:build --work .work/pdf/book --out dist/book.epub \
  --epubcheck "$HOME/.local/share/ocr-engines/epubcheck-5.4.0/epubcheck.jar"
```

EPUBCheck 5.4.0 passes on the Nishkriti fixture after the `dc:title` ID and
non-linear nav spine fixes.

`pnpm pdf:publish` reads the sidecar (or `--publication path`) and stores its
validation report and revision metadata in `book_files.validation_report` and
`editions.source_revisions` instead of writing `{}`. Preview the publish
payload without touching Supabase or R2:

```bash
pnpm pdf:publish -- --epub dist/book.epub --bundle .work/pdf/book \
  --slug my-book --title-bn "বই" --author-bn "লেখক" --dry-run
```

## Limits and review checklist

Heuristics are good, not magic. Before publishing, spot-check:

1. **Chapter starts**, especially books whose headings are decorative or whose
   first chapter begins mid-page.
2. **Footnote pairing.** Superscripts that are not followed by a matching note
   stay as plain markers rather than becoming broken links.
3. **Two-column pages** with sidebars or pull quotes.
4. **Tables.** Complex merged cells are simplified; compare against the scan.
5. **Running heads.** Recurring lines at the top/bottom are removed when they
   repeat across pages, but a one-off section title can survive.
6. **Bengali spelling.** OCR errors are not corrected automatically; correct
   them in the bundle and re-run `pdf:build` if needed.
7. **Cover.** `--cover auto` keeps a cover-like image from the first pages when
   it is large enough; otherwise check the generated cover's title/author.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `No text layer found and --ocr never was set` | Remove `--ocr never` or run OCR elsewhere and use `--ocr-json`. |
| `Surya is not installed` | `pip install -e 'tools/pdf2epub[surya]'` in the venv. |
| `pnpm pdf:check-ocr` warns | Install Tesseract 5.5.3 and the pinned `tessdata_best`; the old `4ded8631c91f` hash is `tessdata_fast`, not best. |
| `Surya OCR failed … backend is running` | Start vLLM/llama-server, or set `SURYA_INFERENCE_URL`. |
| `pdf-craft is not installed …` | Use Python 3.11-3.13 and `pip install -e 'tools/pdf2epub[pdfcraft]'`; set `PDFCRAFT_PYTHON` if the venv is elsewhere. |
| `pdf-craft extraction failed … tesseract` | Install the `tesseract` binary and Bengali `ben.traineddata`; pass `--tesseract` / `--tessdata`. |
| `pdf-craft extraction produced no body chapters` | Check that the PDF has a usable TOC/headings; try a page range with `--max-pages` and inspect `extraction.pcex`. |
| Choppy reading order | Inspect the page in the PDF; the XY-cut is conservative around overlapping boxes. |
| Chinese/Devanagari text appears | The PDF's text layer is wrong or the OCR model misread the script; force OCR and compare models. |
| EPUB validation failed | The error names the file/anchor; fix the bundle fragment or the metadata flag. |
| `--cover original` fails | The PDF has no cover-like image; use `--cover auto` or `generate`. |

## Tests

```bash
/tmp/pdfvenv/bin/python -m pytest tools/pdf2epub   # structure, OCR JSON, pdf-craft bridge, text heuristics
pnpm test                                           # sanitizer, EPUB builder, validation
pnpm typecheck
pnpm lint
```

`pnpm pdf:test` runs the Python suite with the same interpreter resolution as
the main command. Install the test extras once with
`pip install -e 'tools/pdf2epub[dev]'`.
