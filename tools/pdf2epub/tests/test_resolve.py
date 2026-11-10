"""Tests for the offline metadata resolver (no network, no real PDFs)."""

from __future__ import annotations

import argparse
import json

import pytest

from pdf2epub.resolve import apply_resolution, resolve_metadata

HASH = "a" * 64
GRANTHAGARA = (
    "/x/book-scrapper/granthagara/books/"
    "নিষ্কৃতি বাংলা বই পিডিএফ ডাউনলোড_ Nishkriti Bengali Book PDF Download.pdf"
)


def _record(**info: str) -> dict:
    return resolve_metadata("/x/book.pdf", info)


def _args(**overrides) -> argparse.Namespace:
    values = {"title": None, "author": None}
    values.update(overrides)
    return argparse.Namespace(**values)


def test_hash_filename_with_empty_info_is_empty():
    record = resolve_metadata(
        f"/x/book-scrapper/granthagara/books/{HASH}.pdf", {}
    )
    assert record["status"] == "empty"
    assert record["title"]["value"] is None
    assert record["authors"]["value"] == []
    assert record["title"]["candidates"] == []
    assert record["pdf_info"] == {"title": None, "author": None, "rejected": []}
    json.dumps(record)  # must be serialisable


def test_granthagara_filename_is_trusted():
    record = resolve_metadata(GRANTHAGARA, {})
    assert record["status"] == "ok"
    assert record["filename"]["source"] == "granthagara"
    assert record["filename"]["trusted"] is True
    assert record["title"]["value"] == "নিষ্কৃতি"
    assert record["title"]["signals"] == ["filename"]


def test_authordir_title_corroborated_by_info():
    record = resolve_metadata(
        "/x/শিরোনাম - লেখক.pdf", {"title": "শিরোনাম", "author": "লেখক"}
    )
    assert record["filename"]["source"] == "authordir"
    assert record["filename"]["trusted"] is True
    assert record["title"]["value"] == "শিরোনাম"
    assert record["title"]["signals"] == ["filename", "pdf_info"]
    assert record["title"]["conflict"] is False
    assert record["authors"]["value"] == ["লেখক"]


def test_title_conflict_is_ambiguous():
    record = resolve_metadata(
        "/x/শিরোনাম - লেখক.pdf", {"title": "সম্পূর্ণ অন্য একটি নাম"}
    )
    assert record["status"] == "ambiguous"
    assert record["title"]["value"] is None
    assert record["title"]["conflict"] is True
    values = {candidate["value"] for candidate in record["title"]["candidates"]}
    assert {"শিরোনাম", "সম্পূর্ণ অন্য একটি নাম"} <= values


def test_author_conflict_keeps_title():
    record = resolve_metadata(
        "/x/শিরোনাম - লেখক.pdf",
        {"title": "শিরোনাম", "author": "সম্পূর্ণ অন্য লেখক"},
    )
    assert record["status"] == "ambiguous"
    assert record["authors"]["value"] == []
    assert record["authors"]["conflict"] is True
    # Per-field conservatism: the agreeing title survives.
    assert record["title"]["value"] == "শিরোনাম"
    assert record["title"]["conflict"] is False


@pytest.mark.parametrize(
    ("info", "field"),
    [
        ({"title": "Microsoft Word - x.doc"}, "title"),
        ({"title": "untitled"}, "title"),
        ({"author": "Administrator"}, "author"),
        ({"title": "book"}, "title"),  # laundered from book.pdf
    ],
)
def test_junk_pdf_info_is_rejected(info, field):
    record = resolve_metadata("/x/book.pdf", info)
    assert record["title"]["value"] is None
    assert record["authors"]["value"] == []
    assert record["pdf_info"]["rejected"]
    assert any(reason.startswith(field) for reason in record["pdf_info"]["rejected"])


def test_untrusted_filename_stays_a_candidate():
    record = resolve_metadata("/tmp/gitanjali.pdf", {})
    assert record["status"] == "empty"
    assert record["title"]["value"] is None
    assert record["filename"]["trusted"] is False
    assert record["title"]["candidates"] == [
        {"value": "gitanjali", "signal": "filename", "trusted": False}
    ]


def test_cover_alone_is_not_accepted():
    record = resolve_metadata(
        "/tmp/" + HASH + ".pdf", {}, cover={"titles": ["নিষ্কৃতি"]}
    )
    assert record["status"] == "empty"
    assert record["title"]["value"] is None


def test_cover_corroborates_untrusted_stem():
    record = resolve_metadata(
        "/tmp/gitanjali.pdf", {}, cover={"titles": ["Gitanjali"]}
    )
    assert record["title"]["value"] == "gitanjali"
    assert record["title"]["signals"] == ["filename", "cover"]
    assert record["status"] == "ok"


def test_not_a_book_filename():
    record = resolve_metadata("/x/Title Page.pdf", {})
    assert record["status"] == "not_a_book"
    assert record["title"]["value"] is None
    assert record["authors"]["value"] == []


def test_single_comma_is_one_author_but_semicolon_splits():
    record = resolve_metadata("/x/book.pdf", {"author": "Chattopadhyay, Sarat"})
    assert record["authors"]["value"] == ["Chattopadhyay, Sarat"]

    record = resolve_metadata("/x/book.pdf", {"author": "A; B"})
    assert record["authors"]["value"] == ["A", "B"]


def test_volume_is_recorded_not_applied():
    record = resolve_metadata(
        "/x/শিরোনাম [ভাগ-২] - লেখক.pdf", {"title": "শিরোনাম"}
    )
    assert record["filename"]["volume"] == "2"
    assert record["title"]["value"] == "শিরোনাম"


def test_apply_resolution_cli_wins():
    args = _args(title="কমান্ড-লাইন", author="সিএলআই")
    record = _record(title="শিরোনাম", author="লেখক")
    apply_resolution(args, record, cli_title="কমান্ড-লাইন", cli_author="সিএলআই")
    assert args.title == "কমান্ড-লাইন"
    assert args.author == "সিএলআই"
    assert record["applied"] == {"title": "cli", "authors": "cli"}
    assert args.metadata_resolution is record


def test_apply_resolution_sidecar_is_recorded():
    args = _args(title="সাইডকার", author="সাইডকার লেখক")
    record = _record(title="রিজলভার")
    apply_resolution(args, record)
    assert args.title == "সাইডকার"
    assert record["applied"] == {"title": "sidecar", "authors": "sidecar"}


def test_apply_resolution_fills_empty_fields():
    args = _args()
    record = _record(title="শিরোনাম", author="এক; দুই")
    apply_resolution(args, record, cli_title=None, cli_author=None)
    assert args.title == "শিরোনাম"
    assert args.author == "এক, দুই"
    assert record["applied"] == {"title": "resolver", "authors": "resolver"}


def test_apply_resolution_nothing_accepted():
    args = _args()
    record = resolve_metadata("/tmp/gitanjali.pdf", {})
    apply_resolution(args, record)
    assert args.title is None
    assert args.author is None
    assert record["applied"] == {"title": None, "authors": None}
