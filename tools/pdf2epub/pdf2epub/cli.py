"""`pdf2epub` command line: inspect, extract, and import Surya JSON."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from . import __version__
from .bundle import write_bundle
from .cover import decide_cover
from .metadata import apply_metadata, load_metadata
from .ocr import DEFAULT_MODEL, extract_ocr_pages, load_raw, pages_from_json
from .pdf import file_sha256, inspect_pdf, open_pdf
from .structure import build_book
from .textlayer import extract_text_pages

# Pins from the November 2026 Bengali benchmark (see docs/pdf-to-epub.md).
PINNED_SURYA_MODEL = DEFAULT_MODEL
PINNED_SURYA_OCR = "0.22.1"
PINNED_TESSERACT = "5.5.3"
TESSDATA_BEST_MD5 = "6e997a9bc0f9dffc3431a0b16ca856ea"
TESSDATA_FAST_MD5 = "4ded8631c91f5d70b5c01ab4d5a671c4"


def _common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("pdf", type=Path, help="input PDF")
    parser.add_argument("--out", type=Path, required=True, help="bundle directory (e.g. .work/book)")
    parser.add_argument("--language", default="bn", help="BCP 47 language (default: bn)")
    parser.add_argument("--title")
    parser.add_argument("--title-en")
    parser.add_argument("--subtitle")
    parser.add_argument("--author")
    parser.add_argument("--author-en")
    parser.add_argument("--author-sort")
    parser.add_argument("--publisher", default="OpenBanglaBooks")
    parser.add_argument("--first-published", type=int)
    parser.add_argument("--source-name", help="human-readable source, e.g. 'Scan: 1932 edition'")
    parser.add_argument("--source-url")
    parser.add_argument("--rights", default="", help="rights statement recorded in the colophon")
    parser.add_argument("--license", dest="license_name", default="")
    parser.add_argument("--license-url", default="")
    parser.add_argument("--description", default="")
    parser.add_argument("--subject", action="append", default=[], help="subject/genre (repeatable)")
    parser.add_argument("--modified", default="2026-01-01T00:00:00Z", help="dcterms:modified, ISO 8601")
    parser.add_argument("--dpi", type=int, default=300, help="render DPI for OCR/figures (default: 300)")
    parser.add_argument("--cover", choices=["auto", "original", "generate", "none"], default="auto")
    parser.add_argument("--max-pages", type=int, default=0, help="limit pages (for trials)")
    parser.add_argument("--keep-raw", action="store_true", help="write raw OCR JSON into the bundle")
    parser.add_argument("--metadata", type=Path, help="publication metadata sidecar (JSON)")
    parser.add_argument("--quiet", action="store_true")


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="pdf2epub", description=__doc__)
    p.add_argument("--version", action="version", version=f"pdf2epub {__version__}")
    sub = p.add_subparsers(dest="command", required=True)

    insp = sub.add_parser("inspect", help="report text-layer quality and cover candidates")
    insp.add_argument("pdf", type=Path)
    insp.add_argument("--json", action="store_true")

    ext = sub.add_parser("extract", help="PDF → book bundle (XHTML + images + JSON)")
    _common(ext)
    ext.add_argument("--engine", choices=["surya", "tesseract"], default="surya", help="OCR engine: surya or tesseract")
    ext.add_argument("--ocr", choices=["auto", "always", "never"], default="auto")
    ext.add_argument("--model", default=DEFAULT_MODEL)
    ext.add_argument("--backend", choices=["vllm", "llamacpp", "mlx"], help="Surya inference backend")
    ext.add_argument("--ocr-json", type=Path, help="use a saved surya_ocr results.json instead of running OCR")
    ext.add_argument("--tesseract", default="tesseract", help="tesseract executable for pdf-craft")
    ext.add_argument("--pdfcraft-language", default="ben", help="Tesseract language code for pdf-craft (default: ben)")
    ext.add_argument("--tessdata", type=Path, help="tessdata directory for pdf-craft")
    ext.add_argument("--pdfcraft-recover-structure", action="store_true", help="run pdf-craft reading-structure recovery before conversion")

    imp = sub.add_parser("import-ocr", help="build a bundle from a saved surya_ocr results.json")
    _common(imp)
    imp.add_argument("ocr_json", type=Path)
    imp.add_argument("--model", default=DEFAULT_MODEL)

    chk = sub.add_parser("check-ocr", help="verify the pinned Surya 2 and Tesseract engines")
    chk.add_argument("--engine", choices=["all", "surya", "tesseract"], default="all")
    chk.add_argument("--tesseract", default="tesseract", help="tesseract executable")
    chk.add_argument("--tessdata", type=Path, help="tessdata directory containing ben.traineddata")
    chk.add_argument("--json", action="store_true")
    chk.add_argument("--strict", action="store_true", help="exit 1 on any missing or unpinned engine")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "inspect":
        return _inspect(args)
    if args.command == "check-ocr":
        return _check_ocr(args)
    if args.command in {"extract", "import-ocr"}:
        return _extract(args)
    return 2


def _inspect(args: argparse.Namespace) -> int:
    info = inspect_pdf(args.pdf)
    data = {
        "file": str(args.pdf),
        "pages": info.pages,
        "metadata": info.metadata,
        "page_size": [round(info.page_width, 1), round(info.page_height, 1)],
        "has_text_layer": info.has_text,
        "text_pages_sampled": info.text_pages,
        "average_chars_per_page": info.avg_chars,
        "replacement_ratio": info.replacement_ratio,
        "image_pages_sampled": info.image_pages,
        "cover_like_pages": [p + 1 for p in info.cover_like_pages],
        "fonts": info.fonts,
        "recommendation": "text layer" if info.has_text and info.replacement_ratio < 0.01 else "OCR",
        "sha256": file_sha256(args.pdf),
    }
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(f"Pages: {info.pages}   Size: {info.page_width:.0f}×{info.page_height:.0f} pt")
        print(f"Text layer: {'yes' if info.has_text else 'no'}  ({info.avg_chars:.0f} chars/page)")
        print(f"Replacement chars: {info.replacement_ratio:.3%}   Image pages (sample): {info.image_pages}")
        print(f"Cover-like pages: {[p + 1 for p in info.cover_like_pages] or 'none'}")
        print(f"Recommendation: {data['recommendation']}")
        print(f"sha256: {data['sha256']}")
    return 0


def _version_tuple(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", value)[:3])


def _md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _check_ocr(args: argparse.Namespace) -> int:
    rows: list[dict[str, Any]] = []
    failed = False

    if args.engine in {"all", "surya"}:
        try:
            version = importlib.metadata.version("surya-ocr")
            expected = _version_tuple(PINNED_SURYA_OCR)[:2]
            status = "ok" if _version_tuple(version)[:2] == expected else "warn"
            note = f"model {PINNED_SURYA_MODEL}; measured with {PINNED_SURYA_OCR}"
        except importlib.metadata.PackageNotFoundError:
            version, status = None, "missing"
            note = "pip install -e 'tools/pdf2epub[surya]'"
        failed |= status != "ok"
        rows.append({"engine": "surya", "status": status, "version": version, "note": note})

    if args.engine in {"all", "tesseract"}:
        try:
            result = subprocess.run(
                [args.tesseract, "--version"], capture_output=True, text=True, timeout=10
            )
            match = re.search(r"tesseract\s+(\d+\.\d+\.\d+)", result.stdout, re.I)
            version = match.group(1) if match else None
            status = "ok" if version == PINNED_TESSERACT else "warn"
            note = f"pinned {PINNED_TESSERACT}"
        except (OSError, subprocess.SubprocessError) as exc:
            version, status = None, "missing"
            note = f"{type(exc).__name__}: {exc}"
        failed |= status != "ok"
        rows.append({"engine": "tesseract", "status": status, "version": version, "note": note})

        tessdata = args.tessdata or Path("tessdata")
        traineddata = tessdata / "ben.traineddata"
        if not traineddata.is_file():
            status, digest = "missing", None
            note = f"expected {traineddata}"
        else:
            digest = _md5(traineddata)
            if digest == TESSDATA_BEST_MD5:
                status, note = "ok", "tessdata_best (recommended)"
            elif digest == TESSDATA_FAST_MD5:
                status, note = "warn", "tessdata_fast (old paper hash; ~7 points lower word accuracy)"
            else:
                status, note = "warn", "unrecognised ben.traineddata"
        failed |= status != "ok"
        rows.append({"engine": "tessdata", "status": status, "version": digest, "note": note})

    payload = {"ok": not failed, "engines": rows}
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for row in rows:
            print(f"{row['engine']}: {row['status']}  {row['version'] or '-'}  ({row['note']})")
        print("ok" if not failed else "not pinned — see docs/pdf-to-epub.md")
    return 0 if not (args.strict and failed) else 1


def _extract(args: argparse.Namespace) -> int:
    pdf = args.pdf.resolve()
    if not pdf.exists():
        print(f"error: no such PDF: {pdf}", file=sys.stderr)
        return 2
    out = args.out.resolve()
    try:
        values, metadata_path = load_metadata(
            pdf,
            getattr(args, "metadata", None),
            title=args.title,
            authors=[args.author] if args.author else None,
        )
        apply_metadata(args, values)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: invalid metadata sidecar: {exc}", file=sys.stderr)
        return 2
    if metadata_path and not args.quiet:
        print(f"metadata: {metadata_path}")
    info = inspect_pdf(pdf)
    sha = file_sha256(pdf)
    if args.command == "extract" and getattr(args, "engine", "surya") == "tesseract":
        return _extract_with_pdfcraft(args, pdf, out, info, sha)
    doc = open_pdf(pdf)
    max_pages = args.max_pages or len(doc)
    indices = list(range(min(max_pages, len(doc))))
    raw: dict[str, Any] | None = None
    ocr_model: str | None = None

    try:
        if args.command == "import-ocr" or args.ocr_json:
            path = args.ocr_json
            raw = load_raw(path)
            pages = pages_from_json(doc, raw, dpi=args.dpi)
            pages = [p for p in pages if p.index in set(indices)]
            ocr_model = args.model
        else:
            use_ocr = args.ocr == "always" or (args.ocr == "auto" and not _text_layer_ok(info))
            if use_ocr:
                pages, raw = extract_ocr_pages(
                    doc,
                    dpi=args.dpi,
                    model=args.model,
                    backend=getattr(args, "backend", None),
                    page_indices=indices,
                )
                ocr_model = args.model
            else:
                pages = extract_text_pages(doc, args.dpi)
                pages = [p for p in pages if p.index in set(indices)]
                if not pages or sum(len(p.blocks) for p in pages) == 0:
                    if args.ocr == "never":
                        raise RuntimeError("No text layer found and --ocr never was set")
                    print("warning: text layer empty; falling back to Surya OCR", file=sys.stderr)
                    pages, raw = extract_ocr_pages(
                        doc, dpi=args.dpi, model=args.model, backend=getattr(args, "backend", None), page_indices=indices
                    )
                    ocr_model = args.model
                elif args.ocr == "auto":
                    pages, raw, ocr_model = _fill_scanned_pages(doc, pages, args)

        decision = decide_cover(doc, args.cover, dpi=args.dpi)
        cover_sha = hashlib.sha1(decision.candidate.data).hexdigest() if decision.candidate else None
        title = args.title or info.metadata.get("title") or pdf.stem
        title = _clean_meta(title)
        author = _clean_meta(args.author or info.metadata.get("author") or "অজ্ঞাত")
        built = build_book(
            pages,
            pdf_sha=sha,
            title=title,
            author=author,
            language=args.language,
            title_en=args.title_en,
            author_en=args.author_en,
            author_sort=args.author_sort,
            subtitle=args.subtitle,
            publisher=args.publisher,
            first_published=args.first_published,
            source_url=args.source_url or "",
            source_name=args.source_name or pdf.name,
            rights=args.rights,
            license_name=args.license_name,
            license_url=args.license_url,
            description=args.description,
            subjects=args.subject,
            modified=args.modified,
            ocr_model=ocr_model,
            cover={"kind": decision.mode} if decision else None,
            cover_sha=cover_sha,
        )
        manifest = write_bundle(
            out,
            built,
            pdf_sha=sha,
            pdf_pages=len(doc),
            pdf_bytes=pdf.stat().st_size,
            ocr_model=ocr_model,
            ocr_dpi=args.dpi,
            cover_candidate=decision.candidate,
            cover_mode=decision.mode,
            cover_reason=decision.reason,
            raw_ocr=raw if args.keep_raw else None,
            metadata=getattr(args, "metadata_record", None),
        )
        if not args.quiet:
            stats = manifest["report"]["stats"]
            print(f"bundle: {out}")
            print(f"  source:      {manifest['source']['pages']} pages, {manifest['source']['bytes'] / 1e6:.1f} MB")
            print(f"  extraction:  {'Surya OCR — ' + (ocr_model or '') if ocr_model else 'PDF text layer'}")
            print(f"  sections:    {len(manifest['sections'])} ({stats['words']} words)")
            print(f"  figures:     {stats['figures']}   tables: {stats['tables']}   notes: {stats['footnotes']}")
            print(f"  cover:       {manifest['cover']['kind']} ({manifest['cover']['reason']})")
            for warning in manifest["report"].get("warnings", []):
                print(f"  warning:     {warning}")
            low = stats.get("low_confidence_pages") or []
            if low:
                print(f"  proof:       {len(low)} page(s) below 0.60 OCR confidence ({low[:12]}{'…' if len(low) > 12 else ''})")
            print(f"  next:        pnpm pdf:build --work {out} --out <book.epub>")
        return 0
    finally:
        doc.close()


def _extract_with_pdfcraft(args: argparse.Namespace, pdf: Path, out: Path, info, sha: str) -> int:
    from .pdfcraft import extract_with_pdfcraft

    args.pdf_sha = sha
    args.pdf_pages = info.pages
    args.pdf_bytes = pdf.stat().st_size
    try:
        built, cover_candidate, cover_mode, cover_reason, ocr_model = extract_with_pdfcraft(pdf, out, args)
    except Exception as exc:
        print(f"error: pdf-craft extraction failed: {exc}", file=sys.stderr)
        return 1

    manifest = write_bundle(
        out,
        built,
        pdf_sha=sha,
        pdf_pages=info.pages,
        pdf_bytes=pdf.stat().st_size,
        ocr_model=ocr_model,
        ocr_dpi=args.dpi,
        cover_candidate=cover_candidate,
        cover_mode=cover_mode,
        cover_reason=cover_reason,
        pipeline_name="pdf-craft",
        pipeline_version=str(built.report.get("pipeline", {}).get("version") or ""),
        metadata=getattr(args, "metadata_record", None),
    )
    if not args.quiet:
        stats = manifest["report"]["stats"]
        print(f"bundle: {out}")
        print(f"  source:      {manifest['source']['pages']} pages, {manifest['source']['bytes'] / 1e6:.1f} MB")
        print(f"  extraction:  pdf-craft — {ocr_model or 'unknown OCR'}")
        print(f"  sections:    {len(manifest['sections'])} ({stats['words']} words)")
        print(f"  figures:     {stats['figures']}   tables: {stats['tables']}   notes: {stats['footnotes']}")
        print(f"  cover:       {manifest['cover']['kind']} ({manifest['cover']['reason']})")
        for warning in manifest["report"].get("warnings", []):
            print(f"  warning:     {warning}")
        print(f"  next:        pnpm pdf:build --work {out} --out <book.epub>")
    return 0


def _text_layer_ok(info) -> bool:
    return info.has_text and info.replacement_ratio < 0.01


def _fill_scanned_pages(doc, pages, args):
    """OCR only pages that have an image but almost no extractable text.

    This makes hybrid books (a few scanned plates or an inserted PDF) work
    without forcing the whole book through the model. Failures are non-fatal
    under `--ocr auto`; `--ocr always` would have taken the full OCR path.
    """
    sparse: list[int] = []
    for page in pages:
        if any(b.kind == "figure" for b in page.blocks):
            continue
        text = " ".join(
            b.text for b in page.blocks if b.kind not in {"header", "footer", "page-number"}
        )
        if len(text.strip()) >= 40:
            continue
        try:
            has_image = bool(doc[page.index].get_images(full=True))
        except Exception:
            has_image = False
        if has_image:
            sparse.append(page.index)
    if not sparse:
        return pages, None, None

    print(
        f"warning: {len(sparse)} page(s) have an image but no text layer; running Surya OCR on them",
        file=sys.stderr,
    )
    try:
        ocr_pages, raw = extract_ocr_pages(
            doc,
            dpi=args.dpi,
            model=args.model,
            backend=getattr(args, "backend", None),
            page_indices=sparse,
        )
    except Exception as exc:
        print(f"warning: OCR fallback failed ({exc}); keeping the text layer", file=sys.stderr)
        return pages, None, None
    by_index = {p.index: p for p in pages}
    for page in ocr_pages:
        by_index[page.index] = page
    return [by_index[i] for i in sorted(by_index)], raw, args.model


def _clean_meta(value: str) -> str:
    value = " ".join(str(value).split())
    # PDF producers often leave placeholders like "untitled" or "Microsoft Word - ...".
    if value.lower() in {"untitled", "unknown", "none", "document"}:
        return "অজানা"
    return value


if __name__ == "__main__":
    raise SystemExit(main())
