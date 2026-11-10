from __future__ import annotations

import argparse
import json

import pytest

from pdf2epub.metadata import apply_metadata, load_metadata


def _args(**overrides):
    values = {
        "title": None,
        "author": None,
        "title_en": None,
        "subtitle": None,
        "author_en": None,
        "author_sort": None,
        "publisher": "OpenBanglaBooks",
        "language": "bn",
        "first_published": None,
        "source_name": None,
        "source_url": None,
        "rights": "",
        "license_name": "",
        "license_url": "",
        "description": "",
        "subject": [],
        "modified": "2026-01-01T00:00:00Z",
        "cover_page": None,
        "metadata": None,
    }
    values.update(overrides)
    return argparse.Namespace(**values)


def test_loads_adjacent_sidecar_and_cli_wins(tmp_path):
    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    (tmp_path / "book.metadata.json").write_text(
        json.dumps(
            {
                "title": "পাশের বই",
                "authors": ["লেখক"],
                "publisher": "প্রকাশক",
                "first_published": 1953,
                "subjects": ["উপন্যাস"],
                "evidence": {"authors": {"page": 1, "note": "title page"}},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    values, path = load_metadata(pdf, title="কমান্ড-লাইন")
    assert path == tmp_path / "book.metadata.json"
    assert values["title"] == "কমান্ড-লাইন"
    assert values["authors"] == ["লেখক"]

    args = _args()
    apply_metadata(args, values)
    assert args.title == "কমান্ড-লাইন"
    assert args.author == "লেখক"
    assert args.publisher == "প্রকাশক"
    assert args.first_published == 1953
    assert args.subject == ["উপন্যাস"]


def test_cover_page_maps_to_args(tmp_path):
    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    (tmp_path / "book.metadata.json").write_text(
        json.dumps({"title": "x", "cover_page": 3}), encoding="utf-8"
    )

    values, _ = load_metadata(pdf)
    args = _args()
    apply_metadata(args, values)
    assert args.cover_page == 3


def test_cover_page_must_be_positive(tmp_path):
    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    (tmp_path / "book.metadata.json").write_text(
        json.dumps({"title": "x", "cover_page": 0}), encoding="utf-8"
    )
    with pytest.raises(ValueError, match="cover_page"):
        load_metadata(pdf)


def test_rejects_unknown_field(tmp_path):
    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    (tmp_path / "book.metadata.json").write_text(
        json.dumps({"title": "x", "invented_isbn": "123"}),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="Unknown metadata field"):
        load_metadata(pdf)


def test_explicit_missing_sidecar_is_an_error(tmp_path):
    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    with pytest.raises(FileNotFoundError):
        load_metadata(pdf, tmp_path / "missing.json")
