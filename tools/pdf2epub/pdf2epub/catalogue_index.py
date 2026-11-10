"""Local Rokomari lookup index: build it once, query it read-only forever.

Two third-party research dumps are folded into a small SQLite database of
title/author/publisher facts:

* **RokomariBG** -- a directory of gzipped, pretty-printed JSON arrays
  (``book.json.gz`` plus optional ``author``, ``book_to_author``,
  ``publisher`` and ``category`` tables). ``book.json.gz`` is required.
* **Rokomari-HF** -- a gzipped JSONL dump (``sayurio/rokomari-bd-product-data``).
  Its top-level ``authors``/``publishers`` fields are the site's navigation
  menu, repeated on every page, and are never read; only ``specification`` is
  evidence.

Both dumps are third-party research data. The index deliberately stores only
the title, author display names, publisher, ISBN, category and source URL.
Summaries, descriptions, covers, prices and ratings are *not* stored (or
published) because the licence does not allow it.

The build streams every input (a pretty-printed JSON array is decoded
incrementally with :meth:`json.JSONDecoder.raw_decode`) so a 150k-book array
never has to fit in memory. Writes go to ``<out>.tmp`` and are atomically
moved into place with :func:`os.replace`.

``normalize_key`` is the comparison key shared by the index and the metadata
resolver: NFC, collapsed whitespace, casefolded, trailing binding notes
removed, edge punctuation stripped. It never folds Bengali vowel signs or
spelling variants -- those distinguish different names.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import sqlite3
import string
import unicodedata
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path
from typing import Any

__all__ = ["BUILDER", "build_index", "lookup_title", "normalize_key"]

BUILDER = "catalogue-index-v1"

SOURCE_BG = "rokomari-bg"
SOURCE_HF = "rokomari-hf"

_BATCH_SIZE = 5000
_CHUNK_SIZE = 1024 * 1024

# Punctuation stripped from both ends of a comparison key.
_EDGE_CHARS = string.punctuation + "“”‘’«»–—…।॥"

# Trailing format note, e.g. "শ্রীকান্ত (হার্ডকভার)" or "(Paperback)".
_BINDING_RE = re.compile(
    r"\s*\(\s*(?:হার্ড\s*কভার|পেপার\s*ব্যাক|hardcover|paperback)\s*\)\s*$",
    re.IGNORECASE,
)

# Words that make a title a collection rather than one identifiable work.
_COLLECTION_WORDS = (
    "সমগ্র",
    "রচনাবলী",
    "রচনাসমগ্র",
    "সংকলন",
    "শ্রেষ্ঠ গল্প",
    "গল্পসমগ্র",
    "কবিতাসমগ্র",
    "উপন্যাস সমগ্র",
    "collected works",
    "omnibus",
)

_WORKS_SCHEMA = """
CREATE TABLE works (
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT,
  title_key TEXT NOT NULL,
  authors TEXT,
  author_keys TEXT,
  publisher TEXT,
  isbn TEXT,
  category TEXT,
  url TEXT,
  UNIQUE(source, source_id)
)
"""

_AUTHORS_SCHEMA = """
CREATE TABLE authors (
  author_key TEXT PRIMARY KEY,
  display TEXT,
  works INTEGER
)
"""

_META_SCHEMA = "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)"

_INSERT_WORKS = """
INSERT OR IGNORE INTO works
  (source, source_id, title, title_key, authors, author_keys,
   publisher, isbn, category, url)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""

_INSERT_AUTHORS = "INSERT OR REPLACE INTO authors (author_key, display, works) VALUES (?, ?, ?)"


def normalize_key(value: str) -> str:
    """Comparison key for titles and author names.

    NFC, collapsed whitespace, casefolded, a trailing binding note removed
    (repeatedly), then edge punctuation and whitespace stripped. Bengali vowel
    signs, nukta, chandrabindu and spelling variants are preserved: folding
    them would merge genuinely different names.
    """
    text = unicodedata.normalize("NFC", str(value or ""))
    text = " ".join(text.split()).casefold()
    while True:
        match = _BINDING_RE.search(text)
        if match is None:
            break
        text = text[: match.start()].rstrip()
    return text.strip(_EDGE_CHARS).strip()


def _text(value: Any) -> str | None:
    """Trimmed display text; ``None``/``""``/literal ``"None"`` mean missing."""
    if value is None:
        return None
    text = " ".join(str(value).split())
    if not text or text.casefold() == "none":
        return None
    return text


def _id_text(value: Any) -> str | None:
    """Stable string form of an id that may arrive as int, float or str."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = str(value).strip()
    if not text or text.casefold() == "none":
        return None
    return text


def _field_text(value: Any) -> str | None:
    """First usable value: a list field is reduced to its first entry."""
    if isinstance(value, (list, tuple)):
        for item in value:
            text = _text(item)
            if text is not None:
                return text
        return None
    return _text(value)


def _sha256_file(path: Path) -> str:
    """SHA-256 of a file, streamed in 1 MiB chunks."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(_CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _iter_json_array(path: Path) -> Iterator[Any]:
    """Yield the elements of a (pretty-printed) JSON array incrementally.

    The file is read in chunks and decoded with ``raw_decode``, so only one
    element plus one chunk is held in memory at a time. This is what makes
    streaming ``book.json.gz`` safe on a 2 GB host.
    """
    decoder = json.JSONDecoder()
    buffer = ""
    position = 0
    eof = False
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        while True:
            while position < len(buffer) and buffer[position].isspace():
                position += 1
            if position >= len(buffer):
                if eof:
                    return
                buffer = handle.read(_CHUNK_SIZE)
                position = 0
                if not buffer:
                    eof = True
                continue
            character = buffer[position]
            if character in "[,":
                position += 1
                continue
            if character == "]":
                return
            try:
                value, end = decoder.raw_decode(buffer, position)
            except json.JSONDecodeError:
                if eof:
                    raise
                more = handle.read(_CHUNK_SIZE)
                if not more:
                    eof = True
                buffer = buffer[position:] + more
                position = 0
                continue
            yield value
            position = end


def _load_id_table(
    path: Path,
    id_field: str,
    name_field: str,
    *,
    source: str,
    hashes: dict[str, str],
    notes: list[str],
) -> dict[str, str]:
    """Load a small ``id -> name`` table; missing/broken files mean empty."""
    if not path.is_file():
        notes.append(f"{source}: missing optional table {path.name}")
        return {}
    hashes[f"{source}/{path.name}"] = _sha256_file(path)
    try:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            rows = json.load(handle)
    except (OSError, EOFError, json.JSONDecodeError) as exc:
        notes.append(f"{source}: unreadable table {path.name}: {exc}")
        return {}
    result: dict[str, str] = {}
    if not isinstance(rows, list):
        notes.append(f"{source}: unexpected table shape in {path.name}")
        return result
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = _id_text(row.get(id_field))
        name = _text(row.get(name_field))
        if key is not None and name is not None:
            result[key] = name
    return result


def _load_book_to_author(
    path: Path,
    *,
    source: str,
    hashes: dict[str, str],
    notes: list[str],
) -> dict[str, list[str]]:
    """Stream ``book_id -> [author_id, ...]`` without loading the rows as JSON."""
    if not path.is_file():
        notes.append(f"{source}: missing optional table {path.name}")
        return {}
    hashes[f"{source}/{path.name}"] = _sha256_file(path)
    result: dict[str, list[str]] = {}
    try:
        for row in _iter_json_array(path):
            if not isinstance(row, dict):
                continue
            book_id = _id_text(row.get("book_id"))
            author_id = _id_text(row.get("author_id"))
            if book_id is not None and author_id is not None:
                result.setdefault(book_id, []).append(author_id)
    except (OSError, EOFError, json.JSONDecodeError) as exc:
        notes.append(f"{source}: unreadable table {path.name}: {exc}")
    return result


def _flush_works(
    conn: sqlite3.Connection,
    batch: list[tuple[Any, ...]],
    counts: dict[str, int],
) -> None:
    """Insert one batch and count the rows SQLite ignored as duplicates."""
    if not batch:
        return
    before = conn.total_changes
    conn.executemany(_INSERT_WORKS, batch)
    inserted = conn.total_changes - before
    counts["duplicates"] += len(batch) - inserted
    counts["works"] += inserted
    batch.clear()


def _bg_row(
    item: dict[str, Any],
    *,
    author_names: dict[str, str],
    book_authors: dict[str, list[str]],
    publishers: dict[str, str],
    categories: dict[str, str],
    author_accum: dict[str, str],
) -> tuple[Any, ...] | None:
    """One BG book as a works row, or ``None`` when it has no usable title."""
    book_id = _id_text(item.get("book_id"))
    title = _text(item.get("book_title"))
    if book_id is None or title is None:
        return None
    title_key = normalize_key(title)
    if not title_key:
        return None

    author_ids = [*book_authors.get(book_id, ())]
    own_author = _id_text(item.get("author_id"))
    if own_author is not None:
        author_ids.append(own_author)

    authors: list[str] = []
    author_keys: list[str] = []
    seen: set[str] = set()
    for author_id in author_ids:
        name = author_names.get(author_id)
        if name is None:
            continue
        key = normalize_key(name)
        if not key or key in seen:
            continue
        seen.add(key)
        authors.append(name)
        author_keys.append(key)
        author_accum.setdefault(key, name)

    publisher = publishers.get(_id_text(item.get("publisher_id")) or "")
    category = categories.get(_id_text(item.get("category_id")) or "")
    row = (
        SOURCE_BG,
        book_id,
        title,
        title_key,
        json.dumps(authors, ensure_ascii=False),
        json.dumps(author_keys, ensure_ascii=False),
        publisher,
        _text(item.get("isbn")),
        category,
        _text(item.get("book_url")),
    )
    return row


def _load_bg(
    conn: sqlite3.Connection,
    directory: Path,
    *,
    hashes: dict[str, str],
    notes: list[str],
    author_accum: dict[str, str],
) -> dict[str, int]:
    """Stream the RokomariBG directory into ``works``; return its counts."""
    counts = {"works": 0, "skipped": 0, "malformed": 0, "duplicates": 0}
    book_path = directory / "book.json.gz"
    if not book_path.is_file():
        notes.append(f"{SOURCE_BG}: missing required {book_path.name}; no works from source")
        return counts
    hashes[f"{SOURCE_BG}/{book_path.name}"] = _sha256_file(book_path)

    author_names = _load_id_table(
        directory / "author.json.gz",
        "author_id",
        "author",
        source=SOURCE_BG,
        hashes=hashes,
        notes=notes,
    )
    publishers = _load_id_table(
        directory / "publisher.json.gz",
        "publisher_id",
        "publisher_name",
        source=SOURCE_BG,
        hashes=hashes,
        notes=notes,
    )
    categories = _load_id_table(
        directory / "category.json.gz",
        "category_id",
        "category_name",
        source=SOURCE_BG,
        hashes=hashes,
        notes=notes,
    )
    book_authors = _load_book_to_author(
        directory / "book_to_author.json.gz",
        source=SOURCE_BG,
        hashes=hashes,
        notes=notes,
    )

    batch: list[tuple[Any, ...]] = []
    try:
        for item in _iter_json_array(book_path):
            if not isinstance(item, dict):
                counts["malformed"] += 1
                continue
            row = _bg_row(
                item,
                author_names=author_names,
                book_authors=book_authors,
                publishers=publishers,
                categories=categories,
                author_accum=author_accum,
            )
            if row is None:
                counts["skipped"] += 1
                continue
            batch.append(row)
            if len(batch) >= _BATCH_SIZE:
                _flush_works(conn, batch, counts)
    except (OSError, EOFError, json.JSONDecodeError) as exc:
        notes.append(f"{SOURCE_BG}: unreadable {book_path.name}: {exc}")
    _flush_works(conn, batch, counts)
    return counts


def _split_hf_authors(value: str) -> list[str]:
    """Split a conservative author list; a comma alone can still be a pair."""
    parts = re.split(r"\s*[,&]\s*|\s+ও\s+", value)
    return [part for part in (" ".join(piece.split()) for piece in parts) if part]


def _hf_authors(specification: dict[str, Any]) -> list[str]:
    raw = specification.get("Author")
    chunks: list[str] = []
    if isinstance(raw, (list, tuple)):
        chunks = [str(item) for item in raw if item is not None]
    elif raw is not None:
        chunks = [str(raw)]
    names: list[str] = []
    seen: set[str] = set()
    for chunk in chunks:
        if _text(chunk) is None:
            continue
        for name in _split_hf_authors(chunk):
            key = normalize_key(name)
            if key and key not in seen:
                seen.add(key)
                names.append(name)
    return names


def _load_hf(
    conn: sqlite3.Connection,
    path: Path,
    *,
    hashes: dict[str, str],
    notes: list[str],
    author_accum: dict[str, str],
) -> dict[str, int]:
    """Stream a gzipped JSONL dump into ``works``; return its counts.

    Only ``productType == "book"`` rows with a dict ``specification`` and a
    usable ``Title`` become works. The top-level ``authors``/``publishers``
    fields are the site navigation menu and are deliberately ignored.
    """
    counts = {"works": 0, "skipped": 0, "malformed": 0, "duplicates": 0}
    if not path.is_file():
        notes.append(f"{SOURCE_HF}: missing {path.name}; no works from source")
        return counts
    hashes[f"{SOURCE_HF}/{path.name}"] = _sha256_file(path)

    batch: list[tuple[Any, ...]] = []
    try:
        with gzip.open(path, "rt", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                text = line.strip()
                if not text:
                    continue
                try:
                    record = json.loads(text)
                except json.JSONDecodeError:
                    counts["malformed"] += 1
                    continue
                if not isinstance(record, dict):
                    counts["malformed"] += 1
                    continue
                if record.get("productType") != "book":
                    counts["skipped"] += 1
                    continue

                specification = record.get("specification")
                if isinstance(specification, str):
                    try:
                        specification = json.loads(specification)
                    except (json.JSONDecodeError, TypeError):
                        counts["skipped"] += 1
                        continue
                if not isinstance(specification, dict):
                    counts["skipped"] += 1
                    continue

                title = _text(specification.get("Title"))
                if title is None:
                    counts["skipped"] += 1
                    continue
                title_key = normalize_key(title)
                if not title_key:
                    counts["skipped"] += 1
                    continue

                isbn = _text(specification.get("ISBN"))
                url = _text(record.get("url"))
                source_id = url or isbn
                if source_id is None:
                    counts["skipped"] += 1
                    continue

                authors = _hf_authors(specification)
                author_keys: list[str] = []
                for name in authors:
                    key = normalize_key(name)
                    author_keys.append(key)
                    author_accum.setdefault(key, name)

                batch.append(
                    (
                        SOURCE_HF,
                        source_id,
                        title,
                        title_key,
                        json.dumps(authors, ensure_ascii=False),
                        json.dumps(author_keys, ensure_ascii=False),
                        _field_text(specification.get("Publisher")),
                        isbn,
                        _field_text(specification.get("Category")),
                        url,
                    )
                )
                if len(batch) >= _BATCH_SIZE:
                    _flush_works(conn, batch, counts)
    except (OSError, EOFError) as exc:
        notes.append(f"{SOURCE_HF}: unreadable {path.name}: {exc}")
    _flush_works(conn, batch, counts)
    return counts


def _count_author_works(
    conn: sqlite3.Connection,
    author_accum: dict[str, str],
) -> int:
    """Count works rows per author and populate the ``authors`` table."""
    counts: dict[str, int] = {key: 0 for key in author_accum}
    cursor = conn.execute("SELECT author_keys FROM works")
    while True:
        rows = cursor.fetchmany(_BATCH_SIZE)
        if not rows:
            break
        for (raw_keys,) in rows:
            try:
                keys = json.loads(raw_keys) if raw_keys else []
            except (json.JSONDecodeError, TypeError):
                continue
            if not isinstance(keys, list):
                continue
            for key in keys:
                if key in counts:
                    counts[key] += 1
    author_rows = [
        (key, author_accum[key], count)
        for key, count in counts.items()
        if count > 0 and author_accum[key]
    ]
    conn.executemany(_INSERT_AUTHORS, author_rows)
    return len(author_rows)


def build_index(
    out: Path,
    *,
    rokomari_bg: Path | None,
    rokomari_hf: Path | None,
) -> dict[str, Any]:
    """Build the lookup SQLite file at ``out`` and return its counts/meta.

    At least one source is required. The build streams both dumps, deduplicates
    identical ``(source, source_id)`` rows, skips works without a usable title
    key, and never stores summaries, prices, covers or descriptions.
    """
    if rokomari_bg is None and rokomari_hf is None:
        raise ValueError("build_index needs rokomari_bg and/or rokomari_hf")

    destination = Path(out)
    temporary = destination.with_name(destination.name + ".tmp")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if temporary.exists():
        temporary.unlink()

    notes: list[str] = []
    hashes: dict[str, str] = {}
    counts: dict[str, dict[str, int]] = {}
    author_accum: dict[str, str] = {}
    sources: dict[str, str | None] = {
        SOURCE_BG: str(rokomari_bg) if rokomari_bg is not None else None,
        SOURCE_HF: str(rokomari_hf) if rokomari_hf is not None else None,
    }

    with closing(sqlite3.connect(temporary)) as conn:
        conn.execute("PRAGMA synchronous = OFF")
        conn.execute(_WORKS_SCHEMA)
        conn.execute("CREATE INDEX works_title_key ON works(title_key)")
        conn.execute(_AUTHORS_SCHEMA)
        conn.execute(_META_SCHEMA)
        conn.execute("BEGIN")
        if rokomari_bg is not None:
            counts[SOURCE_BG] = _load_bg(
                conn,
                Path(rokomari_bg),
                hashes=hashes,
                notes=notes,
                author_accum=author_accum,
            )
        if rokomari_hf is not None:
            counts[SOURCE_HF] = _load_hf(
                conn,
                Path(rokomari_hf),
                hashes=hashes,
                notes=notes,
                author_accum=author_accum,
            )
        author_rows = _count_author_works(conn, author_accum)
        total_works = sum(values["works"] for values in counts.values())

        meta = {
            "builder": BUILDER,
            "sources": json.dumps(sources, ensure_ascii=False, sort_keys=True),
            "sha256": json.dumps(hashes, ensure_ascii=False, sort_keys=True),
            "counts": json.dumps(counts, ensure_ascii=False, sort_keys=True),
            "notes": json.dumps(notes, ensure_ascii=False, sort_keys=True),
        }
        conn.executemany(
            "INSERT INTO meta (key, value) VALUES (?, ?)",
            sorted(meta.items()),
        )
        conn.commit()

    os.replace(temporary, destination)
    return {
        "index": str(destination),
        "builder": BUILDER,
        "sources": sources,
        "sha256": hashes,
        "counts": counts,
        "notes": notes,
        "works": total_works,
        "authors": author_rows,
    }


def _json_list(value: Any) -> list[str]:
    """Decode a JSON list column defensively."""
    if not value:
        return []
    try:
        data = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(data, list):
        return []
    return [str(item) for item in data]


def _is_collection(title_key: str) -> bool:
    return any(word in title_key for word in _COLLECTION_WORDS)


DOMINANT_SHARE = 0.9
DOMINANT_MIN = 3


def lookup_title(index: Path, title: str) -> dict[str, Any]:
    """Look up a title in the read-only catalogue index.

    ``authors`` is the intersection of the author sets of every matching work
    that has authors, in first-appearance order; failing that, the authors
    named on >= 90% (and at least 3) of those works. Conflicting authors or a
    collection-style title make the result ``ambiguous`` with no authors.
    Entries, per-author counts and a small sample are still reported. The
    index is opened ``mode=ro&immutable=1`` and is never created or modified.
    """
    path = Path(index)
    if not path.is_file():
        raise FileNotFoundError(f"catalogue index not found: {path}")
    title_key = normalize_key(title)
    result: dict[str, Any] = {
        "title_key": title_key,
        "entries": 0,
        "authors": [],
        "author_counts": {},
        "ambiguous": False,
        "sources": [],
        "sample": [],
    }
    if not title_key:
        return result

    url = f"file:{path}?mode=ro&immutable=1"
    with closing(sqlite3.connect(url, uri=True)) as conn:
        rows = conn.execute(
            "SELECT source, source_id, title, authors, author_keys, publisher, url "
            "FROM works WHERE title_key = ? ORDER BY rowid",
            (title_key,),
        ).fetchall()
        if not rows:
            return result

        parsed: list[tuple[tuple[Any, ...], list[str], list[str]]] = []
        wanted: set[str] = set()
        for row in rows:
            displays = _json_list(row[3])
            keys = _json_list(row[4])
            parsed.append((row, displays, keys))
            wanted.update(keys)

        table_displays: dict[str, str] = {}
        ordered_keys = sorted(wanted)
        for start in range(0, len(ordered_keys), _BATCH_SIZE):
            chunk = ordered_keys[start : start + _BATCH_SIZE]
            placeholders = ",".join("?" for _ in chunk)
            for key, display in conn.execute(
                f"SELECT author_key, display FROM authors WHERE author_key IN ({placeholders})",
                chunk,
            ):
                if display:
                    table_displays[key] = str(display)

    display_by_key: dict[str, str] = {}
    for _row, displays, keys in parsed:
        for key, display in zip(keys, displays):
            display_by_key.setdefault(key, display)
    for key, display in table_displays.items():
        display_by_key[key] = display

    entry_author_lists = [keys for _row, _displays, keys in parsed if keys]
    common: set[str] = set()
    if entry_author_lists:
        common = set(entry_author_lists[0])
        for keys in entry_author_lists[1:]:
            common &= set(keys)
    # Retail data mislabels the odd entry: Rokomari files a critical study
    # (`গোরা সন্দর্শন ও রবীন্দ্রনাথ`) under the bare title `গোরা`, which empties
    # a strict intersection for a book 27 of 28 editions credit to Tagore.
    # Because this signal can only corroborate, an author named on at least
    # DOMINANT_SHARE of the authored entries (and on at least DOMINANT_MIN of
    # them) also counts. Titles shared by different works stay ambiguous.
    if not common and len(entry_author_lists) >= DOMINANT_MIN:
        tally: dict[str, int] = {}
        for keys in entry_author_lists:
            for key in set(keys):
                tally[key] = tally.get(key, 0) + 1
        threshold = DOMINANT_SHARE * len(entry_author_lists)
        common = {
            key for key, count in tally.items()
            if count >= DOMINANT_MIN and count >= threshold
        }

    ambiguous = bool(entry_author_lists) and not common
    if _is_collection(title_key):
        ambiguous = True

    authors: list[str] = []
    if common and not ambiguous:
        order = [key for keys in entry_author_lists for key in keys]
        authors = [
            display_by_key.get(key, key) for key in dict.fromkeys(order) if key in common
        ]

    author_counts: dict[str, int] = {}
    for _row, displays, keys in parsed:
        seen: set[str] = set()
        for key, display in zip(keys, displays):
            name = display_by_key.get(key, display or key)
            if name and name not in seen:
                seen.add(name)
                author_counts[name] = author_counts.get(name, 0) + 1

    sources = sorted({str(row[0]) for row in rows if row[0]})
    sample = [
        {
            "source": row[0],
            "source_id": row[1],
            "title": row[2],
            "authors": displays,
            "publisher": row[5],
            "url": row[6],
        }
        for row, displays, _keys in parsed[:5]
    ]

    return {
        "title_key": title_key,
        "entries": len(rows),
        "authors": authors,
        "author_counts": author_counts,
        "ambiguous": ambiguous,
        "sources": sources,
        "sample": sample,
    }
