"""Tests for the local Rokomari catalogue index (offline fixtures only)."""

from __future__ import annotations

import gzip
import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from pdf2epub.catalogue_index import build_index, lookup_title, normalize_key

SUMMARY_SENTINEL = "SECRET_SUMMARY_SENTINEL"
PRICE_SENTINEL = "PRICE_SENTINEL"
COVER_SENTINEL = "COVER_SENTINEL"


def _write_array(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        handle.write(json.dumps(rows, ensure_ascii=False, indent=2))


def _write_jsonl(path: Path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        for line in lines:
            handle.write(line + "\n")


def _make_bg(tmp_path: Path) -> Path:
    """Small RokomariBG-shaped directory with the usual traps."""
    directory = tmp_path / "rokomari-bg"
    _write_array(
        directory / "author.json.gz",
        [
            {"author_id": 1, "author": "শরৎচন্দ্র চট্টোপাধ্যায়"},
            {"author_id": 2, "author": "আনিসুজ্জামান"},
            {"author_id": 3, "author": "রবীন্দ্রনাথ ঠাকুর"},
            {"author_id": 4, "author": "কাজী নজরুল ইসলাম"},
            {"author_id": 5, "author": "অব্যবহৃত লেখক"},
        ],
    )
    _write_array(
        directory / "publisher.json.gz",
        [{"publisher_id": 10, "publisher_name": "প্রকাশনী"}],
    )
    _write_array(
        directory / "category.json.gz",
        [{"category_id": 100, "category_name": "উপন্যাস"}],
    )
    _write_array(
        directory / "book_to_author.json.gz",
        [{"book_id": 111, "author_id": 2}],
    )
    _write_array(
        directory / "book.json.gz",
        [
            {
                "book_id": 101,
                "book_title": "দেবদাস",
                "author_id": 1,
                "publisher_id": 10,
                "category_id": 100,
                "isbn": "9780000000001",
                "book_url": "https://example.test/101",
                "book_summary": SUMMARY_SENTINEL,
                "prices": {"price": PRICE_SENTINEL},
                "book_cover": COVER_SENTINEL,
            },
            {
                "book_id": 102,
                "book_title": "দেবদাস (হার্ডকভার)",
                "author_id": 1,
                "publisher_id": "None",
                "category_id": "None",
                "isbn": "None",
                "book_url": "https://example.test/102",
            },
            # Same book id again: the unique key must drop it.
            {
                "book_id": 101,
                "book_title": "দেবদাস",
                "author_id": 1,
                "book_url": "https://example.test/101-again",
                "book_summary": SUMMARY_SENTINEL,
            },
            {
                "book_id": 103,
                "book_title": "গোরা",
                "author_id": 3,
                "book_url": "https://example.test/103",
            },
            {
                "book_id": 111,
                "book_title": "গোরা",
                "author_id": 3,
                "book_url": "https://example.test/111",
            },
            {
                "book_id": 104,
                "book_title": "গল্প সমগ্র",
                "author_id": 4,
                "book_url": "https://example.test/104",
            },
            {
                "book_id": 105,
                "book_title": "শ্রীকান্ত (হার্ডকভার)",
                "author_id": 1,
                "book_url": "https://example.test/105",
            },
            {
                "book_id": 106,
                "book_title": "   ",
                "author_id": 1,
                "book_url": "https://example.test/106",
            },
            {
                "book_id": 108,
                "book_title": "দ্বন্দ্ব",
                "author_id": 1,
                "book_url": "https://example.test/108",
            },
            {
                "book_id": 109,
                "book_title": "দ্বন্দ্ব",
                "author_id": 4,
                "book_url": "https://example.test/109",
            },
            {
                "book_id": 110,
                "book_title": "নিষ্ক্রিয়",
                "author_id": "1",
                "publisher_id": "None",
                "category_id": "None",
                "isbn": "None",
                "book_url": "https://example.test/110",
            },
        ],
    )
    return directory


HF_NAV_AUTHORS = ["আহমদ ছফা", "হুমায়ূন আহমেদ", "রবীন্দ্রনাথ ঠাকুর"]
HF_NAV_PUBLISHERS = ["অনুপম প্রকাশনী", "সময় প্রকাশন"]


def _make_hf(tmp_path: Path) -> Path:
    """Rokomari-HF-shaped JSONL with navigation-menu and malformed traps."""
    path = tmp_path / "rokomari-hf" / "data.jsonl.gz"

    def line(value: object) -> str:
        return json.dumps(value, ensure_ascii=False)

    _write_jsonl(
        path,
        [
            line(
                {
                    "url": "https://example.test/hf/1",
                    "name": "পথের পাঁচালী",
                    "productType": "book",
                    "authors": HF_NAV_AUTHORS,
                    "publishers": HF_NAV_PUBLISHERS,
                    "specification": line(
                        {
                            "Title": "পথের পাঁচালী",
                            "Author": "বিভূতিভূষণ বন্দ্যোপাধ্যায়",
                            "Publisher": "প্রকাশনী",
                            "ISBN": "9780000000002",
                            "Category": "উপন্যাস",
                        }
                    ),
                }
            ),
            line(
                {
                    "url": "https://example.test/hf/2",
                    "name": "আবোল তাবোল",
                    "productType": "book",
                    "authors": HF_NAV_AUTHORS,
                    "publishers": HF_NAV_PUBLISHERS,
                    "specification": {
                        "Title": "আবোল তাবোল",
                        "Author": "A, B & C",
                    },
                }
            ),
            line(
                {
                    "url": "https://example.test/hf/3",
                    "name": "লীলাবতী",
                    "productType": "book",
                    "authors": HF_NAV_AUTHORS,
                    "specification": {"Title": "লীলাবতী"},
                }
            ),
            line(
                {
                    "url": "https://example.test/hf/product",
                    "productType": "product",
                    "specification": {"Title": "একটি পণ্য"},
                }
            ),
            "{this is not json",
            line(
                {
                    "url": "https://example.test/hf/no-title",
                    "productType": "book",
                    "specification": {"Author": "লেখক"},
                }
            ),
            line([1, 2, 3]),
            line(
                {
                    "url": "https://example.test/hf/8",
                    "productType": "book",
                    "specification": {
                        "Title": "চাঁদের পাহাড়",
                        "Author": "বিভূতিভূষণ বন্দ্যোপাধ্যায়",
                    },
                }
            ),
        ],
    )
    return path


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------


def test_normalize_key_strips_binding_notes_and_edges():
    assert normalize_key("  শ্রীকান্ত (হার্ডকভার)  ") == "শ্রীকান্ত"
    assert normalize_key("শ্রীকান্ত (Hardcover)") == "শ্রীকান্ত"
    assert normalize_key("শ্রীকান্ত (পেপার ব্যাক)") == "শ্রীকান্ত"
    assert normalize_key("“গোরা”") == "গোরা"
    # Internal punctuation and Bengali vowel signs are preserved.
    assert normalize_key("চাঁদের-পাহাড়") == "চাঁদের-পাহাড়"
    assert normalize_key("কী") != normalize_key("কি")


# ---------------------------------------------------------------------------
# RokomariBG build
# ---------------------------------------------------------------------------


def test_build_bg_counts_dedupes_and_omits_licensed_fields(tmp_path):
    directory = _make_bg(tmp_path)
    out = tmp_path / "index.sqlite3"

    built = build_index(out, rokomari_bg=directory, rokomari_hf=None)

    assert out.is_file()
    assert not out.with_name(out.name + ".tmp").exists()
    assert built["works"] == 9
    assert built["authors"] == 4
    bg = built["counts"]["rokomari-bg"]
    assert bg == {"works": 9, "skipped": 1, "malformed": 0, "duplicates": 1}

    with closing(sqlite3.connect(f"file:{out}?mode=ro&immutable=1", uri=True)) as conn:
        meta = dict(conn.execute("SELECT key, value FROM meta"))
        counts = json.loads(meta["counts"])
        hashes = json.loads(meta["sha256"])
        works = conn.execute("SELECT COUNT(*) FROM works").fetchone()[0]
        authors = conn.execute("SELECT COUNT(*) FROM authors").fetchone()[0]
        author_counts = dict(
            conn.execute("SELECT author_key, works FROM authors")
        )

    assert meta["builder"] == "catalogue-index-v1"
    assert counts["rokomari-bg"] == bg
    assert hashes["rokomari-bg/book.json.gz"]
    assert works == 9
    assert authors == 4
    assert author_counts["শরৎচন্দ্র চট্টোপাধ্যায়"] == 5
    assert author_counts["রবীন্দ্রনাথ ঠাকুর"] == 2
    assert author_counts["আনিসুজ্জামান"] == 1

    raw = out.read_bytes()
    assert SUMMARY_SENTINEL.encode() not in raw
    assert PRICE_SENTINEL.encode() not in raw
    assert COVER_SENTINEL.encode() not in raw


def test_build_requires_at_least_one_source(tmp_path):
    with pytest.raises(ValueError):
        build_index(tmp_path / "index.sqlite3", rokomari_bg=None, rokomari_hf=None)


def test_build_bg_without_book_file_still_writes_an_index(tmp_path):
    directory = tmp_path / "empty-bg"
    directory.mkdir()

    built = build_index(
        tmp_path / "index.sqlite3", rokomari_bg=directory, rokomari_hf=None
    )

    assert built["works"] == 0
    assert built["counts"]["rokomari-bg"]["works"] == 0
    assert any("book.json.gz" in note for note in built["notes"])


# ---------------------------------------------------------------------------
# Rokomari-HF build
# ---------------------------------------------------------------------------


def test_build_hf_ignores_nav_menu_and_counts_bad_lines(tmp_path):
    path = _make_hf(tmp_path)
    out = tmp_path / "index.sqlite3"

    built = build_index(out, rokomari_bg=None, rokomari_hf=path)

    counts = built["counts"]["rokomari-hf"]
    assert counts == {"works": 4, "skipped": 2, "malformed": 2, "duplicates": 0}
    assert built["works"] == 4

    listing = lookup_title(out, "আবোল তাবোল")
    assert listing["entries"] == 1
    assert listing["authors"] == ["A", "B", "C"]
    assert not set(HF_NAV_AUTHORS) & set(listing["authors"])
    assert listing["sample"][0]["source"] == "rokomari-hf"
    assert listing["sample"][0]["source_id"] == "https://example.test/hf/2"

    nav_only = lookup_title(out, "লীলাবতী")
    assert nav_only["entries"] == 1
    assert nav_only["authors"] == []

    spec_as_string = lookup_title(out, "পথের পাঁচালী")
    assert spec_as_string["authors"] == ["বিভূতিভূষণ বন্দ্যোপাধ্যায়"]
    assert spec_as_string["sample"][0]["publisher"] == "প্রকাশনী"


# ---------------------------------------------------------------------------
# Lookup rules
# ---------------------------------------------------------------------------


@pytest.fixture()
def index_path(tmp_path: Path) -> Path:
    out = tmp_path / "index.sqlite3"
    build_index(out, rokomari_bg=_make_bg(tmp_path), rokomari_hf=_make_hf(tmp_path))
    return out


def test_single_author_across_editions(index_path: Path):
    result = lookup_title(index_path, "দেবদাস")
    assert result["entries"] == 2
    assert result["authors"] == ["শরৎচন্দ্র চট্টোপাধ্যায়"]
    assert result["ambiguous"] is False
    assert result["author_counts"] == {"শরৎচন্দ্র চট্টোপাধ্যায়": 2}
    assert result["sources"] == ["rokomari-bg"]


def test_editor_plus_author_editions_keep_the_shared_author(index_path: Path):
    result = lookup_title(index_path, "গোরা")
    assert result["entries"] == 2
    assert result["authors"] == ["রবীন্দ্রনাথ ঠাকুর"]
    assert result["ambiguous"] is False
    assert result["author_counts"]["আনিসুজ্জামান"] == 1


def test_different_authors_same_title_is_ambiguous(index_path: Path):
    result = lookup_title(index_path, "দ্বন্দ্ব")
    assert result["entries"] == 2
    assert result["ambiguous"] is True
    assert result["authors"] == []
    assert len(result["author_counts"]) == 2


def test_collection_title_is_ambiguous_even_with_one_author(index_path: Path):
    result = lookup_title(index_path, "গল্প সমগ্র")
    assert result["entries"] == 1
    assert result["ambiguous"] is True
    assert result["authors"] == []
    assert result["author_counts"] == {"কাজী নজরুল ইসলাম": 1}


def test_binding_note_is_stripped_for_lookup(index_path: Path):
    assert lookup_title(index_path, "শ্রীকান্ত")["entries"] == 1
    assert lookup_title(index_path, "শ্রীকান্ত (Hardcover)")["entries"] == 1
    assert lookup_title(index_path, "শ্রীকান্ত (হার্ডকভার)")["entries"] == 1


def test_unknown_title_returns_empty_result(index_path: Path):
    result = lookup_title(index_path, "কোনো অজানা বই")
    assert result["entries"] == 0
    assert result["authors"] == []
    assert result["ambiguous"] is False
    assert result["sources"] == []
    assert result["sample"] == []


def test_sample_never_carries_summaries_or_prices(index_path: Path):
    result = lookup_title(index_path, "দেবদাস")
    assert set(result["sample"][0]) == {
        "source",
        "source_id",
        "title",
        "authors",
        "publisher",
        "url",
    }
    assert len(result["sample"]) == 2


def test_lookup_missing_index_raises_and_creates_nothing(tmp_path: Path):
    missing = tmp_path / "missing.sqlite3"
    with pytest.raises(FileNotFoundError):
        lookup_title(missing, "দেবদাস")
    assert not missing.exists()


def test_lookup_is_read_only(index_path: Path):
    before = index_path.read_bytes()
    before_mtime = index_path.stat().st_mtime_ns
    before_names = {item.name for item in index_path.parent.iterdir()}

    lookup_title(index_path, "দেবদাস")

    assert index_path.read_bytes() == before
    assert index_path.stat().st_mtime_ns == before_mtime
    assert {item.name for item in index_path.parent.iterdir()} == before_names


def _hand_index(tmp_path: Path, author_lists: list[list[str]], title: str = "গোরা") -> Path:
    """A minimal index with one title and the given per-entry author lists."""
    import json as _json
    import sqlite3 as _sqlite3

    from pdf2epub.catalogue_index import normalize_key

    path = tmp_path / "hand.sqlite3"
    conn = _sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE works(source TEXT, source_id TEXT, title TEXT, title_key TEXT, "
        "authors TEXT, author_keys TEXT, publisher TEXT, isbn TEXT, category TEXT, url TEXT)"
    )
    conn.execute("CREATE TABLE authors(author_key TEXT PRIMARY KEY, display TEXT, works INTEGER)")
    for i, names in enumerate(author_lists):
        conn.execute(
            "INSERT INTO works VALUES (?,?,?,?,?,?,?,?,?,?)",
            ("rokomari-bg", str(i), title, normalize_key(title),
             _json.dumps(names, ensure_ascii=False),
             _json.dumps([normalize_key(n) for n in names], ensure_ascii=False),
             None, None, None, None),
        )
    conn.commit()
    conn.close()
    return path


def test_dominant_author_survives_one_mislabelled_entry(tmp_path: Path):
    tagore = "রবীন্দ্রনাথ ঠাকুর"
    lists = [[tagore]] * 24 + [["আনিসুজ্জামান", tagore], [], ["কেশব আড়ু"]]
    result = lookup_title(_hand_index(tmp_path, lists), "গোরা")
    assert result["authors"] == [tagore]
    assert result["ambiguous"] is False


def test_split_title_stays_ambiguous(tmp_path: Path):
    lists = [["লেখক এক"]] * 2 + [["লেখক দুই"]] * 2
    result = lookup_title(_hand_index(tmp_path, lists, "ছায়া"), "ছায়া")
    assert result["authors"] == []
    assert result["ambiguous"] is True


def test_dominance_needs_enough_entries(tmp_path: Path):
    lists = [["লেখক এক"]] * 2 + [["লেখক দুই"]]
    result = lookup_title(_hand_index(tmp_path, lists, "ছায়া"), "ছায়া")
    assert result["ambiguous"] is True
