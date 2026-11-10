"""Editable publication metadata for a PDF, modelled on
`bengali-book-pipeline/pdf_craft_tool/book_metadata.py`.

The sidecar is read, never rewritten. CLI flags win over the sidecar; the
sidecar wins over PDF `/Info` and the filename. Unknown bibliographic fields
stay absent rather than being guessed.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

TEXT_FIELDS = {
    "title",
    "title_en",
    "subtitle",
    "author_en",
    "author_sort",
    "publisher",
    "language",
    "source_date",
    "edition",
    "isbn",
    "rights",
    "license",
    "license_url",
    "identifier",
    "description",
    "source_name",
    "source_url",
    "modified",
}
LIST_FIELDS = {"authors", "editors", "translators", "subjects"}
INT_FIELDS = {"first_published"}
ALLOWED = TEXT_FIELDS | LIST_FIELDS | INT_FIELDS | {"evidence"}


def load_metadata(
    pdf: Path,
    metadata_path: str | Path | None = None,
    *,
    title: str | None = None,
    authors: list[str] | None = None,
) -> tuple[dict[str, Any], Path | None]:
    """Read an adjacent ``<book>.metadata.json`` or an explicit sidecar.

    Returns ``(values, path)``. A missing adjacent file is not an error; an
    explicitly requested missing file is. CLI title/authors take precedence.
    """
    path = Path(metadata_path) if metadata_path else Path(pdf).with_suffix(".metadata.json")
    if not path.exists():
        if metadata_path:
            raise FileNotFoundError(path)
        return {}, None
    values = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(values, dict):
        raise ValueError("Metadata must be a JSON object")
    unknown = set(values) - ALLOWED
    if unknown:
        raise ValueError(f"Unknown metadata field(s): {', '.join(sorted(unknown))}")
    for key in TEXT_FIELDS:
        if key in values and not isinstance(values[key], str):
            raise ValueError(f"Metadata {key} must be text")
    for key in LIST_FIELDS:
        if key in values and (
            not isinstance(values[key], list)
            or not all(isinstance(item, str) and item.strip() for item in values[key])
        ):
            raise ValueError(f"Metadata {key} must be a list of nonempty strings")
    for key in INT_FIELDS:
        if key in values and type(values[key]) is not int:
            raise ValueError(f"Metadata {key} must be an integer")
    if title:
        values["title"] = title
    if authors:
        values["authors"] = authors
    return values, path


def apply_metadata(args: Any, values: dict[str, Any]) -> None:
    """Fill unset CLI defaults from the sidecar without overwriting explicit flags.

    Defaults that are not ``None`` (publisher, language, modified, cover) are
    only replaced when they still equal their argparse default.
    """
    if not values:
        return
    if values.get("title") and not args.title:
        args.title = values["title"]
    if values.get("authors") and not args.author:
        args.author = ", ".join(values["authors"])
    for key in ("title_en", "subtitle", "author_en", "author_sort", "first_published",
                "source_name", "source_url", "rights", "license_name", "license_url",
                "description", "modified"):
        sidecar_key = key
        if key == "license_name":
            sidecar_key = "license"
        value = values.get(sidecar_key)
        if value in (None, "", []):
            continue
        if getattr(args, key, None) in (None, "", [], "2026-01-01T00:00:00Z"):
            setattr(args, key, value)
    if values.get("publisher") and getattr(args, "publisher", None) in (None, "OpenBanglaBooks"):
        args.publisher = values["publisher"]
    if values.get("subjects") and not getattr(args, "subject", None):
        args.subject = list(values["subjects"])
    if values.get("language") and getattr(args, "language", "bn") == "bn":
        args.language = values["language"]
    args.metadata_record = values
