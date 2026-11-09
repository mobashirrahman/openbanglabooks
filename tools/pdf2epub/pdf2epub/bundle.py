"""Write the book bundle consumed by `scripts/pdf/build.ts`."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import __version__
from .model import CoverCandidate
from .structure import BuiltBook, ImageAsset


def write_bundle(
    out_dir: Path,
    book: BuiltBook,
    *,
    pdf_sha: str,
    pdf_pages: int,
    pdf_bytes: int,
    ocr_model: str | None,
    ocr_dpi: int,
    cover_candidate: CoverCandidate | None,
    cover_mode: str,
    cover_reason: str,
    raw_ocr: dict[str, Any] | None = None,
    pipeline_name: str = "pdf2epub",
    pipeline_version: str | None = None,
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    chapters = out_dir / "chapters"
    images = out_dir / "images"
    chapters.mkdir(exist_ok=True)
    images.mkdir(exist_ok=True)

    for section in book.sections:
        (chapters / f"{section.id}.xhtml").write_text(section.xhtml + "\n", encoding="utf-8")

    for asset in book.images:
        _write_image(images, asset)

    cover: dict[str, Any] = {"kind": cover_mode, "reason": cover_reason}
    if cover_candidate is not None:
        ext = "jpg" if cover_candidate.ext.lower() in {"jpg", "jpeg"} else cover_candidate.ext.lower()
        name = f"cover-original.{ext}"
        (out_dir / name).write_bytes(cover_candidate.data)
        cover = {
            "kind": "original",
            "file": name,
            "width": cover_candidate.width,
            "height": cover_candidate.height,
            "sourcePage": cover_candidate.source_page + 1,
            "source": cover_candidate.source,
            "reason": cover_reason,
        }

    manifest: dict[str, Any] = {
        "format": "openbanglabooks-book-bundle",
        "version": 1,
        "pipeline": {
            "name": pipeline_name,
            "version": pipeline_version or __version__,
            "ocrModel": ocr_model,
            "ocrDpi": ocr_dpi,
        },
        "source": {
            "sha256": pdf_sha,
            "pages": pdf_pages,
            "bytes": pdf_bytes,
        },
        "meta": book.meta,
        "cover": cover,
        "sections": [
            {
                "id": s.id,
                "label": s.label,
                "file": f"chapters/{s.id}.xhtml",
                "epubType": s.epub_type,
                "part": s.part,
                "pageStart": s.page_start + 1,
                "pageEnd": s.page_end + 1,
                "words": s.words,
            }
            for s in book.sections
        ],
        "images": [
            {
                "id": a.id,
                "file": a.href,
                "mediaType": a.media_type,
                "alt": a.alt,
                "width": a.width,
                "height": a.height,
                "sha1": a.sha1,
            }
            for a in book.images
        ],
        "toc": book.toc,
        "pageList": book.page_list,
        "report": book.report,
    }
    (out_dir / "book.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    if raw_ocr is not None:
        raw_dir = out_dir / "raw"
        raw_dir.mkdir(exist_ok=True)
        (raw_dir / "ocr.json").write_text(json.dumps(raw_ocr, ensure_ascii=False, indent=1), encoding="utf-8")

    _write_report(out_dir, book, manifest)
    return manifest


def _write_image(images: Path, asset: ImageAsset) -> None:
    # `href` is images/img-001.jpg
    name = asset.href.split("/", 1)[-1]
    (images / name).write_bytes(asset.data)


def _write_report(out_dir: Path, book: BuiltBook, manifest: dict[str, Any]) -> None:
    stats = book.report.get("stats", {})
    warnings = book.report.get("warnings", [])
    lines = [
        f"# Conversion report — {book.meta.get('title', '')}",
        "",
        f"- Source pages: {stats.get('pages', 0)}",
        f"- Words: {stats.get('words', 0)}",
        f"- Sections: {len(book.sections)}",
        f"- Footnotes: {stats.get('footnotes', 0)}",
        f"- Tables: {stats.get('tables', 0)}",
        f"- Figures: {stats.get('figures', 0)}",
        f"- Dropped running heads: {stats.get('dropped_running_heads', 0)}",
        f"- TOC pages dropped (rebuilt as EPUB nav): {stats.get('toc_pages_dropped', 0)}",
        f"- OCR model: {book.meta.get('ocrModel') or 'text layer (no OCR)'}",
        f"- Cover: {manifest.get('cover', {}).get('kind', 'generated')} "
        f"({manifest.get('cover', {}).get('reason', '')})",
        "",
    ]
    low = stats.get("low_confidence_pages") or []
    if low:
        lines += ["## Pages to proof", "", "OCR mean confidence below 0.60 on these PDF pages:", ""]
        lines += [f"- page {p}" for p in low]
        lines.append("")
    if warnings:
        lines += ["## Warnings", ""] + [f"- {w}" for w in warnings] + [""]
    lines += ["## Sections", ""]
    for sec in book.sections:
        lines.append(f"- {sec.label} — pages {sec.page_start + 1}–{sec.page_end + 1}, {sec.words} words")
    lines.append("")
    (out_dir / "report.md").write_text("\n".join(lines), encoding="utf-8")
    (out_dir / "report.json").write_text(
        json.dumps(book.report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
