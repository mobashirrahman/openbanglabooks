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

OCR is optional. To use Surya:

```bash
tools/pdf2epub/.venv/bin/pip install -e 'tools/pdf2epub[surya]'
```

Surya 2.x needs an inference backend: vLLM on NVIDIA (Docker), or llama.cpp on
CPU/Apple Silicon. The model manager starts a server on first use. Point it at
an already-running server with `SURYA_INFERENCE_URL=http://host:port/v1`.

## Two OCR backends

There are exactly two OCR paths, and both produce the same book bundle:

- **Surya** — the native engine (default). Uses the PDF text layer when it is
  good, otherwise Surya OCR. Also supports `--ocr-json` imports.
- **Tesseract** — the `pdf-craft` engine. Runs Tesseract locally, with optional
  pdf-craft reading-structure recovery.


## Commands

```bash
# What is in this PDF, and which path would be used?
pnpm pdf:epub -- book.pdf --inspect

# Text-layer conversion (auto-detects)
pnpm pdf:epub -- book.pdf --out dist/book.epub

# Surya OCR for a scanned book
pnpm pdf:epub -- book.pdf --engine surya --ocr always --out dist/book.epub

# A/B two Surya checkpoints on a few pages first
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

You also need Poppler (`pdftoppm`). For the Tesseract backend, install the
`tesseract` binary and Bengali `tessdata_best` (`ben.traineddata`).

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

## OCR model choice

`datalab-to/surya-ocr-2` is the default. The newer
`datalab-to/surya-ocr-2.5` exists (689M parameters, released 2026-10-29), but
the project's Bengali benchmark measured Surya 2, not 2.5: Surya 2 base was the
strongest historical-page engine there, and the 2.5 weights have not been
measured on that benchmark. Convert a handful of representative pages with both
before committing a whole book; poetry, thin paper and old letterpress are the
cases most likely to differ.

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
