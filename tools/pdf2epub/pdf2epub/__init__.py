"""PDF → structured book bundle.

The Python half of the pipeline does the expensive, model-shaped work:
text-layer extraction, Surya OCR, reading order, chapter/footnote recovery,
figure extraction, and cover detection. It writes a deterministic *book
bundle* (JSON + XHTML fragments + images). The TypeScript half
(`scripts/pdf/build.ts`) turns that bundle into an EPUB 3.3 file using the
same sanitiser and structural checks as the rest of OpenBanglaBooks.
"""

__version__ = "0.1.0"
