"""Small, serialisable types shared by the extractors and the book builder."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Block:
    """One ordered unit of page content."""

    page: int  # 0-based PDF page index
    bbox: tuple[float, float, float, float]  # PDF points, y grows downwards
    kind: str  # text | heading1..3 | list | table | figure | caption | footnote | header | footer | page-number | toc | equation
    html: str = ""
    text: str = ""
    confidence: float | None = None
    label: str = ""
    meta: dict[str, Any] = field(default_factory=dict)

    def with_html(self, html: str) -> "Block":
        self.html = html
        return self


@dataclass
class PageContent:
    index: int
    width: float
    height: float
    blocks: list[Block] = field(default_factory=list)
    source: str = "text"  # text | ocr
    printed_number: str | None = None
    mean_confidence: float | None = None


@dataclass
class ExtractedImage:
    data: bytes
    media_type: str
    width: int
    height: int
    page: int
    bbox: tuple[float, float, float, float]
    source: str  # embedded | render
    ext: str = "jpg"


@dataclass
class CoverCandidate:
    data: bytes
    ext: str
    width: int
    height: int
    source_page: int
    source: str  # embedded | render
    is_cover: bool


@dataclass
class ChapterDraft:
    id: str
    label: str
    part: str | None
    blocks: list[Block]
    page_start: int
    page_end: int
    epub_type: str = "chapter"
