"""Bridge from a pdf-craft ``.pcex`` extraction to a puthi book bundle.

The bridge deliberately reads the portable ``.pcex`` archive with the standard
library instead of importing pdf-craft internals. That keeps conversion
testable without a GPU/OCR stack; only the extraction step imports pdf-craft.
"""

from __future__ import annotations

import csv
import difflib
from collections import Counter
import hashlib
import html as html_lib
import io
import json
import re
import uuid
import zipfile
from dataclasses import dataclass, field
from math import isfinite
from pathlib import Path
from typing import Any, Iterable
from xml.etree import ElementTree as ET

from .model import CoverCandidate, ExtractedImage
from .structure import (
    BuiltBook,
    ImageRegistry,
    Section,
    _colophon,
    _title_section,
)
from .textnorm import bn_digits, normalise_text, word_count

TITLE_TAGS = {"title", "sub_title"}
ASSET_TAGS = {"image", "table", "equation"}

# Tags the puthi sanitizer keeps. Unknown GFM tags are unwrapped, not dropped.
_ALLOWED_TAGS = {
    "p",
    "br",
    "hr",
    "span",
    "h1",
    "h2",
    "h3",
    "h4",
    "strong",
    "em",
    "sup",
    "sub",
    "small",
    "blockquote",
    "ol",
    "ul",
    "li",
    "table",
    "caption",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th",
    "a",
    "abbr",
    "section",
    "aside",
}
_TAG_MAP = {
    "b": "strong",
    "i": "em",
    "u": "span",
    "s": "span",
    "del": "span",
    "strike": "span",
    "mark": "span",
    "code": "span",
    "q": "span",
    "div": "section",
    "center": "section",
    "right": "section",
}


# ---------------------------------------------------------------------------
# .pcex parsing


@dataclass
class _Inline:
    kind: str
    text: str


@dataclass
class _Ref:
    id: str


@dataclass
class _Tag:
    name: str
    attrs: list[tuple[str, str]]
    children: list[Any]


@dataclass
class _Block:
    page: int
    order: int
    content: list[Any]


@dataclass
class _Paragraph:
    ref: str
    level: int
    blocks: list[_Block]


@dataclass
class _Asset:
    ref: str
    page: int
    det: tuple[int, int, int, int]
    title: list[Any]
    content: list[Any]
    caption: list[Any]
    hash: str | None


Layout = _Paragraph | _Asset


@dataclass
class _Chapter:
    id: int | None
    level: int
    layouts: list[Layout]
    references: dict[str, list[Layout]] = field(default_factory=dict)


@dataclass
class _Toc:
    id: int
    page: int
    order: int
    level: int
    children: list["_Toc"] = field(default_factory=list)


class PcexArchive:
    """Read a portable pdf-craft extraction from a ``.pcex`` or a directory."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._zip = zipfile.ZipFile(self.path) if self.path.is_file() else None
        if self._zip is None and not self.path.is_dir():
            raise FileNotFoundError(f"not a .pcex file or directory: {self.path}")

    def close(self) -> None:
        if self._zip is not None:
            self._zip.close()

    def __enter__(self) -> "PcexArchive":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def names(self) -> list[str]:
        if self._zip is not None:
            return self._zip.namelist()
        return [
            str(p.relative_to(self.path)).replace("\\", "/")
            for p in self.path.rglob("*")
            if p.is_file()
        ]

    def read(self, name: str) -> bytes:
        if self._zip is not None:
            return self._zip.read(name)
        return (self.path / name).read_bytes()

    def exists(self, name: str) -> bool:
        if self._zip is not None:
            try:
                self._zip.getinfo(name)
                return True
            except KeyError:
                return False
        return (self.path / name).is_file()

    def manifest(self) -> dict[str, Any]:
        return json.loads(self.read("manifest.json").decode("utf-8"))

    def document(self) -> dict[str, Any]:
        return dict(self.manifest().get("document") or {})

    def pages(self) -> dict[int, tuple[int, int]]:
        root = ET.fromstring(self.read("pages.xml"))
        sizes: dict[int, tuple[int, int]] = {}
        for page in root.findall("page"):
            index = int(page.get("index") or 0)
            if index:
                sizes[index] = (int(page.get("width") or 0), int(page.get("height") or 0))
        return sizes

    def toc(self) -> list[_Toc]:
        if not self.exists("toc.xml"):
            return []
        root = ET.fromstring(self.read("toc.xml"))

        def parse(item: ET.Element) -> _Toc:
            return _Toc(
                id=int(item.get("id") or 0),
                page=int(item.get("page_index") or 0),
                order=int(item.get("order") or 0),
                level=int(item.get("level") or 0),
                children=[parse(child) for child in item.findall("item")],
            )

        return [parse(item) for item in root.findall("item")]

    def chapter_names(self) -> list[str]:
        names = [n for n in self.names() if re.fullmatch(r"chapters/chapter_[^.]+\.xml", n)]
        names.sort(key=lambda n: (0 if n.endswith("chapter_head.xml") else 1, _chapter_sort_key(n)))
        return names

    def chapters(self) -> list[_Chapter]:
        return [self._parse_chapter(self.read(name)) for name in self.chapter_names()]

    def asset(self, hash_value: str) -> bytes:
        for name in (f"assets/{hash_value}.png", f"assets/{hash_value}.jpg", f"assets/{hash_value}"):
            if self.exists(name):
                return self.read(name)
        raise FileNotFoundError(f"pdf-craft asset not found: {hash_value}")

    def cover(self) -> bytes | None:
        return self.read("cover.png") if self.exists("cover.png") else None

    def _parse_chapter(self, data: bytes) -> _Chapter:
        root = ET.fromstring(data)
        references: dict[str, list[Layout]] = {}
        refs_el = root.find("references")
        if refs_el is not None:
            for ref_el in refs_el.findall("ref"):
                ref_id = ref_el.get("id")
                if ref_id:
                    references[ref_id] = _parse_layouts(ref_el)
        return _Chapter(
            id=_optional_int(root.get("id")),
            level=_optional_int(root.get("level")) if root.get("level") is not None else -1,
            layouts=_parse_layouts(root.find("body")),
            references=references,
        )


def _chapter_sort_key(name: str) -> tuple[int, int | str]:
    stem = Path(name).stem.removeprefix("chapter_")
    if stem.isdigit():
        return (0, int(stem))
    return (1, stem)


def _optional_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _parse_layouts(parent: ET.Element | None) -> list[Layout]:
    if parent is None:
        return []
    out: list[Layout] = []
    for el in parent:
        if el.tag == "paragraph":
            ref = el.get("ref") or "text"
            level = _optional_int(el.get("level"))
            blocks: list[_Block] = []
            for block_el in el.findall("block"):
                blocks.append(
                    _Block(
                        page=int(block_el.get("page_index") or 1),
                        order=int(block_el.get("order") or 0),
                        content=_parse_content(block_el),
                    )
                )
            out.append(_Paragraph(ref=ref, level=level if level is not None else -1, blocks=blocks))
        elif el.tag == "asset":
            ref = el.get("ref") or "image"
            det = tuple(int(x) for x in (el.get("det") or "0,0,0,0").split(","))
            if len(det) != 4:
                det = (0, 0, 0, 0)
            out.append(
                _Asset(
                    ref=ref,
                    page=int(el.get("page_index") or 1),
                    det=det,  # type: ignore[arg-type]
                    title=_parse_content(el.find("title")),
                    content=_parse_content(el.find("content")),
                    caption=_parse_content(el.find("caption")),
                    hash=el.get("hash"),
                )
            )
    return out


def _parse_content(parent: ET.Element | None) -> list[Any]:
    if parent is None:
        return []
    out: list[Any] = []
    if parent.text:
        out.append(parent.text)
    for child in parent:
        if child.tag == "inline_expr":
            out.append(_Inline(kind=child.get("kind") or "text", text=child.text or ""))
        elif child.tag == "ref":
            out.append(_Ref(id=child.get("id") or ""))
        else:
            out.append(_Tag(name=child.tag, attrs=list(child.attrib.items()), children=_parse_content(child)))
        if child.tail:
            out.append(child.tail)
    return out


# ---------------------------------------------------------------------------
# Rendering


def _plain_text(items: Iterable[Any]) -> str:
    parts: list[str] = []
    for item in items:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, _Inline):
            parts.append(item.text)
        elif isinstance(item, _Tag):
            parts.append(_plain_text(item.children))
    return normalise_text("".join(parts))


def _layout_text(layout: Layout) -> str:
    if isinstance(layout, _Paragraph):
        return _plain_text(part for block in layout.blocks for part in block.content)
    return _plain_text(list(layout.title) + list(layout.content) + list(layout.caption))


def _join(parts: Iterable[str]) -> str:
    out = ""
    for part in parts:
        if not part:
            continue
        if out and not out.endswith((" ", ">", "\n")) and not part.startswith((" ", "<", ".", ",", "।", ";", ":", "!", "?", "”", "’")):
            out += " "
        out += part
    return out


def _image_size(data: bytes) -> tuple[int, int]:
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as image:
            return image.size
    except Exception:
        return (0, 0)


class _ChapterRenderer:
    def __init__(
        self,
        chapter: _Chapter,
        sec_id: str,
        archive: PcexArchive,
        images: ImageRegistry,
        page_anchors: dict[int, str],
    ) -> None:
        self.chapter = chapter
        self.sec_id = sec_id
        self.archive = archive
        self.images = images
        self.page_anchors = page_anchors
        self.ref_numbers: dict[str, int] = {}
        self.footnote_refs: list[str] = []
        self.tables = 0
        self.figures = 0

    def render(self) -> str:
        body: list[str] = []
        for layout in self.chapter.layouts:
            if isinstance(layout, _Paragraph):
                part = self.paragraph(layout)
            else:
                part = self.asset(layout)
            if part:
                body.append(part)
        footnotes = self.footnotes()
        if footnotes:
            body.append(footnotes)
        return "\n".join(body)

    def anchor(self, page: int) -> str:
        if page <= 0 or page in self.page_anchors:
            return ""
        self.page_anchors[page] = self.sec_id
        return (
            f'<span id="page-{page}" class="page-anchor" epub:type="pagebreak" '
            f'role="doc-pagebreak" title="{bn_digits(page)}"></span>'
        )

    def number(self, ref_id: str) -> int:
        if ref_id not in self.ref_numbers:
            self.ref_numbers[ref_id] = len(self.ref_numbers) + 1
            self.footnote_refs.append(ref_id)
        return self.ref_numbers[ref_id]

    def content(self, items: Iterable[Any], *, preserve_newlines: bool = False, in_footnote: bool = False) -> str:
        parts: list[str] = []
        for item in items:
            if isinstance(item, str):
                text = html_lib.escape(item)
                parts.append(text.replace("\n", "<br/>") if preserve_newlines else re.sub(r"\s+", " ", text))
            elif isinstance(item, _Inline):
                text = html_lib.escape(item.text)
                if "math" in item.kind.lower() or item.kind.lower() in {"latex", "display"}:
                    parts.append(f'<span class="equation">{text}</span>')
                else:
                    parts.append(text)
            elif isinstance(item, _Ref):
                if in_footnote or not item.id:
                    continue
                number = self.number(item.id)
                parts.append(
                    f'<a class="noteref" id="fnref-{self.sec_id}-{number}" '
                    f'href="#fn-{self.sec_id}-{number}"><sup>{bn_digits(number)}</sup></a>'
                )
            elif isinstance(item, _Tag):
                parts.append(self.tag(item, preserve_newlines=preserve_newlines, in_footnote=in_footnote))
        return _join(parts)

    def tag(self, item: _Tag, *, preserve_newlines: bool, in_footnote: bool) -> str:
        name = _TAG_MAP.get(item.name.lower(), item.name.lower())
        if name not in _ALLOWED_TAGS:
            return self.content(item.children, preserve_newlines=preserve_newlines, in_footnote=in_footnote)
        if name == "br":
            return "<br/>"
        if name == "img":
            attrs = {k.lower(): v for k, v in item.attrs}
            return html_lib.escape(attrs.get("alt", ""))
        attrs = ""
        for key, value in item.attrs:
            key = key.lower()
            if key == "class":
                attrs += f' class="{html_lib.escape(value)}"'
            elif key == "colspan" or key == "rowspan":
                if str(value).isdigit():
                    attrs += f' {key}="{int(value)}"'
            elif key == "href" and name == "a":
                if value.startswith("#") or re.match(r"^(?:https?|mailto):", value):
                    attrs += f' href="{html_lib.escape(value)}"'
        inner = self.content(item.children, preserve_newlines=preserve_newlines, in_footnote=in_footnote)
        if name == "a" and " href=" not in attrs:
            return inner
        return f"<{name}{attrs}>{inner}</{name}>"

    def paragraph(self, layout: _Paragraph) -> str:
        preserve = layout.ref in {"verse", "poetry"}
        prefix: list[str] = []
        parts: list[str] = []
        for index, block in enumerate(layout.blocks):
            anchor = self.anchor(block.page)
            if index == 0:
                if anchor:
                    prefix.append(anchor)
            elif anchor:
                parts.append(anchor)
            parts.append(self.content(block.content, preserve_newlines=preserve))
        inner = _join(parts)
        if not inner.strip():
            return "".join(prefix)
        if layout.ref in TITLE_TAGS and layout.level >= 0:
            level = min(max(layout.level + 2, 2), 4)
            cls = ' class="chapter-title"' if level == 2 else ""
            return "".join(prefix) + f"<h{level}{cls}>{inner}</h{level}>"
        if layout.ref == "scene-break":
            return "".join(prefix) + f'<p class="scene-break">{inner}</p>'
        if layout.ref == "quote":
            return "".join(prefix) + f"<blockquote>{inner}</blockquote>"
        if layout.ref in {"verse", "poetry"}:
            return "".join(prefix) + f'<section class="poem"><p>{inner}</p></section>'
        if layout.ref == "letter":
            return "".join(prefix) + f'<p class="indent">{inner}</p>'
        return "".join(prefix) + f"<p>{inner}</p>"

    def asset(self, layout: _Asset) -> str:
        prefix = self.anchor(layout.page)
        caption = self.content(layout.caption)
        title = self.content(layout.title)
        if layout.ref == "image" and layout.hash:
            try:
                data = self.archive.asset(layout.hash)
            except FileNotFoundError:
                return prefix
            width, height = _image_size(data)
            alt = _plain_text(list(layout.title) + list(layout.caption)) or "চিত্র"
            image = self.images.add(
                ExtractedImage(
                    data=data,
                    media_type="image/png",
                    width=width,
                    height=height,
                    page=max(0, layout.page - 1),
                    bbox=tuple(float(x) for x in layout.det),
                    source="pdf-craft",
                    ext="png",
                ),
                alt=alt,
            )
            self.figures += 1
            html = f'<figure class="figure"><img src="../{image.href}" alt="{html_lib.escape(image.alt)}"'
            if image.width and image.height:
                html += f' width="{image.width}" height="{image.height}"'
            html += "/>"
            if caption:
                html += f"<figcaption>{caption}</figcaption>"
            html += "</figure>"
            return prefix + html
        if layout.ref == "table":
            table = _find_tag(layout.content, "table")
            if table is not None:
                self.tables += 1
                html = f'<section class="table-wrap">{self.tag(table, preserve_newlines=False, in_footnote=False)}'
                if caption:
                    html += f'<p class="caption">{caption}</p>'
                html += "</section>"
                return prefix + html
        if layout.ref == "equation":
            inner = self.content(layout.content)
            if title:
                inner = f"{title} {inner}"
            html = f'<section class="equation">{inner}'
            if caption:
                html += f'<p class="caption">{caption}</p>'
            html += "</section>"
            return prefix + html
        return prefix

    def footnotes(self) -> str:
        if not self.footnote_refs:
            return ""
        parts = [
            '<section class="footnotes" epub:type="endnotes"><h3>টীকা</h3>'
        ]
        for ref_id in self.footnote_refs:
            number = self.ref_numbers[ref_id]
            layouts = self.chapter.references.get(ref_id, [])
            if not layouts:
                continue
            body = _join(self.footnote_layout(layout) for layout in layouts)
            if not body.strip():
                continue
            parts.append(
                f'<aside class="footnote" epub:type="footnote" id="fn-{self.sec_id}-{number}">'
                f'<p><span class="fn-num">{bn_digits(number)}</span> {body} '
                f'<a class="fn-back" href="#fnref-{self.sec_id}-{number}" aria-label="ফিরে যান">↩</a></p></aside>'
            )
        parts.append("</section>")
        return "\n".join(parts)

    def footnote_layout(self, layout: Layout) -> str:
        if isinstance(layout, _Paragraph):
            return self.content(
                (part for block in layout.blocks for part in block.content),
                in_footnote=True,
            )
        if layout.ref == "image" and layout.hash:
            return self.content(list(layout.title) + list(layout.caption), in_footnote=True)
        return self.content(list(layout.content) + list(layout.caption), in_footnote=True)


def _find_tag(items: Iterable[Any], name: str) -> _Tag | None:
    for item in items:
        if isinstance(item, _Tag):
            if item.name.lower() == name:
                return item
            found = _find_tag(item.children, name)
            if found is not None:
                return found
    return None


def _heading_key(text: str) -> str:
    return re.sub(r"[\s\d০-৯।.,:;!?\-–—_]+", "", text).lower()


def _chapter_titles(chapter: _Chapter) -> list[_Paragraph]:
    return [
        layout
        for layout in chapter.layouts
        if isinstance(layout, _Paragraph)
        and layout.ref in TITLE_TAGS
        and _plain_text(part for block in layout.blocks for part in block.content).strip()
    ]


def _clean_chapters(chapters: list[_Chapter], book_title: str) -> list[_Chapter]:
    """Remove repeated running heads and merge the pages they fragmented.

    Tesseract often labels the running head at the top of every page as a
    sub-title. pdf-craft then treats each page as a new chapter. A heading
    whose normalized text repeats across many chapters is a running head, not
    a chapter title; demote/drop it and merge the now-untitled chapter into the
    previous real chapter.
    """
    counts: Counter[str] = Counter()
    for chapter in chapters:
        for layout in _chapter_titles(chapter):
            key = _heading_key(_plain_text(part for block in layout.blocks for part in block.content))
            if key:
                counts[key] += 1

    repeated = {key for key, count in counts.items() if count >= 3}
    title_key = _heading_key(book_title)

    def is_running_head(text: str) -> bool:
        key = _heading_key(text)
        if not key:
            return True
        if key in repeated:
            return True
        if title_key and (
            title_key in key
            or key in title_key
            or difflib.SequenceMatcher(None, key, title_key).ratio() >= 0.55
        ):
            return True
        return False

    for chapter in chapters:
        kept: list[Layout] = []
        for layout in chapter.layouts:
            if isinstance(layout, _Paragraph) and layout.ref in TITLE_TAGS:
                if is_running_head(
                    _plain_text(part for block in layout.blocks for part in block.content)
                ):
                    continue
            kept.append(layout)
        chapter.layouts = kept

    head = [chapter for chapter in chapters if chapter.id is None]
    body = [chapter for chapter in chapters if chapter.id is not None]
    merged: list[_Chapter] = []
    for chapter in body:
        if not chapter.layouts:
            continue
        if _chapter_titles(chapter) or not merged:
            merged.append(chapter)
        else:
            merged[-1].layouts.extend(chapter.layouts)
    return head + merged


_CHAPTER_MARKER = re.compile(
    r"^(?:"
    r"(?:অধ্যায়|অধ্যায়|পরিচ্ছেদ|খণ্ড|খন্ড|পর্ব)\s*[০-৯0-9]{1,3}"
    r"|[০-৯0-9]{1,3}\s*(?:অধ্যায়|অধ্যায়|পরিচ্ছেদ|খণ্ড|খন্ড|পর্ব)"
    r"|এক|দুই|তিন|চার|পাঁচ|ছয়|সাত|আট|নয়|দশ"
    r"|এগারো|বারো|তেরো|চৌদ্দ|পনেরো|ষোল|সতেরো|আঠারো|উনিশ|বিশ"
    r"|প্রথম|দ্বিতীয়|দ্বিতীয়|তৃতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম"
    r"|[০-৯0-9]{1,3}"
    r")$"
)


def _is_page_number(text: str) -> bool:
    value = text.strip(" \t\r\n।.,;:!?—–-")
    return bool(value) and len(value) <= 4 and all(
        "০" <= char <= "৯" or "0" <= char <= "9" for char in value
    )


def _is_chapter_marker(text: str) -> bool:
    value = " ".join(text.split()).strip(" \t\r\n।.,;:!?—–-")
    return bool(value) and len(value) <= 40 and len(value.split()) <= 5 and bool(
        _CHAPTER_MARKER.fullmatch(value)
    )


def _split_text_layout(layout: Layout) -> list[Layout]:
    """Split one coarse paragraph into page groups and chapter headings.

    pdf-craft/Tesseract can hand us a single ``text`` paragraph whose blocks
    are the individual lines of several pages. Rendering that as one ``<p>``
    loses every paragraph and page boundary and hides chapter headings such as
    ``এক``. Group by page, drop a trailing page number, and lift a leading
    chapter marker into a title paragraph. Other layout kinds are untouched.
    """
    if not isinstance(layout, _Paragraph) or layout.ref not in {"", "text", "letter", "quote"}:
        return [layout]
    if not layout.blocks:
        return [layout]

    groups: list[list[_Block]] = []
    current: list[_Block] = []
    current_page: int | None = None
    for block in layout.blocks:
        if current and block.page != current_page:
            groups.append(current)
            current = []
        current.append(block)
        current_page = block.page
    if current:
        groups.append(current)

    out: list[Layout] = []
    for group in groups:
        if len(group) > 1 and _is_page_number(_plain_text(group[-1].content)):
            group = group[:-1]
        if not group:
            continue
        first = _plain_text(group[0].content).strip()
        if len(group) > 1 and _is_chapter_marker(first):
            out.append(_Paragraph(ref="title", level=1, blocks=[group[0]]))
            out.append(_Paragraph(ref=layout.ref, level=layout.level, blocks=group[1:]))
        else:
            out.append(_Paragraph(ref=layout.ref, level=layout.level, blocks=group))
    return out or [layout]


def _chapter_label(chapter: _Chapter) -> str | None:
    for layout in chapter.layouts:
        if isinstance(layout, _Paragraph) and layout.ref in TITLE_TAGS:
            text = _layout_text(layout)
            if text:
                return text
    return None


def _head_is_redundant(chapter: _Chapter, title: str, author: str, publisher: str = "") -> bool:
    text = _plain_text(_layout_text(layout) for layout in chapter.layouts)
    if not text:
        return True
    if word_count(text) >= 40:
        return False
    norm = re.sub(r"[\s\W_]+", "", text, flags=re.UNICODE).lower()
    remainder = norm
    for value in (title, author, publisher):
        key = re.sub(r"[\s\W_]+", "", value, flags=re.UNICODE).lower()
        if key:
            remainder = remainder.replace(key, "")
    return len(remainder) <= 6


# ---------------------------------------------------------------------------
# Bundle construction


def convert_pcex(
    pcex_path: str | Path,
    *,
    pdf_sha: str,
    pdf_pages: int,
    pdf_bytes: int,
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
    cover_mode: str = "generated",
    cover_reason: str = "",
    ocr_model: str | None = None,
    pipeline_name: str = "pdf-craft",
    pipeline_version: str = "",
) -> BuiltBook:
    warnings: list[str] = []
    images = ImageRegistry()
    page_anchors: dict[int, str] = {}
    sections: list[Section] = []
    front_section: Section | None = None
    chapter_sections: list[Section] = []
    chapter_section_ids: dict[int, str] = {}
    stats = {
        "pages": pdf_pages,
        "words": 0,
        "footnotes": 0,
        "tables": 0,
        "figures": 0,
        "dropped_running_heads": 0,
        "low_confidence_pages": [],
    }

    with PcexArchive(pcex_path) as archive:
        documents = archive.document()
        chapters = _clean_chapters(archive.chapters(), title)
        for chapter in chapters:
            chapter.layouts = [
                split
                for layout in chapter.layouts
                for split in _split_text_layout(layout)
            ]
        toc_items = archive.toc()
        page_sizes = archive.pages()

        title = title.strip() or str(documents.get("title") or "").strip() or "শিরোনামহীন"
        author = author.strip() or "অজ্ঞাত"
        sections.append(_title_section(title, subtitle, author, publisher, first_published))

        head: _Chapter | None = None
        body_chapters: list[_Chapter] = []
        for chapter in chapters:
            if chapter.id is None:
                head = chapter
            else:
                body_chapters.append(chapter)

        if head is not None and not _head_is_redundant(head, title, author, publisher):
            # A PDF with no TOC/headings can arrive entirely as chapter_head.
            # In that case keep it as the body instead of an untitled front
            # section with an empty nav.
            if not body_chapters:
                body_chapters = [head]
                head = None
            else:
                sec_id = "front"
                renderer = _ChapterRenderer(head, sec_id, archive, images, page_anchors)
                xhtml = renderer.render()
                if xhtml.strip():
                    label = _chapter_label(head) or "শুরুর পাতা"
                    front_section = Section(
                        id=sec_id,
                        label=label,
                        xhtml=xhtml,
                        epub_type="frontmatter",
                        page_start=min((b.page for l in head.layouts if isinstance(l, _Paragraph) for b in l.blocks), default=0) - 1,
                        page_end=max((b.page for l in head.layouts if isinstance(l, _Paragraph) for b in l.blocks), default=0) - 1,
                        words=word_count(_plain_text(_layout_text(l) for l in head.layouts)),
                    )
                    sections.append(front_section)

        # Reading order follows the first page a chapter touches, not its ID.
        body_chapters.sort(key=_chapter_first_page)
        for index, chapter in enumerate(body_chapters, start=1):
            sec_id = f"c{index:03d}"
            renderer = _ChapterRenderer(chapter, sec_id, archive, images, page_anchors)
            xhtml = renderer.render()
            if not xhtml.strip():
                continue
            label = _chapter_label(chapter) or (
                "মূল পাঠ" if len(body_chapters) == 1 else f"অধ্যায় {bn_digits(index)}"
            )
            if not any(
                isinstance(layout, _Paragraph) and layout.ref in TITLE_TAGS for layout in chapter.layouts
            ):
                xhtml = f'<h2 class="chapter-title">{html_lib.escape(label)}</h2>\n{xhtml}'
            words = word_count(_plain_text(_layout_text(l) for l in chapter.layouts))
            sec = Section(
                id=sec_id,
                label=label,
                xhtml=xhtml,
                epub_type="chapter",
                page_start=_chapter_first_page(chapter) - 1,
                page_end=_chapter_last_page(chapter) - 1,
                words=words,
            )
            sections.append(sec)
            chapter_sections.append(sec)
            if chapter.id is not None:
                chapter_section_ids[chapter.id] = sec_id
            stats["footnotes"] += len(renderer.footnote_refs)
            stats["tables"] += renderer.tables

        if not chapter_sections:
            warnings.append("pdf-craft extraction produced no body chapters")

        # Drop images from a chapter that was skipped, matching the native engine.
        used = {img.href for img in images.items if any(f"../{img.href}" in sec.xhtml for sec in sections)}
        images.items = [img for img in images.items if img.href in used]

        toc = _build_toc(toc_items, chapter_sections, chapter_section_ids)
        if not toc:
            toc = [{"label": sec.label, "href": f"{sec.id}.xhtml"} for sec in chapter_sections]
        if front_section is not None and not any(
            entry.get("href") == f"{front_section.id}.xhtml" for entry in toc
        ):
            toc.insert(0, {"label": front_section.label, "href": f"{front_section.id}.xhtml"})

        stats["words"] = sum(sec.words for sec in sections)
        stats["figures"] = len(images.items)

        page_list = [
            {"label": bn_digits(page), "href": f"{sec_id}.xhtml#page-{page}"}
            for page, sec_id in sorted(page_anchors.items())
        ]

    colophon = _colophon(
        title=title,
        publisher=publisher,
        source_url=source_url,
        source_name=source_name,
        rights=rights,
        license_name=license_name,
        license_url=license_url,
        ocr_model=ocr_model,
        pages=pdf_pages,
    )
    sections.append(colophon)

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
    return BuiltBook(
        meta=meta,
        sections=sections,
        images=images.items,
        toc=toc,
        page_list=page_list,
        cover={"kind": cover_mode, "reason": cover_reason} if cover_mode != "none" else {"kind": "none"},
        report={
            "stats": stats,
            "warnings": warnings,
            "pipeline": {"name": pipeline_name, "version": pipeline_version},
        },
    )


def _chapter_first_page(chapter: _Chapter) -> int:
    pages = [
        block.page
        for layout in chapter.layouts
        if isinstance(layout, _Paragraph)
        for block in layout.blocks
    ]
    pages += [layout.page for layout in chapter.layouts if isinstance(layout, _Asset)]
    return min(pages, default=0)


def _chapter_last_page(chapter: _Chapter) -> int:
    pages = [
        block.page
        for layout in chapter.layouts
        if isinstance(layout, _Paragraph)
        for block in layout.blocks
    ]
    pages += [layout.page for layout in chapter.layouts if isinstance(layout, _Asset)]
    return max(pages, default=0)


def _build_toc(
    items: list[_Toc],
    chapter_sections: list[Section],
    chapter_ids: dict[int, str],
) -> list[dict[str, Any]]:
    labels = {sec.id: sec.label for sec in chapter_sections}
    used: set[str] = set()

    def build(entries: list[_Toc]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for item in entries:
            children = build(item.children)
            sec_id = chapter_ids.get(item.id)
            if sec_id:
                used.add(sec_id)
                out.append({"label": labels.get(sec_id, f"অধ্যায় {item.id}"), "href": f"{sec_id}.xhtml", "children": children})
            elif children:
                out.append({"label": children[0]["label"], "href": children[0]["href"], "children": children})
        return out

    toc = build(items)
    for sec in chapter_sections:
        if sec.id not in used:
            toc.append({"label": sec.label, "href": f"{sec.id}.xhtml"})
    return toc


def pcex_document(pcex_path: str | Path) -> dict[str, Any]:
    with PcexArchive(pcex_path) as archive:
        return archive.document()


def pcex_cover(pcex_path: str | Path) -> CoverCandidate | None:
    with PcexArchive(pcex_path) as archive:
        data = archive.cover()
    if not data:
        return None
    width, height = _image_size(data)
    return CoverCandidate(
        data=data,
        ext="png",
        width=width,
        height=height,
        source_page=0,
        source="pdf-craft",
        is_cover=True,
    )


def pcex_sha256(pcex_path: str | Path) -> str:
    digest = hashlib.sha256()
    with open(pcex_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _install_tesseract_tsv_fix() -> None:
    """Work around csv quote handling in pdf-craft's Tesseract TSV parser.

    Tesseract emits a literal ASCII quote in some Bengali words. The stock
    ``csv.DictReader`` treats it as a quoted field and swallows the following
    rows, so fields with a quote become one giant "word" containing raw TSV.
    """
    try:
        from pdf_craft.pdf import tesseract as module
    except Exception:  # pragma: no cover - optional dependency
        return
    if getattr(module, "_puthi_tsv_quote_fix", False):
        return

    def parse_tsv(content: str):
        words = []
        if not content.startswith("level\tpage_num\t"):
            raise RuntimeError("Tesseract returned malformed TSV output")
        for row in csv.DictReader(io.StringIO(content), delimiter="\t", quoting=csv.QUOTE_NONE):
            text = (row.get("text") or "").strip()
            if row.get("level") != "5" or not text:
                continue
            try:
                word = module._Word(
                    block=int(row["block_num"]),
                    paragraph=int(row["par_num"]),
                    line=int(row["line_num"]),
                    left=int(row["left"]),
                    top=int(row["top"]),
                    width=int(row["width"]),
                    height=int(row["height"]),
                    confidence=float(row["conf"]),
                    text=text,
                )
            except (KeyError, TypeError, ValueError) as error:
                raise RuntimeError("Tesseract returned malformed TSV output") from error
            if min(word.left, word.top) < 0 or min(word.width, word.height) <= 0 or not isfinite(word.confidence):
                raise RuntimeError("Tesseract returned invalid word geometry or confidence")
            words.append(word)
        return words

    module.TesseractPageExtractor._parse_tsv = staticmethod(parse_tsv)
    module._puthi_tsv_quote_fix = True


def extract_with_pdfcraft(pdf: Path, out: Path, args: Any) -> tuple[BuiltBook, CoverCandidate | None, str, str, str | None]:
    """Run pdf-craft extraction and convert its ``.pcex`` into a puthi bundle."""
    try:
        from pdf_craft import ExtractionOptions, PDFCraft, PDFOptions, TesseractOCRLocalConfig
    except Exception as exc:  # pragma: no cover - optional dependency
        raise RuntimeError(
            "pdf-craft is not installed for this Python interpreter. Use Python 3.11-3.13 and run:\n"
            '  pip install "pdf-craft @ git+https://github.com/mobashirrahman/pdf-craft.git"\n'
            "Then set PDFCRAFT_PYTHON=/path/to/that/python when calling pnpm pdf:epub.\n"
            f"Original error: {exc}"
        ) from exc

    _install_tesseract_tsv_fix()
    ocr = TesseractOCRLocalConfig(
        executable=getattr(args, "tesseract", "tesseract"),
        tessdata_path=getattr(args, "tessdata", None),
        language=getattr(args, "pdfcraft_language", None) or "ben",
    )
    ocr_label = "pdf-craft/tesseract"
    pcex_path = out / "extraction.pcex"
    if pcex_path.exists():
        pcex_path.unlink()

    max_pages = int(getattr(args, "max_pages", 0) or 0)
    page_indexes = range(1, max_pages + 1) if max_pages else None
    dpi = int(getattr(args, "dpi", 300) or 300)
    options = ExtractionOptions(
        page_indexes=page_indexes,
        dpi=dpi,
        includes_cover=True,
        includes_footnotes=True,
        toc_assumed=False,
    )
    craft = PDFCraft(pdf=PDFOptions(ocr=ocr))
    try:
        craft.extract_pdf(pdf, pcex_path, options=options)
    finally:
        craft.release_pdf_resources()

    if getattr(args, "pdfcraft_recover_structure", False):
        try:
            from pdf_craft import PDFCraftExtraction
            from pdf_craft.transformer.reading_structure import recover_structure
        except Exception as exc:  # pragma: no cover - optional dependency
            raise RuntimeError("pdf-craft reading-structure recovery is unavailable") from exc
        recovered = out / "reading.pcex"
        if recovered.exists():
            recovered.unlink()
        recover_structure(
            PDFCraftExtraction.open(pcex_path),
            recovered,
            out / "structure-audit.json",
        )
        pcex_path = recovered

    document = pcex_document(pcex_path)
    title = (
        getattr(args, "title", None)
        or str(document.get("title") or "").strip()
        or pdf.stem
    )
    author = (
        getattr(args, "author", None)
        or ", ".join(str(a) for a in (document.get("authors") or []) if str(a).strip())
        or "অজ্ঞাত"
    )
    language = getattr(args, "language", None) or str(document.get("language") or "bn")
    publisher = getattr(args, "publisher", None) or str(document.get("publisher") or "OpenBanglaBooks")
    description = getattr(args, "description", None) or str(document.get("description") or "")
    modified = getattr(args, "modified", None) or str(document.get("modified") or "2026-01-01T00:00:00Z")

    cover = pcex_cover(pcex_path)
    requested_cover = getattr(args, "cover", "auto")
    if requested_cover == "none":
        cover = None
        cover_mode = "none"
        cover_reason = "cover disabled"
    elif requested_cover == "generate":
        cover = None
        cover_mode = "generated"
        cover_reason = "cover generation requested"
    elif cover is not None:
        cover_mode = "original"
        cover_reason = "cover from pdf-craft extraction"
    elif requested_cover == "original":
        raise ValueError("--cover original requested, but pdf-craft produced no cover")
    else:
        cover_mode = "generated"
        cover_reason = "pdf-craft extraction has no cover"

    built = convert_pcex(
        pcex_path,
        pdf_sha=str(getattr(args, "pdf_sha", "") or ""),
        pdf_pages=int(getattr(args, "pdf_pages", 0) or 0),
        pdf_bytes=int(getattr(args, "pdf_bytes", 0) or 0),
        title=title,
        author=author,
        language=language,
        title_en=getattr(args, "title_en", None),
        author_en=getattr(args, "author_en", None),
        author_sort=getattr(args, "author_sort", None),
        subtitle=getattr(args, "subtitle", None),
        publisher=publisher,
        first_published=getattr(args, "first_published", None),
        source_url=getattr(args, "source_url", None) or "",
        source_name=getattr(args, "source_name", None) or pdf.name,
        rights=getattr(args, "rights", "") or "",
        license_name=getattr(args, "license_name", "") or "",
        license_url=getattr(args, "license_url", "") or "",
        description=description,
        subjects=getattr(args, "subject", None) or [],
        modified=modified,
        cover_mode=cover_mode,
        cover_reason=cover_reason,
        ocr_model=ocr_label,
        pipeline_version=_pdfcraft_version(),
    )
    return built, cover, cover_mode, cover_reason, ocr_label


def _pdfcraft_version() -> str:
    try:
        from importlib.metadata import version

        return version("pdf-craft")
    except Exception:
        return ""
