"""Extract ordered blocks from a born-digital PDF's text layer.

This path is deliberately preferred when a PDF already has a good text layer:
it is faster, keeps italics/superscripts, and avoids OCR mistakes. Scanned
books fall through to `ocr.py`.
"""

from __future__ import annotations

import html as html_lib
import re
from collections import Counter
from typing import Iterable

try:  # PyMuPDF ≥ 1.24 exposes the non-deprecated module name.
    import pymupdf as fitz
except ImportError:  # pragma: no cover - older PyMuPDF
    import fitz  # type: ignore
from bs4 import BeautifulSoup

from .model import Block, PageContent
from .pdf import PageText, extract_page_images, read_page
from .textnorm import is_page_number, normalise_text, word_count

BULLET = re.compile(r"^\s*(?:[\u2022\u00b7\u25aa\u25cf\u2013\u2014*\-]\s+|\d{1,3}[.)]\s+)")
CENTER_TOLERANCE = 0.08
HEADING_MAX_CHARS = 180


def estimate_body_size(doc: fitz.Document, sample: int = 40) -> float:
    sizes: Counter[float] = Counter()
    for page in list(doc)[:sample]:
        data = page.get_text("dict", flags=getattr(fitz, "TEXTFLAGS_TEXT", 0))
        for block in data.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "")
                    if not text.strip():
                        continue
                    size = round(float(span.get("size", 0)) * 2) / 2
                    if 5 <= size <= 72:
                        sizes[size] += max(1, len(text))
    if not sizes:
        return 11.0
    return sizes.most_common(1)[0][0]


def _span_html(span: dict, dominant: float) -> str:
    text = html_lib.escape(re.sub(r"\s+", " ", span.get("text", "")))
    if not text:
        return ""
    flags = int(span.get("flags", 0))
    size = float(span.get("size", 0))
    # A small digit run is almost always a footnote marker, even when the PDF
    # did not mark the span as superscript.
    if re.fullmatch(r"\s*[\d০-৯]{1,3}\s*", text) and dominant and size < dominant * 0.82:
        text = f"<sup>{text.strip()}</sup>"
    elif flags & 1:
        text = f"<sup>{text}</sup>"
    if flags & 2:
        text = f"<em>{text}</em>"
    if flags & 16:
        text = f"<strong>{text}</strong>"
    return text


def _block_html(block: dict) -> tuple[str, str, float, bool, bool]:
    """Return (inner html, plain text, dominant size, bold, italic)."""
    lines_out: list[str] = []
    plain_lines: list[str] = []
    weighted_size = 0.0
    weight = 0
    bold = False
    italic = False
    for line in block.get("lines", []):
        for span in line.get("spans", []):
            text = span.get("text", "")
            if not text:
                continue
            n = max(1, len(text.strip()))
            weighted_size += float(span.get("size", 0)) * n
            weight += n
    dominant = weighted_size / max(1, weight)

    for line in block.get("lines", []):
        pieces: list[str] = []
        plain_pieces: list[str] = []
        for span in line.get("spans", []):
            text = span.get("text", "")
            if not text:
                continue
            pieces.append(_span_html(span, dominant))
            plain_pieces.append(text)
            flags = int(span.get("flags", 0))
            bold = bold or bool(flags & 16)
            italic = italic or bool(flags & 2)
        if not pieces:
            continue
        raw = "".join(plain_pieces).strip()
        if not raw:
            continue
        plain_lines.append(raw)
        lines_out.append("".join(pieces).strip())

    if not lines_out:
        return "", "", 0.0, False, False

    # Join PDF lines into a paragraph, undoing Latin hyphenation.
    merged = ""
    for i, line in enumerate(lines_out):
        raw = plain_lines[i]
        if not merged:
            merged = line
            continue
        prev = plain_lines[i - 1]
        if prev.endswith("-") and raw[:1].islower():
            merged = merged[:-1] + line.lstrip()
        else:
            merged += " " + line
    text = normalise_text(" ".join(plain_lines))
    size = weighted_size / max(1, weight)
    return merged, text, size, bold, italic


def _centre_offset(bbox: tuple[float, float, float, float], page_width: float) -> float:
    return abs(((bbox[0] + bbox[2]) / 2) - page_width / 2) / max(1.0, page_width)


def _classify(
    text: str,
    size: float,
    body_size: float,
    bold: bool,
    bbox: tuple[float, float, float, float],
    page_width: float,
    page_height: float,
) -> str:
    n = len(text)
    if not text:
        return "text"
    if is_page_number(text):
        return "page-number"
    at_margin = bbox[3] < page_height * 0.075 or bbox[1] > page_height * 0.93
    if at_margin and n < 120:
        return "header" if bbox[3] < page_height * 0.075 else "footer"
    ratio = size / max(5.0, body_size)
    centred = _centre_offset(bbox, page_width) < CENTER_TOLERANCE
    if n <= HEADING_MAX_CHARS:
        if ratio >= 1.55 or (centred and ratio >= 1.28 and n < 90):
            return "heading1"
        if ratio >= 1.2 and n < 140:
            return "heading2"
        if bold and ratio >= 1.03 and n < 110:
            return "heading3"
    if n < 220 and re.match(r"^(?:figure|fig\.|plate|map|illustration|চিত্র|ছবি|নকশা)\b", text, re.IGNORECASE):
        return "caption"
    if ratio <= 0.86 and bbox[1] > page_height * 0.6 and n < 700:
        return "footnote"
    return "text"


def _table_blocks(page: fitz.Page) -> list[Block]:
    try:
        finder = page.find_tables()
        tables = list(finder.tables)
    except Exception:
        return []
    out: list[Block] = []
    for table in tables:
        try:
            rows = table.extract()
        except Exception:
            continue
        if not rows:
            continue
        bbox = tuple(table.bbox)
        body: list[str] = []
        for r, row in enumerate(rows):
            cells = []
            for cell in row:
                value = "" if cell is None else str(cell).strip()
                value = html_lib.escape(value).replace("\n", "<br/>")
                cells.append(f"<td>{value}</td>")
            tag = "th" if r == 0 and len(rows) > 1 else "td"
            if tag == "th":
                cells = [c.replace("<td>", "<th>").replace("</td>", "</th>") for c in cells]
            body.append(f"<tr>{''.join(cells)}</tr>")
        head = ""
        rest = body
        if len(body) > 1 and rows[0] and any(rows[0]):
            head = f"<thead>{body[0]}</thead>"
            rest = body[1:]
        out.append(
            Block(
                page=page.number,
                bbox=bbox,
                kind="table",
                html=f'<div class="table-wrap"><table>{head}<tbody>{"".join(rest)}</tbody></table></div>',
                text=" ".join(" ".join(str(c) for c in row if c) for row in rows),
            )
        )
    return out


def extract_text_pages(
    doc: fitz.Document,
    dpi: int,
    body_size: float | None = None,
) -> list[PageContent]:
    body = body_size or estimate_body_size(doc)
    pages: list[PageContent] = []
    for page in doc:
        info = read_page(page)
        blocks: list[Block] = []
        tables = _table_blocks(page)
        images = extract_page_images(doc, page, dpi)
        table_rects = [t.bbox for t in tables]
        image_rects = [i.bbox for i in images]

        for raw in info.blocks:
            if raw.get("type") != 0:
                continue
            bbox = tuple(raw.get("bbox", (0, 0, 0, 0)))
            if _inside_any(bbox, table_rects, 0.55) or _inside_any(bbox, image_rects, 0.85):
                continue
            html, text, size, bold, italic = _block_html(raw)
            if not text or word_count(text) == 0 and not re.search(r"\d", text):
                continue
            kind = _classify(text, size, body, bold, bbox, info.width, info.height)
            if kind == "text" and BULLET.match(text):
                items = [ln.strip() for ln in text.splitlines() if ln.strip()] or [BULLET.sub("", text).strip()]
                html = "".join(f"<li>{html_lib.escape(BULLET.sub('', item).strip())}</li>" for item in items)
                kind = "list"
            blocks.append(
                Block(
                    page=page.number,
                    bbox=bbox,
                    kind=kind,
                    html=html,
                    text=text,
                    label="text-layer",
                    meta={"size": size, "bold": bold, "italic": italic},
                )
            )

        blocks.extend(tables)
        for img in images:
            blocks.append(
                Block(
                    page=page.number,
                    bbox=img.bbox,
                    kind="figure",
                    label="picture",
                    meta={"image": img},
                )
            )
        blocks = order_blocks(blocks, info.width, info.height)
        mean = None
        pages.append(
            PageContent(
                index=page.number,
                width=info.width,
                height=info.height,
                blocks=blocks,
                source="text",
                printed_number=info.printed_number,
                mean_confidence=mean,
            )
        )
    return pages


def _inside_any(
    bbox: tuple[float, float, float, float],
    containers: Iterable[tuple[float, float, float, float]],
    threshold: float,
) -> bool:
    area = max(1.0, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
    for c in containers:
        ix = max(0.0, min(bbox[2], c[2]) - max(bbox[0], c[0]))
        iy = max(0.0, min(bbox[3], c[3]) - max(bbox[1], c[1]))
        if (ix * iy) / area >= threshold:
            return True
    return False


def order_blocks(blocks: list[Block], page_width: float, page_height: float) -> list[Block]:
    """Order blocks with a small XY-cut so two-column pages read correctly.

    Sorting by y then x interleaves the columns of a newspaper or a scholarly
    page. This recursive cut prefers a vertical gutter when one separates all
    blocks, then falls back to horizontal bands (running heads, full-width
    headings, footnotes), which also isolates columns below a heading.
    """
    return _xy_cut(blocks, depth=0)


def _xy_cut(blocks: list[Block], depth: int) -> list[Block]:
    if len(blocks) <= 1 or depth >= 12:
        return sorted(blocks, key=lambda b: (b.bbox[1], b.bbox[0]))

    xs = sorted({round(b.bbox[0], 2) for b in blocks} | {round(b.bbox[2], 2) for b in blocks})
    for cut in xs:
        left = [b for b in blocks if b.bbox[2] <= cut + 0.5]
        right = [b for b in blocks if b.bbox[0] >= cut - 0.5]
        if left and right and len(left) + len(right) == len(blocks):
            return _xy_cut(left, depth + 1) + _xy_cut(right, depth + 1)

    ys = sorted({round(b.bbox[1], 2) for b in blocks} | {round(b.bbox[3], 2) for b in blocks})
    for cut in ys:
        top = [b for b in blocks if b.bbox[3] <= cut + 0.5]
        bottom = [b for b in blocks if b.bbox[1] >= cut - 0.5]
        if top and bottom and len(top) + len(bottom) == len(blocks):
            return _xy_cut(top, depth + 1) + _xy_cut(bottom, depth + 1)

    return sorted(blocks, key=lambda b: (b.bbox[1], b.bbox[0]))


def page_text(page: PageContent) -> str:
    return " ".join(b.text for b in page.blocks if b.text)
