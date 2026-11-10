"""Tests for the read-only book-scrapper catalogue lookup (offline)."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from pdf2epub.filename_parser import parse_source_title
from pdf2epub.scrape_catalog import lookup_scrape_records

SHA = "3e01ccccc04cbc92cbc5b63cb2ac3845dd6e860ba2cd3fa181c1d412fce00e5b"
OTHER_SHA = "b" * 64
TITLE = "নিষ্কৃতি বাংলা বই পিডিএফ ডাউনলোড| Nishkriti Bengali Book PDF Download"

_ASSETS_SCHEMA = """
CREATE TABLE assets (
  url TEXT PRIMARY KEY, status TEXT, path TEXT, sha256 TEXT, bytes INTEGER,
  error TEXT
)
"""
_LINKS_SCHEMA = """
CREATE TABLE links (page_url TEXT, asset_url TEXT, label TEXT)
"""
_PAGES_SCHEMA = """
CREATE TABLE pages (
  site TEXT, url TEXT PRIMARY KEY, title TEXT, status TEXT, error TEXT,
  author TEXT, publisher TEXT, published_date TEXT, language TEXT, isbn TEXT,
  page_count INTEGER, meta_confidence TEXT, meta_source TEXT, meta_raw TEXT
)
"""
_OLD_PAGES_SCHEMA = """
CREATE TABLE pages (site TEXT, url TEXT PRIMARY KEY, title TEXT, status TEXT, error TEXT)
"""


def _make_catalog(
    tmp_path: Path,
    site: str,
    *,
    sha: str = SHA,
    page_title: str = TITLE,
    author: str | None = None,
    pages_table: bool = True,
    author_column: bool = True,
) -> Path:
    """Create ``<tmp_path>/<site>/catalog.sqlite3`` with one linked asset."""
    directory = tmp_path / site
    directory.mkdir(parents=True)
    path = directory / "catalog.sqlite3"
    asset_url = f"https://example.test/{site}/{sha}.pdf"
    page_url = f"https://example.test/{site}/boi/1/"
    with closing(sqlite3.connect(path)) as conn:
        conn.executescript(_ASSETS_SCHEMA)
        conn.executescript(_LINKS_SCHEMA)
        if pages_table:
            conn.executescript(_PAGES_SCHEMA if author_column else _OLD_PAGES_SCHEMA)
        conn.execute(
            "INSERT INTO assets(url, status, path, sha256) VALUES (?, 'downloaded', ?, ?)",
            (asset_url, f"/data/{sha}.pdf", sha),
        )
        conn.execute(
            "INSERT INTO links(page_url, asset_url, label) VALUES (?, ?, 'download')",
            (page_url, asset_url),
        )
        if pages_table:
            if author_column:
                conn.execute(
                    "INSERT INTO pages(site, url, title, author) VALUES (?, ?, ?, ?)",
                    (site, page_url, page_title, author),
                )
            else:
                conn.execute(
                    "INSERT INTO pages(site, url, title) VALUES (?, ?, ?)",
                    (site, page_url, page_title),
                )
        conn.commit()
    return path


def test_lookup_finds_row_across_site_databases(tmp_path):
    _make_catalog(tmp_path, "granthagara")
    _make_catalog(tmp_path, "arefinlibrary", sha=OTHER_SHA, page_title="অন্য বই")

    records = lookup_scrape_records(tmp_path, SHA)

    assert len(records) == 1
    row = records[0]
    assert row["site"] == "granthagara"
    assert row["page_title"] == TITLE
    assert row["page_url"] == "https://example.test/granthagara/boi/1/"
    assert row["asset_url"] == f"https://example.test/granthagara/{SHA}.pdf"
    assert row["asset_path"] == f"/data/{SHA}.pdf"
    assert row["author"] is None
    assert row["publisher"] is None
    assert row["published_date"] is None
    assert row["isbn"] is None


def test_unknown_hash_returns_empty_list(tmp_path):
    _make_catalog(tmp_path, "granthagara")
    assert lookup_scrape_records(tmp_path, "f" * 64) == []


def test_missing_pages_table_and_missing_author_column_tolerated(tmp_path):
    _make_catalog(tmp_path, "_archive", pages_table=False)
    _make_catalog(tmp_path, "old-site", author_column=False)

    records = lookup_scrape_records(tmp_path, SHA)

    assert len(records) == 1
    assert records[0]["site"] == "old-site"
    assert records[0]["page_title"] == TITLE
    assert records[0]["author"] is None


def test_lookup_is_read_only(tmp_path):
    path = _make_catalog(tmp_path, "granthagara")
    before_bytes = path.read_bytes()
    before_mtime = path.stat().st_mtime_ns
    before_names = {item.name for item in path.parent.iterdir()}

    lookup_scrape_records(tmp_path, SHA)

    assert path.read_bytes() == before_bytes
    assert path.stat().st_mtime_ns == before_mtime
    assert {item.name for item in path.parent.iterdir()} == before_names
    assert before_names == {"catalog.sqlite3"}


def test_parse_source_title_granthagara_example():
    parsed = parse_source_title(TITLE, "granthagara")
    assert parsed.titles == ("নিষ্কৃতি", "Nishkriti")
    assert parsed.confidence == 0.8
    assert parsed.authors == ()
