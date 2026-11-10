"""Read-only lookups in the book-scrapper SQLite catalogues.

The book scraper keeps one database per site at
``<data_dir>/<site>/catalog.sqlite3`` with ``pages``, ``assets`` and ``links``
tables. Downloaded files are named by SHA-256, so
``assets.sha256 -> links.asset_url -> pages.url`` recovers the page a local
file came from.

Every database is opened strictly read-only (SQLite URI ``mode=ro`` plus
``immutable=1``: the site databases run in WAL mode, where a plain read-only
connection still updates the ``-shm`` index file). This module never writes,
never creates journal/WAL side files and runs only read-only PRAGMAs.
Databases that lack a table are skipped; databases that lack an optional
column are degraded field-by-field, and unreadable databases are ignored
rather than failing the whole lookup.

``lookup_scrape_records`` returns a deterministic list of dicts with the keys
``site``, ``page_url``, ``page_title``, ``author``, ``publisher``,
``published_date``, ``isbn``, ``asset_url`` and ``asset_path``. A value that
the database does not carry is ``None``.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

__all__ = ["lookup_scrape_records"]

# Optional page columns, selected only when the database actually has them.
_PAGE_COLUMNS = ("title", "author", "publisher", "published_date", "isbn")


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str] | None:
    """Column names for ``table``; ``None`` when the table does not exist."""
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    if not rows:
        return None
    return {row[1] for row in rows}


def _lookup_database(path: Path, site: str, digest: str) -> list[dict]:
    """Rows from one catalogue; ``[]`` when it cannot answer the query."""
    # immutable=1 keeps SQLite from creating/updating the -shm file of a WAL
    # database; the brief forbids touching anything next to the catalogues.
    url = f"file:{path}?mode=ro&immutable=1"
    with closing(sqlite3.connect(url, uri=True)) as conn:
        assets = _table_columns(conn, "assets")
        links = _table_columns(conn, "links")
        pages = _table_columns(conn, "pages")
        if assets is None or links is None or pages is None:
            return []
        if not {"url", "sha256"} <= assets:
            return []
        if not {"asset_url", "page_url"} <= links:
            return []
        if "url" not in pages:
            return []

        asset_select = "url, path" if "path" in assets else "url, NULL AS path"
        asset_rows = conn.execute(
            f"SELECT {asset_select} FROM assets WHERE lower(sha256) = ?", (digest,)
        ).fetchall()

        present = [column for column in _PAGE_COLUMNS if column in pages]
        page_select = "url" + "".join(f", {column}" for column in present)

        records: list[dict] = []
        for asset_url, asset_path in asset_rows:
            if not asset_url:
                continue
            page_urls = conn.execute(
                "SELECT page_url FROM links WHERE asset_url = ?", (asset_url,)
            ).fetchall()
            for (page_url,) in page_urls:
                if not page_url:
                    continue
                page_row = conn.execute(
                    f"SELECT {page_select} FROM pages WHERE url = ?", (page_url,)
                ).fetchone()
                if page_row is None:
                    continue
                values = dict(zip(("url", *present), page_row))
                records.append(
                    {
                        "site": site,
                        "page_url": page_url,
                        "page_title": values.get("title"),
                        "author": values.get("author"),
                        "publisher": values.get("publisher"),
                        "published_date": values.get("published_date"),
                        "isbn": values.get("isbn"),
                        "asset_url": asset_url,
                        "asset_path": asset_path,
                    }
                )
        return records


def lookup_scrape_records(data_dir: Path, sha256: str) -> list[dict]:
    """Find catalogue records for a PDF's SHA-256 across every site database.

    Only ``data_dir/*/catalog.sqlite3`` files are opened (read-only). Missing
    directories, missing tables, partial schemas and SQLite errors are ignored.
    Identical rows from different databases are deduplicated, and the result
    is sorted by site, page URL and asset URL so callers get stable output.
    """
    directory = Path(data_dir)
    digest = str(sha256 or "").strip().lower()
    if not digest:
        return []

    rows: list[dict] = []
    seen: set[tuple] = set()
    for db_path in sorted(directory.glob("*/catalog.sqlite3")):
        if not db_path.is_file():
            continue
        try:
            found = _lookup_database(db_path, db_path.parent.name, digest)
        except sqlite3.Error:
            continue
        for row in found:
            key = tuple((name, row[name]) for name in sorted(row))
            if key in seen:
                continue
            seen.add(key)
            rows.append(row)

    rows.sort(
        key=lambda row: (
            row["site"] or "",
            row["page_url"] or "",
            row["asset_url"] or "",
        )
    )
    return rows
