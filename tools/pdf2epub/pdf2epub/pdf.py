"""PDF inspection, page rendering, and embedded-image extraction."""

from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

try:  # PyMuPDF ≥ 1.24 exposes the non-deprecated module name.
    import pymupdf as fitz
except ImportError:  # pragma: no cover - older PyMuPDF
    import fitz  # type: ignore
from PIL import Image, ImageOps

from .model import CoverCandidate, ExtractedImage
from .textnorm import ascii_digits, bn_digits, is_page_number, short

TEXT_FLAGS = (
    getattr(fitz, "TEXTFLAGS_TEXT", 0)
    | getattr(fitz, "TEXT_PRESERVE_WHITESPACE", 0)
    | getattr(fitz, "TEXT_PRESERVE_LIGATURES", 0)
)


@dataclass
class PdfInfo:
    pages: int
    encrypted: bool
    metadata: dict[str, str]
    page_width: float
    page_height: float
    has_text: bool
    text_pages: int
    avg_chars: float
    replacement_ratio: float
    image_pages: int
    cover_like_pages: list[int]
    fonts: list[str]


@dataclass
class PageText:
    page: int
    width: float
    height: float
    blocks: list[dict]
    plain: str
    printed_number: str | None


def open_pdf(path: Path) -> fitz.Document:
    doc = fitz.open(path)
    if doc.is_encrypted:
        # Many PDFs are "encrypted" with an empty owner password; try that first.
        if not doc.authenticate(""):
            raise ValueError("PDF is encrypted and needs a password")
    return doc


def _replacement_ratio(text: str) -> float:
    if not text:
        return 0.0
    bad = text.count("\ufffd") + text.count("\u25a1") + text.count("\u25af")
    return bad / max(1, len(text))


def inspect_pdf(path: Path, sample_pages: int = 24) -> PdfInfo:
    doc = open_pdf(path)
    try:
        indices = list(range(min(sample_pages, len(doc))))
        chars = 0
        bad = 0
        text_pages = 0
        image_pages = 0
        cover_like: list[int] = []
        fonts: set[str] = set()
        for i in indices:
            page = doc[i]
            text = page.get_text("text")
            chars += len(text)
            bad += text.count("\ufffd") + text.count("\u25a1") + text.count("\u25af")
            if len(text.strip()) >= 60:
                text_pages += 1
            if page.get_images(full=True):
                image_pages += 1
            if _cover_score(page) >= 0.32:
                cover_like.append(i)
            for f in page.get_fonts(full=True):
                fonts.add(f[3] if len(f) > 3 else str(f))
        total_chars = sum(len(doc[i].get_text("text")) for i in indices)
        avg = total_chars / max(1, len(indices))
        return PdfInfo(
            pages=len(doc),
            encrypted=doc.is_encrypted,
            metadata={k: v for k, v in (doc.metadata or {}).items() if v},
            page_width=doc[0].rect.width if len(doc) else 0,
            page_height=doc[0].rect.height if len(doc) else 0,
            has_text=avg >= 120 and text_pages >= max(1, len(indices) // 2),
            text_pages=text_pages,
            avg_chars=round(avg, 1),
            replacement_ratio=round(bad / max(1, total_chars), 5),
            image_pages=image_pages,
            cover_like_pages=cover_like,
            fonts=sorted(fonts)[:20],
        )
    finally:
        doc.close()


def _cover_score(page: fitz.Page) -> float:
    """How much of the page is one large image (a proxy for 'this is a cover')."""
    page_area = max(1.0, page.rect.width * page.rect.height)
    best = 0.0
    for item in page.get_images(full=True):
        rects = _image_rects(page, item[0])
        for rect in rects:
            best = max(best, (rect.width * rect.height) / page_area)
    text = page.get_text("text").strip()
    # A full-bleed image with little text is a cover; a full-page scan of text
    # is not, so weigh the text down only a little.
    text_penalty = min(0.25, len(text) / 2400)
    return max(0.0, min(1.0, best - text_penalty))


def _image_rects(page: fitz.Page, xref: int) -> list[fitz.Rect]:
    try:
        rects = page.get_image_rects(xref)
    except Exception:
        return []
    out: list[fitz.Rect] = []
    for r in rects:
        if isinstance(r, fitz.Rect):
            out.append(r)
        elif isinstance(r, (tuple, list)) and len(r) >= 2 and isinstance(r[1], fitz.Rect):
            out.append(r[1])
    return out


def read_page(page: fitz.Page) -> PageText:
    data = page.get_text("dict", flags=TEXT_FLAGS)
    printed = detect_printed_page_number(page)
    return PageText(
        page=page.number,
        width=page.rect.width,
        height=page.rect.height,
        blocks=list(data.get("blocks", [])),
        plain=page.get_text("text"),
        printed_number=printed,
    )


def render_page(page: fitz.Page, dpi: int) -> Image.Image:
    pix = page.get_pixmap(dpi=dpi, alpha=False, colorspace=fitz.csRGB)
    return Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")


def render_clip(page: fitz.Page, rect: fitz.Rect, dpi: int) -> Image.Image:
    clip = fitz.Rect(rect) & page.rect
    if clip.is_empty:
        clip = page.rect
    pix = page.get_pixmap(clip=clip, dpi=dpi, alpha=False, colorspace=fitz.csRGB)
    return Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")


def _pil_from_bytes(data: bytes) -> Image.Image | None:
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
        return ImageOps.exif_transpose(im)
    except Exception:
        return None


def extract_page_images(
    doc: fitz.Document,
    page: fitz.Page,
    dpi: int,
    min_side: int = 160,
    min_area_ratio: float = 0.012,
) -> list[ExtractedImage]:
    """Prefer the original embedded image; fall back to a high-DPI page crop."""
    page_area = max(1.0, page.rect.width * page.rect.height)
    seen: set[int] = set()
    out: list[ExtractedImage] = []
    for item in page.get_images(full=True):
        xref = int(item[0])
        if xref in seen:
            continue
        seen.add(xref)
        rects = _image_rects(page, xref)
        if not rects:
            continue
        rect = max(rects, key=lambda r: r.width * r.height)
        if rect.width * rect.height / page_area < min_area_ratio:
            continue
        try:
            raw = doc.extract_image(xref)
        except Exception:
            raw = None
        chosen: ExtractedImage | None = None
        if raw and raw.get("image"):
            im = _pil_from_bytes(raw["image"])
            if im and im.width >= min_side and im.height >= min_side:
                ext = str(raw.get("ext") or "png").lower()
                if ext not in {"png", "jpg", "jpeg", "webp"}:
                    ext = "png"
                chosen = ExtractedImage(
                    data=raw["image"],
                    media_type=f"image/{'jpeg' if ext in {'jpg', 'jpeg'} else ext}",
                    width=im.width,
                    height=im.height,
                    page=page.number,
                    bbox=tuple(rect),
                    source="embedded",
                    ext="jpg" if ext in {"jpg", "jpeg"} else ext,
                )
        if chosen is None:
            im = render_clip(page, rect, dpi)
            if im.width < min_side or im.height < min_side:
                continue
            chosen = ExtractedImage(
                data=_jpeg_bytes(im, quality=92),
                media_type="image/jpeg",
                width=im.width,
                height=im.height,
                page=page.number,
                bbox=tuple(rect),
                source="render",
                ext="jpg",
            )
        out.append(chosen)
    out.sort(key=lambda i: (i.bbox[1], i.bbox[0]))
    return out


def _jpeg_bytes(im: Image.Image, quality: int = 92) -> bytes:
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def extract_cover(
    doc: fitz.Document, dpi: int = 300, page_index: int | None = None
) -> CoverCandidate | None:
    """Find the most cover-like page in the first three pages and extract it.

    ``page_index`` (0-based) forces a specific page when the metadata sidecar
    supplies ``cover_page``. The original embedded image is used when it is
    large enough; otherwise the page is rendered at `dpi`. The result is not
    resized here — the TypeScript cover stage crops/upscales it to the 2:3
    EPUB canvas.
    """
    best: tuple[float, int, fitz.Rect, int] | None = None
    page_area_ref = 1.0
    pages = [page_index] if page_index is not None else list(range(min(3, len(doc))))
    for i in pages:
        if i < 0 or i >= len(doc):
            raise ValueError(f"cover_page is outside the document: {i + 1}")
        page = doc[i]
        if i == 0:
            page_area_ref = max(1.0, page.rect.width * page.rect.height)
        score = _cover_score(page)
        if score < 0.3:
            continue
        for item in page.get_images(full=True):
            xref = int(item[0])
            for rect in _image_rects(page, xref):
                area = rect.width * rect.height / page_area_ref
                if area >= 0.3 and (best is None or score + area > best[0]):
                    best = (score + area, i, rect, xref)
    if best is None:
        return None

    _, page_index, rect, xref = best
    page = doc[page_index]
    raw = None
    try:
        raw = doc.extract_image(xref)
    except Exception:
        pass
    if raw and raw.get("image"):
        im = _pil_from_bytes(raw["image"])
        if im and im.width >= 900 and im.height >= 1200:
            ext = str(raw.get("ext") or "jpg").lower()
            if ext not in {"jpg", "jpeg", "png", "webp"}:
                ext = "png"
            return CoverCandidate(
                data=raw["image"],
                ext="jpg" if ext in {"jpg", "jpeg"} else ext,
                width=im.width,
                height=im.height,
                source_page=page_index,
                source="embedded",
                is_cover=True,
            )

    im = render_clip(page, rect, max(dpi, _dpi_for_height(rect, 2000)))
    if im.width < 800 or im.height < 1000:
        return None
    return CoverCandidate(
        data=_jpeg_bytes(im, quality=94),
        ext="jpg",
        width=im.width,
        height=im.height,
        source_page=page_index,
        source="render",
        is_cover=True,
    )


def _dpi_for_height(rect: fitz.Rect, target_px: int) -> int:
    # PDF points are 1/72 inch.
    return max(72, math.ceil(target_px * 72 / max(1.0, rect.height)))


def detect_printed_page_number(page: fitz.Page) -> str | None:
    """Read a folio at the top or bottom margin, if there is one."""
    height = page.rect.height
    candidates: list[str] = []
    for block in page.get_text("blocks", sort=True):
        x0, y0, x1, y1, text = block[:5]
        if not isinstance(text, str):
            continue
        if y1 < height * 0.09 or y0 > height * 0.91:
            if is_page_number(text):
                candidates.append(text.strip())
    if not candidates:
        return None
    value = ascii_digits(candidates[0])
    value = re.sub(r"[^\d]", "", value)
    return bn_digits(value) if value else None


def iter_page_images(doc: fitz.Document, dpi: int) -> Iterable[tuple[int, list[ExtractedImage]]]:
    for page in doc:
        yield page.number, extract_page_images(doc, page, dpi)


def is_title_page(text: str, title: str, author: str) -> bool:
    norm = re.sub(r"[\s\W_]+", "", text, flags=re.UNICODE).lower()
    if not norm or len(norm) > 600:
        return False
    t = re.sub(r"[\s\W_]+", "", title, flags=re.UNICODE).lower()
    a = re.sub(r"[\s\W_]+", "", author, flags=re.UNICODE).lower()
    return (bool(t) and t in norm) or (bool(a) and a in norm and len(norm) < 260)


def file_sha256(path: Path) -> str:
    import hashlib

    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
