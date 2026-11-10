"""Tests for the offline metadata resolver (no network, no real PDFs)."""

from __future__ import annotations

import argparse
import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from pdf2epub.catalogue_index import normalize_key
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


# ---------------------------------------------------------------------------
# Rokomari catalogue signal
# ---------------------------------------------------------------------------

CATALOGUE_TITLE = "দেবদাস"
CATALOGUE_AUTHOR = "শরৎচন্দ্র চট্টোপাধ্যায়"

_CATALOGUE_SCHEMA = """
CREATE TABLE works (
  source TEXT NOT NULL, source_id TEXT NOT NULL, title TEXT,
  title_key TEXT NOT NULL, authors TEXT, author_keys TEXT,
  publisher TEXT, isbn TEXT, category TEXT, url TEXT,
  UNIQUE(source, source_id)
);
CREATE TABLE authors (author_key TEXT PRIMARY KEY, display TEXT, works INTEGER);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX works_title_key ON works(title_key);
"""


def _catalogue_index(
    tmp_path: Path,
    *,
    title: str = CATALOGUE_TITLE,
    author: str = CATALOGUE_AUTHOR,
) -> Path:
    """Minimal index in the production schema, containing one work."""
    path = tmp_path / "catalogue.sqlite3"
    author_key = normalize_key(author)
    with closing(sqlite3.connect(path)) as conn:
        conn.executescript(_CATALOGUE_SCHEMA)
        conn.execute(
            "INSERT INTO works (source, source_id, title, title_key, authors, "
            "author_keys, publisher, isbn, category, url) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "rokomari-bg",
                "101",
                title,
                normalize_key(title),
                json.dumps([author], ensure_ascii=False),
                json.dumps([author_key], ensure_ascii=False),
                None,
                None,
                None,
                "https://example.test/101",
            ),
        )
        conn.execute(
            "INSERT INTO authors (author_key, display, works) VALUES (?, ?, 1)",
            (author_key, author),
        )
        conn.commit()
    return path


def test_catalogue_hit_corroborates_untrusted_filename_stem(tmp_path):
    index = _catalogue_index(tmp_path)

    record = resolve_metadata(
        Path("/tmp/দেবদাস.pdf"), {}, catalogue_index=index
    )

    assert record["status"] == "ok"
    assert record["title"]["value"] == CATALOGUE_TITLE
    assert record["title"]["signals"] == ["filename", "catalogue"]
    assert record["title"]["conflict"] is False
    assert record["catalogue"]["index"] == str(index)
    assert record["catalogue"]["lookups"] == [
        {
            "title": CATALOGUE_TITLE,
            "entries": 1,
            "authors": [CATALOGUE_AUTHOR],
            "ambiguous": False,
        }
    ]
    json.dumps(record)  # must stay serialisable


def test_catalogue_authors_are_not_accepted_alone(tmp_path):
    index = _catalogue_index(tmp_path)

    record = resolve_metadata(
        Path("/tmp/দেবদাস.pdf"), {}, catalogue_index=index
    )

    assert record["authors"]["value"] == []
    assert record["authors"]["conflict"] is False
    assert any(
        candidate["value"] == CATALOGUE_AUTHOR
        and candidate["signal"] == "catalogue"
        and candidate["trusted"] is False
        for candidate in record["authors"]["candidates"]
    )


def test_catalogue_authors_corroborate_a_matching_cover(tmp_path):
    index = _catalogue_index(tmp_path)

    record = resolve_metadata(
        Path("/tmp/দেবদাস.pdf"),
        {},
        cover={"authors": [CATALOGUE_AUTHOR]},
        catalogue_index=index,
    )

    assert record["authors"]["value"] == [CATALOGUE_AUTHOR]
    assert record["authors"]["conflict"] is False
    assert set(record["authors"]["signals"]) >= {"catalogue", "cover"}
    assert record["status"] == "ok"


def test_catalogue_does_not_disturb_a_trusted_scrape_title(tmp_path):
    index = _catalogue_index(tmp_path)

    record = resolve_metadata(
        f"/x/{HASH}.pdf", {}, scrape=[_scrape()], catalogue_index=index
    )

    assert record["title"]["value"] == "নিষ্কৃতি"
    assert record["title"]["signals"] == ["scrape"]
    assert record["catalogue"]["index"] == str(index)
    assert record["catalogue"]["lookups"][0]["entries"] == 0


def test_catalogue_authors_never_conflict_with_a_trusted_author(tmp_path):
    index = _catalogue_index(tmp_path)

    record = resolve_metadata(
        Path("/tmp/দেবদাস.pdf"),
        {"author": "সম্পূর্ণ অন্য লেখক"},
        catalogue_index=index,
    )

    assert record["title"]["value"] == CATALOGUE_TITLE
    assert record["authors"]["value"] == ["সম্পূর্ণ অন্য লেখক"]
    assert record["authors"]["conflict"] is False
    assert record["status"] == "ok"
    assert any("disagree" in note for note in record["catalogue"]["notes"])


def test_missing_catalogue_index_is_a_note_not_a_failure(tmp_path):
    missing = tmp_path / "missing.sqlite3"

    record = resolve_metadata(
        "/x/book.pdf", {"title": "শিরোনাম"}, catalogue_index=missing
    )

    assert not missing.exists()
    assert record["status"] == "ok"
    assert record["title"]["value"] == "শিরোনাম"
    assert record["catalogue"]["index"] == str(missing)
    assert record["catalogue"]["lookups"] == []
    assert record["catalogue"]["notes"]
    assert "unreadable" in record["catalogue"]["notes"][0]


def test_no_catalogue_index_keeps_an_empty_block():
    record = resolve_metadata("/tmp/gitanjali.pdf", {})

    assert record["catalogue"] == {"index": None, "lookups": [], "notes": []}
    assert record["status"] == "empty"


def test_catalogue_cannot_pick_between_two_candidate_titles(tmp_path):
    """Two disagreeing scrape rows that both exist in the catalogue stay unresolved."""
    index = _catalogue_index(tmp_path, title="নিষ্কৃতি")
    with closing(sqlite3.connect(index)) as conn:
        conn.execute(
            "INSERT INTO works (source, source_id, title, title_key, authors, author_keys) "
            "VALUES ('rokomari-bg', '102', 'ভিন্ন', ?, '[]', '[]')",
            (normalize_key("ভিন্ন"),),
        )
        conn.commit()
    other = "ভিন্ন বাংলা বই পিডিএফ ডাউনলোড| Different Bengali Book PDF Download"
    record = resolve_metadata(
        f"/x/{HASH}.pdf",
        {},
        scrape=[
            _scrape(),
            _scrape(page_url="https://granthagara.com/boi/other/", page_title=other),
        ],
        catalogue_index=index,
    )
    assert record["title"]["value"] is None
    assert any("several candidate titles" in n for n in record["catalogue"]["notes"])


def test_collection_title_gets_no_catalogue_support(tmp_path):
    index = _catalogue_index(tmp_path, title="গল্প সমগ্র")
    record = resolve_metadata(Path("/tmp/গল্প সমগ্র.pdf"), {}, catalogue_index=index)
    assert record["title"]["value"] is None
    assert record["catalogue"]["lookups"][0]["entries"] == 1
