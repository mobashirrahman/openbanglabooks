"""Turn ordered page blocks into chapters, front matter, notes, and a nav.

The rules are deliberately conservative. When the evidence for a chapter
boundary is weak we keep the text together and emit a warning rather than
inventing structure; a human can fix the handful of books that need it.
"""

from __future__ import annotations

import hashlib
import html as html_lib
import re
import uuid
from dataclasses import dataclass, field
from typing import Any

from .htmlclean import clean_fragment, plain_text, wrap_paragraphs
from .model import Block, ExtractedImage, PageContent
from .textnorm import ascii_digits, bn_digits, is_page_number, normalise_text, short, word_count

TOC_LABELS = ("সূচিপত্র", "সূচীপত্র", "বিষয়সূচি", "contents", "table of contents")
CHAPTER_RE = re.compile(
    r"^\s*(অধ্যায়|অধ্যায়ঃ|পরিচ্ছেদ|chapter)\s*[\d০-৯ivxlcdm]+",
    re.IGNORECASE,
)
SCENE_BREAKS = {"* * *", "***", "—", "———", "— — —", "◆", "❖", "⁂"}


@dataclass
class Section:
    id: str
    label: str
    xhtml: str
    epub_type: str = "chapter"
    part: str | None = None
    page_start: int = 0
    page_end: int = 0
    words: int = 0


@dataclass
class ImageAsset:
    id: str
    href: str
    media_type: str
    data: bytes
    alt: str
    width: int
    height: int
    source: str
    sha1: str


@dataclass
class BuiltBook:
    meta: dict[str, Any]
    sections: list[Section]
    images: list[ImageAsset]
    toc: list[dict[str, Any]]
    page_list: list[dict[str, str]]
    cover: dict[str, Any] | None
    report: dict[str, Any] = field(default_factory=dict)


class ImageRegistry:
    def __init__(self) -> None:
        self.by_sha: dict[str, ImageAsset] = {}
        self.items: list[ImageAsset] = []

    def add(self, image: ExtractedImage, alt: str = "চিত্র") -> ImageAsset:
        sha = hashlib.sha1(image.data).hexdigest()
        if sha in self.by_sha:
            return self.by_sha[sha]
        n = len(self.items) + 1
        ext = image.ext.lower().lstrip(".")
        if ext == "jpeg":
            ext = "jpg"
        if ext not in {"jpg", "png", "webp"}:
            ext = "png"
        media = "image/jpeg" if ext == "jpg" else f"image/{ext}"
        asset = ImageAsset(
            id=f"img-{n:03d}",
            href=f"images/img-{n:03d}.{ext}",
            media_type=media,
            data=image.data,
            alt=alt or "চিত্র",
            width=image.width,
            height=image.height,
            source=image.source,
            sha1=sha,
        )
        self.by_sha[sha] = asset
        self.items.append(asset)
        return asset


def build_book(
    pages: list[PageContent],
    *,
    pdf_sha: str,
    title: str,
    author: str,
    language: str = "bn",
    title_en: str | None = None,
    author_en: str | None = None,
    author_sort: str | None = None,
    subtitle: str | None = None,
    publisher: str = "OpenBanglaBooks",
    first_published: int | None = None,
    source_url: str = "",
    source_name: str = "",
    rights: str = "",
    license_name: str = "",
    license_url: str = "",
    description: str = "",
    subjects: list[str] | None = None,
    modified: str = "2026-01-01T00:00:00Z",
    ocr_model: str | None = None,
    cover: dict[str, Any] | None = None,
    cover_sha: str | None = None,
    max_section_pages: int = 24,
) -> BuiltBook:
    warnings: list[str] = []
    stats: dict[str, Any] = {
        "pages": len(pages),
        "words": 0,
        "footnotes": 0,
        "tables": 0,
        "figures": 0,
        "dropped_running_heads": 0,
        "toc_pages_dropped": 0,
        "low_confidence_pages": [],
    }

    pages = _drop_running_heads(pages, stats, warnings)
    if cover_sha:
        for page in pages:
            page.blocks = [
                b
                for b in page.blocks
                if not (
                    b.kind == "figure"
                    and b.meta.get("image") is not None
                    and hashlib.sha1(b.meta["image"].data).hexdigest() == cover_sha
                )
            ]
    toc_pages = _find_toc_pages(pages)
    stats["toc_pages_dropped"] = len(toc_pages)

    flat: list[Block] = []
    for page in pages:
        if page.index in toc_pages:
            continue
        flat.extend(page.blocks)

    # Blank pages and pure page-number pages disappear naturally.
    first_heading = _first_chapter_index(flat)
    if first_heading is None:
        warnings.append("No chapter heading was found; sections are split by page count.")
        front = []
        body = flat
        chapter_starts: list[int] = list(range(0, len(body), _blocks_per_pages(body, max_section_pages)))
    else:
        front = flat[:first_heading]
        body = flat[first_heading:]
        chapter_starts = []

    images = ImageRegistry()
    sections: list[Section] = []
    page_anchors: dict[int, str] = {}

    title_section = _title_section(title, subtitle, author, publisher, first_published)
    sections.append(title_section)

    front_sections = _front_matter_sections(
        front, title, author, images, stats, warnings, page_anchors
    )
    sections.extend(front_sections)

    if chapter_starts:
        chapters = _split_fixed_sections(body, title, max_section_pages, warnings)
    else:
        chapters = _split_chapters(body, warnings)

    # Build body sections. A part gets its own section so the part title is not
    # repeated at the head of every chapter in it.
    chapter_sections: list[Section] = []
    part_ids: dict[str, str] = {}
    for n, (label, part, blocks) in enumerate(chapters, start=1):
        sec = _render_section(
            f"c{n:03d}",
            label,
            part,
            blocks,
            images,
            stats,
            warnings,
            page_anchors,
            include_heading=True,
        )
        if sec.words == 0:
            continue
        if part and part not in part_ids:
            part_id = f"part-{len(part_ids) + 1:03d}"
            part_ids[part] = part_id
            sections.append(
                Section(
                    id=part_id,
                    label=part,
                    xhtml=f'<h1 class="part">{html_lib.escape(part)}</h1>',
                    epub_type="part",
                    page_start=blocks[0].page if blocks else 0,
                    page_end=blocks[0].page if blocks else 0,
                    words=0,
                )
            )
        chapter_sections.append(sec)
        sections.append(sec)

    if not chapter_sections:
        # Last resort: one section with whatever text exists.
        blocks = [b for b in flat if b.kind not in {"header", "footer", "page-number", "toc"}]
        sec = _render_section("c001", title, None, blocks, images, stats, warnings, page_anchors)
        if sec.words:
            sections.append(sec)
            chapter_sections.append(sec)

    stats["words"] = sum(s.words for s in sections)

    page_list = _page_list(pages, page_anchors)
    toc = _toc(front_sections, chapter_sections, part_ids)

    colophon = _colophon(
        title=title,
        publisher=publisher,
        source_url=source_url,
        source_name=source_name,
        rights=rights,
        license_name=license_name,
        license_url=license_url,
        ocr_model=ocr_model,
        pages=len(pages),
    )
    sections.append(colophon)

    # Keep only images a section actually references. A scanned cover that was
    # dropped with the title page must not leave an orphan copy in the EPUB.
    used = {img.href for img in images.items if any(f"../{img.href}" in s.xhtml for s in sections)}
    images.items = [img for img in images.items if img.href in used]
    stats["figures"] = len(images.items)

    meta = {
        "identifier": f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, f'openbanglabooks:pdf:{pdf_sha}:{title}:{first_published or ''}')}",
        "title": title,
        "titleEn": title_en,
        "subtitle": subtitle,
        "author": author,
        "authorEn": author_en,
        "authorSort": author_sort,
        "language": language,
        "publisher": publisher,
        "firstPublished": first_published,
        "sourceUrl": source_url,
        "sourceName": source_name,
        "rights": rights,
        "license": license_name,
        "licenseUrl": license_url,
        "description": description,
        "subjects": subjects or [],
        "modified": modified,
        "ocrModel": ocr_model,
    }

    low = [p.index + 1 for p in pages if p.mean_confidence is not None and p.mean_confidence < 0.6]
    stats["low_confidence_pages"] = low

    return BuiltBook(
        meta=meta,
        sections=sections,
        images=images.items,
        toc=toc,
        page_list=page_list,
        cover=cover,
        report={"stats": stats, "warnings": warnings},
    )


# --------------------------------------------------------------------------
# Running heads / TOC


def _norm_repeat(text: str) -> str:
    return re.sub(r"[\s\d০-৯।.,:;!?\-–—]+", "", normalise_text(text)).lower()


def _drop_running_heads(
    pages: list[PageContent],
    stats: dict[str, Any],
    warnings: list[str],
) -> list[PageContent]:
    counts: dict[str, int] = {}
    for page in pages:
        seen: set[str] = set()
        for b in page.blocks:
            if b.kind in {"header", "footer", "page-number"}:
                continue
            if b.bbox[3] < page.height * 0.12 or b.bbox[1] > page.height * 0.88:
                key = _norm_repeat(b.text)
                if 0 < len(key) <= 60 and key not in seen:
                    counts[key] = counts.get(key, 0) + 1
                    seen.add(key)

    threshold = max(3, int(len(pages) * 0.28))
    for page in pages:
        kept: list[Block] = []
        for b in page.blocks:
            if b.kind == "page-number":
                if not page.printed_number and is_page_number(b.text):
                    page.printed_number = bn_digits(re.sub(r"\D", "", ascii_digits(b.text)) or page.index + 1)
                stats["dropped_running_heads"] += 1
                continue
            if b.kind in {"header", "footer"}:
                stats["dropped_running_heads"] += 1
                continue
            at_margin = b.bbox[3] < page.height * 0.12 or b.bbox[1] > page.height * 0.88
            if at_margin and b.kind not in {"heading1", "heading2"}:
                key = _norm_repeat(b.text)
                if key and (counts.get(key, 0) >= threshold or is_page_number(b.text)):
                    if is_page_number(b.text) and not page.printed_number:
                        page.printed_number = bn_digits(re.sub(r"\D", "", ascii_digits(b.text)))
                    stats["dropped_running_heads"] += 1
                    continue
            kept.append(b)
        page.blocks = kept
    return pages


def _find_toc_pages(pages: list[PageContent]) -> set[int]:
    toc: set[int] = set()
    for page in pages:
        text = " ".join(b.text for b in page.blocks).lower()
        if any(label in text for label in TOC_LABELS) and len(page.blocks) >= 4:
            toc.add(page.index)
    # TOC often continues on the next page(s): lots of short lines ending in numbers.
    changed = True
    while changed:
        changed = False
        for page in pages:
            if page.index in toc:
                continue
            prev = page.index - 1
            if prev not in toc or not page.blocks:
                continue
            short_with_number = sum(
                1 for b in page.blocks if len(b.text) < 120 and re.search(r"[\d০-৯]\s*$", b.text.strip())
            )
            if short_with_number >= max(3, len(page.blocks) * 0.5):
                toc.add(page.index)
                changed = True
    return toc


# --------------------------------------------------------------------------
# Splitting


def _first_chapter_index(blocks: list[Block]) -> int | None:
    for i, b in enumerate(blocks):
        if b.kind == "heading1":
            if _looks_like_front_page(blocks, b):
                continue
            return i
        if b.kind == "heading2" and CHAPTER_RE.search(b.text):
            return i
        if b.kind == "text" and CHAPTER_RE.match(b.text) and len(b.text) < 80:
            b.kind = "heading1"
            return i
    return None


def _looks_like_front_page(blocks: list[Block], heading: Block) -> bool:
    """A short title/copyright page before the body is not chapter one."""
    if heading.page > 3:
        return False
    if CHAPTER_RE.match(heading.text):
        return False
    same_page = [b for b in blocks if b.page == heading.page]
    words = sum(word_count(b.text) for b in same_page)
    has_prose = any(len(b.text) > 120 and b.kind == "text" for b in same_page)
    return words < 40 and not has_prose


def _is_part_heading(block: Block) -> bool:
    if block.kind not in {"heading1", "heading2"} or len(block.text) >= 60:
        return False
    return bool(
        re.search(r"(খণ্ড|পর্ব|ভাগ|অংশ)", block.text)
        or re.search(r"\bpart\b\s*[ivxlcdm\d]+", block.text, re.IGNORECASE)
        or re.search(r"\bbook\s*[ivxlcdm\d]+", block.text, re.IGNORECASE)
    )


def _blocks_per_pages(blocks: list[Block], max_pages: int) -> int:
    if not blocks:
        return 1
    first = blocks[0].page
    last = blocks[-1].page
    total_pages = max(1, last - first + 1)
    n = max(1, math_ceil(total_pages / max_pages))
    return max(1, math_ceil(len(blocks) / n))


def math_ceil(value: float) -> int:
    import math

    return int(math.ceil(value))


def _split_fixed_sections(
    blocks: list[Block], title: str, max_pages: int, warnings: list[str]
) -> list[tuple[str, str | None, list[Block]]]:
    if not blocks:
        return []
    first_page = blocks[0].page
    out: list[tuple[str, str | None, list[Block]]] = []
    current: list[Block] = []
    start_page = first_page
    n = 0
    for b in blocks:
        if current and b.page - start_page >= max_pages:
            n += 1
            out.append((f"{title} — অংশ {bn_digits(n)}", None, current))
            current = []
            start_page = b.page
        current.append(b)
    if current:
        n += 1
        out.append((f"{title} — অংশ {bn_digits(n)}" if n > 1 else title, None, current))
    warnings.append(f"Split the body into {len(out)} sections of at most {max_pages} pages.")
    return out


def _split_chapters(
    blocks: list[Block], warnings: list[str]
) -> list[tuple[str, str | None, list[Block]]]:
    out: list[tuple[str, str | None, list[Block]]] = []
    current: list[Block] = []
    current_label: str | None = None
    current_part: str | None = None
    pending_part: str | None = None
    n = 0
    for b in blocks:
        starts = b.kind == "heading1" or (b.kind == "heading2" and current_label is None)
        if starts and _is_part_heading(b):
            pending_part = normalise_text(b.text)
            if current and current_label:
                out.append((current_label, current_part, current))
                current = []
                current_label = None
            continue
        if starts:
            if current and current_label:
                out.append((current_label, current_part, current))
            n += 1
            current_label = _chapter_label(b.text, n)
            current_part = pending_part
            current = [b]
        else:
            current.append(b)
    if current and current_label:
        out.append((current_label, current_part, current))
    if not out:
        return []
    if len(out) == 1:
        warnings.append("Only one chapter heading was found; check the PDF for a table of contents or clear headings.")
    return out


def _chapter_label(text: str, n: int) -> str:
    label = normalise_text(text)
    if not label:
        return f"অধ্যায় {bn_digits(n)}"
    if len(label) > 140:
        label = short(label, 140)
    return label


# --------------------------------------------------------------------------
# Section rendering


def _render_section(
    sec_id: str,
    label: str,
    part: str | None,
    blocks: list[Block],
    images: ImageRegistry,
    stats: dict[str, Any],
    warnings: list[str],
    page_anchors: dict[int, str],
    include_heading: bool = False,
) -> Section:
    out: list[str] = []
    if include_heading:
        out.append(f'<h2 class="chapter-title">{html_lib.escape(label)}</h2>')

    footnotes: list[Block] = []
    pending_figure: Block | None = None
    pending_caption: str | None = None
    last_page = -1
    list_buffer: list[Block] = []
    words = 0

    def flush_list() -> None:
        nonlocal list_buffer
        if not list_buffer:
            return
        ordered = bool(re.match(r"^\s*[\\d০-৯]", list_buffer[0].text))
        tag = "ol" if ordered else "ul"
        items: list[str] = []

        def flush_items() -> None:
            if items:
                out.append(f"<{tag}>" + "".join(items) + f"</{tag}>")
                items.clear()

        for item in list_buffer:
            inner = clean_fragment(item.html) or html_lib.escape(item.text)
            if re.match(r"^\s*<(?:ul|ol)\b", inner):
                # OCR's ListGroup already carries a list element; do not nest it
                # inside an <li> we invented.
                flush_items()
                out.append(inner)
            elif re.match(r"^\s*<li\b", inner):
                items.append(inner)
            else:
                items.append(f"<li>{inner}</li>")
        flush_items()
        list_buffer = []

    for index, b in enumerate(blocks):
        if b.kind in {"header", "footer", "page-number", "toc"}:
            continue
        if include_heading and index == 0 and b.kind.startswith("heading"):
            # The chapter heading is rendered above; do not duplicate it.
            continue
        if b.kind == "list":
            list_buffer.append(b)
            continue
        flush_list()

        # A pending figure belongs to its own page; close it before the next
        # page's anchor so the figure does not drift into the following page.
        if pending_figure is not None and b.page != pending_figure.page:
            out.append(_figure_html(pending_figure, pending_caption, images, stats, warnings))
            pending_figure = None
            pending_caption = None

        # Page anchor before the block that starts a new page.
        if b.page != last_page and b.page not in page_anchors:
            page_anchors[b.page] = f"{sec_id}.xhtml#page-{b.page + 1}"
            title = _page_label(b.page, blocks)
            out.append(
                f'<span id="page-{b.page + 1}" class="page-anchor" epub:type="pagebreak" '
                f'role="doc-pagebreak" title="{html_lib.escape(title)}"></span>'
            )
        last_page = b.page

        if b.kind == "footnote":
            footnotes.append(b)
            continue
        if b.kind == "figure":
            if pending_figure is not None:
                out.append(_figure_html(pending_figure, pending_caption, images, stats, warnings))
            pending_figure = b
            pending_caption = None
            continue
        if b.kind == "caption":
            if pending_figure is not None:
                pending_caption = b.text
            else:
                out.append(f'<p class="caption">{_inline(b)}</p>')
            continue
        if pending_figure is not None:
            out.append(_figure_html(pending_figure, pending_caption, images, stats, warnings))
            pending_figure = None
            pending_caption = None
        if b.kind == "table":
            stats["tables"] += 1
            out.append(_table(b))
        elif b.kind in {"heading2", "heading3"}:
            tag = "h3" if b.kind == "heading2" else "h4"
            out.append(f'<{tag} class="subtitle">{html_lib.escape(b.text)}</{tag}>')
            words += word_count(b.text)
        elif b.kind == "equation":
            out.append(_equation(b, warnings))
        else:
            text = b.text.strip()
            if text in SCENE_BREAKS:
                out.append('<p class="scene-break">* * *</p>')
                continue
            html = clean_fragment(b.html)
            if not html:
                html = f"<p>{html_lib.escape(text)}</p>"
            elif not re.match(r"\s*<(p|div|h[1-4]|ul|ol|table|figure|blockquote|pre)\b", html):
                html = f"<p>{html}</p>"
            out.append(html)
            words += word_count(text)

    flush_list()
    if pending_figure is not None:
        out.append(_figure_html(pending_figure, pending_caption, images, stats, warnings))

    # Footnotes at the end of the chapter, with backlinks where the source gave
    # us matching superscript markers.
    body = "\n".join(part for part in out if part.strip())
    if footnotes:
        stats["footnotes"] += len(footnotes)
        body = _link_footnote_refs(body, sec_id)
        has_refs = f'id="fnref-{sec_id}-1"' in body
        body += "\n" + _footnotes_html(sec_id, footnotes, has_refs)
    return Section(
        id=sec_id,
        label=label,
        xhtml=body,
        part=part,
        page_start=blocks[0].page if blocks else 0,
        page_end=blocks[-1].page if blocks else 0,
        words=words,
    )


def _page_label(page_index: int, blocks: list[Block]) -> str:
    # A printed number is preferred; otherwise the PDF page number in Bengali.
    return bn_digits(page_index + 1)


def _inline(block: Block) -> str:
    html = clean_fragment(block.html)
    if not html:
        return html_lib.escape(block.text)
    return html


def _figure_html(
    block: Block,
    caption: str | None,
    images: ImageRegistry,
    stats: dict[str, Any],
    warnings: list[str],
) -> str:
    image: ExtractedImage | None = block.meta.get("image")
    if image is None:
        return ""
    if image.width < 120 or image.height < 120:
        return ""
    asset = images.add(image, alt=caption or "চিত্র")
    cap = f"<figcaption>{html_lib.escape(caption)}</figcaption>" if caption else ""
    return (
        f'<figure class="figure"><img src="../{asset.href}" alt="{html_lib.escape(asset.alt)}" '
        f'width="{asset.width}" height="{asset.height}"/>{cap}</figure>'
    )


def _table(block: Block) -> str:
    html = clean_fragment(block.html)
    if not html:
        return ""
    if "<table" not in html.lower():
        html = f'<div class="table-wrap"><table><tbody><tr><td>{html}</td></tr></tbody></table></div>'
    return html


def _equation(block: Block, warnings: list[str]) -> str:
    if "<math" in block.html.lower():
        warnings.append(f"Equation on page {block.page + 1} kept as text; MathML is not yet passed through.")
        return f'<div class="equation"><p>{html_lib.escape(block.text)}</p></div>'
    html = clean_fragment(block.html) or html_lib.escape(block.text)
    return f'<div class="equation">{html}</div>'


def _footnotes_html(sec_id: str, notes: list[Block], has_refs: bool) -> str:
    items: list[str] = []
    for n, note in enumerate(notes, start=1):
        html = clean_fragment(note.html) or html_lib.escape(note.text)
        # Drop a leading note number and unwrap a single paragraph: the note
        # already lives inside <p> in the output.
        html = re.sub(r"^\s*(?:<[^>]+>\s*)*[\d০-৯*]{1,3}[.)]?\s*", "", html, count=1)
        html = re.sub(r"^\s*<p>(.*)</p>\s*$", r"\1", html, flags=re.DOTALL)
        html = re.sub(r"</?p[^>]*>", "", html)
        ref = (
            f'<a class="fn-back" href="#fnref-{sec_id}-{n}" aria-label="ফিরে যান">↩</a>'
            if has_refs
            else ""
        )
        items.append(
            f'<aside class="footnote" epub:type="footnote" id="fn-{sec_id}-{n}">'
            f'<p><span class="fn-num">{bn_digits(n)}</span> {html} {ref}</p></aside>'
        )
    return (
        '<section class="footnotes" epub:type="endnotes">'
        "<h3>টীকা</h3>" + "".join(items) + "</section>"
    )


def _link_footnote_refs(xhtml: str, sec_id: str) -> str:
    n = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal n
        n += 1
        label = match.group(1)
        return f'<a class="noteref" id="fnref-{sec_id}-{n}" href="#fn-{sec_id}-{n}"><sup>{label}</sup></a>'

    return re.sub(r"<sup>\s*([\d০-৯]{1,3})\s*</sup>", repl, xhtml)


# --------------------------------------------------------------------------
# Front matter, title page, colophon, nav


def _front_matter_sections(
    blocks: list[Block],
    title: str,
    author: str,
    images: ImageRegistry,
    stats: dict[str, Any],
    warnings: list[str],
    page_anchors: dict[int, str],
) -> list[Section]:
    if not blocks:
        return []
    # Drop leading title/copyright pages even when a cover image precedes them
    # (a figure block on page 1 used to hide the title page on page 2).
    while blocks:
        first_page = next((b.page for b in blocks if b.kind != "figure"), None)
        if first_page is None or first_page > 3:
            break
        page_blocks = [b for b in blocks if b.page == first_page and b.kind != "figure"]
        if not _is_title_page_group(page_blocks, title, author):
            break
        blocks = [b for b in blocks if b.page != first_page]
    if not blocks:
        return []
    groups: list[tuple[str | None, list[Block]]] = []
    current: list[Block] = []
    current_label: str | None = None
    for b in blocks:
        if b.kind in {"heading1", "heading2"} and current:
            groups.append((current_label, current))
            current = [b]
            current_label = normalise_text(b.text)
        else:
            if not current:
                current_label = normalise_text(b.text) if b.kind.startswith("heading") else None
            current.append(b)
    if current:
        groups.append((current_label, current))

    out: list[Section] = []
    for n, (label, group) in enumerate(groups, start=1):
        # Skip a title page that merely repeats the generated one.
        if n == 1 and _is_title_page_group(group, title, author):
            continue
        sec_id = f"front-{len(out) + 1:03d}"
        local_anchors: dict[int, str] = {}
        body: list[str] = []
        last_page = -1
        for b in group:
            if b.kind in {"header", "footer", "page-number", "toc"}:
                continue
            if b.page != last_page and b.page not in page_anchors and b.page not in local_anchors:
                local_anchors[b.page] = f"{sec_id}.xhtml#page-{b.page + 1}"
                body.append(
                    f'<span id="page-{b.page + 1}" class="page-anchor" epub:type="pagebreak" '
                    f'role="doc-pagebreak" title="{bn_digits(b.page + 1)}"></span>'
                )
            last_page = b.page
            if b.kind == "heading1" or b.kind == "heading2":
                body.append(f'<h2 class="chapter-title">{html_lib.escape(b.text)}</h2>')
            elif b.kind == "figure":
                body.append(_figure_html(b, None, images, stats, warnings))
            elif b.kind == "table":
                body.append(_table(b))
            else:
                html = clean_fragment(b.html) or f"<p>{html_lib.escape(b.text)}</p>"
                body.append(wrap_paragraphs(html))
        body = [x for x in body if x.strip()]
        if not body:
            continue
        words = sum(word_count(b.text) for b in group)
        if words < 3:
            continue
        page_anchors.update(local_anchors)
        out.append(
            Section(
                id=sec_id,
                label=label or ("শুরুর পাতা" if n == 1 else f"ভূমিকা {bn_digits(n)}"),
                xhtml="\n".join(body),
                epub_type="frontmatter",
                page_start=group[0].page,
                page_end=group[-1].page,
                words=words,
            )
        )
    return out


def _looks_like_title_page(text: str, title: str, author: str) -> bool:
    norm = re.sub(r"[\s\W_]+", "", text, flags=re.UNICODE).lower()
    if len(norm) > 320:
        return False
    t = re.sub(r"[\s\W_]+", "", title, flags=re.UNICODE).lower()
    a = re.sub(r"[\s\W_]+", "", author, flags=re.UNICODE).lower()
    return (t and t in norm and len(norm) < 160) or (a and a in norm and len(norm) < 120)


def _is_title_page_group(group: list[Block], title: str, author: str) -> bool:
    """A leading page that is a title page, not a dedication or preface.

    Matching the metadata title/author is the strongest signal. Scans often use
    an English title page that does not match the Bengali metadata, so accept a
    page with several heading fragments (title, subtitle, byline) as well.
    """
    text = " ".join(b.text for b in group)
    if _looks_like_title_page(text, title, author):
        return True
    headings = [b for b in group if b.kind in {"heading1", "heading2"}]
    return len(headings) >= 2 and _is_title_layout(group)


def _is_title_layout(group: list[Block]) -> bool:
    """Heuristic for a front page that is just title/author/publisher."""
    if not group or group[0].page > 3:
        return False
    if any(CHAPTER_RE.match(b.text) for b in group if b.kind in {"heading1", "heading2"}):
        return False
    words = sum(word_count(b.text) for b in group)
    has_prose = any(len(b.text) > 120 and b.kind == "text" for b in group)
    has_heading = any(b.kind in {"heading1", "heading2"} for b in group)
    # A short preface has sentences ("…।" / "."); a title page is fragments.
    has_sentence = any(
        b.kind == "text" and re.search(r"[।.!?…]\s*$", b.text.strip()) for b in group
    )
    return words < 35 and not has_prose and has_heading and not has_sentence


def _title_section(
    title: str,
    subtitle: str | None,
    author: str,
    publisher: str,
    first_published: int | None,
) -> Section:
    parts = [
        '<div class="title-page">',
        f'<p class="imprint">{html_lib.escape(publisher)}</p>',
        f"<h1>{html_lib.escape(title)}</h1>",
    ]
    if subtitle:
        parts.append(f'<p class="subtitle">{html_lib.escape(subtitle)}</p>')
    parts.append(f'<p class="author">{html_lib.escape(author)}</p>')
    if first_published:
        parts.append(f'<p class="edition">{bn_digits(first_published)}</p>')
    parts.append("</div>")
    return Section(
        id="title",
        label="শিরোনাম",
        xhtml="\n".join(parts),
        epub_type="titlepage",
        words=0,
    )


def _colophon(
    *,
    title: str,
    publisher: str,
    source_url: str,
    source_name: str,
    rights: str,
    license_name: str,
    license_url: str,
    ocr_model: str | None,
    pages: int,
) -> Section:
    rows = [
        '<div class="colophon">',
        '<h2 class="chapter-title">উৎস ও স্বত্ব</h2>',
    ]
    if source_name or source_url:
        src = html_lib.escape(source_name or "PDF")
        if source_url:
            rows.append(f'<p>এই সংস্করণের উৎস: <a href="{html_lib.escape(source_url)}">{src}</a>।</p>')
        else:
            rows.append(f"<p>এই সংস্করণের উৎস: {src}।</p>")
    if rights:
        rows.append(f"<p>{html_lib.escape(rights)}</p>")
    if license_name:
        lic = html_lib.escape(license_name)
        if license_url:
            rows.append(f'<p>লাইসেন্স: <a href="{html_lib.escape(license_url)}">{lic}</a>।</p>')
        else:
            rows.append(f"<p>লাইসেন্স: {lic}।</p>")
    rows.append(f"<p>{html_lib.escape(publisher)} এই সংস্করণটি PDF থেকে তৈরি করেছে; মূল পাঠে সম্পাদকীয় পরিবর্তন করা হয়নি।</p>")
    rows.append(f"<p>পৃষ্ঠা: {bn_digits(pages)}।</p>")
    if ocr_model:
        rows.append(f"<p>OCR: {html_lib.escape(ocr_model)}।</p>")
    rows.append("</div>")
    return Section(
        id="colophon",
        label="উৎস ও স্বত্ব",
        xhtml="\n".join(rows),
        epub_type="colophon",
        words=0,
    )


def _toc(
    front: list[Section],
    chapters: list[Section],
    part_ids: dict[str, str],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for sec in front:
        out.append({"label": sec.label, "href": f"{sec.id}.xhtml"})
    current_part: dict[str, Any] | None = None
    for sec in chapters:
        entry = {"label": sec.label, "href": f"{sec.id}.xhtml"}
        if sec.part:
            if current_part is None or current_part["label"] != sec.part:
                part_id = part_ids.get(sec.part, sec.id)
                current_part = {"label": sec.part, "href": f"{part_id}.xhtml", "children": []}
                out.append(current_part)
            current_part["children"].append(entry)
        else:
            current_part = None
            out.append(entry)
    return out


def _page_list(pages: list[PageContent], anchors: dict[int, str]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for page in pages:
        href = anchors.get(page.index)
        if not href:
            continue
        label = page.printed_number or bn_digits(page.index + 1)
        out.append({"label": label, "href": href})
    return out
