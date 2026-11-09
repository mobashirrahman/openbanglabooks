"""Surya OCR integration.

Default model: `datalab-to/surya-ocr-2`. The newer `datalab-to/surya-ocr-2.5`
exists, but the project's Bengali page/crop benchmark measured Surya 2: it is
the strongest historical-page engine there, and 2.5 has not been measured on
that benchmark. A/B a few pages before switching a whole book.

Surya 2.x is served by vLLM (NVIDIA), llama.cpp (CPU / Apple Silicon), or the
transformers backend. The manager starts the server on first use; see
`docs/pdf-to-epub.md`.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

try:  # PyMuPDF ≥ 1.24 exposes the non-deprecated module name.
    import pymupdf as fitz
except ImportError:  # pragma: no cover - older PyMuPDF
    import fitz  # type: ignore

from .model import Block, ExtractedImage, PageContent
from .pdf import _jpeg_bytes, _pil_from_bytes, render_clip, render_page
from .textnorm import normalise_text

DEFAULT_MODEL = "datalab-to/surya-ocr-2"
SKIP_LABELS = {"BlankPage"}


def _import_surya():
    try:
        from surya.inference import SuryaInferenceManager  # type: ignore
        from surya.recognition import RecognitionPredictor  # type: ignore
    except Exception as exc:  # pragma: no cover - depends on optional install
        raise RuntimeError(
            "Surya is not installed. Install the OCR extra:\n"
            "  pip install -e 'tools/pdf2epub[surya]'\n"
            "and a backend (vLLM Docker on NVIDIA, or llama.cpp on CPU).\n"
            f"Original error: {exc}"
        ) from exc
    return SuryaInferenceManager, RecognitionPredictor


def _make_predictor(model: str, backend: str | None = None):
    os.environ["SURYA_MODEL_CHECKPOINT"] = model
    if backend:
        os.environ["SURYA_INFERENCE_BACKEND"] = backend
    SuryaInferenceManager, RecognitionPredictor = _import_surya()
    manager = SuryaInferenceManager()
    return RecognitionPredictor(manager)


def extract_ocr_pages(
    doc: fitz.Document,
    dpi: int = 300,
    model: str = DEFAULT_MODEL,
    backend: str | None = None,
    page_indices: list[int] | None = None,
    chunk_size: int = 8,
) -> tuple[list[PageContent], dict[str, Any]]:
    """Render pages and run Surya full-page OCR.

    Returns page contents plus the raw result (so a conversion can be audited
    or re-used without another model run).
    """
    predictor = _make_predictor(model, backend)
    indices = page_indices or list(range(len(doc)))
    pages: list[PageContent] = []
    raw: dict[str, Any] = {"model": model, "dpi": dpi, "pages": {}}

    for start in range(0, len(indices), chunk_size):
        chunk = indices[start : start + chunk_size]
        images = []
        for i in chunk:
            images.append(render_page(doc[i], dpi))
        try:
            predictions = predictor(images)
        except Exception as exc:
            raise RuntimeError(
                f"Surya OCR failed for pages {chunk[0] + 1}-{chunk[-1] + 1}: {exc}\n"
                "Check that the inference backend is running (vLLM Docker or llama-server)."
            ) from exc
        for i, pred in zip(chunk, predictions):
            page = doc[i]
            result = _result_to_page(page, pred, dpi)
            pages.append(result)
            raw["pages"][str(i)] = _prediction_json(pred)
    return pages, raw


def _bbox(block: Any) -> tuple[float, float, float, float]:
    bbox = getattr(block, "bbox", None)
    if bbox is None and getattr(block, "polygon", None):
        pts = block.polygon
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        bbox = (min(xs), min(ys), max(xs), max(ys))
    if not bbox:
        return (0.0, 0.0, 0.0, 0.0)
    return tuple(float(v) for v in bbox)


def _result_to_page(page: fitz.Page, pred: Any, dpi: int) -> PageContent:
    image_bbox = list(getattr(pred, "image_bbox", [0, 0, page.rect.width, page.rect.height]))
    px_w = max(1.0, float(image_bbox[2]))
    px_h = max(1.0, float(image_bbox[3]))
    sx = page.rect.width / px_w
    sy = page.rect.height / px_h
    blocks: list[Block] = []
    confidences: list[float] = []
    for item in getattr(pred, "blocks", []):
        label = str(getattr(item, "label", "Text"))
        if label in SKIP_LABELS:
            continue
        px_bbox = _bbox(item)
        bbox = (px_bbox[0] * sx, px_bbox[1] * sy, px_bbox[2] * sx, px_bbox[3] * sy)
        html = str(getattr(item, "html", "") or "")
        conf = getattr(item, "confidence", None)
        if conf is not None:
            try:
                conf = float(conf)
                confidences.append(conf)
            except (TypeError, ValueError):
                conf = None
        kind = _kind_for(label, bbox, page.rect.height)
        block = Block(
            page=page.number,
            bbox=bbox,
            kind=kind,
            html=html,
            text=normalise_text(_strip_simple(html)),
            confidence=conf,
            label=label,
            meta={"raw_label": str(getattr(item, "raw_label", "")), "reading_order": getattr(item, "reading_order", 0)},
        )
        if kind == "figure":
            block.meta["image"] = _crop_image(page, bbox, dpi)
        blocks.append(block)

    order = {id(b): int(b.meta.get("reading_order", 0)) for b in blocks}
    blocks.sort(key=lambda b: (order.get(id(b), 0), b.bbox[1], b.bbox[0]))
    mean = sum(confidences) / len(confidences) if confidences else None
    return PageContent(
        index=page.number,
        width=page.rect.width,
        height=page.rect.height,
        blocks=blocks,
        source="ocr",
        printed_number=None,
        mean_confidence=mean,
    )


def _kind_for(label: str, bbox: tuple[float, float, float, float], page_height: float) -> str:
    if label in {"PageHeader"}:
        return "header"
    if label in {"PageFooter"}:
        return "footer"
    if label in {"SectionHeader"}:
        height = bbox[3] - bbox[1]
        return "heading1" if height >= page_height * 0.028 else "heading2"
    if label in {"Table"}:
        return "table"
    if label in {"Picture", "Figure", "Diagram", "Image"}:
        return "figure"
    if label in {"Caption"}:
        return "caption"
    if label in {"Footnote"}:
        return "footnote"
    if label in {"TableOfContents"}:
        return "toc"
    if label in {"Equation", "ChemicalBlock", "Form", "Code"}:
        return "equation"
    if label in {"ListGroup"}:
        return "list"
    return "text"


def _crop_image(page: fitz.Page, bbox: tuple[float, float, float, float], dpi: int) -> ExtractedImage:
    rect = fitz.Rect(bbox) & page.rect
    im = render_clip(page, rect, dpi)
    # A figure needs enough pixels to be readable, but not a 20 MB page crop.
    if max(im.width, im.height) > 2400:
        im.thumbnail((2400, 2400))
    return ExtractedImage(
        data=_jpeg_bytes(im, quality=92),
        media_type="image/jpeg",
        width=im.width,
        height=im.height,
        page=page.number,
        bbox=bbox,
        source="render",
        ext="jpg",
    )


def _strip_simple(html: str) -> str:
    import re

    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()


def _prediction_json(pred: Any) -> dict[str, Any]:
    def clean(obj: Any) -> Any:
        if isinstance(obj, (str, int, float, bool)) or obj is None:
            return obj
        if isinstance(obj, (list, tuple)):
            return [clean(v) for v in obj]
        if isinstance(obj, dict):
            return {str(k): clean(v) for k, v in obj.items()}
        return str(obj)

    return clean(
        {
            "image_bbox": getattr(pred, "image_bbox", None),
            "blocks": [
                {
                    "label": getattr(b, "label", ""),
                    "raw_label": getattr(b, "raw_label", ""),
                    "bbox": getattr(b, "bbox", None),
                    "polygon": getattr(b, "polygon", None),
                    "reading_order": getattr(b, "reading_order", 0),
                    "confidence": getattr(b, "confidence", None),
                    "html": getattr(b, "html", ""),
                    "error": getattr(b, "error", False),
                }
                for b in getattr(pred, "blocks", [])
            ],
        }
    )


def pages_from_json(
    doc: fitz.Document,
    payload: Any,
    dpi: int = 300,
) -> list[PageContent]:
    """Build pages from a `surya_ocr` results.json (or our raw.json)."""
    page_dicts = _find_page_list(payload)
    pages: list[PageContent] = []
    for index, item in enumerate(page_dicts[: len(doc)]):
        page = doc[index]
        image_bbox = item.get("image_bbox") or [0, 0, page.rect.width, page.rect.height]
        px_w = max(1.0, float(image_bbox[2]))
        px_h = max(1.0, float(image_bbox[3]))
        sx = page.rect.width / px_w
        sy = page.rect.height / px_h
        blocks: list[Block] = []
        confidences: list[float] = []
        # Surya 2.5 nests `blocks` with `html`; older 2.x results use
        # `text_lines` with plain `text`. Accept either so an archived
        # results.json can be imported without re-running the model.
        raw_blocks = item.get("blocks")
        if not raw_blocks:
            raw_blocks = item.get("text_lines") or []
        for raw in raw_blocks:
            label = str(raw.get("label", "Text"))
            if label in SKIP_LABELS:
                continue
            pbox = raw.get("bbox") or (0, 0, 0, 0)
            bbox = (float(pbox[0]) * sx, float(pbox[1]) * sy, float(pbox[2]) * sx, float(pbox[3]) * sy)
            kind = _kind_for(label, bbox, page.rect.height)
            conf = raw.get("confidence")
            if conf is not None:
                try:
                    confidences.append(float(conf))
                except (TypeError, ValueError):
                    pass
            html = str(raw.get("html", "") or "")
            plain = str(raw.get("text", "") or "")
            block = Block(
                page=index,
                bbox=bbox,
                kind=kind,
                html=html,
                text=normalise_text(_strip_simple(html) if html else plain),
                confidence=conf,
                label=label,
                meta={"reading_order": raw.get("reading_order", 0)},
            )
            if kind == "figure":
                block.meta["image"] = _crop_image(page, bbox, dpi)
            blocks.append(block)
        blocks.sort(key=lambda b: (int(b.meta.get("reading_order", 0)), b.bbox[1], b.bbox[0]))
        pages.append(
            PageContent(
                index=index,
                width=page.rect.width,
                height=page.rect.height,
                blocks=blocks,
                source="ocr",
                mean_confidence=sum(confidences) / len(confidences) if confidences else None,
            )
        )
    return pages


def _find_page_list(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        raise ValueError("OCR JSON must be an object or list")
    if "pages" in payload and isinstance(payload["pages"], dict):
        return [payload["pages"][k] for k in sorted(payload["pages"], key=lambda s: int(s))]
    # surya_ocr results.json is {input_name: [page, page, ...]}.
    for value in payload.values():
        if isinstance(value, list) and (not value or isinstance(value[0], dict)):
            return value
    raise ValueError("Could not find a page list in OCR JSON")


def save_raw(raw: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(raw, ensure_ascii=False, indent=1), encoding="utf-8")


def load_raw(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))
