"""Opt-in, auditable LLM proofreading for the Tesseract/pdf-craft path.

This is the same safety model as `bengali-book-pipeline`: the model proposes
exact-word edits, `ConservativeProofreader` validates them, and a fresh
Tesseract crop reading must corroborate each accepted edit. Without evidence
the edit stays in review. `--review-only` writes the audit but changes no text.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

DEFAULT_MODEL = "qwen3.5:4b"
DEFAULT_URL = "http://127.0.0.1:11434"


class OllamaProofreadingClient:
    """Ollama JSON chat client with a pinned model digest."""

    def __init__(self, url: str = DEFAULT_URL, model: str = DEFAULT_MODEL) -> None:
        self.url = url.rstrip("/")
        self.model = model
        with urlopen(self.url + "/api/tags", timeout=15) as response:
            models = json.load(response)["models"]
        record = next((item for item in models if item["name"] == model), None)
        if record is None:
            names = ", ".join(item["name"] for item in models[:8])
            raise ValueError(f"Model {model!r} is not installed in Ollama; available: {names}")
        self.identity = f"{model}@{record['digest']}"

    def __call__(self, system: str, user: str) -> str:
        return self.chat(system, user)

    def chat(self, system: str, user: str, images: list[str] | None = None) -> str:
        payload: dict[str, Any] = {
            "model": self.model,
            "stream": False,
            "think": False,
            "format": "json",
            "keep_alive": "5m",
            "options": {"temperature": 0, "seed": 0, "num_ctx": 4096, "num_predict": 512},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if images:
            payload["messages"][1]["images"] = images
        request = Request(
            self.url + "/api/chat",
            json.dumps(payload).encode(),
            {"Content-Type": "application/json"},
        )
        with urlopen(request, timeout=300) as response:
            result = json.load(response)
        if not result.get("done") or result.get("done_reason") == "length":
            raise RuntimeError("Incomplete LLM response; original text retained")
        return result["message"]["content"]


def load_diagnostics(analysis_dir: Path, pages: list[int] | None = None) -> dict[int, dict]:
    root = analysis_dir / "ocr"
    diagnostics: dict[int, dict] = {}
    if not root.is_dir():
        return diagnostics
    for path in sorted(root.glob("page_*.json")):
        try:
            page = int(path.stem.removeprefix("page_"))
        except ValueError:
            continue
        if pages is not None and page not in pages:
            continue
        diagnostics[page] = json.loads(path.read_text(encoding="utf-8"))
    return diagnostics


def proofread_pcex(
    pdf: Path,
    out: Path,
    pcex_path: Path,
    craft: Any,
    ocr_config: Any,
    args: Any,
) -> Path:
    """Run the conservative proofreader and return the proofread .pcex path."""
    from pdf_craft import PDFCraftExtraction
    from pdf_craft.pdf.crop_verifier import TesseractCropVerifier
    from pdf_craft.transformer.proofreader import ConservativeProofreader

    pages = None
    max_pages = int(getattr(args, "max_pages", 0) or 0)
    if max_pages:
        pages = list(range(1, max_pages + 1))
    diagnostics = load_diagnostics(out / "analysis", pages)
    root = out / "proofread"
    audit = root / "audit"
    evidence = root / "evidence"
    target = root / "proofread.pcex"
    root.mkdir(parents=True, exist_ok=True)

    client = OllamaProofreadingClient(
        getattr(args, "ollama_url", DEFAULT_URL) or DEFAULT_URL,
        getattr(args, "proofread_model", DEFAULT_MODEL) or DEFAULT_MODEL,
    )
    verifier = TesseractCropVerifier(pdf, ocr_config, diagnostics, evidence)
    try:
        proofreader = ConservativeProofreader(
            client,
            model_identity=client.identity,
            audit_path=audit,
            diagnostics=diagnostics or None,
            verify_edit=verifier,
            apply_edits=not getattr(args, "review_only", False),
            protected_words=tuple(getattr(args, "protected_word", None) or ()),
        )
        craft.translate_extraction(PDFCraftExtraction.open(pcex_path), target, proofreader)
    finally:
        verifier.close()
    return target
