from __future__ import annotations

from pdf2epub.pdfcraft import (
    _Asset,
    _Block,
    _Chapter,
    _Paragraph,
    _plain_text,
    _split_front_matter,
    _split_text_layout,
)


def block(page: int, order: int, text: str) -> _Block:
    return _Block(page=page, order=order, content=[text])


def test_splits_pages_heading_and_page_number():
    layout = _Paragraph(
        ref="text",
        level=-1,
        blocks=[
            block(3, 0, "এক"),
            block(3, 1, "ভবানীপুরের চাটুয্যের পরিবার।"),
            block(3, 2, "৩"),
            block(4, 0, "বাড়ি আসা-বাওয়ার অল্প সময়।"),
        ],
    )
    parts = _split_text_layout(layout)

    assert [part.ref for part in parts] == ["title", "text", "text"]
    assert _plain_text(parts[0].blocks[0].content) == "এক"
    assert _plain_text(parts[1].blocks[0].content) == "ভবানীপুরের চাটুয্যের পরিবার।"
    assert all("৩" != _plain_text(item.content) for part in parts for item in part.blocks)
    assert _plain_text(parts[2].blocks[0].content).startswith("বাড়ি")


def test_leaves_regular_paragraph_alone():
    layout = _Paragraph(
        ref="text",
        level=-1,
        blocks=[block(7, 0, "সাধারণ অনুচ্ছেদ।"), block(7, 1, "দ্বিতীয় বাক্য।")],
    )
    assert _split_text_layout(layout) == [layout]


def test_preserves_verse_layout():
    layout = _Paragraph(ref="verse", level=-1, blocks=[block(2, 0, "পঙক্তি"), block(2, 1, "২")])
    assert _split_text_layout(layout) == [layout]


def test_splits_front_matter_at_first_chapter_marker():
    chapter = _Chapter(
        id=1,
        level=0,
        layouts=[
            _Paragraph(ref="text", level=-1, blocks=[block(1, 0, "প্রকাশক"), block(2, 0, "মাঘ ১৩৫৯")]),
            _Paragraph(ref="title", level=1, blocks=[block(3, 0, "এক")]),
            _Paragraph(ref="text", level=-1, blocks=[block(3, 1, "ভবানীপুরের চাটুয্যের পরিবার।")]),
        ],
    )
    parts = _split_front_matter([chapter])

    assert [part.id for part in parts] == [None, 1]
    assert _plain_text(parts[1].layouts[0].blocks[0].content) == "এক"
    assert _plain_text(parts[0].layouts[0].blocks[0].content) == "প্রকাশক"


def test_front_matter_moves_early_page_assets():
    asset = lambda page: _Asset(
        ref="image", page=page, det=(0, 0, 10, 10), title=[], content=[], caption=[], hash=None
    )
    chapter = _Chapter(
        id=3,
        level=0,
        layouts=[
            _Paragraph(ref="title", level=1, blocks=[block(3, 0, "এক")]),
            _Paragraph(ref="text", level=-1, blocks=[block(3, 1, "পাঠ।")]),
            asset(1),
            asset(2),
        ],
    )
    parts = _split_front_matter([chapter])

    assert [part.id for part in parts] == [None, 3]
    assert [item.page for item in parts[0].layouts if isinstance(item, _Asset)] == [1, 2]
    assert not [item for item in parts[1].layouts if isinstance(item, _Asset)]


def test_front_matter_split_leaves_markerless_chapter_alone():
    chapter = _Chapter(
        id=2,
        level=0,
        layouts=[_Paragraph(ref="text", level=-1, blocks=[block(4, 0, "সাধারণ পাঠ।")])],
    )
    assert _split_front_matter([chapter]) == [chapter]
