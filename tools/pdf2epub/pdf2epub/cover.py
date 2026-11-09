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


def decide_cover(doc: fitz.Document, mode: str = "auto", dpi: int = 300) -> CoverDecision:
    if mode not in {"auto", "original", "generate", "none"}:
        raise ValueError(f"Unknown cover mode: {mode}")
    if mode == "none":
        return CoverDecision(None, "none", "cover disabled")
    if mode == "generate":
        return CoverDecision(None, "generated", "cover generation requested")
    candidate = extract_cover(doc, dpi=dpi)
    if candidate is None:
        if mode == "original":
            raise ValueError("No cover-like image found; use --cover auto or --cover generate")
        return CoverDecision(None, "generated", "no cover-like image on the first pages")
    return CoverDecision(candidate, "original", f"image on PDF page {candidate.source_page + 1}")
