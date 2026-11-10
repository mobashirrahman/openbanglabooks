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


# ---------------------------------------------------------------------------
# Scrape catalogue signal
# ---------------------------------------------------------------------------

SCRAPE_TITLE = (
    "নিষ্কৃতি বাংলা বই পিডিএফ ডাউনলোড| Nishkriti Bengali Book PDF Download"
)


def _scrape(**overrides) -> dict:
    record = {
        "site": "granthagara",
        "page_url": "https://granthagara.com/boi/327910-nishkriti/",
        "page_title": SCRAPE_TITLE,
        "author": None,
        "publisher": None,
        "published_date": None,
        "isbn": None,
        "asset_url": "https://archive.org/download/x/2015.456069.Nishkriti.pdf",
        "asset_path": f"/data/{HASH}.pdf",
    }
    record.update(overrides)
    return record


def test_scrape_title_resolves_hash_filename():
    record = resolve_metadata(
        f"/x/book-scrapper/granthagara/books/{HASH}.pdf", {}, scrape=[_scrape()]
    )
    assert record["status"] == "ok"
    assert record["title"]["value"] == "নিষ্কৃতি"
    assert record["title"]["signals"] == ["scrape"]
    assert record["scrape"]["trusted"] is True
    assert record["scrape"]["matches"][0]["confidence"] == 0.8


def test_scrape_title_conflicts_with_trusted_pdf_info():
    record = resolve_metadata(
        f"/x/{HASH}.pdf",
        {"title": "সম্পূর্ণ অন্য একটি নাম"},
        scrape=[_scrape()],
    )
    assert record["status"] == "ambiguous"
    assert record["title"]["value"] is None
    assert record["title"]["conflict"] is True


def test_filename_from_the_same_site_is_not_double_counted():
    record = resolve_metadata(GRANTHAGARA, {}, scrape=[_scrape()])
    assert record["title"]["value"] == "নিষ্কৃতি"
    assert record["title"]["signals"] == ["scrape"]
    assert record["filename"]["trusted"] is False


def test_scrape_author_column_is_accepted():
    record = resolve_metadata(
        f"/x/books/{HASH}.pdf",
        {},
        scrape=[
            _scrape(
                site="arefinlibrary",
                page_title="কোনো একটা বই",
                author="হুমায়ূন আহমেদ",
            )
        ],
    )
    assert record["authors"]["value"] == ["হুমায়ূন আহমেদ"]
    assert record["status"] == "ok"


def test_disagreeing_scrape_titles_are_not_accepted():
    other = "ভিন্ন বাংলা বই পিডিএফ ডাউনলোড| Different Bengali Book PDF Download"
    record = resolve_metadata(
        f"/x/{HASH}.pdf",
        {},
        scrape=[
            _scrape(),
            _scrape(page_url="https://granthagara.com/boi/other/", page_title=other),
        ],
    )
    assert record["title"]["value"] is None
    assert record["scrape"]["trusted"] is False
    assert record["scrape"]["notes"]


def test_same_site_filename_cannot_rescue_untrusted_scrape_titles():
    """Disagreeing scrape rows plus their own site's filename are still one source."""
    other = "ভিন্ন বাংলা বই পিডিএফ ডাউনলোড| Different Bengali Book PDF Download"
    record = resolve_metadata(
        GRANTHAGARA,
        {},
        scrape=[
            _scrape(),
            _scrape(page_url="https://granthagara.com/boi/other/", page_title=other),
        ],
    )
    assert record["title"]["value"] is None
    assert record["status"] == "empty"
