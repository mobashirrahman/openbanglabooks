"""Cover discovery. Generation happens in TypeScript (`scripts/pdf/cover.ts`)."""

from __future__ import annotations

from dataclasses import dataclass

try:  # PyMuPDF ≥ 1.24 exposes the non-deprecated module name.
    import pymupdf as fitz
except ImportError:  # pragma: no cover - older PyMuPDF
    import fitz  # type: ignore

from .model import CoverCandidate
from .pdf import extract_cover


@dataclass
class CoverDecision:
    candidate: CoverCandidate | None
    mode: str  # original | generated | none
    reason: str


def decide_cover(
    doc: fitz.Document,
    mode: str = "auto",
    dpi: int = 300,
    cover_page: int | None = None,
) -> CoverDecision:
    if mode not in {"auto", "original", "generate", "none"}:
        raise ValueError(f"Unknown cover mode: {mode}")
    if mode == "none":
        return CoverDecision(None, "none", "cover disabled")
    if mode == "generate":
        return CoverDecision(None, "generated", "cover generation requested")
    candidate = extract_cover(
        doc, dpi=dpi, page_index=(cover_page - 1) if cover_page is not None else None
    )
    if candidate is None:
        if mode == "original" or cover_page is not None:
            raise ValueError("No cover-like image found on the requested page")
        return CoverDecision(None, "generated", "no cover-like image on the first pages")
    reason = (
        f"requested PDF page {cover_page}"
        if cover_page is not None
        else f"image on PDF page {candidate.source_page + 1}"
    )
    return CoverDecision(candidate, "original", reason)
