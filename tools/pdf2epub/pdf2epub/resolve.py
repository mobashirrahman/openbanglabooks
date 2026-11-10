"""Offline title/author resolution for the PDF→EPUB bundle.

Precision over recall: an omitted title falls back to a visible
``শিরোনামহীন`` placeholder, while a wrong title silently mislabels the book.
An accepted value therefore needs a *trusted* signal -- a matched filename
template (confidence >= 0.5) or a junk-filtered PDF ``/Info`` value -- or
corroboration from two independent signals. Trusted signals that disagree
produce ``status="ambiguous"`` with no value instead of a guess.

``status`` is one of:

* ``ok`` -- a title and/or authors were accepted, no conflict.
* ``ambiguous`` -- two trusted signals disagree on a field; that field alone
  is left empty (per-field conservatism).
* ``empty`` -- no signal carried a usable value (e.g. a content-hash filename
  with an empty ``/Info``).
* ``not_a_book`` -- the filename names a fragment (title page, chapter, link
  list), so nothing is resolved.

Volume/edition/year parsed from the filename are recorded, never applied: a
wrong volume is worse than no volume.
"""

from __future__ import annotations

import re
import string
import unicodedata
from pathlib import Path
from typing import Any

from .filename_parser import parse_filename

__all__ = ["RESOLVER", "resolve_metadata", "apply_resolution"]

RESOLVER = "pdf2epub-metadata-v1"

# A filename only competes for acceptance when it matched a scraper template.
TRUSTED_CONFIDENCE = 0.5

SIGNAL_ORDER = ("filename", "pdf_info", "cover")

_UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    re.IGNORECASE,
)
_TITLE_PLACEHOLDERS = frozenset({
    "document", "new document", "microsoft word", "word document", "print",
    "scan", "scanned", "scanned document", "book", "book1", "pdf",
    "document1", "doc1", "test", "test document", "default", "title",
})
_UNTITLED_RE = re.compile(r"untitled[\s\-_#\d]*", re.IGNORECASE)
_AUTHOR_PLACEHOLDERS = frozenset({
    "unknown", "unknown author", "administrator", "admin", "user", "users",
    "owner", "anonymous", "none", "n/a", "na", "null", "author", "authors",
    "no author",
})
_TITLE_EXTENSIONS = (".pdf", ".doc", ".docx", ".indd")

# Punctuation stripped from both ends before comparing two values.
_EDGE_CHARS = string.punctuation + "“”‘’«»–—…।॥"


def _normalize(value: str) -> str:
    """Comparison key: NFC, collapsed whitespace, casefolded, unpunctuated."""
    text = unicodedata.normalize("NFC", str(value))
    text = " ".join(text.split()).casefold()
    return text.strip(_EDGE_CHARS)


def _raw(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _is_numeric_or_uuid(text: str) -> bool:
    compact = re.sub(r"[\s\-._]", "", text)
    if compact and compact.isdigit():
        return True
    return bool(_UUID_RE.fullmatch(text.strip()))


def _title_reason(value: str, path: Path) -> str | None:
    """Why a ``/Title`` is untrustworthy, or None when it is usable."""
    text = value.strip()
    if not text:
        return "empty"
    lowered = text.casefold()
    # Never launder a filename into metadata: converters copy the file name
    # into /Title, and that is not evidence of a title.
    if lowered in {path.name.casefold(), path.stem.casefold()}:
        return "filename"
    if "/" in text or "\\" in text or lowered.endswith(_TITLE_EXTENSIONS):
        return "path_like"
    if lowered in _TITLE_PLACEHOLDERS or _UNTITLED_RE.fullmatch(text):
        return "placeholder"
    if lowered.startswith("microsoft word"):
        return "placeholder"
    if _is_numeric_or_uuid(text):
        return "numeric_or_uuid"
    return None


def _author_reason(value: str) -> str | None:
    text = " ".join(value.split())
    if not text:
        return "empty"
    if text.casefold() in _AUTHOR_PLACEHOLDERS:
        return "placeholder"
    if _is_numeric_or_uuid(text):
        return "numeric_or_uuid"
    return None


def _split_authors(value: str) -> list[str]:
    """Split an ``/Author`` string without breaking ``Surname, Given``."""
    authors: list[str] = []
    for semicolon_part in value.split(";"):
        for and_part in re.split(r"\s+and\s+", semicolon_part, flags=re.IGNORECASE):
            piece = and_part.strip()
            if not piece:
                continue
            if piece.count(",") == 1:
                # One comma is far more likely "Surname, Given" than two names.
                candidates = [piece]
            else:
                candidates = piece.split(",")
            for candidate in candidates:
                name = " ".join(candidate.split())
                if name and _author_reason(name) is None:
                    authors.append(name)
    return _dedupe(authors)


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        key = _normalize(value)
        if key and key not in seen:
            seen.add(key)
            out.append(value)
    return out


def _candidates(signals: dict[str, list[tuple[str, bool]]]) -> list[dict[str, Any]]:
    """Merge per-signal values into ranked candidates (first signal wins)."""
    seen: dict[str, dict[str, Any]] = {}
    ordered: list[dict[str, Any]] = []
    for name in SIGNAL_ORDER:
        for value, trusted in signals.get(name, ()):
            key = _normalize(value)
            if not key:
                continue
            entry = seen.get(key)
            if entry is None:
                entry = {
                    "value": value,
                    "signal": name,
                    "trusted": trusted,
                    "support": [],
                }
                seen[key] = entry
                ordered.append(entry)
            else:
                entry["trusted"] = bool(entry["trusted"] or trusted)
            if name not in entry["support"]:
                entry["support"].append(name)
    return ordered


def _trusted_signals(signals: dict[str, list[tuple[str, bool]]]) -> list[str]:
    """Signals that may accept a value alone (cover is weak by design)."""
    return [
        name
        for name in SIGNAL_ORDER
        if name != "cover" and any(trusted for _, trusted in signals.get(name, ()))
    ]


def _resolve_title(
    signals: dict[str, list[tuple[str, bool]]],
) -> tuple[str | None, bool]:
    candidates = _candidates(signals)
    trusted = _trusted_signals(signals)
    if len(trusted) >= 2:
        # Ranked top must be corroborated, mirroring the catalogue resolver.
        top = candidates[0]
        if len(top["support"]) >= 2:
            return top["value"], False
        return None, True
    if len(trusted) == 1:
        return next(value for value, ok in signals[trusted[0]] if ok), False
    # No trusted signal: only two independent weak signals can corroborate.
    if candidates and len(candidates[0]["support"]) >= 2:
        return candidates[0]["value"], False
    return None, False


def _shared_names(lists: list[list[str]]) -> set[str]:
    normalized = [{_normalize(value) for value in values} for values in lists]
    return set.intersection(*normalized) if normalized else set()


def _resolve_authors(
    signals: dict[str, list[tuple[str, bool]]],
) -> tuple[list[str], bool]:
    trusted = _trusted_signals(signals)
    if len(trusted) >= 2:
        lists = [[value for value, ok in signals[name] if ok] for name in trusted]
        shared = _shared_names(lists)
        if shared:
            return [value for value in lists[0] if _normalize(value) in shared], False
        return [], True
    if len(trusted) == 1:
        return [value for value, ok in signals[trusted[0]] if ok], False
    lists = [[value for value, _ in signals[name]] for name in SIGNAL_ORDER if signals.get(name)]
    if len(lists) >= 2:
        shared = _shared_names(lists)
        if shared:
            return [value for value in lists[0] if _normalize(value) in shared], False
    return [], False


def _supporting_signals(candidates: list[dict[str, Any]], values: list[str]) -> list[str]:
    wanted = {_normalize(value) for value in values}
    names: set[str] = set()
    for candidate in candidates:
        if _normalize(candidate["value"]) in wanted:
            names.update(candidate["support"])
    return [name for name in SIGNAL_ORDER if name in names]


def _public_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {"value": c["value"], "signal": c["signal"], "trusted": bool(c["trusted"])}
        for c in candidates
    ]


def resolve_metadata(
    pdf_path: Path,
    pdf_info: dict[str, str],
    *,
    cover: dict | None = None,
) -> dict:
    """Resolve a PDF's title/authors from offline signals (no network/OCR).

    ``pdf_info`` is PyMuPDF's ``doc.metadata`` shape (``title``/``author``);
    junk placeholders and filename-laundered values are rejected and recorded
    in ``pdf_info.rejected``. ``cover`` is a reserved hook for cover-OCR
    readings (``{"titles": [...], "authors": [...]}``): a WEAK signal that may
    corroborate another one but can never be accepted alone. No OCR runs here.

    The returned dict is JSON-serialisable; volume/edition/year appear only in
    the ``filename`` block and are never applied to a field.
    """
    path = Path(pdf_path)
    info = pdf_info or {}
    parsed = parse_filename(str(path))
    filename_block = {
        "source": parsed.source,
        "confidence": parsed.confidence,
        "trusted": parsed.confidence >= TRUSTED_CONFIDENCE,
        "volume": parsed.volume,
        "edition": parsed.edition,
        "year": parsed.year,
        "directory_author": parsed.directory_author,
    }

    raw_title = _raw(info.get("title"))
    raw_author = _raw(info.get("author"))
    rejected: list[str] = []
    info_titles: list[str] = []
    info_authors: list[str] = []
    if raw_title is not None:
        reason = _title_reason(raw_title, path)
        if reason is None:
            info_titles = [raw_title]
        else:
            rejected.append(f"title: {reason}")
    if raw_author is not None:
        info_authors = _split_authors(raw_author)
        if not info_authors:
            rejected.append(f"author: {_author_reason(raw_author) or 'placeholder'}")

    cover = cover or {}
    cover_titles = [str(v) for v in (cover.get("titles") or []) if str(v).strip()]
    cover_authors = [str(v) for v in (cover.get("authors") or []) if str(v).strip()]
    filename_trusted = bool(filename_block["trusted"])

    title_signals = {
        "filename": [(v, filename_trusted) for v in parsed.titles if str(v).strip()],
        "pdf_info": [(v, True) for v in info_titles],
        "cover": [(v, False) for v in cover_titles],
    }
    author_signals = {
        "filename": [(v, filename_trusted) for v in parsed.authors if str(v).strip()],
        "pdf_info": [(v, True) for v in info_authors],
        "cover": [(v, False) for v in cover_authors],
    }

    if parsed.is_not_a_book:
        title_block = {"value": None, "candidates": [], "conflict": False, "signals": []}
        author_block = {"value": [], "candidates": [], "conflict": False, "signals": []}
        status = "not_a_book"
    else:
        title_candidates = _candidates(title_signals)
        author_candidates = _candidates(author_signals)
        title_value, title_conflict = _resolve_title(title_signals)
        author_value, author_conflict = _resolve_authors(author_signals)
        title_block = {
            "value": title_value,
            "candidates": _public_candidates(title_candidates),
            "conflict": title_conflict,
            "signals": _supporting_signals(
                title_candidates, [title_value] if title_value else []
            ),
        }
        author_block = {
            "value": author_value,
            "candidates": _public_candidates(author_candidates),
            "conflict": author_conflict,
            "signals": _supporting_signals(author_candidates, author_value),
        }
        if title_conflict or author_conflict:
            status = "ambiguous"
        elif title_value or author_value:
            status = "ok"
        else:
            status = "empty"

    return {
        "resolver": RESOLVER,
        "status": status,
        "title": title_block,
        "authors": author_block,
        "filename": filename_block,
        "pdf_info": {
            "title": raw_title,
            "author": raw_author,
            "rejected": rejected,
        },
    }


def apply_resolution(
    args: Any,
    record: dict,
    *,
    cli_title: str | None = None,
    cli_author: str | None = None,
) -> None:
    """Apply resolver values last, recording where each field came from.

    Precedence is CLI flags > sidecar > resolver. ``cli_title``/``cli_author``
    must be captured *before* the sidecar is applied. Values that still arrived
    from the sidecar are labelled ``"sidecar"``; the resolver only fills empty
    fields. The record is stored as ``args.metadata_resolution`` for the bundle.
    """
    title_value = (record.get("title") or {}).get("value")
    author_values = list((record.get("authors") or {}).get("value") or [])
    applied: dict[str, str | None] = {"title": None, "authors": None}

    if getattr(args, "title", None):
        applied["title"] = "cli" if cli_title else "sidecar"
    elif title_value:
        args.title = title_value
        applied["title"] = "resolver"

    if getattr(args, "author", None):
        applied["authors"] = "cli" if cli_author else "sidecar"
    elif author_values:
        args.author = ", ".join(author_values)
        applied["authors"] = "resolver"

    record["applied"] = applied
    args.metadata_resolution = record
