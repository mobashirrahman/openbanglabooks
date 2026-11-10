from __future__ import annotations

from pdf2epub.pdfcraft import _Block, _Paragraph, _plain_text, _split_text_layout


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
